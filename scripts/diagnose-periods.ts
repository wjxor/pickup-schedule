/**
 * 기간 추출이 실패하거나 근사치로 떨어지는 사례의 원문을 그대로 보여주는 진단 도구.
 *
 * 사용법:
 *   npx tsx scripts/diagnose-periods.ts nikke
 *   npx tsx scripts/diagnose-periods.ts wuwa
 *   npx tsx scripts/diagnose-periods.ts zzz
 *
 * 정규식을 고치기 전에 실제 표기를 확인하려고 만들었다. 수집 결과에는 영향을 주지 않는다.
 */
import { getGame } from '@/config/games';
import { createCollectorContext } from '@/lib/collectors';
import { htmlToLines } from '@/lib/collectors/html';
import {
  extractPeriod as extractHoyolabPeriod,
  buildVersionPeriods,
  toPlainText,
} from '@/lib/collectors/adapters/hoyolab';
import { splitSections, sectionPeriod, periodLines } from '@/lib/collectors/adapters/levelinfinite';

const context = createCollectorContext();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function heading(text: string): void {
  console.log(`\n${'='.repeat(78)}\n${text}\n${'='.repeat(78)}`);
}

// ---------------------------------------------------------------------------
// 니케 — "점검 종료 후"로만 적힌 시작
// ---------------------------------------------------------------------------

async function diagnoseNikke(): Promise<void> {
  const game = getGame('nikke');
  if (!game || game.collector.kind !== 'levelinfinite') throw new Error('니케 설정 없음');

  const { cmsGameId, areaId, language, primaryLabelId, secondaryLabelId } = game.collector;
  const base =
    'https://na-community.playerinfinite.com/api/gpts.information_feeds_svr.InformationFeedsSvr';
  const headers = {
    'Content-Type': 'application/json;charset=utf-8',
    'User-Agent': context.userAgent,
    'X-GameId': cmsGameId,
    'X-AreaId': areaId,
    'X-Source': 'pc_web',
    'X-Language': language,
  };
  const commonBody = { gameid: cmsGameId, language: [language], ext_info_type_list: [0, 1, 2] };

  const post = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
    const response = await context.fetchImpl(`${base}/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    return (await response.json()) as T;
  };

  const list = await post<{ data?: { info_content?: Array<{ content_id?: string; title?: string }> } }>(
    'GetContentByLabel',
    {
      ...commonBody,
      offset: 0,
      get_num: 10,
      primary_label_id: primaryLabelId,
      secondary_label_id: secondaryLabelId,
      content_class: 0,
    },
  );

  const items = list.data?.info_content ?? [];
  heading(`니케 — 공지 ${items.length}건에서 "점검" 표기 확인`);
  console.log('\n공지 제목 목록:');
  for (const item of items) console.log(`  - ${item.title}`);

  for (const item of items) {
    const detail = await post<{ data?: { content?: string; title?: string } }>(
      'GetContentInfoById',
      { ...commonBody, content_id: item.content_id },
    );

    const lines = htmlToLines(detail.data?.content ?? '');
    const sections = splitSections(lines);
    const approximate = sections.filter((s) => sectionPeriod(s)?.startBasis === 'maintenance');

    if (approximate.length === 0) {
      await wait(300);
      continue;
    }

    console.log(`\n--- ${detail.data?.title ?? item.title} (content_id=${item.content_id})`);
    console.log(`  시작이 근사인 구획: ${approximate.length}개`);

    // 이 공지 어디엔가 점검 시간이 적혀 있는지 본다.
    const maintenanceLines = lines.filter((line) => /점검/.test(line));
    console.log(`  "점검" 포함 줄 ${maintenanceLines.length}개:`);
    for (const line of maintenanceLines) {
      console.log(`    | ${line.slice(0, 130)}`);
    }

    console.log('  근사 구획의 기간 줄:');
    for (const section of approximate.slice(0, 4)) {
      console.log(`    [${section.no} ${section.title}]`);
      for (const line of periodLines(section.body).slice(0, 3)) {
        console.log(`      > ${line.slice(0, 130)}`);
      }
    }

    await wait(300);
  }
}

// ---------------------------------------------------------------------------
// 명조 — 점검 시간 줄의 타임존 표기
// ---------------------------------------------------------------------------

async function diagnoseWuwa(): Promise<void> {
  const game = getGame('wuwa');
  if (!game || game.collector.kind !== 'kurogame') throw new Error('명조 설정 없음');

  const { gameCode, locale, limit } = game.collector;
  const base = `https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/${gameCode}/${locale}`;

  const get = async <T>(url: string): Promise<T> => {
    const response = await context.fetchImpl(url, {
      headers: { 'User-Agent': context.userAgent },
      signal: AbortSignal.timeout(20_000),
    });
    return (await response.json()) as T;
  };

  const menu = await get<Array<{ articleId?: number; articleTitle?: string; startTime?: string }>>(
    `${base}/ArticleMenu.json`,
  );

  const recent = menu
    .filter((item) => item.articleId !== undefined)
    .sort((a, b) => Date.parse(b.startTime ?? '') - Date.parse(a.startTime ?? ''))
    .slice(0, limit);

  heading(`명조 — 최근 ${recent.length}건 중 버전 공지의 점검 시간 표기`);

  for (const item of recent) {
    if (!/버전/.test(item.articleTitle ?? '')) continue;

    const detail = await get<{ articleContent?: string; articleTitle?: string }>(
      `${base}/article/${item.articleId}.json`,
    );
    const lines = htmlToLines(detail.articleContent ?? '');

    const interesting = lines.filter((line) => /점검|시간|한국|서버|UTC|GMT/.test(line));
    if (interesting.length === 0) continue;

    console.log(`\n--- ${detail.articleTitle ?? item.articleTitle} (articleId=${item.articleId})`);
    for (const line of interesting.slice(0, 14)) {
      console.log(`    | ${line.slice(0, 140)}`);
    }

    await wait(200);
  }
}

// ---------------------------------------------------------------------------
// 젠레스 — 기간을 못 찾은 공지
// ---------------------------------------------------------------------------

async function diagnoseZzz(): Promise<void> {
  const game = getGame('zzz');
  if (!game || game.collector.kind !== 'hoyolab') throw new Error('젠레스 설정 없음');

  const { gids, pageSize } = game.collector;
  const listUrl =
    'https://bbs-api-os.hoyolab.com/community/post/wapi/getNewsList?' +
    new URLSearchParams({ gids: String(gids), type: '1', page_size: String(pageSize) }).toString();

  const get = async <T>(url: string): Promise<T> => {
    const response = await context.fetchImpl(url, {
      headers: { 'User-Agent': context.userAgent, 'x-rpc-language': 'ko-kr' },
      signal: AbortSignal.timeout(20_000),
    });
    return (await response.json()) as T;
  };

  const list = await get<{
    data?: { list?: Array<{ post?: { post_id?: string; subject?: string } }> };
  }>(listUrl);

  const posts = (list.data?.list ?? []).filter((entry) => entry.post?.post_id);
  const detailed: Array<{ title: string; text: string; postId: string }> = [];

  for (const entry of posts) {
    const full = await get<{ data?: { post?: { post?: Record<string, unknown> } } }>(
      `https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull?post_id=${entry.post!.post_id}`,
    );
    const post = full.data?.post?.post;
    detailed.push({
      title: entry.post!.subject ?? '',
      text: post ? toPlainText(post) : '',
      postId: entry.post!.post_id!,
    });
    await wait(300);
  }

  const versions = buildVersionPeriods(detailed);
  heading(`젠레스 — 버전 기간표 ${[...versions.keys()].join(', ')} / 기간 추출 실패 목록`);

  for (const { title, text, postId } of detailed) {
    if (extractHoyolabPeriod(text, versions) !== null) continue;

    console.log(`\n--- ${title} (post_id=${postId})`);
    // 날짜처럼 보이는 조각만 추려 어떤 표기를 놓쳤는지 본다.
    const dateLike = text.match(/[^。.!?]{0,60}(?:\d{4}[/년]\d{1,2}|버전\s*업데이트|KST)[^。.!?]{0,60}/g);
    if (dateLike) {
      for (const fragment of dateLike.slice(0, 6)) {
        console.log(`    | ${fragment.trim().slice(0, 140)}`);
      }
    } else {
      console.log('    (날짜처럼 보이는 조각 없음)');
      console.log(`    본문 앞부분: ${text.slice(0, 160)}`);
    }
  }
}


// ---------------------------------------------------------------------------
// 니케 — 점검 공지가 다른 컬럼에 있는지 / 목록을 더 받으면 나오는지
// ---------------------------------------------------------------------------

async function diagnoseNikkeLabels(): Promise<void> {
  const game = getGame('nikke');
  if (!game || game.collector.kind !== 'levelinfinite') throw new Error('니케 설정 없음');

  const { cmsGameId, areaId, language, primaryLabelId } = game.collector;
  const base =
    'https://na-community.playerinfinite.com/api/gpts.information_feeds_svr.InformationFeedsSvr';
  const headers = {
    'Content-Type': 'application/json;charset=utf-8',
    'User-Agent': context.userAgent,
    'X-GameId': cmsGameId,
    'X-AreaId': areaId,
    'X-Source': 'pc_web',
    'X-Language': language,
  };
  const commonBody = { gameid: cmsGameId, language: [language], ext_info_type_list: [0, 1, 2] };

  const post = async <T>(body: Record<string, unknown>): Promise<T> => {
    const response = await context.fetchImpl(`${base}/GetContentByLabel`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    return (await response.json()) as T;
  };

  // 조사 기록에 남은 하위 컬럼 두 개(NOTICE 892 / NEWS 496)를 모두 훑는다.
  for (const secondary of [892, 496]) {
    heading(`니케 — secondary_label_id=${secondary} 목록 30건`);
    for (let offset = 0; offset < 30; offset += 10) {
      const payload = await post<{
        data?: { result?: number; info_content?: Array<{ title?: string; pub_timestamp?: string }> };
      }>({
        ...commonBody,
        offset,
        get_num: 10,
        primary_label_id: primaryLabelId,
        secondary_label_id: secondary,
        content_class: 0,
      });

      for (const item of payload.data?.info_content ?? []) {
        console.log(`  - ${item.title}`);
      }
      await wait(300);
    }
  }
}

// ---------------------------------------------------------------------------
// 명조 — 점검 종료 시각과 같은 날 시작하는 절대 표기를 대조한다
// ---------------------------------------------------------------------------

async function diagnoseWuwaCross(): Promise<void> {
  const game = getGame('wuwa');
  if (!game || game.collector.kind !== 'kurogame') throw new Error('명조 설정 없음');

  const { gameCode, locale, limit } = game.collector;
  const base = `https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/${gameCode}/${locale}`;

  const get = async <T>(url: string): Promise<T> => {
    const response = await context.fetchImpl(url, {
      headers: { 'User-Agent': context.userAgent },
      signal: AbortSignal.timeout(20_000),
    });
    return (await response.json()) as T;
  };

  const menu = await get<Array<{ articleId?: number; articleTitle?: string; startTime?: string }>>(
    `${base}/ArticleMenu.json`,
  );
  const recent = menu
    .filter((item) => item.articleId !== undefined)
    .sort((a, b) => Date.parse(b.startTime ?? '') - Date.parse(a.startTime ?? ''))
    .slice(0, limit);

  // 버전 점검일(= 버전이 열리는 날)을 먼저 모은다.
  const openDays = new Map<string, string>(); // `8월 20일` → 점검 종료 시각 문자열
  const all: Array<{ title: string; lines: string[] }> = [];

  for (const item of recent) {
    const detail = await get<{ articleContent?: string; articleTitle?: string }>(
      `${base}/article/${item.articleId}.json`,
    );
    const lines = htmlToLines(detail.articleContent ?? '');
    all.push({ title: detail.articleTitle ?? item.articleTitle ?? '', lines });

    for (const line of lines) {
      const m = /점검\s*시간\s*[:：]\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2}):(\d{2})\s*[~〜～]\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2}):(\d{2})/.exec(line);
      if (m) openDays.set(`${m[6]}-${m[7]}-${m[8]}`, `${m[9]}:${m[10]}`);
    }
    await wait(200);
  }

  heading('명조 — 버전 점검 종료 시각 / 같은 날짜를 쓰는 다른 표기');
  for (const [day, endTime] of openDays) {
    const [y, mo, d] = day.split('-');
    console.log(`\n점검 종료: ${y}년 ${mo}월 ${d}일 ${endTime}`);

    const sameDay = new RegExp(`${y}년\\s*${mo}월\\s*${d}일\\s*\\d{1,2}:\\d{2}`);
    let shown = 0;
    for (const { title, lines } of all) {
      for (const line of lines) {
        if (!sameDay.test(line)) continue;
        // 점검 시간 줄 자체는 건너뛴다.
        if (/점검\s*시간\s*[:：]/.test(line)) continue;
        console.log(`    [${title.slice(0, 28)}] ${line.slice(0, 120)}`);
        shown += 1;
        if (shown >= 6) break;
      }
      if (shown >= 6) break;
    }
    if (shown === 0) console.log('    (같은 날짜를 쓰는 다른 표기 없음)');
  }

  // 타임존을 명시한 줄이 하나라도 있는지 전수 확인
  heading('명조 — 타임존을 명시한 줄');
  let found = 0;
  for (const { title, lines } of all) {
    for (const line of lines) {
      if (!/한국\s*시간|서버\s*시간|UTC|GMT|KST/.test(line)) continue;
      console.log(`  [${title.slice(0, 28)}] ${line.slice(0, 130)}`);
      found += 1;
      if (found >= 25) return;
    }
  }
  if (found === 0) console.log('  (없음)');
}


// ---------------------------------------------------------------------------
// 명조 — 점검 안내 전용 공지의 본문
// ---------------------------------------------------------------------------

async function diagnoseWuwaMaintenance(): Promise<void> {
  const game = getGame('wuwa');
  if (!game || game.collector.kind !== 'kurogame') throw new Error('명조 설정 없음');

  const { gameCode, locale } = game.collector;
  const base = `https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/${gameCode}/${locale}`;

  const get = async <T>(url: string): Promise<T> => {
    const response = await context.fetchImpl(url, {
      headers: { 'User-Agent': context.userAgent },
      signal: AbortSignal.timeout(20_000),
    });
    return (await response.json()) as T;
  };

  const menu = await get<Array<{ articleId?: number; articleTitle?: string; startTime?: string }>>(
    `${base}/ArticleMenu.json`,
  );
  const maintenance = menu
    .filter((item) => /점검/.test(item.articleTitle ?? ''))
    .sort((a, b) => Date.parse(b.startTime ?? '') - Date.parse(a.startTime ?? ''))
    .slice(0, 4);

  heading(`명조 — 점검 안내 공지 ${maintenance.length}건의 본문`);

  for (const item of maintenance) {
    const detail = await get<{ articleContent?: string; articleTitle?: string }>(
      `${base}/article/${item.articleId}.json`,
    );
    console.log(`\n--- ${detail.articleTitle ?? item.articleTitle} (게시 ${item.startTime})`);
    for (const line of htmlToLines(detail.articleContent ?? '').slice(0, 16)) {
      console.log(`    | ${line.slice(0, 140)}`);
    }
    await wait(200);
  }
}


// ---------------------------------------------------------------------------
// 니케 — 공지 게시 시각이 점검 종료 시점을 알려주는지
// ---------------------------------------------------------------------------

async function diagnoseNikkePublish(): Promise<void> {
  const game = getGame('nikke');
  if (!game || game.collector.kind !== 'levelinfinite') throw new Error('니케 설정 없음');

  const { cmsGameId, areaId, language, primaryLabelId, secondaryLabelId } = game.collector;
  const base =
    'https://na-community.playerinfinite.com/api/gpts.information_feeds_svr.InformationFeedsSvr';
  const headers = {
    'Content-Type': 'application/json;charset=utf-8',
    'User-Agent': context.userAgent,
    'X-GameId': cmsGameId,
    'X-AreaId': areaId,
    'X-Source': 'pc_web',
    'X-Language': language,
  };
  const commonBody = { gameid: cmsGameId, language: [language], ext_info_type_list: [0, 1, 2] };

  const items: Array<{ title?: string; pub_timestamp?: string | number }> = [];
  for (const offset of [0, 10, 20]) {
    const response = await context.fetchImpl(`${base}/GetContentByLabel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...commonBody,
        offset,
        get_num: 10,
        primary_label_id: primaryLabelId,
        secondary_label_id: secondaryLabelId,
        content_class: 0,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json()) as {
      data?: { info_content?: Array<{ title?: string; pub_timestamp?: string | number }> };
    };
    items.push(...(payload.data?.info_content ?? []));
    await wait(300);
  }

  heading('니케 — 공지 게시 시각(한국시간)');
  for (const item of items) {
    const seconds = Number(item.pub_timestamp);
    if (!Number.isFinite(seconds)) continue;
    const kst = new Date(seconds * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    console.log(`  ${kst}  ${item.title?.trim()}`);
  }
}

const target = process.argv[2];
const runners: Record<string, () => Promise<void>> = {
  nikke: diagnoseNikke,
  wuwa: diagnoseWuwa,
  zzz: diagnoseZzz,
  'nikke-labels': diagnoseNikkeLabels,
  'wuwa-cross': diagnoseWuwaCross,
  'wuwa-maint': diagnoseWuwaMaintenance,
  'nikke-publish': diagnoseNikkePublish,
};

const runner = runners[target];
if (!runner) {
  console.error(`사용법: npx tsx scripts/diagnose-periods.ts <${Object.keys(runners).join('|')}>`);
  process.exit(1);
}

runner().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
