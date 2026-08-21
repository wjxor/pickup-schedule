import type { EventType } from '@/types/event';

/**
 * 공지 제목으로 일정 종류를 판별한다.
 *
 * API가 주는 분류 필드를 쓰지 않는 이유:
 * 같은 회사 API인데도 원신은 숫자(2=기원), 스타레일은 한자 문자열(重要)이라
 * 게임 간 의미가 통일돼 있지 않다. 제목 키워드가 더 이식성이 높다.
 *
 * 게임을 추가할 때는 그 게임의 가챠 명칭만 아래 사전에 넣으면 된다.
 */

/**
 * 각 게임이 가챠를 부르는 이름.
 *   원신 = 기원, 스타레일 = 워프, 명조 = 조율, 젠레스 존 제로 = 변조 / 기간 한정 채널
 *
 * "채널"만으로는 공식 커뮤니티 채널 같은 것까지 걸리므로 "한정 채널"로 좁혔다.
 */
const PICKUP_PATTERN = /변조|한정\s*채널|기원|워프|조율|픽업|확률\s*UP|확률\s*상승/i;

const RERUN_PATTERN = /복각/;
const COLLAB_PATTERN = /콜라보/;
const BROADCAST_PATTERN = /특별\s*방송|공식\s*방송|생방송|프리뷰\s*방송/;
const UPDATE_PATTERN = /버전\s*업데이트|업데이트\s*안내|업데이트\s*공지|최적화/;
const VERSION_PATTERN = /\d+\.\d+\s*버전/;
const STORY_PATTERN = /메인\s*스토리|스토리\s*시즌/;
const REDEEM_PATTERN = /리딤\s*코드|교환\s*코드/;
const EVENT_PATTERN = /이벤트/;

/**
 * @param title 공지 제목
 * @param subtitle 부제. 없으면 빈 문자열.
 */
export function classifyAnnouncement(title: string, subtitle = ''): EventType {
  const text = `${title} ${subtitle}`;

  // 복각은 픽업의 일종이지만 사용자가 구분해서 보고 싶어 하므로 먼저 판정한다.
  if (RERUN_PATTERN.test(text)) return '복각';
  // 콜라보 픽업은 픽업으로 본다. 사용자가 찾는 것은 "무엇을 뽑을 수 있는가"이기 때문이다.
  if (PICKUP_PATTERN.test(text)) return '픽업';
  if (COLLAB_PATTERN.test(text)) return '콜라보';
  if (BROADCAST_PATTERN.test(text)) return '공식방송';
  if (REDEEM_PATTERN.test(text)) return '리딤코드';
  if (UPDATE_PATTERN.test(text)) return '업데이트';
  if (STORY_PATTERN.test(text)) return '스토리';
  if (VERSION_PATTERN.test(text)) return '버전';
  if (EVENT_PATTERN.test(text)) return '이벤트';
  return '공지';
}
