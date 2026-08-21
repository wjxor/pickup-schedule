import { formatKst } from '@/lib/datetime';
import { getDaysUntilEnd, getDaysUntilStart, getEventStatus, isEndingSoon } from '@/lib/events/status';
import type { GameEvent } from '@/types/event';

type Schedulable = Pick<GameEvent, 'startAt' | 'endAt'>;

/** 상태 뱃지의 색 계열. 실제 색값은 컴포넌트가 정한다. */
export type StatusTone = 'live' | 'soon' | 'upcoming' | 'ended';

export interface StatusBadge {
  text: string;
  tone: StatusTone;
}

/**
 * 카드 우측에 붙일 상태 문구를 만든다.
 * "진행 중"보다 "종료 D-2"가 사용자에게 훨씬 쓸모 있으므로 임박 여부를 먼저 본다.
 */
export function getStatusBadge(event: Schedulable, now: number = Date.now()): StatusBadge {
  const status = getEventStatus(event, now);

  if (status === 'ended') {
    return { text: '종료', tone: 'ended' };
  }

  if (status === 'upcoming') {
    const daysLeft = getDaysUntilStart(event, now);
    return {
      text: daysLeft === null || daysLeft > 30 ? '예정' : `${daysLeft}일 뒤 시작`,
      tone: 'upcoming',
    };
  }

  if (isEndingSoon(event, now)) {
    const daysLeft = getDaysUntilEnd(event, now);
    return { text: `종료 D-${daysLeft}`, tone: 'soon' };
  }

  return { text: '진행 중', tone: 'live' };
}

/** 카드에 표시할 기간 문자열. 종료일이 없으면 그 사실을 분명히 밝힌다. */
export function formatPeriod(event: Schedulable): string {
  const start = formatKst(event.startAt, 'yyyy.MM.dd (E) HH:mm');

  if (event.endAt === null) {
    return `${start} ~ 종료일 미정`;
  }

  return `${start} ~ ${formatKst(event.endAt, 'yyyy.MM.dd (E) HH:mm')}`;
}
