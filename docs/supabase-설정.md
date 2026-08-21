# Supabase 연결 설정

처음 한 번만 하면 되는 작업이다. 순서대로 따라가면 5~10분쯤 걸린다.

---

## 1단계 — Supabase 프로젝트 만들기

1. [supabase.com](https://supabase.com) 에 로그인한다.
2. **New project** 를 누른다.
3. 값을 채운다.

   | 항목 | 권장값 | 설명 |
   |---|---|---|
   | Name | `pickup-schedule` | 아무거나 상관없다 |
   | Database Password | 자동 생성 후 복사 | **한 번만 보여준다.** 비밀번호 관리자에 저장해 둔다 |
   | Region | `Northeast Asia (Seoul)` | 한국 사용자 대상이므로 가까울수록 빠르다 |
   | Plan | Free | 지금 규모에는 충분하다 |

4. 프로젝트 생성에 1~2분 걸린다.

> **무료 플랜 주의**
> 일주일간 아무 요청이 없으면 프로젝트가 일시정지된다.
> 대시보드에서 다시 켤 수 있지만, 수집 배치를 매일 돌리면 자연히 방지된다.

---

## 2단계 — 테이블 만들기

1. 왼쪽 메뉴에서 **SQL Editor** 를 연다.
2. **New query** 를 누른다.
3. 프로젝트의 [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) 파일 내용을 **전부 복사해서 붙여넣는다.**
4. **Run** 을 누른다.

`Success. No rows returned` 이 나오면 정상이다.

무엇이 만들어지는가:

- `games` 테이블 — 지원 게임 6종이 함께 등록된다
- `events` 테이블 — 일정 본체
- 중복 방지 제약, 기간 유효성 제약, 인덱스
- RLS 정책 — 공개 키로는 읽기만 가능

---

## 3단계 — API 키를 `.env.local` 에 넣기

1. 왼쪽 메뉴 맨 아래 **Project Settings** → **API Keys** 로 간다.
2. 프로젝트 루트에 `.env.local` 파일을 만든다.

   ```bash
   touch .env.local
   ```

3. 아래 내용을 붙여넣고 대시보드에서 복사한 값을 채운다.

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=여기에_anon_public_키
   SUPABASE_SERVICE_ROLE_KEY=여기에_service_role_키
   ```

<!-- markdownlint-disable-next-line -->
> ⚠️ **`service_role` 키 취급 주의**
> 이 키는 RLS를 통째로 무시하고 모든 데이터를 읽고 지울 수 있는 전권 키다.
> - 절대 `NEXT_PUBLIC_` 접두사를 붙이지 않는다. 붙이면 브라우저 번들에 그대로 실려 나간다.
> - 스크린샷, 채팅, 커밋 어디에도 남기지 않는다.
> - `.env.local` 은 `.gitignore` 에 걸려 있어 git에는 올라가지 않는다.
> - 실수로 노출했다면 대시보드에서 즉시 키를 새로 발급한다.

`anon` 키는 노출을 전제로 설계된 키라 브라우저에 나가도 괜찮다.
RLS 정책이 읽기만 허용하고 있기 때문이다.

---

## 4단계 — 연결 확인

```bash
npm run db:check
```

정상이면 이렇게 나온다.

```
✅  환경변수 — 3개 모두 설정됨
✅  games 테이블 — 6개 게임 등록됨
✅  events 테이블 — 현재 0건 저장됨

연결 정상입니다. `npm run collect:save` 로 수집한 일정을 저장할 수 있습니다.
```

문제가 있으면 어느 단계에서 막혔는지 알려준다.

| 메시지 | 원인 | 해결 |
|---|---|---|
| `환경변수 — 없음: ...` | `.env.local` 이 없거나 값이 비었다 | 3단계를 다시 확인 |
| `games 테이블 — ... does not exist` | 마이그레이션 미실행 | 2단계를 다시 실행 |
| `Invalid API key` | 키를 잘못 복사했다 | 대시보드에서 다시 복사 |
| `누락된 게임: ...` | 마이그레이션 일부만 실행됐다 | SQL 전체를 다시 실행 |

---

## 5단계 — 실제 데이터 넣기

```bash
npm run collect:save
```

공식 API에서 일정을 수집해 DB에 저장한다.
같은 공지를 다시 수집해도 `(game_slug, external_id)` 기준으로 갱신되므로 중복이 쌓이지 않는다.

저장 후 다시 확인해 보면 건수가 올라가 있다.

```bash
npm run db:check
```

---

## 6단계 — 화면에서 확인

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) 을 연다.
상단의 "목 데이터로 동작 중" 안내가 사라졌으면 DB에서 읽고 있다는 뜻이다.

---

## 왜 매일 수집해야 하는가

호요버스 공지 API는 **현재 진행 중이거나 곧 시작하는 공지만** 내려준다. 과거 이력이 없다.
따라서 지난 픽업 기록을 남기려면 매일 수집해서 우리 DB에 누적하는 수밖에 없다.
수집을 하루 걸러도 그날 시작해서 그날 끝난 짧은 이벤트는 영영 놓친다.

자동화는 다음 중 하나로 한다.

- **Vercel Cron** — 배포처가 Vercel이라면 가장 간단하다
- **GitHub Actions** — 저장소만 있으면 되고, 실패 시 알림도 받을 수 있다

두 방법 모두 `SUPABASE_SERVICE_ROLE_KEY` 를 각 플랫폼의 시크릿에 등록해야 한다.
