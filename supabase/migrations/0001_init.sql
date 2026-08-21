-- ============================================================
-- 픽업 스케줄 초기 스키마
--
-- 적용 방법: Supabase 대시보드 > SQL Editor 에 이 파일 내용을 붙여넣고 실행한다.
-- ============================================================

-- ------------------------------------------------------------
-- games : 지원 게임 목록
--
-- 게임을 테이블로 빼둔 이유는, 나중에 게임을 추가할 때
-- 코드 배포 없이 행 하나만 넣어도 되게 하기 위해서다.
-- (수집 어댑터가 필요한 게임은 코드 추가도 함께 필요하다.)
-- ------------------------------------------------------------
create table if not exists public.games (
  slug          text primary key,
  name          text        not null,
  short_name    text        not null,
  color         text        not null,
  official_url  text,
  -- false로 두면 수집·노출 대상에서 빠진다. 삭제 대신 이 값을 쓴다.
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- events : 일정 본체
--
-- 날짜는 전부 timestamptz(타임존 포함)로 저장한다.
-- 게임사가 주는 "2026-08-09 23:00:00" 같은 타임존 없는 문자열을 그대로 넣으면
-- 나중에 어느 나라 시간인지 알 수 없게 되므로, 반드시 UTC로 변환해 저장한다.
-- ------------------------------------------------------------
create table if not exists public.events (
  id          uuid        primary key default gen_random_uuid(),
  game_slug   text        not null references public.games (slug) on update cascade,

  -- 분류. 값을 늘리려면 이 제약을 함께 수정한다.
  type        text        not null check (
    type in ('픽업', '복각', '이벤트', '콜라보', '공식방송',
             '업데이트', '버전', '스토리', '리딤코드', '공지')
  ),

  title       text        not null,
  description text,

  start_at    timestamptz not null,
  -- 종료 시각을 알 수 없는 공지(리딤코드 등)가 있어 null을 허용한다.
  end_at      timestamptz,

  region      text        not null default 'KR' check (region in ('KR', 'GLOBAL')),

  source_url  text,
  -- 어떻게 수집했는지. 신뢰도 판단과 재수집 정책에 쓰인다.
  source_kind text        not null check (source_kind in ('official_api', 'crawler', 'manual')),

  image_url   text,

  -- 원본 시스템의 식별자 (호요버스 ann_id, 스팀 gid 등).
  -- 수동 입력 건은 원본이 없으므로 null.
  external_id text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- 종료가 시작보다 빠른 데이터는 파싱 오류이므로 애초에 막는다.
  constraint events_period_valid check (end_at is null or end_at >= start_at)
);

-- 같은 게임의 같은 원본 공지를 두 번 넣지 않게 막는다.
--
-- 부분 인덱스(where external_id is not null)가 아니라 일반 UNIQUE 제약을 쓴다.
--   1. PostgreSQL은 UNIQUE 제약에서 NULL을 서로 다른 값으로 취급한다.
--      따라서 external_id가 없는 수동 입력 건은 여러 개 있어도 서로 충돌하지 않는다.
--   2. 수집기가 쓰는 `on conflict (game_slug, external_id)` upsert는 부분 인덱스를
--      자동으로 추론하지 못한다. 온전한 제약이어야 동작한다.
drop index if exists public.events_game_external_id_key;
alter table public.events drop constraint if exists events_game_external_id_key;
alter table public.events
  add constraint events_game_external_id_key unique (game_slug, external_id);

create index if not exists events_start_at_idx on public.events (start_at desc);
create index if not exists events_end_at_idx   on public.events (end_at);
create index if not exists events_game_idx     on public.events (game_slug);

-- ------------------------------------------------------------
-- updated_at 자동 갱신
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before update on public.events
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- RLS (Row Level Security)
--
-- 브라우저에 노출되는 anon 키로는 "읽기"만 가능하게 한다.
-- 쓰기는 service_role 키를 쓰는 서버 측 수집기/관리자만 할 수 있다.
-- (service_role 키는 RLS를 우회하므로 별도 정책이 필요 없다.)
-- ------------------------------------------------------------
alter table public.games  enable row level security;
alter table public.events enable row level security;

drop policy if exists "games readable by anyone"  on public.games;
create policy "games readable by anyone"
  on public.games for select using (true);

drop policy if exists "events readable by anyone" on public.events;
create policy "events readable by anyone"
  on public.events for select using (true);

-- ------------------------------------------------------------
-- 초기 게임 데이터
-- src/config/games.ts 와 값을 맞춰 둔다.
-- ------------------------------------------------------------
insert into public.games (slug, name, short_name, color, official_url) values
  ('genshin',  '원신',              '원신',     '#4ade80', 'https://genshin.hoyoverse.com/ko'),
  ('starrail', '붕괴: 스타레일',     '스타레일', '#60a5fa', 'https://hsr.hoyoverse.com/ko-kr'),
  ('zzz',      '젠레스 존 제로',     'ZZZ',      '#fb923c', 'https://zenless.hoyoverse.com/ko-kr'),
  ('nikke',    '승리의 여신: 니케',  '니케',     '#f472b6', 'https://nikke-kr.com/'),
  ('wuwa',     '명조: 워더링 웨이브', '명조',     '#c084fc', 'https://wutheringwaves.kurogames.com/kr/'),
  ('limbus',   '림버스 컴퍼니',      '림버스',   '#fb7185', 'https://steamcommunity.com/app/1973530')
on conflict (slug) do update set
  name         = excluded.name,
  short_name   = excluded.short_name,
  color        = excluded.color,
  official_url = excluded.official_url;
