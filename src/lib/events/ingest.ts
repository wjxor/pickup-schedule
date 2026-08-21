import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { CollectedEvent } from '@/types/event';

/**
 * 수집 결과를 DB에 저장한다.
 *
 * 같은 공지를 매일 다시 수집하므로, 삽입이 아니라 upsert(있으면 갱신, 없으면 삽입)로
 * 처리한다. 중복 판정 기준은 (game_slug, external_id) 이다.
 */

/** 한 번에 보낼 행 수. 요청이 너무 커지면 타임아웃이 나므로 나눠 보낸다. */
const CHUNK_SIZE = 200;

export interface IngestResult {
  /** upsert를 시도한 행 수 */
  upserted: number;
  /** 원본 식별자가 없어 저장하지 않은 행 수 */
  skipped: number;
  errors: string[];
}

/** 앱의 camelCase 를 DB 컬럼명(snake_case)으로 옮긴다. */
function toRow(event: CollectedEvent) {
  return {
    game_slug: event.gameSlug,
    type: event.type,
    title: event.title,
    description: event.description,
    start_at: event.startAt,
    end_at: event.endAt,
    region: event.region,
    source_url: event.sourceUrl,
    source_kind: event.sourceKind,
    image_url: event.imageUrl,
    external_id: event.externalId,
  };
}

export async function saveEvents(events: CollectedEvent[]): Promise<IngestResult> {
  const result: IngestResult = { upserted: 0, skipped: 0, errors: [] };

  if (events.length === 0) return result;

  // 원본 식별자가 없으면 중복 판정을 할 수 없다. 매 실행마다 같은 행이 쌓이는 것을
  // 막기 위해 저장하지 않고 건너뛴다. (수동 입력 건은 관리자 화면에서 직접 넣는다.)
  const savable = events.filter((event) => {
    if (event.externalId === null) {
      result.skipped += 1;
      return false;
    }
    return true;
  });

  if (savable.length === 0) return result;

  const { client } = createAdminClient();

  for (let offset = 0; offset < savable.length; offset += CHUNK_SIZE) {
    const chunk = savable.slice(offset, offset + CHUNK_SIZE).map(toRow);

    const { error } = await client
      .from('events')
      .upsert(chunk, { onConflict: 'game_slug,external_id' });

    if (error) {
      result.errors.push(`${offset}번째 묶음 저장 실패: ${error.message}`);
      logger.error({ err: error, offset }, 'events upsert 실패');
      continue;
    }

    result.upserted += chunk.length;
  }

  return result;
}
