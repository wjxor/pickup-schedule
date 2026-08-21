/**
 * Supabase 연결 점검 CLI.
 *
 * 사용법:
 *   npm run db:check
 *
 * 환경변수가 제대로 들어갔는지, 마이그레이션이 적용됐는지, 실제로 읽고 쓸 수 있는지를
 * 순서대로 확인한다. 수집을 돌리기 전에 이걸 먼저 통과시키면 원인 찾기가 훨씬 쉽다.
 */
import { GAME_SLUGS } from '@/config/games';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/supabase/admin';

import { loadEnvFiles } from './load-env';

/** 점검 항목 하나의 결과. */
interface CheckOutcome {
  label: string;
  ok: boolean;
  detail: string;
}

function report(outcomes: CheckOutcome[]): void {
  for (const { label, ok, detail } of outcomes) {
    process.stdout.write(`${ok ? '✅' : '❌'}  ${label} — ${detail}\n`);
  }
}

async function main(): Promise<void> {
  loadEnvFiles();

  const outcomes: CheckOutcome[] = [];

  // 1) 환경변수
  const envPairs = [
    ['NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
  ] as const;

  const missing = envPairs.filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    report([
      {
        label: '환경변수',
        ok: false,
        detail: `없음: ${missing.join(', ')} — .env.local 을 만들고 값을 채우세요 (docs/환경변수.md)`,
      },
    ]);
    process.exitCode = 1;
    return;
  }

  outcomes.push({ label: '환경변수', ok: true, detail: '3개 모두 설정됨' });

  // 2) 연결 + 스키마 적용 여부
  let client;
  try {
    client = createAdminClient().client;
  } catch (error) {
    report([...outcomes, { label: '클라이언트 생성', ok: false, detail: (error as Error).message }]);
    process.exitCode = 1;
    return;
  }

  const { data: games, error: gamesError } = await client
    .from('games')
    .select('slug, name')
    .order('slug');

  if (gamesError) {
    outcomes.push({
      label: 'games 테이블',
      ok: false,
      detail: `${gamesError.message} — supabase/migrations/0001_init.sql 을 SQL Editor에서 실행했는지 확인하세요`,
    });
    report(outcomes);
    process.exitCode = 1;
    return;
  }

  const registeredSlugs = new Set((games ?? []).map((row) => row.slug));
  const notSeeded = GAME_SLUGS.filter((slug) => !registeredSlugs.has(slug));

  outcomes.push({
    label: 'games 테이블',
    ok: notSeeded.length === 0,
    detail:
      notSeeded.length === 0
        ? `${games?.length ?? 0}개 게임 등록됨`
        : `누락된 게임: ${notSeeded.join(', ')}`,
  });

  // 3) events 테이블 접근
  const { count, error: eventsError } = await client
    .from('events')
    .select('*', { count: 'exact', head: true });

  if (eventsError) {
    outcomes.push({ label: 'events 테이블', ok: false, detail: eventsError.message });
    report(outcomes);
    process.exitCode = 1;
    return;
  }

  outcomes.push({ label: 'events 테이블', ok: true, detail: `현재 ${count ?? 0}건 저장됨` });

  report(outcomes);

  if (outcomes.every((outcome) => outcome.ok)) {
    process.stdout.write('\n연결 정상입니다. `npm run collect:save` 로 수집한 일정을 저장할 수 있습니다.\n');
  } else {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  logger.error({ err: error }, '연결 점검 중 오류');
  process.exitCode = 1;
});
