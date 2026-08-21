import { GAMES } from '@/config/games';
import { formatPeriod, getStatusBadge, type StatusTone } from '@/lib/events/display';
import { getEventStatus } from '@/lib/events/status';
import type { GameEvent } from '@/types/event';

/** 상태별 뱃지 스타일. 색 의미를 한곳에 모아둔다. */
const TONE_CLASS: Record<StatusTone, string> = {
  live: 'bg-live/15 text-live',
  soon: 'bg-soon/15 text-soon',
  upcoming: 'bg-accent/15 text-accent',
  ended: 'bg-surface-2 text-dim',
};

interface EventCardProps {
  event: GameEvent;
  /** 서버·클라이언트 렌더 결과를 맞추기 위해 기준 시각을 위에서 내려받는다. */
  now: number;
}

export function EventCard({ event, now }: EventCardProps) {
  const game = GAMES[event.gameSlug];
  const badge = getStatusBadge(event, now);
  const isEnded = getEventStatus(event, now) === 'ended';

  return (
    <article
      className={`rounded-xl border border-line bg-surface p-4 transition-colors hover:border-dim ${
        isEnded ? 'opacity-55' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium"
            // 게임 색은 데이터에서 오므로 Tailwind 클래스로 표현할 수 없다.
            style={{ backgroundColor: `${game.color}22`, color: game.color }}
          >
            {game.shortName}
          </span>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
            {event.type}
          </span>
        </div>

        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[badge.tone]}`}>
          {badge.text}
        </span>
      </div>

      <h3 className="mt-2.5 text-sm leading-relaxed font-medium break-keep text-ink">
        {event.title}
      </h3>

      {event.description !== null && (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed break-keep text-muted">
          {event.description}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-dim">
        <time dateTime={event.startAt}>{formatPeriod(event)}</time>

        {event.sourceUrl !== null && (
          <a
            href={event.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-muted underline-offset-2 hover:text-accent hover:underline"
          >
            원문
          </a>
        )}
      </div>
    </article>
  );
}
