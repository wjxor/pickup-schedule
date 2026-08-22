import { classifyAnnouncement } from '@/lib/collectors/classify';
import { htmlToLines } from '@/lib/collectors/html';
import {
  END_OF_DAY,
  KOREAN_DATE,
  KOREAN_TIME,
  KST_OFFSET_HOURS,
  matchDateToUtcIso,
  matchToUtcIso,
  mergePeriods,
  offsetFromLabel,
  TILDE,
  type Period,
  type TimeOfDay,
} from '@/lib/collectors/korean-date';
import { type CollectorAdapter, type CollectorContext, skipped } from '@/lib/collectors/types';
import { unixSecondsToUtcIso } from '@/lib/datetime';
import type { CollectedEvent, EventType } from '@/types/event';

/**
 * 레벨 인피니트 CMS 어댑터 (승리의 여신: 니케).
 *
 * 공식 사이트는 화면을 CMS API로 채운다. 서명이 필요한 엔드포인트도 있지만,
 * 공지 목록과 본문은 헤더 네 개(X-GameId / X-AreaId / X-Source / X-Language)만
 * 붙이면 인증 없이 읽을 수 있다.
 *
 * 다른 게임과 결정적으로 다른 점: **공지 하나에 일정이 수십 개 들어 있다.**
 * 호요버스나 명조는 픽업 하나에 공지 하나를 쓰지만, 니케는 "8월 13일 업데이트 공지"
 * 한 건에 신규 캐릭터 모집·이벤트·상점까지 전부 묶어서 올린다.
 *
 * 다행히 본문이 `1.` `1.1` 같은 번호 제목으로 일관되게 나뉘어 있어,
 * 그 번호를 경계로 쪼갠 뒤 구획마다 기간을 찾는다. 그래서 이 어댑터만
 * "공지 → 이벤트 여러 개"로 펼치는 단계를 갖는다.
 *
 * 조사 근거는 docs/조사-니케-명조-데이터-출처.md 참고.
 */

const API_BASE =
  'https://na-community.playerinfinite.com/api/gpts.information_feeds_svr.InformationFeedsSvr';

/** 공지 원문을 사람이 볼 수 있는 주소. */
const DETAIL_URL = 'https://nikke-kr.com/newsdetail.html';

/** 목록 API가 한 번에 돌려주는 최대 건수. 더 크게 요청해도 이만큼만 온다. */
const PAGE_SIZE = 10;

/** 요청 사이 간격(ms). */
const REQUEST_INTERVAL_MS = 300;

interface FeedItem {
  content_id?: string;
  title?: string;
  /** UNIX 초 단위 게시 시각 */
  pub_timestamp?: string | number;
  pic_urls?: string[];
}

interface FeedListResponse {
  data?: { result?: number; errmsg?: string; info_content?: FeedItem[] };
}

interface FeedDetailResponse {
  data?: { result?: number; content?: string; title?: string; pic_urls?: string[] };
}

// ---------------------------------------------------------------------------
// 본문을 번호 구획으로 쪼개기
// ---------------------------------------------------------------------------

/**
 * `1. 신규 캐릭터` / `1.1 SSR 캐릭터 [퀸]` / `6 챔피언 아레나` 형태의 제목 줄.
 *
 * 날짜 줄(`2026년 8월 20일 …`)이나 순서 표기(`1차: …`)가 걸리지 않도록
 * 번호 뒤에 공백을 요구한다. `2026년…`은 숫자 뒤가 바로 한글이라 매치되지 않는다.
 */
const SECTION_HEADING = /^(\d+(?:\.\d+)*)[.)]?\s+(\S.{1,79})$/;

export interface NoticeSection {
  /** `1.1` 같은 구획 번호. 원본 식별자와 묶어 이벤트의 고유 키로 쓴다. */
  no: string;
  title: string;
  body: string[];
}

/** 본문 줄들을 번호 제목 기준으로 구획 배열로 나눈다. */
export function splitSections(lines: string[]): NoticeSection[] {
  const sections: NoticeSection[] = [];
  let current: NoticeSection | null = null;

  for (const line of lines) {
    const heading = SECTION_HEADING.exec(line);
    if (heading) {
      current = { no: heading[1], title: heading[2].trim(), body: [] };
      sections.push(current);
      continue;
    }
    current?.body.push(line);
  }

  return sections;
}

// ---------------------------------------------------------------------------
// 기간 추출
// ---------------------------------------------------------------------------

/** `*이벤트 기간:` `오픈 시간:` `*진행 일정:` 처럼 기간을 알리는 줄인지. */
const PERIOD_LABEL = /(기간|시간|일정)\s*[:：]/;

/** 연도가 들어 있는 줄만 날짜 후보로 본다. */
const HAS_YEAR = /\d{4}\s*년/;

/**
 * `서버 점검 종료 이후` / `업데이트 점검 종료 후` / `점검 후`.
 * 날짜와 `점검` 사이에 수식어가 끼므로 짧은 임의 구간을 허용한다.
 */
const MAINTENANCE = String.raw`(?:\s*[^~〜～\n]{0,12}?)?점검\s*(?:종료\s*)?(?:이)?후`;

/**
 * 점검이 끝나는 시각을 모를 때 쓰는 하한.
 *
 * 니케는 점검 시간을 공지 API로 알려주지 않는다. 공식 사이트의 공지 컬럼 두 개
 * (`NOTICE` / `NEWS`)를 30건씩 훑어도 점검 안내 자체가 없고, 업데이트 공지는 점검
 * 사흘 전에 올라와 게시 시각도 근거가 되지 못한다.
 *
 * 대신 확실한 것이 하나 있다. **니케의 하루 경계는 05:00**이다. 본문에 적힌 일정이
 * 예외 없이 `5:00:00`에 시작해 `4:59:59`에 끝난다. 점검은 그 경계가 지난 뒤에
 * 시작하므로, 점검 종료는 반드시 05:00보다 뒤다.
 *
 * 그래서 0시가 아니라 05:00을 쓴다. 실제 시각보다 이르다는 성질은 그대로 두면서
 * (달력에서 일정이 실제보다 늦게 시작한 것처럼 보이지 않는다) 오차를 다섯 시간 줄인다.
 */
const MAINTENANCE_END_FLOOR: TimeOfDay = { hour: '05', minute: '00', second: '00' };

/**
 * 시작 시각을 무엇에 근거해 정했는지.
 *
 * 화면에는 드러나지 않지만 수집 로그에서 이 구분이 필요하다.
 * "근사 32건"이라고만 적으면 그 32건이 얼마나 어긋나 있는지 알 수 없다.
 */
export type StartBasis =
  /** 본문에 시각이 적혀 있었다. */
  | 'exact'
  /** `점검 종료 후`로만 적혀 있어 그날 05:00으로 뒀다. */
  | 'maintenance'
  /** 날짜만 적혀 있어 그날 0시로 뒀다. */
  | 'dateOnly';

/**
 * 기간 표기 패턴. 구체적인 것부터 순서대로 시도한다.
 *
 * 니케는 `(UTC+9)`를 붙여 주지만 빠진 줄도 있어, 표기가 없으면 한국시간으로 본다.
 * 한국 서버 공지이므로 다른 해석의 여지가 없다.
 */
type PeriodReader = (match: RegExpMatchArray, offset: number) => Period;

interface PeriodPattern {
  /** 로그와 통계에 쓰는 이름 */
  name: string;
  pattern: RegExp;
  read: PeriodReader;
  /** 이 패턴이 정하는 시작 시각의 근거. 생략하면 본문에 적힌 시각을 그대로 쓴 것이다. */
  startBasis?: Exclude<StartBasis, 'exact'>;
}

const PERIOD_PATTERNS: PeriodPattern[] = [
  {
    // 2026년 8월 20일 5:00:00 ~ 2026년 9월 10일 4:59:59
    name: '절대',
    pattern: new RegExp(
      `${KOREAN_DATE}\\s*${KOREAN_TIME}\\s*${TILDE}\\s*${KOREAN_DATE}\\s*${KOREAN_TIME}`,
    ),
    read: (m, offset) => ({
      startAt: matchToUtcIso(m, 1, offset),
      endAt: matchToUtcIso(m, 7, offset),
    }),
  },
  {
    // 2026년 8월 13일 서버 점검 종료 이후 ~ 2026년 9월 10일 4:59:59
    name: '점검후→절대',
    pattern: new RegExp(
      `${KOREAN_DATE}${MAINTENANCE}\\s*${TILDE}\\s*${KOREAN_DATE}\\s*${KOREAN_TIME}`,
    ),
    read: (m, offset) => ({
      startAt: matchDateToUtcIso(m, 1, offset, MAINTENANCE_END_FLOOR),
      endAt: matchToUtcIso(m, 4, offset),
    }),
    startBasis: 'maintenance',
  },
  {
    // 2026년 4월 23일 ~ 2026년 5월 21일 (시각 없음)
    name: '날짜만',
    pattern: new RegExp(`${KOREAN_DATE}\\s*${TILDE}\\s*${KOREAN_DATE}`),
    read: (m, offset) => ({
      startAt: matchDateToUtcIso(m, 1, offset),
      endAt: matchDateToUtcIso(m, 4, offset, END_OF_DAY),
    }),
  },
  {
    // 2026년 8월 13일 점검 종료 후 (종료일 없음)
    name: '점검후(무기한)',
    pattern: new RegExp(`${KOREAN_DATE}${MAINTENANCE}`),
    read: (m, offset) => ({
      startAt: matchDateToUtcIso(m, 1, offset, MAINTENANCE_END_FLOOR),
      endAt: null,
    }),
    startBasis: 'maintenance',
  },
  {
    // 2026년 8월 20일 12:00:00 (시작만)
    name: '시작만',
    pattern: new RegExp(`${KOREAN_DATE}\\s*${KOREAN_TIME}`),
    read: (m, offset) => ({ startAt: matchToUtcIso(m, 1, offset), endAt: null }),
  },
  {
    // 2026년 8월 13일 (날짜 하나)
    name: '날짜하나',
    pattern: new RegExp(KOREAN_DATE),
    read: (m, offset) => ({ startAt: matchDateToUtcIso(m, 1, offset), endAt: null }),
    startBasis: 'dateOnly',
  },
];

/**
 * 구획에서 기간을 알리는 라벨 줄만 고른다.
 *
 * 일정의 종류를 판별하는 근거로 쓴다. `*기간 한정 모집 기간:`은 픽업이고
 * `*임시 합류 가능 기간:`은 체험 기능이다. 라벨이 그 구획이 무엇에 대한
 * 기간인지를 정확히 말해 준다.
 *
 * 본문 전체를 분류에 넣으면 "현재 픽업 중인 캐릭터를 체험할 수 있습니다" 같은
 * 설명 문장 때문에 체험 기능이 픽업으로 뒤집힌다.
 */

/**
 * 구획에서 기간이 적힌 줄들을 고른다.
 *
 * 라벨과 날짜가 한 줄에 있는 경우가 대부분이지만,
 * `*임시 합류 가능 기간:` 다음 줄부터 `① [퀸]: 2026년 …`처럼 나열되기도 한다.
 * 그래서 라벨 줄에 연도가 없으면 뒤따르는 몇 줄을 함께 본다.
 */
export function periodLabelLines(body: string[]): string[] {
  return body.filter((line) => PERIOD_LABEL.test(line));
}

export function periodLines(body: string[]): string[] {
  const found: string[] = [];
  const LOOKAHEAD = 4;

  for (let i = 0; i < body.length; i += 1) {
    if (!PERIOD_LABEL.test(body[i])) continue;

    if (HAS_YEAR.test(body[i])) {
      found.push(body[i]);
      continue;
    }

    for (let j = i + 1; j < Math.min(i + 1 + LOOKAHEAD, body.length); j += 1) {
      // 다음 라벨을 만나면 이 라벨의 나열이 끝난 것으로 본다.
      if (PERIOD_LABEL.test(body[j]) && !HAS_YEAR.test(body[j])) break;
      if (HAS_YEAR.test(body[j])) found.push(body[j]);
    }
  }

  return found;
}

/** 한 줄에서 읽어낸 기간. `startBasis`가 `exact`가 아니면 시각을 지어낸 것이다. */
export interface ReadPeriod extends Period {
  startBasis: StartBasis;
}

/** 한 줄에서 기간 하나를 읽는다. 어떤 패턴에도 걸리지 않으면 null. */
export function readPeriod(line: string): ReadPeriod | null {
  const offset = offsetFromLabel(line) ?? KST_OFFSET_HOURS;

  for (const { pattern, read, startBasis } of PERIOD_PATTERNS) {
    const matched = pattern.exec(line);
    if (!matched) continue;

    try {
      return { ...read(matched, offset), startBasis: startBasis ?? 'exact' };
    } catch {
      // 2026년 13월 같은 값은 해석에 실패한다. 다음 패턴으로 넘어간다.
    }
  }

  return null;
}

/** 구획 전체의 기간. 여러 구간이 적혀 있으면 전체를 감싸는 하나로 합친다. */
export function sectionPeriod(section: NoticeSection): ReadPeriod | null {
  const read = periodLines(section.body)
    .map(readPeriod)
    .filter((period): period is ReadPeriod => period !== null);

  const merged = mergePeriods(read);
  if (merged === null) return null;

  // 합친 시작 시각이 어느 줄에서 왔는지 되짚어, 그 줄의 근거를 이어받는다.
  const source = read.find((period) => period.startAt === merged.startAt);
  return { ...merged, startBasis: source?.startBasis ?? 'exact' };
}

// ---------------------------------------------------------------------------
// 수집
// ---------------------------------------------------------------------------

async function postJson<T>(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  context: CollectorContext,
): Promise<T> {
  const response = await context.fetchImpl(`${API_BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      'User-Agent': context.userAgent,
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return (await response.json()) as T;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 이미지 주소 중 http로 시작하는 첫 번째. */
function pickImage(...candidates: Array<string[] | undefined>): string | null {
  for (const list of candidates) {
    const url = list?.find((value) => value?.startsWith('http'));
    if (url) return url;
  }
  return null;
}

export const collectLevelInfinite: CollectorAdapter = async (game, context) => {
  if (game.collector.kind !== 'levelinfinite') {
    return skipped(game, `레벨 인피니트 어댑터가 아닌 설정입니다: ${game.collector.kind}`);
  }

  const { cmsGameId, areaId, language, primaryLabelId, secondaryLabelId, noticeCount, keepTypes } =
    game.collector;

  const headers = {
    'X-GameId': cmsGameId,
    'X-AreaId': areaId,
    'X-Source': 'pc_web',
    'X-Language': language,
  };
  const commonBody = { gameid: cmsGameId, language: [language], ext_info_type_list: [0, 1, 2] };
  const warnings: string[] = [];

  // 목록 조회 (한 번에 10건씩이라 필요한 만큼 넘겨가며 받는다)
  const items: FeedItem[] = [];
  for (let offset = 0; offset < noticeCount; offset += PAGE_SIZE) {
    let payload: FeedListResponse;
    try {
      payload = await postJson<FeedListResponse>(
        'GetContentByLabel',
        {
          ...commonBody,
          offset,
          get_num: PAGE_SIZE,
          primary_label_id: primaryLabelId,
          secondary_label_id: secondaryLabelId,
          content_class: 0,
        },
        headers,
        context,
      );
    } catch (error) {
      if (items.length === 0) {
        return skipped(game, `공지 목록 조회 실패: ${(error as Error).message}`);
      }
      warnings.push(`공지 목록 ${offset}번째 페이지 조회 실패: ${(error as Error).message}`);
      break;
    }

    if (payload.data?.result !== 0) {
      const reason = `공지 목록 API 오류: result=${payload.data?.result} ${payload.data?.errmsg ?? ''}`;
      if (items.length === 0) return skipped(game, reason);
      warnings.push(reason);
      break;
    }

    const page = payload.data.info_content ?? [];
    items.push(...page.filter((item) => Boolean(item.content_id)));

    if (page.length < PAGE_SIZE) break;
    await wait(REQUEST_INTERVAL_MS);
  }

  if (items.length === 0) {
    return skipped(game, '공지 목록이 비어 있습니다.');
  }

  const events: CollectedEvent[] = [];
  const keep = new Set<EventType>(keepTypes);
  let noticesWithoutSchedule = 0;
  let maintenanceStarts = 0;
  let dateOnlyStarts = 0;
  let filteredOut = 0;

  for (const item of items.slice(0, noticeCount)) {
    let detail: FeedDetailResponse;
    try {
      detail = await postJson<FeedDetailResponse>(
        'GetContentInfoById',
        { ...commonBody, content_id: item.content_id },
        headers,
        context,
      );
    } catch (error) {
      warnings.push(`본문 조회 실패 (content_id=${item.content_id}): ${(error as Error).message}`);
      await wait(REQUEST_INTERVAL_MS);
      continue;
    }

    const title = (detail.data?.title ?? item.title ?? '').trim();
    const sourceUrl = `${DETAIL_URL}?content_id=${item.content_id}`;
    const publishedAt = Number(item.pub_timestamp);

    const sections = splitSections(htmlToLines(detail.data?.content ?? ''));
    let madeFromSections = 0;

    for (const section of sections) {
      const period = sectionPeriod(section);
      if (period === null) continue;

      // 기간이 있는 구획은 전부 "일정이 있는 공지"로 세되, 담을지는 종류로 가른다.
      madeFromSections += 1;

      const type = classifyAnnouncement(section.title, periodLabelLines(section.body).join(' '));
      if (!keep.has(type)) {
        filteredOut += 1;
        continue;
      }

      if (period.startBasis === 'maintenance') maintenanceStarts += 1;
      else if (period.startBasis === 'dateOnly') dateOnlyStarts += 1;

      events.push({
        gameSlug: game.slug,
        type,
        title: section.title,
        // 어느 공지에서 나온 항목인지 밝혀야 원문을 대조할 수 있다.
        description: title,
        startAt: period.startAt,
        endAt: period.endAt,
        region: 'KR',
        sourceUrl,
        sourceKind: 'official_api',
        // 구획에는 저마다의 이미지가 없다. 본문에 <img>가 아예 없어서,
        // 공지 대표 배너를 물려주면 한 공지에서 나온 카드가 전부 같은 그림이 된다.
        // 같은 배너를 여러 장 늘어놓느니 제목과 기간만 보여주는 편이 읽기 쉽다.
        imageUrl: null,
        externalId: `${item.content_id}#${section.no}`,
      });
    }

    // 구획에서 일정을 하나도 못 뽑았다면(이슈 안내, 개발자 노트 등)
    // 공지 자체를 한 건으로 남긴다. 기간이 없으니 게시일을 시작으로 둔다.
    if (madeFromSections === 0) {
      noticesWithoutSchedule += 1;
      const type = classifyAnnouncement(title);

      if (keep.has(type) && Number.isFinite(publishedAt)) {
        events.push({
          gameSlug: game.slug,
          type,
          title,
          description: null,
          startAt: unixSecondsToUtcIso(publishedAt),
          endAt: null,
          region: 'KR',
          sourceUrl,
          sourceKind: 'official_api',
          // 공지 한 건을 그대로 남기는 경우이므로 공지 대표 배너가 맞다.
          imageUrl: pickImage(detail.data?.pic_urls, item.pic_urls),
          externalId: item.content_id ?? null,
        });
      } else if (keep.has(type)) {
        warnings.push(`기간과 게시일을 모두 알 수 없어 건너뜀 (content_id=${item.content_id})`);
      }
    }

    await wait(REQUEST_INTERVAL_MS);
  }

  warnings.push(`공지 ${items.length}건에서 일정 ${events.length}건을 만들었습니다.`);
  if (filteredOut > 0) {
    warnings.push(
      `수집 대상 종류(${keepTypes.join(', ')})가 아니라 제외한 구획: ${filteredOut}건` +
        ' — 상점 판매·아레나 시즌 같은 게임 내 운영 일정입니다.',
    );
  }
  if (noticesWithoutSchedule > 0) {
    warnings.push(`일정 구획이 없어 공지 자체로 남긴 건: ${noticesWithoutSchedule}건`);
  }
  if (maintenanceStarts > 0) {
    warnings.push(
      `"점검 종료 후"로만 적혀 시작 시각을 그날 05:00으로 둔 일정: ${maintenanceStarts}건` +
        ' (니케의 하루 경계가 05:00이라 점검 종료는 그보다 뒤다. 날짜는 정확)',
    );
  }
  if (dateOnlyStarts > 0) {
    warnings.push(`날짜만 적혀 시작 시각을 그날 0시로 둔 일정: ${dateOnlyStarts}건 (날짜는 정확)`);
  }

  return { gameSlug: game.slug, events, warnings };
};
