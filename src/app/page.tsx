import { ScheduleBoard } from '@/components/ScheduleBoard';
import { GAME_LIST } from '@/config/games';
import { getEvents, isDatabaseConfigured } from '@/lib/events/repository';

/**
 * 메인 페이지.
 *
 * 데이터 조회는 서버에서 하고, 필터·뷰 전환 같은 상호작용만 클라이언트로 넘긴다.
 * 이렇게 하면 첫 화면이 검색엔진과 사용자 모두에게 완성된 상태로 전달된다.
 */
/**
 * 정적 생성 결과를 5분마다 다시 만든다.
 * 일정 데이터는 자주 바뀌지 않으므로 매 요청 렌더링은 낭비다.
 */
export const revalidate = 300;

export default async function HomePage() {
  const { events, fetchedAt } = await getEvents();

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-lg font-bold tracking-tight">픽업 스케줄</h1>
            <p className="mt-0.5 text-xs text-dim">
              서브컬처 게임 픽업 · 이벤트 일정 통합 캘린더
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {GAME_LIST.map((game) => (
              <a
                key={game.slug}
                href={game.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:text-ink"
                title={`${game.name} 공식 사이트`}
              >
                <span
                  className="mr-1.5 inline-block size-1.5 rounded-full align-middle"
                  style={{ backgroundColor: game.color }}
                />
                {game.shortName}
              </a>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6">
        {!isDatabaseConfigured && (
          <p className="mb-4 rounded-lg border border-soon/30 bg-soon/10 px-3 py-2 text-xs text-soon">
            데이터베이스가 연결되지 않아 수집기가 만든 목 데이터로 동작 중입니다.
            <code className="mx-1 rounded bg-surface-2 px-1 py-0.5">.env.local</code>에 Supabase
            정보를 넣으면 실제 데이터로 전환됩니다.
          </p>
        )}

        <ScheduleBoard events={events} initialNow={Date.parse(fetchedAt)} />
      </main>

      <footer className="border-t border-line px-4 py-5 text-center text-xs text-dim sm:px-6">
        일정 정보의 출처는 각 게임의 공식 공지이며, 카드의 &ldquo;원문&rdquo; 링크에서 원본을 확인할 수
        있습니다. 실제 일정은 게임사 사정으로 변경될 수 있습니다.
      </footer>
    </>
  );
}
