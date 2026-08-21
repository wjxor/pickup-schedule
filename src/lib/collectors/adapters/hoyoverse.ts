import type { GameDefinition } from '@/config/games';
import { offsetTimeToUtcIso } from '@/lib/datetime';
import { classifyAnnouncement } from '@/lib/collectors/classify';
import { type CollectorAdapter, type CollectorResult, skipped } from '@/lib/collectors/types';
import type { CollectedEvent } from '@/types/event';

/**
 * 호요버스(원신 / 붕괴: 스타레일 / 젠레스 존 제로) 공지 API 어댑터.
 *
 * 이 API는 게임 내 공지 웹뷰가 쓰는 비공개 엔드포인트다.
 * 공식 문서가 없으므로 스펙이 예고 없이 바뀔 수 있고, 그때는 이 어댑터만 고치면 된다.
 */

/** 공지 한 건. list와 pic_list가 대부분의 필드를 공유한다. */
interface HoyoAnnouncement {
  ann_id?: number | string;
  title?: string;
  subtitle?: string;
  /** list 쪽 이미지 */
  banner?: string;
  /** pic_list 쪽 이미지 */
  img?: string;
  start_time?: string;
  end_time?: string;
  type_label?: string;
  href?: string;
}

interface HoyoAnnListResponse {
  retcode?: number;
  message?: string;
  data?: {
    /** 텍스트 공지 그룹 */
    list?: Array<{ type_label?: string; list?: HoyoAnnouncement[] }>;
    /**
     * 이미지 공지 그룹. 픽업(기원·워프·조율) 배너가 주로 여기 들어간다.
     * list보다 한 겹 더 깊게 중첩돼 있다.
     */
    pic_list?: Array<{ type_list?: Array<{ list?: HoyoAnnouncement[] }> }>;
    /** 공지에 적힌 시각의 UTC 오프셋(시간). 보통 8(UTC+8). */
    timezone?: number;
  };
}

/**
 * 공지 노출 기간이 이 일수를 넘으면 실제 이벤트 기간이 아니라고 본다.
 *
 * 호요버스가 주는 end_time은 "공지를 언제까지 띄울지"라서,
 * 상시 공지에는 10년 뒤 같은 값이 들어간다.
 * (실측 예: 「Fate[UBW] 콜라보 워프 안내」 종료일 2036-07-03)
 */
const MAX_REASONABLE_PERIOD_DAYS = 400;

const DAY_IN_MS = 86_400_000;

/** list와 pic_list를 하나의 배열로 펼친다. ann_id가 겹치면 먼저 나온 것을 남긴다. */
function flattenAnnouncements(data: NonNullable<HoyoAnnListResponse['data']>): HoyoAnnouncement[] {
  const fromList = (data.list ?? []).flatMap((group) => group.list ?? []);
  const fromPicList = (data.pic_list ?? []).flatMap((group) =>
    (group.type_list ?? []).flatMap((inner) => inner.list ?? []),
  );

  const seen = new Set<string>();
  const merged: HoyoAnnouncement[] = [];

  for (const item of [...fromList, ...fromPicList]) {
    const key = String(item.ann_id ?? '');
    if (key !== '' && seen.has(key)) continue;
    if (key !== '') seen.add(key);
    merged.push(item);
  }

  return merged;
}

function buildAnnListUrl(game: GameDefinition): string {
  if (game.collector.kind !== 'hoyoverse') {
    throw new Error(`호요버스 어댑터에 ${game.collector.kind} 설정이 들어왔습니다.`);
  }

  const { host, bizPath, game: gameKey, gameBiz, bundleId, region, level } = game.collector;
  const params = new URLSearchParams({
    game: gameKey,
    game_biz: gameBiz,
    lang: 'ko-kr',
    bundle_id: bundleId,
    platform: 'pc',
    region,
    level: String(level),
    uid: '1',
  });

  return `${host}/common/${bizPath}/announcement/api/getAnnList?${params.toString()}`;
}

export const collectHoyoverse: CollectorAdapter = async (game, context) => {
  if (game.collector.kind !== 'hoyoverse') {
    return skipped(game, `호요버스 어댑터가 아닌 설정입니다: ${game.collector.kind}`);
  }

  if (!game.collector.verified) {
    return skipped(
      game,
      'API 파라미터가 아직 실제 응답으로 검증되지 않았습니다. games.ts의 verified를 true로 바꾸기 전까지 건너뜁니다.',
    );
  }

  const warnings: string[] = [];
  const url = buildAnnListUrl(game);

  let payload: HoyoAnnListResponse;
  try {
    const response = await context.fetchImpl(url, {
      headers: { 'User-Agent': context.userAgent },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return skipped(game, `공지 API 응답이 실패했습니다: HTTP ${response.status}`);
    }

    payload = (await response.json()) as HoyoAnnListResponse;
  } catch (error) {
    return skipped(game, `공지 API 호출 중 오류: ${(error as Error).message}`);
  }

  if (payload.retcode !== 0 || !payload.data) {
    return skipped(game, `공지 API가 오류를 반환했습니다: retcode=${payload.retcode} ${payload.message ?? ''}`);
  }

  // 응답이 알려주는 오프셋을 그대로 쓰고, 없을 때만 설정값으로 되돌아간다.
  const offsetHours = payload.data.timezone ?? 8;
  const events: CollectedEvent[] = [];

  for (const item of flattenAnnouncements(payload.data)) {
    const title = item.title?.trim();
    if (!title || !item.start_time) {
      warnings.push(`제목 또는 시작일이 없어 건너뜀 (ann_id=${item.ann_id ?? '알 수 없음'})`);
      continue;
    }

    let startAt: string;
    let endAt: string | null;
    try {
      startAt = offsetTimeToUtcIso(item.start_time, offsetHours);
      endAt = item.end_time ? offsetTimeToUtcIso(item.end_time, offsetHours) : null;
    } catch (error) {
      warnings.push(`날짜 해석 실패 (ann_id=${item.ann_id ?? '?'}): ${(error as Error).message}`);
      continue;
    }

    // 공지 노출 기간이 비현실적으로 길면 종료일을 신뢰하지 않는다.
    if (endAt !== null) {
      const periodDays = (new Date(endAt).getTime() - new Date(startAt).getTime()) / DAY_IN_MS;
      if (periodDays > MAX_REASONABLE_PERIOD_DAYS) {
        warnings.push(
          `종료일이 비현실적으로 멀어 무시함 (${title}): ${item.end_time} — 실제 기간은 본문 확인이 필요합니다.`,
        );
        endAt = null;
      }
    }

    const imageUrl = item.img ?? item.banner ?? null;
    const sourceUrl = item.href?.startsWith('http') ? item.href : game.officialUrl;

    events.push({
      gameSlug: game.slug,
      type: classifyAnnouncement(title, item.subtitle ?? ''),
      title,
      description: item.subtitle?.trim() || null,
      startAt,
      endAt,
      region: 'KR',
      sourceUrl,
      sourceKind: 'official_api',
      imageUrl: imageUrl && imageUrl.startsWith('http') ? imageUrl : null,
      externalId: item.ann_id === undefined ? null : String(item.ann_id),
    });
  }

  const result: CollectorResult = { gameSlug: game.slug, events, warnings };
  return result;
};
