import { classifyAnnouncement } from '@/lib/collectors/classify';
import { firstImageUrl, htmlToLines } from '@/lib/collectors/html';
import {
  KOREAN_DATE,
  KOREAN_TIME,
  KST_OFFSET_HOURS,
  matchToUtcIso,
  offsetFromLabel,
  TILDE,
  type Period,
} from '@/lib/collectors/korean-date';
import { type CollectorAdapter, type CollectorContext, skipped } from '@/lib/collectors/types';
import { localTimeToUtcIso } from '@/lib/datetime';
import type { CollectedEvent } from '@/types/event';

/**
 * 쿠로게임 공식 사이트 어댑터 (명조: 워더링 웨이브).
 *
 * 처음에는 HTML 크롤링을 전제로 잡았지만, 공식 사이트가 실제로는 CDN에 올려둔
 * 정적 JSON을 읽어 화면을 그리고 있었다. 그래서 화면을 긁지 않고 그 JSON을 그대로 쓴다.
 * HTML 구조가 바뀌어도 깨지지 않고, 요청 한 번에 전체 목록을 받을 수 있다.
 *
 *   목록  {CDN}/{게임코드}/{언어}/ArticleMenu.json
 *   본문  {CDN}/{게임코드}/{언어}/article/{articleId}.json
 *
 * 목록에도 `articleContent`가 들어 있지만 20자 남짓으로 잘린 미리보기라
 * 기간을 뽑으려면 본문을 따로 받아야 한다.
 *
 * 조사 근거는 docs/조사-니케-명조-데이터-출처.md 참고.
 */

const CDN_BASE = 'https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json';

/** 공지 원문을 사람이 볼 수 있는 주소. 사이트의 상세 라우트와 같은 형태다. */
const SITE_BASE = 'https://wutheringwaves.kurogames.com';

/** 본문 요청 사이 간격(ms). 정적 CDN이라 부담은 적지만 예의를 지킨다. */
const REQUEST_INTERVAL_MS = 200;

interface ArticleSummary {
  articleId?: number;
  articleTitle?: string;
  /** `2026-07-29 11:00:00` 형태의 게시 시각 */
  startTime?: string;
}

interface ArticleDetail extends ArticleSummary {
  articleContent?: string;
  /** `공지`, `소식` 등 사람이 읽는 분류명 */
  articleTypeName?: string;
}

// ---------------------------------------------------------------------------
// 기간 추출
// ---------------------------------------------------------------------------

/** `2026년 7월 30일 11:00 ~ 2026년 8월 19일 12:59` — 시작 1~6, 종료 7~12 그룹 */
const ABSOLUTE_PERIOD = new RegExp(
  `${KOREAN_DATE}\\s*${KOREAN_TIME}\\s*${TILDE}\\s*${KOREAN_DATE}\\s*${KOREAN_TIME}`,
);

/** `3.5 버전 업데이트 이후 ~ 2026년 7월 30일 10:59` — 버전 1, 종료 2~7 그룹 */
const VERSION_RELATIVE_PERIOD = new RegExp(
  `(\\d+\\.\\d+)?\\s*버전\\s*업데이트\\s*(?:이)?후\\s*${TILDE}\\s*${KOREAN_DATE}\\s*${KOREAN_TIME}`,
);

/** `✦점검 시간: 2026년 7월 10일 05:00 ~ 2026년 7월 10일 12:00` */
const MAINTENANCE_PERIOD = new RegExp(
  `점검\\s*시간\\s*[:：]\\s*${KOREAN_DATE}\\s*${KOREAN_TIME}\\s*${TILDE}\\s*${KOREAN_DATE}\\s*${KOREAN_TIME}`,
);

/** 제목의 버전 번호. `「…」 3.5 버전 업데이트 내용 안내` → `3.5` */
const VERSION_IN_TITLE = /(\d+\.\d+)\s*버전/;

/** 버전 번호 → 그 버전이 시작하는 시각. 상대 표현을 절대 시각으로 바꾸는 데 쓴다. */
export type VersionStarts = Map<string, string>;

/**
 * 버전 업데이트 공지에서 버전 시작 시각을 모은다.
 *
 * 점검이 **끝나는** 시각이 곧 새 버전이 열리는 시각이다.
 * 점검 시작을 쓰면 몇 시간 앞당겨진다.
 *
 * 이 줄에는 타임존 표기가 없다. 한국 사이트의 다른 무표기 시각이 모두 한국시간이므로
 * 한국시간으로 해석하되, 호출부에서 경고를 남긴다.
 */
export function buildVersionStarts(
  articles: Array<{ title: string; lines: string[] }>,
): VersionStarts {
  const starts: VersionStarts = new Map();

  for (const { title, lines } of articles) {
    const version = VERSION_IN_TITLE.exec(title)?.[1];
    if (version === undefined) continue;

    for (const line of lines) {
      const matched = MAINTENANCE_PERIOD.exec(line);
      if (!matched) continue;

      try {
        // 종료 시각은 두 번째 날짜 묶음이므로 7번 그룹부터 읽는다.
        const openedAt = matchToUtcIso(matched, 7, offsetFromLabel(line) ?? KST_OFFSET_HOURS);
        const current = starts.get(version);
        if (current === undefined || openedAt < current) starts.set(version, openedAt);
      } catch {
        // 날짜를 해석하지 못하면 이 줄은 버린다. 다음 공지에서 다시 채울 기회가 있다.
      }
      break;
    }
  }

  return starts;
}

/** 버전 번호가 생략된 상대 표현은 가장 높은 버전을 가리키는 것으로 본다. */
function latestVersion(starts: VersionStarts): string | undefined {
  return [...starts.keys()].sort((a, b) => {
    const [majorA, minorA] = a.split('.').map(Number);
    const [majorB, minorB] = b.split('.').map(Number);
    return majorA === majorB ? minorB - minorA : majorB - majorA;
  })[0];
}

/**
 * 본문 줄들에서 기간을 뽑는다. 못 찾으면 null.
 *
 * 절대 표기를 먼저 찾고, 없으면 `X.Y 버전 업데이트 후` 형태를 버전표로 치환한다.
 */
export function extractPeriod(lines: string[], versionStarts: VersionStarts): Period | null {
  for (const line of lines) {
    const offset = offsetFromLabel(line) ?? KST_OFFSET_HOURS;

    const absolute = ABSOLUTE_PERIOD.exec(line);
    if (absolute) {
      try {
        return { startAt: matchToUtcIso(absolute, 1, offset), endAt: matchToUtcIso(absolute, 7, offset) };
      } catch {
        continue;
      }
    }

    const relative = VERSION_RELATIVE_PERIOD.exec(line);
    if (relative) {
      const version = relative[1] ?? latestVersion(versionStarts);
      const startAt = version === undefined ? undefined : versionStarts.get(version);
      if (startAt === undefined) continue;

      try {
        return { startAt, endAt: matchToUtcIso(relative, 2, offset) };
      } catch {
        continue;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 수집
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, context: CollectorContext): Promise<T> {
  const response = await context.fetchImpl(url, {
    headers: { 'User-Agent': context.userAgent },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return (await response.json()) as T;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const collectKurogame: CollectorAdapter = async (game, context) => {
  if (game.collector.kind !== 'kurogame') {
    return skipped(game, `쿠로게임 어댑터가 아닌 설정입니다: ${game.collector.kind}`);
  }

  const { gameCode, locale, limit } = game.collector;
  const base = `${CDN_BASE}/${gameCode}/${locale}`;
  const warnings: string[] = [];

  let menu: ArticleSummary[];
  try {
    menu = await fetchJson<ArticleSummary[]>(`${base}/ArticleMenu.json`, context);
  } catch (error) {
    return skipped(game, `공지 목록 조회 실패: ${(error as Error).message}`);
  }

  if (!Array.isArray(menu)) {
    return skipped(game, '공지 목록이 배열이 아닙니다. 응답 형식이 바뀐 것 같습니다.');
  }

  // 목록은 2024년 서비스 시작분까지 전부 담겨 있다(수백 건).
  // 지난 일정은 이미 DB에 쌓여 있으므로 최근 것만 다시 확인한다.
  const recent = menu
    .filter((item) => item.articleId !== undefined && Boolean(item.articleTitle))
    .sort((a, b) => Date.parse(b.startTime ?? '') - Date.parse(a.startTime ?? ''))
    .slice(0, limit);

  const articles: Array<{ detail: ArticleDetail; title: string; lines: string[] }> = [];

  for (const item of recent) {
    let detail: ArticleDetail;
    try {
      detail = await fetchJson<ArticleDetail>(`${base}/article/${item.articleId}.json`, context);
    } catch (error) {
      warnings.push(`본문 조회 실패 (articleId=${item.articleId}): ${(error as Error).message}`);
      await wait(REQUEST_INTERVAL_MS);
      continue;
    }

    articles.push({
      detail: { ...item, ...detail },
      title: (detail.articleTitle ?? item.articleTitle ?? '').trim(),
      lines: htmlToLines(detail.articleContent ?? ''),
    });

    await wait(REQUEST_INTERVAL_MS);
  }

  // 상대 표현(`3.5 버전 업데이트 후`)을 치환하려면 버전표가 먼저 있어야 한다.
  const versionStarts = buildVersionStarts(articles);

  const events: CollectedEvent[] = [];
  let withoutPeriod = 0;

  for (const { detail, title, lines } of articles) {
    const period = extractPeriod(lines, versionStarts);

    let startAt: string;
    let endAt: string | null;

    if (period) {
      startAt = period.startAt;
      endAt = period.endAt;
    } else if (detail.startTime) {
      // 기간이 없는 공지(FAQ, 안내문 등)는 게시 시각을 시작으로 두고 종료는 비워둔다.
      // 게시 시각에는 타임존이 붙어 있지 않으나 한국 사이트이므로 한국시간으로 읽는다.
      try {
        startAt = localTimeToUtcIso(detail.startTime, 'Asia/Seoul');
      } catch {
        warnings.push(`게시 시각을 해석할 수 없어 건너뜀 (articleId=${detail.articleId})`);
        continue;
      }
      endAt = null;
      withoutPeriod += 1;
    } else {
      warnings.push(`기간과 게시일을 모두 알 수 없어 건너뜀 (articleId=${detail.articleId})`);
      continue;
    }

    events.push({
      gameSlug: game.slug,
      type: classifyAnnouncement(title, detail.articleTypeName ?? ''),
      title,
      description: null,
      startAt,
      endAt,
      region: 'KR',
      sourceUrl: `${SITE_BASE}/${locale}/main/news/detail/${detail.articleId}`,
      sourceKind: 'official_api',
      imageUrl: firstImageUrl(detail.articleContent ?? ''),
      externalId: detail.articleId === undefined ? null : String(detail.articleId),
    });
  }

  if (versionStarts.size > 0) {
    warnings.push(
      `버전 시작 시각 확보: ${[...versionStarts.keys()].join(', ')}` +
        ' (점검 시간 줄에 타임존 표기가 없어 한국시간으로 해석했습니다. 최대 1시간 오차 가능)',
    );
  }
  if (withoutPeriod > 0) {
    warnings.push(`본문에 기간이 없어 게시일을 시작으로 사용한 공지: ${withoutPeriod}건`);
  }

  return { gameSlug: game.slug, events, warnings };
};
