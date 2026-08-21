import { createClient } from '@supabase/supabase-js';

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

/**
 * 전체 이벤트를 가져온다.
 *
 * DB 조회가 실패하더라도 화면이 완전히 비어버리지 않도록 목 데이터로 되돌아간다.
 */
export async function getEvents(): Promise<EventSnapshot> {
  const fetchedAt = new Date().toISOString();

  if (!isDatabaseConfigured) {
    return { events: mockEvents as GameEvent[], fetchedAt };
  }

  try {
    const supabase = createClient(supabaseUrl!, supabaseAnonKey!);
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('start_at', { ascending: false });

    if (error) throw new Error(error.message);

    return { events: (data as EventRow[]).map(toGameEvent), fetchedAt };
  } catch (error) {
    logger.error({ err: error }, 'DB 조회 실패. 목 데이터로 대체합니다.');
    return { events: mockEvents as GameEvent[], fetchedAt };
  }
}
