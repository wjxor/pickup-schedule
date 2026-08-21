/**
 * 게임 레지스트리 (SSOT, Single Source of Truth)
 *
 * 새 게임을 추가하려면:
 *   1. `GAME_SLUGS`에 슬러그를 추가한다.
 *   2. `GAMES`에 정의를 추가한다.
 *   3. `collector.kind`에 맞는 어댑터가 없으면 `src/lib/collectors/adapters/`에 새로 만든다.
 *
 * UI 색상·정렬·필터는 모두 이 파일을 참조하므로 다른 곳을 수정할 필요가 없다.
 */

/** 지원 게임 슬러그. URL·DB 키로 쓰이므로 변경하면 마이그레이션이 필요하다. */
export const GAME_SLUGS = [
  'genshin',
  'starrail',
  'zzz',
  'nikke',
  'wuwa',
  'limbus',
] as const;

export type GameSlug = (typeof GAME_SLUGS)[number];

/**
 * 수집 방식별 설정.
 * 어댑터는 `kind`로 분기하며, 각 분기의 필드가 그대로 어댑터 입력이 된다.
 */
export type CollectorConfig =
  | {
      kind: 'hoyoverse';
      /** 공지 API 게이트웨이 호스트 */
      host: string;
      /** getAnnList/getAnnContent 앞에 붙는 경로 세그먼트 (예: hk4e_global) */
      bizPath: string;
      /** 쿼리 파라미터 game (예: hk4e) */
      game: string;
      gameBiz: string;
      bundleId: string;
      region: string;
      level: number;
      /** 공지에 적힌 시각의 기준 타임존. 호요버스는 UTC+8 서버시간으로 내려준다. */
      sourceTimeZone: string;
      /** 실제 호출로 응답을 확인했는지 여부. false면 수집 시 경고를 남긴다. */
      verified: boolean;
    }
  | {
      /**
       * HoYoLAB 뉴스 API.
       * 공지 API(getAnnList)를 제공하지 않는 호요버스 게임에 쓴다.
       * 기간이 구조화돼 있지 않아 본문에서 뽑아내야 한다.
       */
      kind: 'hoyolab';
      /** HoYoLAB 게임 식별자. 1=붕괴3rd, 2=원신, 6=스타레일, 8=젠레스 존 제로 */
      gids: number;
      /** 한 번에 가져올 공지 수. 늘리면 본문 요청도 그만큼 늘어난다. */
      pageSize: number;
    }
  | {
      kind: 'steam';
      appId: number;
      /** Steam 뉴스는 종료일을 주지 않으므로 본문 파싱 단계가 필요하다. */
      needsBodyParsing: true;
    }
  | {
      kind: 'crawler';
      /** 공지 목록 페이지. 어댑터 구현 전까지는 참고용으로만 쓰인다. */
      noticeUrl: string;
      needsBodyParsing: true;
    }
  | {
      kind: 'manual';
    };

export interface GameDefinition {
  slug: GameSlug;
  /** 한글 정식 명칭 */
  name: string;
  /** 좁은 화면·간트 라벨용 약칭 */
  shortName: string;
  /** 간트 바·뱃지 색상 (hex) */
  color: string;
  /** 공식 사이트 */
  officialUrl: string;
  collector: CollectorConfig;
}

export const GAMES: Record<GameSlug, GameDefinition> = {
  genshin: {
    slug: 'genshin',
    name: '원신',
    shortName: '원신',
    color: '#4ade80',
    officialUrl: 'https://genshin.hoyoverse.com/ko',
    collector: {
      kind: 'hoyoverse',
      host: 'https://sg-hk4e-api.hoyoverse.com',
      bizPath: 'hk4e_global',
      game: 'hk4e',
      gameBiz: 'hk4e_global',
      bundleId: 'hk4e_global',
      region: 'os_asia',
      level: 60,
      sourceTimeZone: 'Asia/Shanghai',
      verified: true,
    },
  },
  starrail: {
    slug: 'starrail',
    name: '붕괴: 스타레일',
    shortName: '스타레일',
    color: '#60a5fa',
    officialUrl: 'https://hsr.hoyoverse.com/ko-kr',
    collector: {
      kind: 'hoyoverse',
      host: 'https://sg-hkrpg-api.hoyoverse.com',
      bizPath: 'hkrpg_global',
      game: 'hkrpg',
      gameBiz: 'hkrpg_global',
      bundleId: 'hkrpg_global',
      region: 'prod_official_asia',
      level: 70,
      sourceTimeZone: 'Asia/Shanghai',
      verified: true,
    },
  },
  zzz: {
    slug: 'zzz',
    name: '젠레스 존 제로',
    shortName: 'ZZZ',
    color: '#fb923c',
    officialUrl: 'https://zenless.hoyoverse.com/ko-kr',
    collector: {
      // 이 게임만 공지 API(getAnnList)가 없다. 호스트 8개와 경로 10여 개를 확인했고,
      // 규칙상 예상되는 sg-nap-api.hoyoverse.com 은 DNS에 아예 존재하지 않는다.
      // 조사 근거는 docs/조사-젠레스-존-제로-데이터-출처.md 참고.
      kind: 'hoyolab',
      gids: 8,
      pageSize: 30,
    },
  },
  nikke: {
    slug: 'nikke',
    name: '승리의 여신: 니케',
    shortName: '니케',
    color: '#f472b6',
    officialUrl: 'https://nikke-kr.com/',
    collector: {
      kind: 'crawler',
      noticeUrl: 'https://nikke-kr.com/',
      needsBodyParsing: true,
    },
  },
  wuwa: {
    slug: 'wuwa',
    name: '명조: 워더링 웨이브',
    shortName: '명조',
    color: '#c084fc',
    officialUrl: 'https://wutheringwaves.kurogames.com/kr/',
    collector: {
      kind: 'crawler',
      noticeUrl: 'https://wutheringwaves.kurogames.com/kr/',
      needsBodyParsing: true,
    },
  },
  limbus: {
    slug: 'limbus',
    name: '림버스 컴퍼니',
    shortName: '림버스',
    color: '#fb7185',
    officialUrl: 'https://steamcommunity.com/app/1973530',
    collector: {
      kind: 'steam',
      appId: 1973530,
      needsBodyParsing: true,
    },
  },
};

/** 표시 순서. 가나다순으로 고정해 필터 목록이 흔들리지 않게 한다. */
export const GAME_ORDER: GameSlug[] = [...GAME_SLUGS].sort((a, b) =>
  GAMES[a].name.localeCompare(GAMES[b].name, 'ko'),
);

export const GAME_LIST: GameDefinition[] = GAME_ORDER.map((slug) => GAMES[slug]);

/** 알 수 없는 슬러그를 안전하게 걸러낸다. */
export function isGameSlug(value: string): value is GameSlug {
  return (GAME_SLUGS as readonly string[]).includes(value);
}

/** 슬러그로 게임 정의를 찾는다. 없으면 undefined. */
export function getGame(slug: string): GameDefinition | undefined {
  return isGameSlug(slug) ? GAMES[slug] : undefined;
}
