import { type CollectorAdapter, skipped } from '@/lib/collectors/types';

/**
 * 공지 페이지 크롤링 어댑터 (니케 / 명조).
 *
 * 아직 구현 전이다. 이 두 게임은 공개 API가 확인되지 않아,
 * 공지 목록 페이지를 긁은 뒤 본문에서 날짜를 뽑아내는 단계가 필요하다.
 *
 * 구현할 때 순서:
 *   1. 공지 목록 페이지의 실제 데이터 요청(XHR)을 찾아 JSON 엔드포인트가 있는지 먼저 확인한다.
 *      SPA라면 화면 HTML이 아니라 그 뒤의 JSON을 쓰는 편이 훨씬 안정적이다.
 *   2. robots.txt와 이용약관을 확인하고, 요청 간격을 충분히 둔다.
 *   3. 본문에서 기간을 뽑는 일은 표기가 게임마다 달라 정규식으로는 한계가 있다.
 *      `src/lib/collectors/parsers/` 의 LLM 파서에 본문을 넘겨 JSON으로 받는다.
 *
 * 그때까지는 건너뛴 이유를 명확히 남겨, 수집 로그만 봐도 무엇이 비어 있는지 알 수 있게 한다.
 */
export const collectCrawler: CollectorAdapter = async (game) => {
  if (game.collector.kind !== 'crawler') {
    return skipped(game, `크롤러 어댑터가 아닌 설정입니다: ${game.collector.kind}`);
  }

  return skipped(
    game,
    `크롤러 미구현. 공지 출처: ${game.collector.noticeUrl} — 당분간 관리자 수동 입력으로 채워야 합니다.`,
  );
};

/**
 * 수동 입력 전용 게임을 위한 어댑터.
 * 자동 수집 대상이 아님을 로그에 남기는 것 외에는 하는 일이 없다.
 */
export const collectManual: CollectorAdapter = async (game) =>
  skipped(game, '수동 입력 전용 게임입니다. 자동 수집을 시도하지 않습니다.');
