# 픽업 스케줄 (Pickup Schedule)

서브컬처 게임 6종의 픽업·이벤트 일정을 한곳에 모아 보여주는 통합 캘린더.

각 게임의 공식 공지를 자동 수집해 하나의 타임라인에 겹쳐 놓는다.
"이번 주에 어떤 픽업이 끝나는지"를 확인하려고 게임마다 다른 공지 채널을 돌아다닐 필요가 없게 하는 것이 목표다.

## 지원 게임

| 게임 | 수집 경로 | 상태 |
|---|---|---|
| 원신 | 호요버스 공지 API | 동작 |
| 붕괴: 스타레일 | 호요버스 공지 API | 동작 |
| 젠레스 존 제로 | HoYoLAB 뉴스 API | 동작 (본문에서 기간 추출) |
| 림버스 컴퍼니 | Steam 공식 뉴스 API | 동작 (종료일 미제공) |
| 승리의 여신: 니케 | 공지 페이지 크롤링 | 미구현 |
| 명조: 워더링 웨이브 | 공지 페이지 크롤링 | 미구현 |

## 기술 스택

- **Next.js 16** (App Router) / React 19 / TypeScript
- **Tailwind CSS v4** (CSS-first 설정)
- **Supabase** (PostgreSQL)
- **Zod** 스키마 검증, **pino** 로깅, **date-fns** 날짜 처리

## 시작하기

```bash
npm install
npm run dev
```

Supabase 설정이 없어도 바로 뜬다. 환경변수가 비어 있으면 `src/mocks/events.json`의 목 데이터로 동작한다.

실제 DB에 연결하려면 [docs/supabase-설정.md](docs/supabase-설정.md)를 순서대로 따라간다.
환경변수 항목별 설명은 [docs/환경변수.md](docs/환경변수.md)에 있다.

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run lint` | ESLint 검사 |
| `npm run type-check` | 타입 검사 |
| `npm run collect` | 모든 게임 일정 수집 (결과 요약만 출력) |
| `npm run collect:mock` | 수집 결과를 목 데이터 파일로 저장 |
| `npm run collect:save` | 수집 결과를 Supabase에 저장 (upsert) |
| `npm run db:check` | Supabase 연결·스키마·데이터 상태 점검 |

특정 게임만 수집하려면:

```bash
npm run collect -- --game genshin
```

## 수집 자동화

GitHub Actions가 하루 4번(한국시간 06 / 12 / 18 / 24시) 자동으로 수집해 DB에 쌓는다.

공식 API들은 진행 중인 공지만 내려주고 과거 이력을 주지 않는다.
수집을 거른 사이에 시작해서 끝난 짧은 이벤트는 영영 남지 않으므로, 자동화가 선택이 아니라 전제다.

설정 방법은 [docs/수집-자동화.md](docs/수집-자동화.md)를 참고한다.

## 프로젝트 구조

```
src/
├── app/                    Next.js App Router
├── components/             UI 컴포넌트
├── config/games.ts         지원 게임 레지스트리 (SSOT)
├── lib/
│   ├── collectors/         일정 수집기
│   │   ├── adapters/       게임 종류별 수집 구현
│   │   ├── index.ts        어댑터 등록 + 실행
│   │   └── types.ts        어댑터 인터페이스
│   ├── events/             상태 계산 · 표시 · 데이터 접근
│   ├── datetime.ts         타임존 변환
│   └── logger.ts           pino 로거
├── mocks/events.json       수집기가 생성한 목 데이터
└── types/                  도메인 타입
scripts/collect.ts          수집 CLI
supabase/migrations/        DB 스키마
```

## 게임 추가 방법

1. `src/config/games.ts`의 `GAME_SLUGS`와 `GAMES`에 항목을 추가한다.
2. `collector.kind`가 기존 어댑터(`hoyoverse`, `steam`, `crawler`, `manual`) 중 하나면 여기서 끝난다.
3. 새로운 수집 방식이 필요하면 `src/lib/collectors/adapters/`에 파일을 만들고
   `src/lib/collectors/index.ts`의 `ADAPTERS`에 등록한다.
4. `supabase/migrations/`에 `games` 행을 추가하는 마이그레이션을 넣는다.

기존 코드를 수정할 필요는 없다. UI의 필터·색상·정렬은 모두 레지스트리를 참조한다.

## 설계 노트

### 시각은 UTC로 저장한다

게임사 API는 `2026-08-09 23:00:00`처럼 타임존이 빠진 문자열을 준다.
이걸 그대로 저장하면 나중에 어느 나라 시간인지 복원할 수 없다.
어댑터가 UTC ISO 문자열로 변환할 책임을 지고, 화면에서만 한국시간으로 되돌린다.

호요버스 API는 응답에 `timezone` 필드로 기준 오프셋을 함께 알려주므로,
타임존을 코드에 박아두지 않고 응답 값을 사용한다.

### 종료일을 항상 믿지 않는다

호요버스가 주는 `end_time`은 실제 이벤트 종료일이 아니라 **공지 노출 기한**이다.
상시 공지에는 10년 뒤 날짜가 들어간다. 기간이 400일을 넘으면 종료일을 `null`로 두고 경고를 남긴다.
잘못된 값을 그럴듯하게 보여주는 것보다 "모른다"고 표시하는 편이 낫다.

### 수집기는 예외를 던지지 않는다

한 게임의 API가 죽어도 나머지 게임 수집은 계속돼야 한다.
어댑터는 실패를 `CollectorResult.skippedReason`에 담아 반환하고, 배치는 끝까지 돈다.

### 진행 상태는 저장하지 않는다

`진행 중 / 예정 / 종료`는 현재 시각에 따라 달라지는 파생값이다.
컬럼으로 저장하면 갱신 배치가 또 필요해지고 값이 어긋날 여지가 생긴다. 매 렌더마다 계산한다.

## 데이터 출처와 원칙

- 일정 정보의 출처는 각 게임의 공식 공지이며, 화면에 원문 링크를 항상 함께 노출한다.
- 이미지는 재호스팅하지 않고 원본 URL을 참조한다.
- 크롤링 대상은 `robots.txt`와 이용약관을 확인하고 요청 간격을 둔다.
- 실제 일정은 게임사 사정으로 변경될 수 있다.
