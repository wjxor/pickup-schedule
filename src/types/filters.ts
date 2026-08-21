import type { GameSlug } from '@/config/games';
import type { EventType } from '@/types/event';

/** 필터에서 "전체"를 뜻하는 값. 빈 문자열이나 null보다 의도가 분명하다. */
export const ALL = 'ALL' as const;

export interface ScheduleFilters {
  game: GameSlug | typeof ALL;
  type: EventType | typeof ALL;
  /** 제목·설명 대상 검색어 */
  query: string;
  /** 종료된 일정을 목록에서 감출지 */
  hideEnded: boolean;
}

export type ScheduleView = 'timeline' | 'calendar';

export const DEFAULT_FILTERS: ScheduleFilters = {
  game: ALL,
  type: ALL,
  query: '',
  hideEnded: true,
};
