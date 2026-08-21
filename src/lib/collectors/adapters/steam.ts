import { unixSecondsToUtcIso } from '@/lib/datetime';
import { type CollectorAdapter, skipped } from '@/lib/collectors/types';
import type { CollectedEvent, EventType } from '@/types/event';

/**
 * 스팀 공식 뉴스 API 어댑터 (림버스 컴퍼니).
 *
 * 호요버스와 달리 이쪽은 문서화된 공개 API라 스펙이 안정적이다.
 * 대신 **공지 게시 시각만** 주고 이벤트 종료일은 주지 않으므로,
 * endAt은 항상 null로 두고 본문 파싱 단계(LLM 파서)에서 채우는 것을 전제로 한다.
 */

interface SteamNewsItem {
  gid?: string;
  title?: string;
  url?: string;
  contents?: string;
  /** UNIX 초 단위 게시 시각 */
  date?: number;
}

interface SteamNewsResponse {
  appnews?: {
    newsitems?: SteamNewsItem[];
  };
}

/** 스팀 공지 본문의 이미지 자리표시자가 가리키는 실제 CDN 주소. */
const STEAM_CLAN_IMAGE_BASE = 'https://clan.cloudflare.steamstatic.com/images/';

/** 한 번에 가져올 공지 수. */
const NEWS_COUNT = 40;

/**
 * 림버스 컴퍼니 공지 제목으로 종류를 판별한다.
 * 이 게임의 공지는 영어라 한글 키워드가 통하지 않는다.
 */
export function classifySteamNews(title: string): EventType {
  if (/collab/i.test(title)) return '콜라보';
  // 이 게임의 가챠는 Extraction(추출)이고, 신규 인격/에고 공개가 픽업 예고 역할을 한다.
  if (/identity|e\.?g\.?o|extraction|banner/i.test(title)) return '픽업';
  if (/rerun|revival/i.test(title)) return '복각';
  if (/update|patch|ver\.?\s*\d/i.test(title)) return '업데이트';
  if (/event|season|walpurgis/i.test(title)) return '이벤트';
  if (/code|coupon/i.test(title)) return '리딤코드';
  return '공지';
}

/** 본문에서 첫 번째 이미지를 뽑아 실제 URL로 바꾼다. 없으면 null. */
export function extractSteamImage(contents: string | undefined): string | null {
  if (!contents) return null;

  const placeholder = /\{STEAM_CLAN_IMAGE\}\/(\S+?\.(?:png|jpe?g|gif|webp))/i.exec(contents);
  if (placeholder) {
    return `${STEAM_CLAN_IMAGE_BASE}${placeholder[1]}`;
  }

  const direct = /https?:\/\/\S+?\.(?:png|jpe?g|gif|webp)/i.exec(contents);
  return direct ? direct[0] : null;
}

export const collectSteam: CollectorAdapter = async (game, context) => {
  if (game.collector.kind !== 'steam') {
    return skipped(game, `스팀 어댑터가 아닌 설정입니다: ${game.collector.kind}`);
  }

  const params = new URLSearchParams({
    appid: String(game.collector.appId),
    count: String(NEWS_COUNT),
    maxlength: '600',
    format: 'json',
  });
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?${params.toString()}`;

  let payload: SteamNewsResponse;
  try {
    const response = await context.fetchImpl(url, {
      headers: { 'User-Agent': context.userAgent },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return skipped(game, `스팀 뉴스 API 응답이 실패했습니다: HTTP ${response.status}`);
    }

    payload = (await response.json()) as SteamNewsResponse;
  } catch (error) {
    return skipped(game, `스팀 뉴스 API 호출 중 오류: ${(error as Error).message}`);
  }

  const warnings: string[] = [
    '스팀 뉴스는 종료일을 제공하지 않아 endAt이 모두 비어 있습니다. 본문 파서 연결 후 채워집니다.',
  ];
  const events: CollectedEvent[] = [];

  for (const item of payload.appnews?.newsitems ?? []) {
    const title = item.title?.trim();
    if (!title || item.date === undefined) {
      warnings.push(`제목 또는 게시일이 없어 건너뜀 (gid=${item.gid ?? '알 수 없음'})`);
      continue;
    }

    events.push({
      gameSlug: game.slug,
      type: classifySteamNews(title),
      title,
      description: null,
      startAt: unixSecondsToUtcIso(item.date),
      endAt: null,
      region: 'KR',
      sourceUrl: item.url?.startsWith('http') ? item.url : game.officialUrl,
      sourceKind: 'official_api',
      imageUrl: extractSteamImage(item.contents),
      externalId: item.gid ?? null,
    });
  }

  return { gameSlug: game.slug, events, warnings };
};
