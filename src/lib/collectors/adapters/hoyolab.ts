import { unixSecondsToUtcIso } from '@/lib/datetime';
import { classifyAnnouncement } from '@/lib/collectors/classify';
import {
  KST_OFFSET_HOURS,
  matchToUtcIso,
  type Period,
} from '@/lib/collectors/korean-date';
import { type CollectorAdapter, type CollectorContext, skipped } from '@/lib/collectors/types';
import type { CollectedEvent } from '@/types/event';

/**
 * HoYoLAB 뉴스 API 어댑터.
 *
 * 젠레스 존 제로는 원신·스타레일이 쓰는 공지 API(getAnnList)를 제공하지 않는다.
 * 조사 과정과 근거는 docs/조사-젠레스-존-제로-데이터-출처.md 에 정리돼 있다.
 *
 * 대신 HoYoLAB 뉴스 API를 쓴다. 인증이 필요 없고, 헤더로 언어를 지정하면
 * 한국어 제목·본문을 받을 수 있다. gids 값만 바꾸면 원신·스타레일에도 그대로
 * 쓸 수 있어, 공지 API가 막히는 날의 폴백 경로가 된다.
 *
 * 대신 기간이 구조화된 필드로 오지 않아 본문에서 뽑아내야 한다.
 */

const NEWS_LIST_URL = 'https://bbs-api-os.hoyolab.com/community/post/wapi/getNewsList';
const POST_FULL_URL = 'https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull';

/** 뉴스 분류. 1=공지, 2=웹이벤트, 3=소식. 기간이 있는 것은 주로 공지다. */
const NEWS_TYPE_NOTICE = 1;

/** 본문 요청 사이에 두는 간격(ms). 상대 서버에 부담을 주지 않기 위한 예의다. */
const REQUEST_INTERVAL_MS = 300;

interface HoyolabPost {
  post_id?: string;
  subject?: string;
  content?: string;
  /** 리치 텍스트 본문. content가 비어 있을 때 여기에 들어 있다. */
  structured_content?: string;
  /** UNIX 초 단위 게시 시각 */
  created_at?: number;
}

/**
 * 목록 응답의 한 항목.
 *
 * 이미지는 post 안이 아니라 이 바깥 층에 있다. post.cover / post.images 는
 * 대부분 비어 있어 쓸 수 없다.
 */
interface NewsListEntry {
  post?: HoyolabPost;
  image_list?: Array<{ url?: string }>;
  cover?: { url?: string };
}

interface NewsListResponse {
  retcode?: number;
  message?: string;
  data?: { list?: NewsListEntry[] };
}

interface PostFullResponse {
  retcode?: number;
  data?: { post?: { post?: HoyolabPost } };
}

// ---------------------------------------------------------------------------
// 본문 텍스트 만들기
// ---------------------------------------------------------------------------

/** 리치 텍스트(JSON 배열)에서 문자열만 이어붙인다. */
function structuredContentToText(raw: string | undefined): string {
  if (!raw) return '';

  try {
    const blocks = JSON.parse(raw) as Array<{ insert?: unknown }>;
    return blocks.map((block) => (typeof block.insert === 'string' ? block.insert : '')).join(' ');
  } catch {
    // 파싱에 실패하면 원문을 그대로 쓴다. 날짜만 뽑으면 되므로 태그가 섞여도 무방하다.
    return raw;
  }
}

/** 공지 본문을 정규식으로 훑기 좋은 평문 한 덩어리로 만든다. */
export function toPlainText(post: HoyolabPost): string {
  const fromHtml = (post.content ?? '').replace(/<[^>]*>/g, ' ');
  const fromStructured = structuredContentToText(post.structured_content);
  return `${fromHtml} ${fromStructured}`.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// 기간 추출
// ---------------------------------------------------------------------------

/**
 * `2026/8/19 13:00` / `2026/08/19 13:00:00` — 연·월·일·시·분·초 여섯 그룹.
 *
 * 월·일·시를 한 자리로 적는 공지가 섞여 있어 자릿수를 고정하지 않는다.
 * 초는 붙기도 하고 빠지기도 한다.
 */
const KST_DATE = String.raw`(\d{4})/(\d{1,2})/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?`;

/**
 * 시각 뒤에 붙는 타임존 표기.
 *
 * 기간의 **끝**에는 거의 항상 붙지만 시작에는 생략되는 일이 잦다.
 * (`2026/07/08 13:00 ~ 2026/07/28 15:59(KST)`)
 * 그래서 시작에는 선택으로 두고 끝에만 요구한다. 표기를 아예 요구하지 않으면
 * 본문에 흩어진 무관한 날짜까지 기간으로 오인하게 된다.
 */
const KST_MARK = String.raw`\s*\(KST\)`;

/**
 * 버전 상대 표현의 꼬리.
 * `업데이트 후` 와 `업데이트 이후` 가 섞여 쓰인다.
 */
const AFTER_UPDATE = String.raw`버전\s*업데이트\s*(?:이)?후`;

/** `2026/08/19 13:00(KST) ~ 2026/09/08 15:59(KST)` — 시작 1~6, 종료 7~12 그룹 */
const ABSOLUTE_PERIOD = new RegExp(
  `${KST_DATE}(?:${KST_MARK})?\\s*[~-]\\s*${KST_DATE}${KST_MARK}`,
);

/** `3.1 버전 업데이트 이후 ~ 2026/09/07 04:59(KST)` — 버전 1, 종료 2~7 그룹 */
const RELATIVE_START_PERIOD = new RegExp(
  String.raw`(?:(\d+\.\d+)\s*)?` + AFTER_UPDATE + `\\s*[~-]\\s*${KST_DATE}${KST_MARK}`,
);

/** `3.1 버전 업데이트 후 ~ 3.1 버전 종료 전` — 양쪽 모두 상대 표현 */
const FULLY_RELATIVE_PERIOD = new RegExp(
  String.raw`(?:(\d+\.\d+)\s*)?` +
    AFTER_UPDATE +
    String.raw`\s*[~-]\s*(?:(\d+\.\d+)\s*)?버전\s*(?:종료|업데이트)\s*전`,
);

/**
 * `2026/07/04 01:00:00(KST) 이후` — 시작만 적고 끝을 말하지 않는 표기.
 *
 * 생일 선물처럼 해마다 갱신되는 항목이 이렇게 적는다. 종료가 없다고 해서 버릴 값이 아니다.
 * 게시일보다 이 시각이 훨씬 정확하다.
 *
 * `(KST)` 를 반드시 요구한다. 없이 두면 본문에 흩어진 버전 출시일·권장 사양 날짜까지
 * 시작 시각으로 오인한다.
 */
const ABSOLUTE_START_ONLY = new RegExp(`${KST_DATE}${KST_MARK}\\s*(?:이후|부터)`);

/**
 * `3.1 버전 업데이트 후 … 영구 개방` — 버전과 함께 열려 끝나지 않는 콘텐츠.
 *
 * 신규 스토리나 상시 추가되는 Bangboo가 여기 해당한다. 시작은 그 버전이 열리는 시각이고
 * 종료는 없다. 게시일을 시작으로 쓰면 사전 공지된 만큼(며칠) 앞당겨진다.
 *
 * `업데이트 후` 와 `영구` 사이에 설명이 끼어드는 문장이 많아
 * (`3.1 버전 업데이트 후, S급 「Bangboo」 [아리엘]이 … 영구 추가됩니다`)
 * 짧은 구간을 허용하되, 물결이 끼면 기간 표기이므로 멈춘다.
 */
const PERMANENT_AFTER_UPDATE = new RegExp(
  String.raw`(?:(\d+\.\d+)\s*)?` + AFTER_UPDATE + String.raw`[^~\n]{0,60}?영구\s*(?:개방|추가|오픈|해금)`,
);

/** 제목에서 버전 번호를 찾는다. `3.1 버전 「기나긴 이별」 업데이트 공지` → `3.1` */
const VERSION_IN_TITLE = /(\d+\.\d+)\s*버전/;

export type { Period };

/**
 * 버전별 기간표.
 *
 * `3.1 버전 업데이트 후` 같은 상대 표현을 절대 시각으로 바꾸려면 그 버전이 언제
 * 시작하고 끝나는지 알아야 한다. 버전 업데이트 공지가 절대 날짜를 주므로,
 * 그 값을 모아 표로 만든다.
 */
export type VersionPeriods = Map<string, Period>;

/**
 * 사전 다운로드 공지.
 *
 * 이 공지의 기간은 "다운로드가 열린 시각 ~ 점검 종료 시각"이다.
 * 즉 **끝나는 시각**이 새 버전이 시작되는 시점이므로, 시작 시각을 버전 시작으로
 * 쓰면 며칠 앞당겨진다.
 */
const PRE_DOWNLOAD_PATTERN = /사전\s*다운로드/;

export function buildVersionPeriods(posts: Array<{ title: string; text: string }>): VersionPeriods {
  const starts = new Map<string, string>();
  const ends = new Map<string, string>();

  for (const { title, text } of posts) {
    const version = VERSION_IN_TITLE.exec(title)?.[1];
    if (!version) continue;

    const matched = ABSOLUTE_PERIOD.exec(text);
    if (!matched) continue;

    let from: string;
    let to: string;
    try {
      from = matchToUtcIso(matched, 1, KST_OFFSET_HOURS);
      to = matchToUtcIso(matched, 7, KST_OFFSET_HOURS);
    } catch {
      continue;
    }

    if (PRE_DOWNLOAD_PATTERN.test(title)) {
      // 점검이 끝나는 시각 = 버전 시작. 이 공지의 종료일은 버전 종료가 아니므로 쓰지 않는다.
      const current = starts.get(version);
      if (current === undefined || to < current) starts.set(version, to);
      continue;
    }

    // 그 외 버전 공지는 가장 이른 시작과 가장 늦은 종료를 버전 구간으로 본다.
    const currentStart = starts.get(version);
    if (currentStart === undefined || from < currentStart) starts.set(version, from);

    const currentEnd = ends.get(version);
    if (currentEnd === undefined || to > currentEnd) ends.set(version, to);
  }

  const periods: VersionPeriods = new Map();
  for (const [version, startAt] of starts) {
    periods.set(version, { startAt, endAt: ends.get(version) ?? null });
  }

  return periods;
}

/** 버전 번호가 없는 상대 표현은 가장 최신 버전을 가리키는 것으로 본다. */
function latestVersion(periods: VersionPeriods): string | undefined {
  return [...periods.keys()].sort((a, b) => {
    const [majorA, minorA] = a.split('.').map(Number);
    const [majorB, minorB] = b.split('.').map(Number);
    return majorA === majorB ? minorB - minorA : majorB - majorA;
  })[0];
}

function resolveVersion(
  periods: VersionPeriods,
  version: string | undefined,
): Period | undefined {
  const key = version ?? latestVersion(periods);
  return key === undefined ? undefined : periods.get(key);
}

/**
 * 본문에서 기간을 뽑는다. 못 찾으면 null.
 *
 * 양 끝이 다 있는 표기부터 찾고, 시작만 아는 표기를 뒤에 둔다.
 * 순서를 뒤집으면 `A ~ B` 의 A만 읽고 종료를 버리게 된다.
 */
export function extractPeriod(text: string, versions: VersionPeriods): Period | null {
  const absolute = ABSOLUTE_PERIOD.exec(text);
  if (absolute) {
    try {
      return {
        startAt: matchToUtcIso(absolute, 1, KST_OFFSET_HOURS),
        endAt: matchToUtcIso(absolute, 7, KST_OFFSET_HOURS),
      };
    } catch {
      return null;
    }
  }

  const relativeStart = RELATIVE_START_PERIOD.exec(text);
  if (relativeStart) {
    const versionPeriod = resolveVersion(versions, relativeStart[1]);
    if (versionPeriod) {
      try {
        return {
          startAt: versionPeriod.startAt,
          endAt: matchToUtcIso(relativeStart, 2, KST_OFFSET_HOURS),
        };
      } catch {
        return null;
      }
    }
  }

  const fullyRelative = FULLY_RELATIVE_PERIOD.exec(text);
  if (fullyRelative) {
    const versionPeriod = resolveVersion(versions, fullyRelative[1] ?? fullyRelative[2]);
    if (versionPeriod) return versionPeriod;
  }

  // 여기부터는 종료를 알 수 없는 표기다. 시작만이라도 정확히 잡는다.
  const permanent = PERMANENT_AFTER_UPDATE.exec(text);
  if (permanent) {
    const versionPeriod = resolveVersion(versions, permanent[1]);
    if (versionPeriod) return { startAt: versionPeriod.startAt, endAt: null };
  }

  const startOnly = ABSOLUTE_START_ONLY.exec(text);
  if (startOnly) {
    try {
      return { startAt: matchToUtcIso(startOnly, 1, KST_OFFSET_HOURS), endAt: null };
    } catch {
      return null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 수집
// ---------------------------------------------------------------------------

async function fetchJson<T>(
  url: string,
  context: CollectorContext,
): Promise<T> {
  const response = await context.fetchImpl(url, {
    headers: {
      'User-Agent': context.userAgent,
      // 이 헤더가 없으면 영어 본문이 온다.
      'x-rpc-language': 'ko-kr',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const collectHoyolab: CollectorAdapter = async (game, context) => {
  if (game.collector.kind !== 'hoyolab') {
    return skipped(game, `HoYoLAB 어댑터가 아닌 설정입니다: ${game.collector.kind}`);
  }

  const { gids, pageSize } = game.collector;
  const warnings: string[] = [];

  const listUrl = `${NEWS_LIST_URL}?${new URLSearchParams({
    gids: String(gids),
    type: String(NEWS_TYPE_NOTICE),
    page_size: String(pageSize),
  }).toString()}`;

  let listPayload: NewsListResponse;
  try {
    listPayload = await fetchJson<NewsListResponse>(listUrl, context);
  } catch (error) {
    return skipped(game, `뉴스 목록 조회 실패: ${(error as Error).message}`);
  }

  if (listPayload.retcode !== 0 || !listPayload.data?.list) {
    return skipped(
      game,
      `뉴스 목록 API가 오류를 반환했습니다: retcode=${listPayload.retcode} ${listPayload.message ?? ''}`,
    );
  }

  /** 이미지가 post 바깥에 있어, 목록 항목 단위로 함께 들고 다닌다. */
  const summaries = listPayload.data.list
    .filter((entry) => Boolean(entry.post?.post_id && entry.post?.subject))
    .map((entry) => ({
      post: entry.post!,
      imageUrl: entry.image_list?.[0]?.url || entry.cover?.url || null,
    }));

  // 목록 API의 content는 미리보기라 잘려 있다. 기간을 뽑으려면 본문 전체가 필요하다.
  //
  // 새 글만 골라 받는 최적화도 가능하지만, 하루 수십 건 규모라 절약폭이 크지 않고
  // 매번 다시 받으면 게임사가 나중에 정정한 기간까지 반영된다는 이점이 있어
  // 전부 받되 요청 간격을 두는 쪽을 택했다.
  const detailed: Array<{
    post: HoyolabPost;
    title: string;
    text: string;
    imageUrl: string | null;
  }> = [];

  for (const { post, imageUrl } of summaries) {
    let text: string;
    try {
      const full = await fetchJson<PostFullResponse>(
        `${POST_FULL_URL}?post_id=${post.post_id}`,
        context,
      );
      const fullPost = full.data?.post?.post;
      text = fullPost ? toPlainText(fullPost) : toPlainText(post);
    } catch (error) {
      warnings.push(
        `본문 조회 실패 (post_id=${post.post_id}): ${(error as Error).message} — 미리보기로 대체`,
      );
      text = toPlainText(post);
    }

    detailed.push({ post, title: post.subject!, text, imageUrl });
    await wait(REQUEST_INTERVAL_MS);
  }

  // 상대 표현을 치환하려면 버전 기간표가 먼저 있어야 하므로 두 번에 나눠 처리한다.
  const versionPeriods = buildVersionPeriods(detailed);
  const events: CollectedEvent[] = [];
  let withoutPeriod = 0;

  for (const { post, title, text, imageUrl } of detailed) {
    const period = extractPeriod(text, versionPeriods);

    let startAt: string;
    let endAt: string | null;

    if (period) {
      startAt = period.startAt;
      endAt = period.endAt;
    } else if (post.created_at !== undefined) {
      // 기간이 없는 공지(영구 콘텐츠, FAQ 등)는 게시 시각을 시작으로 두고
      // 종료는 모른다고 표시한다. 없는 날짜를 지어내지 않는다.
      startAt = unixSecondsToUtcIso(post.created_at);
      endAt = null;
      withoutPeriod += 1;
    } else {
      warnings.push(`기간과 게시일을 모두 알 수 없어 건너뜀 (post_id=${post.post_id})`);
      continue;
    }

    events.push({
      gameSlug: game.slug,
      type: classifyAnnouncement(title),
      title,
      description: null,
      startAt,
      endAt,
      region: 'KR',
      sourceUrl: `https://www.hoyolab.com/article/${post.post_id}`,
      sourceKind: 'official_api',
      imageUrl: imageUrl?.startsWith('http') ? imageUrl : null,
      externalId: post.post_id ?? null,
    });
  }

  if (versionPeriods.size > 0) {
    warnings.push(`버전 기간표 확보: ${[...versionPeriods.keys()].join(', ')}`);
  }
  if (withoutPeriod > 0) {
    warnings.push(`본문에 기간이 없어 게시일을 시작으로 사용한 공지: ${withoutPeriod}건`);
  }

  return { gameSlug: game.slug, events, warnings };
};
