import type { CollectorConfig, GameDefinition } from '@/config/games';
import type { CollectedEvent } from '@/types/event';

/** 어댑터 실행에 필요한 주변 환경. 테스트에서 fetch를 갈아끼우기 위해 주입받는다. */
export interface CollectorContext {
  /** 기준 시각. 상대 날짜 계산이나 로그에 쓴다. */
  now: Date;
  /** 외부 API 호출 시 밝힐 User-Agent. */
  userAgent: string;
  /** 기본값은 전역 fetch. 테스트에서는 가짜 함수를 넣는다. */
  fetchImpl: typeof fetch;
}

/** 어댑터 한 번 실행의 결과. 실패해도 예외를 던지지 않고 이 형태로 보고한다. */
export interface CollectorResult {
  gameSlug: GameDefinition['slug'];
  /** 정규화가 끝난 이벤트들. 실패 시 빈 배열. */
  events: CollectedEvent[];
  /**
   * 수집을 아예 건너뛴 이유. 값이 있으면 events는 비어 있다.
   * (어댑터 미구현, 설정 미검증, API 키 없음 등)
   */
  skippedReason?: string;
  /** 일부만 실패했거나 형식이 예상과 달랐던 항목들. 수집은 계속 진행된다. */
  warnings: string[];
}

/** 게임 하나를 수집하는 함수. 게임 종류별로 하나씩 구현한다. */
export type CollectorAdapter = (
  game: GameDefinition,
  context: CollectorContext,
) => Promise<CollectorResult>;

/** 수집 방식(kind) → 어댑터 매핑 테이블의 키 타입. */
export type CollectorKind = CollectorConfig['kind'];

/** 빈 결과를 만드는 헬퍼. 건너뛰기 처리를 한 줄로 끝내기 위해 쓴다. */
export function skipped(
  game: GameDefinition,
  reason: string,
  warnings: string[] = [],
): CollectorResult {
  return { gameSlug: game.slug, events: [], skippedReason: reason, warnings };
}
