'use client';

import { useMemo, useState } from 'react';

import { GAMES, GAME_ORDER, type GameSlug } from '@/config/games';
import { toKstDateKey } from '@/lib/datetime';
import { getEventStatus } from '@/lib/events/status';
import type { GameEvent } from '@/types/event';

/** 화면에 한 번에 보여줄 일수. */
const WINDOW_DAYS = 21;
/** 날짜 한 칸의 너비(px). 가로 스크롤 계산에 쓰인다. */
const DAY_WIDTH = 38;
/** 게임 이름이 들어가는 왼쪽 고정 열의 너비(px). */
const LABEL_WIDTH = 96;

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * `YYYY-MM-DD` 키에 일수를 더한다.
 *
 * 키는 이미 한국시간 기준으로 만들어진 값이므로, UTC 기준으로 더하면
 * 브라우저 시간대나 서머타임에 영향받지 않고 정확히 하루씩 이동한다.
 */
function addDaysToKey(key: string, delta: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

/** 날짜 키에서 표시에 필요한 정보만 뽑는다. */
function describeDay(key: string): {
  month: number;
  dayOfMonth: number;
  weekday: number;
  isMonthStart: boolean;
} {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return {
    month,
    dayOfMonth: day,
    weekday: date.getUTCDay(),
    isMonthStart: day === 1,
  };
}

interface PositionedEvent {
  event: GameEvent;
  /** 0-based 열 인덱스 */
  startIndex: number;
  /** 차지하는 칸 수 */
  span: number;
  /** 창 왼쪽 밖에서 이미 시작했는지 */
  clippedStart: boolean;
  /** 창 오른쪽 밖까지 이어지는지 */
  clippedEnd: boolean;
}

interface GanttCalendarProps {
  events: GameEvent[];
  now: number;
}

export function GanttCalendar({ events, now }: GanttCalendarProps) {
  const todayKey = toKstDateKey(new Date(now).toISOString());
  // 오늘이 왼쪽에서 세 번째 칸에 오도록 시작점을 살짝 앞으로 당긴다.
  const [windowStart, setWindowStart] = useState(() => addDaysToKey(todayKey, -2));

  const dayKeys = useMemo(
    () => Array.from({ length: WINDOW_DAYS }, (_, index) => addDaysToKey(windowStart, index)),
    [windowStart],
  );

  const lastKey = dayKeys[dayKeys.length - 1];

  /** 게임별로 묶고, 각 이벤트가 몇 번째 칸부터 몇 칸을 차지하는지 계산한다. */
  const groups = useMemo(() => {
    const byGame = new Map<GameSlug, PositionedEvent[]>();

    for (const event of events) {
      const startKey = toKstDateKey(event.startAt);
      // 종료일이 없으면 하루짜리로 두되, 잘린 것으로 표시해 계속 진행 중임을 알린다.
      const endKey = event.endAt === null ? startKey : toKstDateKey(event.endAt);

      // 날짜 키는 ISO 형식이라 문자열 비교만으로 정렬·범위 판정이 된다.
      if (endKey < dayKeys[0] || startKey > lastKey) continue;

      const clippedStart = startKey < dayKeys[0];
      const clippedEnd = endKey > lastKey;

      const startIndex = clippedStart ? 0 : dayKeys.indexOf(startKey);
      const endIndex = clippedEnd ? dayKeys.length - 1 : dayKeys.indexOf(endKey);
      if (startIndex < 0 || endIndex < 0) continue;

      const positioned: PositionedEvent = {
        event,
        startIndex,
        span: Math.max(1, endIndex - startIndex + 1),
        clippedStart,
        clippedEnd: clippedEnd || event.endAt === null,
      };

      const bucket = byGame.get(event.gameSlug);
      if (bucket) bucket.push(positioned);
      else byGame.set(event.gameSlug, [positioned]);
    }

    return GAME_ORDER.filter((slug) => byGame.has(slug)).map((slug) => ({
      slug,
      rows: byGame.get(slug)!.sort((a, b) => a.startIndex - b.startIndex),
    }));
  }, [events, dayKeys, lastKey]);

  const gridTemplate = `${LABEL_WIDTH}px repeat(${WINDOW_DAYS}, ${DAY_WIDTH}px)`;
  const totalWidth = LABEL_WIDTH + WINDOW_DAYS * DAY_WIDTH;

  return (
    <section className="rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setWindowStart((key) => addDaysToKey(key, -7))}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
          >
            ‹ 이전 주
          </button>
          <button
            type="button"
            onClick={() => setWindowStart(addDaysToKey(todayKey, -2))}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
          >
            오늘
          </button>
          <button
            type="button"
            onClick={() => setWindowStart((key) => addDaysToKey(key, 7))}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
          >
            다음 주 ›
          </button>
        </div>

        <p className="text-xs text-dim">
          {windowStart.replace(/-/g, '.')} ~ {lastKey.replace(/-/g, '.')} · 한국시간 기준
        </p>
      </header>

      {groups.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-dim">
          이 기간에 표시할 일정이 없습니다.
        </p>
      ) : (
        <div className="thin-scrollbar overflow-x-auto">
          <div style={{ width: totalWidth }} className="min-w-full">
            {/* 날짜 헤더 */}
            <div
              className="sticky top-0 z-10 grid border-b border-line bg-surface"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="px-3 py-2 text-xs font-medium text-dim">게임</div>
              {dayKeys.map((key) => {
                const { month, dayOfMonth, weekday, isMonthStart } = describeDay(key);
                const isToday = key === todayKey;
                const isWeekend = weekday === 0 || weekday === 6;

                return (
                  <div
                    key={key}
                    className={`border-l border-line py-1.5 text-center ${
                      isToday ? 'bg-accent/10' : ''
                    }`}
                  >
                    <div
                      className={`text-xs leading-tight ${
                        isToday
                          ? 'font-bold text-accent'
                          : isWeekend
                            ? 'text-soon'
                            : 'text-muted'
                      }`}
                    >
                      {/* 달이 바뀌는 지점만 월을 함께 보여줘 긴 기간에서도 위치를 잃지 않게 한다. */}
                      {isMonthStart ? `${month}/${dayOfMonth}` : dayOfMonth}
                    </div>
                    <div className="text-[10px] leading-tight text-dim">
                      {WEEKDAY_LABELS[weekday]}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 게임별 행 */}
            {groups.map(({ slug, rows }) => (
              <div key={slug} className="border-b border-line last:border-b-0">
                {rows.map(({ event, startIndex, span, clippedStart, clippedEnd }, rowIndex) => (
                  <div
                    key={event.id}
                    className="grid items-center"
                    style={{ gridTemplateColumns: gridTemplate }}
                  >
                    <div className="truncate px-3 py-1 text-xs text-muted">
                      {rowIndex === 0 ? GAMES[slug].shortName : ''}
                    </div>

                    <div
                      className="py-1"
                      style={{ gridColumn: `${startIndex + 2} / span ${span}` }}
                      title={event.title}
                    >
                      <div
                        className={`truncate rounded px-2 py-1 text-[11px] leading-tight ${
                          getEventStatus(event, now) === 'ended' ? 'opacity-45' : ''
                        }`}
                        style={{
                          backgroundColor: `${GAMES[slug].color}26`,
                          color: GAMES[slug].color,
                          borderLeft: clippedStart ? 'none' : `3px solid ${GAMES[slug].color}`,
                        }}
                      >
                        {clippedStart ? '‹ ' : ''}
                        {event.title}
                        {clippedEnd ? ' ›' : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
