import Image from 'next/image';

import { GAMES } from '@/config/games';
import { isAllowedImageHost } from '@/config/image-hosts';
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

/**
 * 카드가 놓이는 그리드에 맞춘 이미지 크기 힌트.
 * 브라우저가 화면 폭에 맞는 크기만 내려받게 해 불필요한 트래픽을 줄인다.
 * (모바일 1열 → sm 2열 → xl 3열)
 */
const IMAGE_SIZES = '(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw';

interface EventCardProps {
  event: GameEvent;
  /** 서버·클라이언트 렌더 결과를 맞추기 위해 기준 시각을 위에서 내려받는다. */
  now: number;
}

export function EventCard({ event, now }: EventCardProps) {
  const game = GAMES[event.gameSlug];
  const badge = getStatusBadge(event, now);
  const isEnded = getEventStatus(event, now) === 'ended';

  // 허용 목록에 없는 호스트는 Next.js가 이미지 요청을 막는다.
  // 깨진 이미지를 보여주느니 영역을 아예 만들지 않는다.
  const imageUrl = isAllowedImageHost(event.imageUrl) ? event.imageUrl : null;

  return (
    <article
      className={`overflow-hidden rounded-xl border border-line bg-surface p-4 transition-colors hover:border-dim ${
        isEnded ? 'opacity-55' : ''
      }`}
    >
      {imageUrl !== null && (
        // 음수 여백으로 카드 안쪽 여백을 상쇄해 배너가 카드 가장자리까지 닿게 한다.
        // 16:7로 낮게 잡은 이유는 카드가 길어지면 한 화면에 보이는 일정 수가 줄기 때문이다.
        <div className="relative -mx-4 -mt-4 mb-3 aspect-[16/7] overflow-hidden bg-surface-2">
          <Image
            src={imageUrl}
            // 제목이 같은 정보를 담고 있으므로 장식용으로 처리한다.
            // 화면 낭독기가 같은 내용을 두 번 읽지 않게 한다.
            alt=""
            fill
            sizes={IMAGE_SIZES}
            className="object-cover"
          />
        </div>
      )}

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
