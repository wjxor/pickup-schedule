'use client';

import { GAME_LIST } from '@/config/games';
import { EVENT_TYPES } from '@/types/event';
import { ALL, type ScheduleFilters, type ScheduleView } from '@/types/filters';

interface FilterBarProps {
  filters: ScheduleFilters;
  view: ScheduleView;
  /** 필터 일부만 바꿔 넘긴다. 호출부에서 전체 객체를 만들 필요가 없다. */
  onFiltersChange: (patch: Partial<ScheduleFilters>) => void;
  onViewChange: (view: ScheduleView) => void;
  /** 현재 필터를 통과한 일정 수. 결과가 0건일 때 사용자가 원인을 짐작할 수 있게 보여준다. */
  resultCount: number;
}

const chipBase =
  'rounded-full border px-3 py-1 text-xs transition-colors cursor-pointer whitespace-nowrap';

export function FilterBar({
  filters,
  view,
  onFiltersChange,
  onViewChange,
  resultCount,
}: FilterBarProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filters.query}
          onChange={(nativeEvent) => onFiltersChange({ query: nativeEvent.target.value })}
          placeholder="게임명, 이벤트명 검색"
          className="min-w-52 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-dim focus:border-accent"
          aria-label="일정 검색"
        />

        <div className="flex rounded-lg border border-line p-0.5" role="tablist">
          {(
            [
              ['timeline', '타임라인'],
              ['calendar', '일정표'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => onViewChange(value)}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs transition-colors ${
                view === value ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onFiltersChange({ game: ALL })}
          className={`${chipBase} ${
            filters.game === ALL
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-line text-muted hover:text-ink'
          }`}
        >
          전체 게임
        </button>

        {GAME_LIST.map((game) => {
          const isActive = filters.game === game.slug;
          return (
            <button
              key={game.slug}
              type="button"
              onClick={() => onFiltersChange({ game: game.slug })}
              className={`${chipBase} ${isActive ? '' : 'border-line text-muted hover:text-ink'}`}
              style={
                isActive
                  ? {
                      borderColor: game.color,
                      backgroundColor: `${game.color}1f`,
                      color: game.color,
                    }
                  : undefined
              }
            >
              {game.shortName}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onFiltersChange({ type: ALL })}
          className={`${chipBase} ${
            filters.type === ALL
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-line text-muted hover:text-ink'
          }`}
        >
          전체 종류
        </button>

        {EVENT_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onFiltersChange({ type })}
            className={`${chipBase} ${
              filters.type === type
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-line text-muted hover:text-ink'
            }`}
          >
            {type}
          </button>
        ))}

        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={filters.hideEnded}
            onChange={(nativeEvent) => onFiltersChange({ hideEnded: nativeEvent.target.checked })}
            className="accent-[var(--accent)]"
          />
          종료 숨김
        </label>

        <span className="text-xs text-dim">{resultCount}건</span>
      </div>
    </div>
  );
}
