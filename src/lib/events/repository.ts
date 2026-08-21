import { createClient } from '@supabase/supabase-js';

import { GAME_SLUGS, isGameSlug } from '@/config/games';
import { logger } from '@/lib/logger';
import mockEvents from '@/mocks/events.json';
import type { GameEvent } from '@/types/event';

/**
 * 이벤트 데이터 접근 계층.
 *
 * Supabase 환경변수가 설정돼 있으면 DB에서 읽고, 없으면 목 데이터로 동작한다.
 * 덕분에 DB 없이도 UI 개발과 빌드가 가능하고, 나중에 키만 채우면 코드 수정 없이 전환된다.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** DB 연결 정보가 갖춰졌는지. 둘 중 하나라도 비면 목 데이터를 쓴다. */
export const isDatabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * 화면에 불러올 과거 구간의 길이(일).
 *
 * DB에는 수집한 일정이 계속 쌓이지만, 달력에서 실제로 보는 것은 최근과 앞으로다.
 * 오래전에 끝난 일정까지 매번 실어 나르면 응답만 무거워진다.
 * 이 값을 넘긴 데이터도 DB에는 그대로 남아 있어, 나중에 통계를 내거나
 * 기간을 늘리고 싶을 때 다시 꺼낼 수 있다.
 */
const PAST_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 이 시각 이전에 이미 끝난 일정은 부르지 않는다. */
function pastCutoff(now: number): string {
  return new Date(now - PAST_WINDOW_DAYS * DAY_MS).toISOString();
}

/**
 * 아직 화면에 보일 만한 일정인지.
 *
 * 종료일을 모르는 일정(리딤코드, 상시 공지 등)은 시작일로 판단한다.
 * 미래 일정은 시작일이 오늘보다 뒤이므로 항상 통과한다.
 */
function isWithinWindow(event: GameEvent, cutoff: string): boolean {
  return (event.endAt ?? event.startAt) >= cutoff;
}

/**
 * 지원 목록에서 내려간 게임의 일정을 걸러낸다.
 *
 * 게임을 목록에서 빼도 그 게임의 일정은 DB에 그대로 남는다. 지우지 않는 이유는
 * 나중에 다시 넣기로 하면 과거 일정을 되살릴 수 없기 때문이다.
 *
 * 다만 화면은 게임 레지스트리에서 색과 이름을 찾으므로, 등록되지 않은 일정이
 * 흘러들면 렌더링 도중 터진다. 데이터 계층에서 미리 막아 둔다.
 */
function isSupportedGame(event: GameEvent): boolean {
  return isGameSlug(event.gameSlug);
}

/** DB의 snake_case 컬럼을 앱에서 쓰는 camelCase로 옮긴다. */
interface EventRow {
  id: string;
  game_slug: string;
  type: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  region: string;
  source_url: string | null;
  source_kind: string;
  image_url: string | null;
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

function toGameEvent(row: EventRow): GameEvent {
  return {
    id: row.id,
    gameSlug: row.game_slug as GameEvent['gameSlug'],
    type: row.type as GameEvent['type'],
    title: row.title,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    region: row.region as GameEvent['region'],
    sourceUrl: row.source_url,
    sourceKind: row.source_kind as GameEvent['sourceKind'],
    imageUrl: row.image_url,
    externalId: row.external_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface EventSnapshot {
  events: GameEvent[];
  /**
   * 이 목록을 읽은 시각(ISO 8601).
   *
   * 화면의 "진행 중 / 종료 D-3" 판정에 쓸 기준 시각이기도 하다.
   * 서버 컴포넌트가 직접 `Date.now()`를 부르면 렌더가 비순수해지므로,
   * 시각을 만드는 책임을 데이터 계층에 둔다.
   */
  fetchedAt: string;
}

/** 목 데이터에도 DB와 같은 기준을 적용한다. 개발과 운영이 다르게 보이면 안 된다. */
function filterMockEvents(cutoff: string): GameEvent[] {
  return (mockEvents as GameEvent[]).filter(
    (event) => isSupportedGame(event) && isWithinWindow(event, cutoff),
  );
}

/**
 * 전체 이벤트를 가져온다.
 *
 * DB 조회가 실패하더라도 화면이 완전히 비어버리지 않도록 목 데이터로 되돌아간다.
 */
export async function getEvents(): Promise<EventSnapshot> {
  const fetchedAt = new Date().toISOString();

  const cutoff = pastCutoff(Date.parse(fetchedAt));

  if (!isDatabaseConfigured) {
    return { events: filterMockEvents(cutoff), fetchedAt };
  }

  try {
    const supabase = createClient(supabaseUrl!, supabaseAnonKey!);
    const { data, error } = await supabase
      .from('events')
      .select('*')
      // 지원 목록에서 내려간 게임은 애초에 가져오지 않는다.
      .in('game_slug', GAME_SLUGS)
      // 종료일이 있으면 그 값으로, 없으면 시작일로 걸러낸다.
      // PostgREST에서는 이런 "둘 중 하나" 조건을 or(...) 문자열로 적는다.
      .or(`end_at.gte.${cutoff},and(end_at.is.null,start_at.gte.${cutoff})`)
      .order('start_at', { ascending: false });

    if (error) throw new Error(error.message);

    return { events: (data as EventRow[]).map(toGameEvent), fetchedAt };
  } catch (error) {
    logger.error({ err: error }, 'DB 조회 실패. 목 데이터로 대체합니다.');
    return { events: filterMockEvents(cutoff), fetchedAt };
  }
}
