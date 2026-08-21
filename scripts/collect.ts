/**
 * 일정 수집 CLI.
 *
 * 사용법:
 *   npm run collect                       모든 게임을 수집해 결과 요약만 출력
 *   npm run collect -- --game genshin     특정 게임만 수집
 *   npm run collect -- --out <경로>        수집 결과를 JSON 파일로 저장
 *
 * 목 데이터를 갱신할 때:
 *   npm run collect:mock
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { GAME_LIST, getGame, type GameDefinition } from '@/config/games';
import { collectAll, createCollectorContext } from '@/lib/collectors';
import { logger } from '@/lib/logger';
import type { GameEvent } from '@/types/event';

interface CliOptions {
  games: GameDefinition[];
  outPath: string | null;
}

/** `--key value` 형태의 인자만 지원한다. 옵션이 늘면 파서 라이브러리로 교체한다. */
function parseArgs(argv: string[]): CliOptions {
  let outPath: string | null = null;
  const slugs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--out') {
      outPath = argv[index + 1] ?? null;
      index += 1;
    } else if (current === '--game') {
      const slug = argv[index + 1];
      if (slug) slugs.push(slug);
      index += 1;
    }
  }

  const games = slugs.length === 0 ? GAME_LIST : slugs.flatMap((slug) => {
    const game = getGame(slug);
    if (!game) {
      logger.warn({ slug }, '알 수 없는 게임 슬러그라 무시합니다');
      return [];
    }
    return [game];
  });

  return { games, outPath };
}

async function main(): Promise<void> {
  const { games, outPath } = parseArgs(process.argv.slice(2));

  if (games.length === 0) {
    logger.error('수집할 게임이 없습니다.');
    process.exitCode = 1;
    return;
  }

  const context = createCollectorContext();
  logger.info({ games: games.map((game) => game.name) }, '수집 시작');

  const results = await collectAll(games, context);
  const collectedAt = new Date().toISOString();

  // 수집 결과를 화면에 그릴 수 있는 형태(GameEvent)로 승격시킨다.
  // 실제 운영에서는 DB가 id와 타임스탬프를 채우지만, 스냅샷 파일에서는 여기서 만든다.
  const events: GameEvent[] = results.flatMap((result) =>
    result.events.map((event) => ({
      ...event,
      id: randomUUID(),
      createdAt: collectedAt,
      updatedAt: collectedAt,
    })),
  );

  const succeeded = results.filter((result) => !result.skippedReason);
  const skipped = results.filter((result) => result.skippedReason);

  logger.info(
    {
      총이벤트: events.length,
      성공: succeeded.length,
      건너뜀: skipped.length,
      경고: results.reduce((sum, result) => sum + result.warnings.length, 0),
    },
    '수집 종료',
  );

  if (outPath === null) return;

  const absolutePath = resolve(process.cwd(), outPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(events, null, 2)}\n`, 'utf8');
  logger.info({ path: absolutePath, count: events.length }, '스냅샷 저장 완료');
}

main().catch((error: unknown) => {
  logger.error({ err: error }, '수집 중 치명적 오류');
  process.exitCode = 1;
});
