import type { EventStatus, GameEvent } from '@/types/event';

/** 상태 계산에 필요한 최소 필드. 목 데이터·DB 데이터 양쪽에 쓰인다. */
type Schedulable = Pick<GameEvent, 'startAt' | 'endAt'>;

/** 종료가 임박했다고 볼 기준 (일). */
export const ENDING_SOON_DAYS = 3;

const DAY_IN_MS = 86_400_000;

/**
 * 이벤트의 진행 상태를 계산한다.
 * 저장하지 않고 매 렌더마다 계산하므로, 날짜가 지나면 자동으로 반영된다.
 *
 * @param now 기준 시각(ms). 테스트에서 고정값을 넣기 위해 주입받는다.
 */
export function getEventStatus(event: Schedulable, now: number = Date.now()): EventStatus {
  const start = new Date(event.startAt).getTime();
  if (now < start) return 'upcoming';

  // 종료일이 없는 공지는 시작한 이상 계속 진행 중으로 본다.
  if (event.endAt === null) return 'ongoing';

  return now > new Date(event.endAt).getTime() ? 'ended' : 'ongoing';
}

/**
 * 종료까지 남은 일수를 올림해서 돌려준다.
 * 종료일이 없거나 이미 끝났으면 null.
 */
export function getDaysUntilEnd(event: Schedulable, now: number = Date.now()): number | null {
  if (event.endAt === null) return null;

  const remaining = new Date(event.endAt).getTime() - now;
  return remaining <= 0 ? null : Math.ceil(remaining / DAY_IN_MS);
}

/** 시작까지 남은 일수. 이미 시작했으면 null. */
export function getDaysUntilStart(event: Schedulable, now: number = Date.now()): number | null {
  const remaining = new Date(event.startAt).getTime() - now;
  return remaining <= 0 ? null : Math.ceil(remaining / DAY_IN_MS);
}

/** 진행 중이면서 종료가 임박했는지. */
export function isEndingSoon(event: Schedulable, now: number = Date.now()): boolean {
  if (getEventStatus(event, now) !== 'ongoing') return false;

  const daysLeft = getDaysUntilEnd(event, now);
  return daysLeft !== null && daysLeft <= ENDING_SOON_DAYS;
}

/**
 * 타임라인 정렬 기준.
 * 진행 중 → 예정 → 종료 순으로 묶고, 그룹 안에서는
 * 진행 중은 "곧 끝나는 것", 예정은 "곧 시작하는 것", 종료는 "최근에 끝난 것"이 먼저 온다.
 */
export function compareForTimeline(
  a: Schedulable,
  b: Schedulable,
  now: number = Date.now(),
): number {
  const statusRank: Record<EventStatus, number> = { ongoing: 0, upcoming: 1, ended: 2 };
  const rankDiff = statusRank[getEventStatus(a, now)] - statusRank[getEventStatus(b, now)];
  if (rankDiff !== 0) return rankDiff;

  const status = getEventStatus(a, now);

  if (status === 'upcoming') {
    return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
  }

  // 종료일이 없는 항목은 끝나는 시점을 알 수 없으므로 뒤로 보낸다.
  const endA = a.endAt === null ? Number.POSITIVE_INFINITY : new Date(a.endAt).getTime();
  const endB = b.endAt === null ? Number.POSITIVE_INFINITY : new Date(b.endAt).getTime();

  return status === 'ongoing' ? endA - endB : endB - endA;
}
