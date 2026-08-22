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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

// ---------------------------------------------------------------------------
// 지역 서버가 제각각 답하는 문제 다루기
// ---------------------------------------------------------------------------

/**
 * 같은 공지를 여러 번 받아 아시아 서버가 답한 것을 골라낸다.
 *
 * 이 API는 아시아·유럽·아메리카 서버로 부하가 분산되는데, 각 서버가 시각을
 * **자기 지역 로컬 시각**으로 적어 보낸다. 그런데 응답의 `timezone` 필드는
 * 어느 서버가 답했든 항상 8(UTC+8)이다. 그래서 유럽 서버가 답한 응답을
 * 그대로 믿으면 7시간, 아메리카면 13시간 어긋난 시각을 저장하게 된다.
 *
 * 실측(같은 공지를 12번 요청):
 *   2026-08-11 18:00  ~ 2026-09-22 17:00   아메리카(UTC-5)
 *   2026-08-12 00:00  ~ 2026-09-22 23:00   유럽(UTC+1),   +6시간
 *   2026-08-12 07:00  ~ 2026-09-23 06:00   아시아(UTC+8), +7시간
 *
 * 셋은 같은 순간을 가리킨다. 우리에게 필요한 것은 `timezone: 8`과 짝이 맞는
 * 아시아 응답이고, 그것은 **항상 가장 늦은 값**이다.
 *
 * region 파라미터로는 고를 수 없다. os_asia / os_euro / os_usa 어느 것을 넣어도
 * 똑같이 세 값이 섞여 나오는 것을 확인했다.
 */

/** 아시아(UTC+8)와 유럽(UTC+1)의 시차. 이만큼 벌어지면 아시아 응답을 본 것이다. */
const ASIA_EUROPE_GAP_MS = 7 * 60 * 60 * 1000;

/**
 * 지역 분산이 없는 게임이라고 판단하기까지 필요한 표본 수.
 *
 * 스타레일은 어느 서버가 답하든 시각이 같다(14회 표본에서 변동 0건).
 * 이런 게임에서는 폭이 영영 벌어지지 않으므로, 몇 번 받아 보고 값이 그대로면
 * 분산이 없는 것으로 보고 멈춘다.
 *
 * 서버가 셋이므로 여섯 번 연속 같은 서버에 걸릴 확률은 3 × (1/3)^6, 약 0.4%다.
 */
const MIN_SAMPLES_FOR_STABLE = 6;

/** 아시아 응답을 만날 때까지 다시 시도할 최대 횟수. */
const MAX_SAMPLES = 12;

/** 표본 사이 간격(ms). */
const SAMPLE_INTERVAL_MS = 250;

/** 시각 문자열은 자릿수가 고정돼 있어 사전순 비교가 곧 시간순 비교다. */
function isLater(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined) return false;
  if (b === undefined) return true;
  return a > b;
}

interface SampledAnnouncements {
  /** ann_id별로 가장 늦은 시각을 적어 보낸 응답 */
  items: HoyoAnnouncement[];
  /** 실제로 요청한 횟수 */
  samples: number;
  /** 같은 공지에서 관측된 시각 차이의 최댓값(ms). 0이면 지역 분산이 없는 게임이다. */
  spreadMs: number;
  /** 아시아 응답을 확실히 만났는지 */
  sawAsia: boolean;
}

/**
 * 여러 번 받은 목록을 합쳐 ann_id마다 가장 늦은 시각의 응답을 남긴다.
 *
 * 관측된 폭이 7시간 이상이면 가장 늦은 값이 아시아 응답이라는 것이 확정된다.
 * 유럽(UTC+1)과 아시아(UTC+8)의 시차가 정확히 7시간이기 때문이다.
 */
function pickAsiaAnnouncements(responses: HoyoAnnouncement[][]): SampledAnnouncements {
  const latest = new Map<string, HoyoAnnouncement>();
  const earliest = new Map<string, string>();

  for (const items of responses) {
    for (const item of items) {
      const key = String(item.ann_id ?? '');
      if (key === '' || item.start_time === undefined) continue;

      const known = latest.get(key);
      if (known === undefined || isLater(item.start_time, known.start_time)) {
        latest.set(key, item);
      }

      const oldest = earliest.get(key);
      if (oldest === undefined || item.start_time < oldest) {
        earliest.set(key, item.start_time);
      }
    }
  }

  let spreadMs = 0;
  for (const [key, item] of latest) {
    const from = earliest.get(key);
    if (from === undefined || item.start_time === undefined) continue;
    const gap =
      Date.parse(item.start_time.replace(' ', 'T')) - Date.parse(from.replace(' ', 'T'));
    if (Number.isFinite(gap) && gap > spreadMs) spreadMs = gap;
  }

  return {
    items: [...latest.values()],
    samples: responses.length,
    spreadMs,
    sawAsia: spreadMs >= ASIA_EUROPE_GAP_MS,
  };
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

  const fetchOnce = async (): Promise<HoyoAnnListResponse> => {
    const response = await context.fetchImpl(url, {
      headers: { 'User-Agent': context.userAgent },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    return (await response.json()) as HoyoAnnListResponse;
  };

  // 어느 지역 서버가 답할지 고를 수 없으므로, 아시아 응답이 확실히 섞일 때까지 받는다.
  const responses: HoyoAnnouncement[][] = [];
  /** 응답이 알려주는 오프셋. 어느 지역 서버가 답하든 늘 8이라 첫 응답 값을 쓴다. */
  let offsetHours: number | undefined;

  for (let attempt = 0; attempt < MAX_SAMPLES; attempt += 1) {
    let sample: HoyoAnnListResponse;
    try {
      sample = await fetchOnce();
    } catch (error) {
      if (responses.length === 0) {
        return skipped(game, `공지 API 호출 중 오류: ${(error as Error).message}`);
      }
      warnings.push(`${attempt + 1}번째 표본 요청 실패: ${(error as Error).message}`);
      break;
    }

    if (sample.retcode !== 0 || !sample.data) {
      if (responses.length === 0) {
        return skipped(
          game,
          `공지 API가 오류를 반환했습니다: retcode=${sample.retcode} ${sample.message ?? ''}`,
        );
      }
      break;
    }

    offsetHours ??= sample.data.timezone ?? 8;
    responses.push(flattenAnnouncements(sample.data));

    const seen = pickAsiaAnnouncements(responses);
    // 아시아 응답을 확인했으면 더 받을 이유가 없다.
    if (seen.sawAsia) break;
    // 값이 전혀 흔들리지 않으면 지역 분산이 없는 게임이다.
    if (seen.samples >= MIN_SAMPLES_FOR_STABLE && seen.spreadMs === 0) break;
    await wait(SAMPLE_INTERVAL_MS);
  }

  if (offsetHours === undefined) {
    return skipped(game, '공지 API에서 쓸 수 있는 응답을 받지 못했습니다.');
  }

  const picked = pickAsiaAnnouncements(responses);
  if (picked.spreadMs === 0) {
    warnings.push(`목록 ${picked.samples}번 요청 — 지역별 시각 차이가 없는 게임입니다.`);
  } else if (picked.sawAsia) {
    warnings.push(`목록 ${picked.samples}번 요청 — 아시아 서버 응답을 골랐습니다.`);
  } else {
    warnings.push(
      `${picked.samples}번 받아 봤지만 아시아 서버 응답을 확인하지 못했습니다.` +
        ' 시각이 최대 13시간 이를 수 있습니다.',
    );
  }

  const events: CollectedEvent[] = [];

  for (const item of picked.items) {
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
