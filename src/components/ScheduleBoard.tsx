'use client';

import { useMemo, useState } from 'react';

import { EventCard } from '@/components/EventCard';
import { FilterBar } from '@/components/FilterBar';
import { GanttCalendar } from '@/components/GanttCalendar';
import { GAMES } from '@/config/games';
import { compareForTimeline, getEventStatus } from '@/lib/events/status';
import { useNow } from '@/lib/useNow';
import type { GameEvent } from '@/types/event';
import {
  ALL,
  DEFAULT_FILTERS,
  type ScheduleFilters,
  type ScheduleView,
} from '@/types/filters';

interface ScheduleBoardProps {
  events: GameEvent[];
  /** 서버 렌더 시각. 하이드레이션 불일치를 막기 위해 첫 렌더는 이 값으로 맞춘다. */
  initialNow: number;
}

export function ScheduleBoard({ events, initialNow }: ScheduleBoardProps) {
  const now = useNow(initialNow);
  const [filters, setFilters] = useState<ScheduleFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<ScheduleView>('timeline');

  const filtered = useMemo(() => {
    const keyword = filters.query.trim().toLowerCase();

    return events
      .filter((event) => {
        if (filters.game !== ALL && event.gameSlug !== filters.game) return false;
        if (filters.type !== ALL && event.type !== filters.type) return false;
        if (filters.hideEnded && getEventStatus(event, now) === 'ended') return false;

        if (keyword !== '') {
          const haystack = [event.title, event.description ?? '', GAMES[event.gameSlug].name]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(keyword)) return false;
        }

        return true;
      })
      .sort((a, b) => compareForTimeline(a, b, now));
  }, [events, filters, now]);

  const handleFiltersChange = (patch: Partial<ScheduleFilters>) => {
    setFilters((previous) => ({ ...previous, ...patch }));
  };

  return (
    <div className="space-y-5">
      <FilterBar
        filters={filters}
        view={view}
        onFiltersChange={handleFiltersChange}
        onViewChange={setView}
        resultCount={filtered.length}
      />

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-12 text-center text-sm text-dim">
          조건에 맞는 일정이 없습니다. 필터를 넓혀 보세요.
        </p>
      ) : view === 'timeline' ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((event) => (
            <EventCard key={event.id} event={event} now={now} />
          ))}
        </div>
      ) : (
        <GanttCalendar events={filtered} now={now} />
      )}
    </div>
  );
}
