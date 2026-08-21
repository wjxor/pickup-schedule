import { GAME_LIST, type GameDefinition } from '@/config/games';
import { logger } from '@/lib/logger';
import { collectCrawler, collectManual } from '@/lib/collectors/adapters/crawler';
import { collectHoyoverse } from '@/lib/collectors/adapters/hoyoverse';
import { collectSteam } from '@/lib/collectors/adapters/steam';
import type {
  CollectorAdapter,
  CollectorContext,
  CollectorKind,
  CollectorResult,
} from '@/lib/collectors/types';
import { collectedEventSchema } from '@/types/event';

/**
 * 수집 방식 → 어댑터 매핑.
 * 새 수집 방식을 만들면 여기에 등록한다. 게임을 추가할 때는 대부분 손댈 필요가 없다.
 */
const ADAPTERS: Record<CollectorKind, CollectorAdapter> = {
  hoyoverse: collectHoyoverse,
  steam: collectSteam,
  crawler: collectCrawler,
  manual: collectManual,
};

/** 기본 컨텍스트. 스크립트에서 일부만 덮어쓸 수 있게 부분 지정을 허용한다. */
export function createCollectorContext(overrides: Partial<CollectorContext> = {}): CollectorContext {
  return {
    now: new Date(),
    userAgent:
      process.env.COLLECTOR_USER_AGENT ?? 'PickupScheduleBot/0.1 (+https://example.com/about)',
    fetchImpl: fetch,
    ...overrides,
  };
}

/**
 * 게임 하나를 수집한다.
 *
 * 어댑터가 예외를 던지더라도 여기서 붙잡아 결과 객체로 바꾼다.
 * 한 게임의 실패가 배치 전체를 멈추면 안 되기 때문이다.
 */
export async function collectGame(
  game: GameDefinition,
  context: CollectorContext,
): Promise<CollectorResult> {
  const adapter = ADAPTERS[game.collector.kind];

  try {
    const result = await adapter(game, context);

    // 어댑터가 잘못된 모양의 데이터를 만들었다면 DB에 넣기 전에 걸러낸다.
    const validEvents = [];
    const warnings = [...result.warnings];

    for (const event of result.events) {
      const parsed = collectedEventSchema.safeParse(event);
      if (parsed.success) {
        validEvents.push(parsed.data);
      } else {
        warnings.push(`검증 실패 (${event.title}): ${parsed.error.issues[0]?.message ?? '알 수 없음'}`);
      }
    }

    return { ...result, events: validEvents, warnings };
  } catch (error) {
    return {
      gameSlug: game.slug,
      events: [],
      skippedReason: `어댑터에서 처리되지 않은 오류: ${(error as Error).message}`,
      warnings: [],
    };
  }
}

/**
 * 지정한 게임들을 순차 수집한다.
 *
 * 동시 실행하지 않는 이유: 상대 서버에 부담을 주지 않기 위해서다.
 * 게임이 6개뿐이라 순차로 돌아도 전체 수십 초면 끝난다.
 */
export async function collectAll(
  games: GameDefinition[] = GAME_LIST,
  context: CollectorContext = createCollectorContext(),
): Promise<CollectorResult[]> {
  const results: CollectorResult[] = [];

  for (const game of games) {
    const result = await collectGame(game, context);
    results.push(result);

    if (result.skippedReason) {
      logger.warn({ game: game.name, reason: result.skippedReason }, '수집 건너뜀');
    } else {
      logger.info({ game: game.name, count: result.events.length }, '수집 완료');
    }

    for (const warning of result.warnings) {
      logger.debug({ game: game.name }, warning);
    }
  }

  return results;
}
