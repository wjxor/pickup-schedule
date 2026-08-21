import { offsetTimeToUtcIso } from '@/lib/datetime';

/**
 * 한국어 공지에 쓰이는 날짜 표기를 다루는 조각들.
 *
 * 명조와 니케는 기간을 구조화된 필드가 아니라 본문 문장으로 알려준다.
 *
 *   명조  2026년 7월 30일 11:00 ~ 2026년 8월 19일 12:59 (한국 시간)
 *   니케  2026년 8월 20일 5:00:00 ~ 2026년 9월 10일 4:59:59 (UTC+9)
 *
 * 표기 세부는 다르지만 `YYYY년 M월 D일 H:MM[:SS]` 라는 뼈대는 같아서,
 * 정규식 조각과 변환 함수를 여기에 모아 두 어댑터가 함께 쓴다.
 */

/** `2026년 8월 20일` — 월·일은 한 자리로 적히기도 한다. */
export const KOREAN_DATE = String.raw`(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일`;

/** `5:00:00` / `11:00` — 초는 생략되는 경우가 많다. */
export const KOREAN_TIME = String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?`;

/**
 * 기간 구분자.
 * 게임사마다 반각(~)·물결 대시(〜)·전각(～)이 섞여 있어 전부 받아준다.
 */
export const TILDE = String.raw`[~〜～]`;

/** `KOREAN_DATE`가 만드는 캡처 그룹 수 (연·월·일). */
export const DATE_GROUPS = 3;

/** `KOREAN_DATE` + `KOREAN_TIME`이 만드는 캡처 그룹 수 (연·월·일·시·분·초). */
export const DATE_TIME_GROUPS = 6;

/** 한국 표준시 오프셋. 니케는 `(UTC+9)`, 명조는 `(한국 시간)`으로 표기한다. */
export const KST_OFFSET_HOURS = 9;

/** 명조가 말하는 `(서버 시간)`. 중국 서버 기준이라 한국시간보다 한 시간 이르다. */
export const CN_SERVER_OFFSET_HOURS = 8;

function pad(value: string | undefined, fallback: string): string {
  return (value ?? fallback).padStart(2, '0');
}

/** 시각이 적혀 있지 않을 때 쓸 기본값. */
export interface TimeOfDay {
  hour: string;
  minute: string;
  second: string;
}

/** 날짜만 적힌 시작일은 그날이 시작하는 시각부터로 본다. */
export const START_OF_DAY: TimeOfDay = { hour: '00', minute: '00', second: '00' };

/** 날짜만 적힌 종료일은 그날이 끝나는 시각까지로 본다. */
export const END_OF_DAY: TimeOfDay = { hour: '23', minute: '59', second: '59' };

function buildIso(
  match: RegExpMatchArray,
  at: number,
  time: { hour?: string; minute?: string; second?: string },
  offsetHours: number,
): string {
  const value =
    `${match[at]}-${pad(match[at + 1], '01')}-${pad(match[at + 2], '01')}` +
    ` ${pad(time.hour, '00')}:${pad(time.minute, '00')}:${pad(time.second, '00')}`;

  return offsetTimeToUtcIso(value, offsetHours);
}

/**
 * `날짜 + 시각` 여섯 그룹을 읽어 UTC ISO 문자열로 바꾼다.
 *
 * 정규식을 조합해 쓰다 보면 그룹 번호가 밀리므로 시작 위치를 명시적으로 받는다.
 * `at`부터 연·월·일·시·분·초 여섯 개가 이어져 있어야 한다.
 *
 * 날짜만 캡처하는 패턴에는 쓰지 말 것. 시각 자리에 그다음 캡처(대개 종료일의 연도)를
 * 읽어버린다. 그런 경우에는 {@link matchDateToUtcIso}를 쓴다.
 *
 * @param offsetHours 표기된 시각의 기준 오프셋 (한국 9, 중국 서버 8)
 */
export function matchToUtcIso(
  match: RegExpMatchArray,
  at: number,
  offsetHours: number,
): string {
  return buildIso(
    match,
    at,
    { hour: match[at + 3], minute: match[at + 4], second: match[at + 5] },
    offsetHours,
  );
}

/**
 * `날짜` 세 그룹만 읽어 UTC ISO 문자열로 바꾼다.
 *
 * 시각이 적혀 있지 않은 표기(`2026년 8월 13일 점검 종료 후`)에 쓴다.
 * 시각을 지어내는 대신 하루의 시작이나 끝으로 두므로 날짜는 절대 어긋나지 않는다.
 */
export function matchDateToUtcIso(
  match: RegExpMatchArray,
  at: number,
  offsetHours: number,
  time: TimeOfDay = START_OF_DAY,
): string {
  return buildIso(match, at, time, offsetHours);
}

/**
 * 그 줄에 적힌 시각의 기준 오프셋을 읽는다. 표기가 없으면 null.
 *
 * 명조는 같은 기간을 `(서버 시간)`과 `(한국 시간)` 두 줄로 나란히 적고,
 * 니케는 `(UTC+9)`로 적는다. 줄에 적힌 표기를 그대로 따르면 어느 쪽을 읽어도
 * 가리키는 순간은 같다.
 */
export function offsetFromLabel(line: string): number | null {
  if (/한국\s*시간/.test(line)) return KST_OFFSET_HOURS;
  if (/서버\s*시간/.test(line)) return CN_SERVER_OFFSET_HOURS;

  const utc = /UTC\s*([+-])\s*(\d{1,2})/i.exec(line);
  if (utc) return Number(utc[2]) * (utc[1] === '-' ? -1 : 1);

  return null;
}

/** 수집한 하나의 기간. 종료 시각을 모르면 `endAt`은 null이다. */
export interface Period {
  startAt: string;
  endAt: string | null;
}

/**
 * 여러 기간을 하나로 합친다. 가장 이른 시작과 가장 늦은 종료를 쓴다.
 *
 * 니케 공지에는 `1차 / 2차 / 3차`처럼 한 항목이 여러 구간으로 나뉘는 경우가 있다.
 * 달력에서는 한 줄로 보여주므로 전체를 감싸는 구간으로 표현한다.
 *
 * 종료 시각을 하나라도 모르면 전체 종료도 모르는 것으로 둔다.
 * 아는 구간만 모아 종료일을 정하면 실제보다 짧게 끝나는 것처럼 보이기 때문이다.
 */
export function mergePeriods(periods: Period[]): Period | null {
  if (periods.length === 0) return null;

  const startAt = periods.reduce(
    (earliest, period) => (period.startAt < earliest ? period.startAt : earliest),
    periods[0].startAt,
  );

  if (periods.some((period) => period.endAt === null)) {
    return { startAt, endAt: null };
  }

  const endAt = periods.reduce<string>(
    (latest, period) => (period.endAt! > latest ? period.endAt! : latest),
    periods[0].endAt!,
  );

  return { startAt, endAt };
}
