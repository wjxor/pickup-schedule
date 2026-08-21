@AGENTS.md

# 픽업 스케줄 프로젝트 가이드

## 프로젝트 성격

서브컬처 게임 6종의 픽업·이벤트 일정을 수집해 하나의 타임라인으로 보여주는 서비스.
자세한 배경과 설계 근거는 [README.md](README.md)에 있다.

## 검증 명령어

코드를 고친 뒤에는 반드시 아래를 통과시킨다.

```bash
npm run type-check && npm run lint && npm run build
```

`npm run type-check`는 Next.js가 생성하는 전역 타입(`LayoutProps` 등)에 의존하므로,
한 번도 빌드하지 않은 상태에서는 실패한다. 이럴 때는 `npm run build`를 먼저 돌린다.

## 이 프로젝트에서 지켜야 할 규칙

### 날짜

- **저장·전달은 항상 UTC ISO 문자열.** 화면에 그릴 때만 한국시간으로 변환한다.
- 타임존 없는 문자열을 다룰 때는 `src/lib/datetime.ts`의 변환 함수를 쓴다. 직접 `new Date(문자열)`을 부르지 않는다.
- 게임사가 응답으로 타임존을 알려주면 그 값을 쓴다. 코드에 오프셋을 박지 않는다.

### 수집기

- **어댑터는 예외를 던지지 않는다.** 실패는 `CollectorResult`의 `skippedReason`과 `warnings`로 보고한다.
- 새 게임을 추가할 때 기존 어댑터 코드를 수정하지 않는다. `src/config/games.ts`에 항목을 넣고, 필요하면 어댑터 파일을 새로 만든다.
- 외부 API 응답은 신뢰하지 않는다. `collectedEventSchema`로 검증한 뒤에만 저장 대상에 넣는다.

### 컴포넌트

- 서버 컴포넌트에서 `Date.now()` 같은 비순수 호출을 하지 않는다. 시각이 필요하면 데이터 계층이 함께 반환한다.
- 시간에 따라 변하는 값은 `useEffect` + `setState`가 아니라 `src/lib/useNow.ts`의 `useNow`를 쓴다.
- 게임 색상은 데이터에서 오므로 Tailwind 클래스로 표현할 수 없다. 이 경우에만 `style` 속성을 쓴다.

### 스타일

- Tailwind CSS v4의 CSS-first 설정을 쓴다. 색은 `src/app/globals.css`의 `:root` 변수로 정의하고 `@theme inline`으로 연결한다.
- 새 색을 하드코딩하지 말고 토큰(`canvas`, `surface`, `line`, `ink`, `muted`, `dim`, `accent`, `live`, `soon`)을 쓴다.

## 알려진 미완성 부분

- 젠레스 존 제로: 공지 API가 없어 HoYoLAB 뉴스 API로 수집한다. 본문에서 기간을 뽑는 구조라
  일부 공지는 기간을 확정하지 못하고 게시일을 시작으로 사용한다(`endAt`은 `null`).
- 니케 / 명조: 크롤러 미구현.
- 림버스 컴퍼니: Steam 뉴스에 종료일이 없어 모든 `endAt`이 `null`이다. 본문 파서 연결 필요.
- Supabase 연동은 코드만 있고 실제 DB는 아직 만들지 않았다. 환경변수가 없으면 목 데이터로 동작한다.
