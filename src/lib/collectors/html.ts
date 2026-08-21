/**
 * 공지 본문(HTML)을 정규식으로 훑기 좋은 평문으로 바꾸는 도구.
 *
 * 명조·니케는 본문을 HTML 문자열로 내려준다. 파서 라이브러리를 붙이는 대신
 * 문자열 치환으로 끝내는 이유는, 우리가 본문에서 필요한 것이 "줄 단위 텍스트"뿐이고
 * DOM 구조는 쓰지 않기 때문이다.
 *
 * 줄바꿈을 살리는 것이 핵심이다. 태그를 전부 공백으로 지워버리면
 * `*이벤트 기간: ...` 같은 항목이 옆 문장과 붙어 기간 추출이 어려워진다.
 */

/** 자주 쓰이는 HTML 엔티티만 되돌린다. 본문에서 날짜를 뽑는 데 필요한 수준이면 충분하다. */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** 블록 요소가 끝나면 줄바꿈으로 바꾼다. 문단 경계를 잃지 않기 위해서다. */
const BLOCK_END = /<\/(?:p|div|li|tr|h[1-6]|section|article)\s*>/gi;

/**
 * HTML을 평문으로 바꾼다.
 *
 * @param html 원본 HTML 문자열
 * @returns 줄바꿈이 보존된 평문
 */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<(?:script|style)[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_END, '\n')
    .replace(/<[^>]+>/g, '');

  for (const [entity, char] of Object.entries(ENTITIES)) {
    text = text.split(entity).join(char);
  }

  // 전각 공백과 연속 공백을 정리하되, 줄바꿈은 남긴다.
  return text.replace(/[ \t 　]+/g, ' ');
}

/**
 * HTML을 의미 있는 줄의 배열로 바꾼다.
 * 빈 줄은 버린다. 공지 본문에는 장식용 빈 문단이 많다.
 */
export function htmlToLines(html: string): string[] {
  return htmlToText(html)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** `<img src="...">` 또는 본문에 그대로 적힌 이미지 주소 중 첫 번째. */
const IMAGE_IN_SRC = /<img[^>]+src\s*=\s*["']([^"']+)["']/i;
const BARE_IMAGE_URL = /https?:\/\/[^\s"'<>)]+\.(?:png|jpe?g|webp|gif)/i;

/**
 * 본문에서 대표 이미지 주소를 뽑는다. 없으면 null.
 *
 * 별도의 커버 필드를 주지 않는 게임(명조)에서 카드 배너로 쓴다.
 */
export function firstImageUrl(html: string): string | null {
  const inSrc = IMAGE_IN_SRC.exec(html)?.[1];
  if (inSrc?.startsWith('http')) return inSrc;

  return BARE_IMAGE_URL.exec(html)?.[0] ?? null;
}
