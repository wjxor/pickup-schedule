import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

/** 서비스 기준 타임존. 화면 표시는 항상 한국시간으로 한다. */
export const KST = 'Asia/Seoul';

/**
 * `2026-08-09 23:00:00` 처럼 타임존이 빠진 문자열을,
 * 지정한 타임존의 로컬 시각으로 해석해 UTC ISO 문자열로 바꾼다.
 *
 * 호요버스 공지 API는 UTC+8(Asia/Shanghai) 서버시간을 타임존 표기 없이 내려주므로
 * 이 함수를 거치지 않으면 일정이 한 시간씩 어긋난다.
 *
 * @param value 타임존이 없는 날짜 문자열 (`YYYY-MM-DD HH:mm[:ss]`, 구분자는 공백 또는 T)
 * @param timeZone IANA 타임존 이름 (예: `Asia/Shanghai`)
 * @returns UTC 기준 ISO 8601 문자열
 */
export function localTimeToUtcIso(value: string, timeZone: string): string {
  const matched =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());

  if (!matched) {
    throw new Error(`날짜 형식을 해석할 수 없습니다: "${value}"`);
  }

  const [, year, month, day, hour, minute, second] = matched;
  const localDate = new TZDate(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? '0'),
    timeZone,
  );

  return new Date(localDate.getTime()).toISOString();
}

/**
 * 타임존이 빠진 날짜 문자열을 UTC 오프셋(시간 단위)으로 해석해 UTC ISO 문자열로 바꾼다.
 *
 * 호요버스 공지 API는 응답에 `timezone: 8` 처럼 기준 오프셋을 함께 알려준다.
 * 타임존 이름을 추측해 박아두는 것보다 이 값을 그대로 쓰는 편이 정확하다.
 *
 * @param value 타임존이 없는 날짜 문자열 (`YYYY-MM-DD HH:mm[:ss]`)
 * @param offsetHours UTC 기준 오프셋. 한국은 9, 중국 서버는 8.
 */
export function offsetTimeToUtcIso(value: string, offsetHours: number): string {
  const matched =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());

  if (!matched) {
    throw new Error(`날짜 형식을 해석할 수 없습니다: "${value}"`);
  }

  const [, year, month, day, hour, minute, second] = matched;
  const sign = offsetHours < 0 ? '-' : '+';
  const absolute = Math.abs(offsetHours);
  const offsetHh = String(Math.floor(absolute)).padStart(2, '0');
  const offsetMm = String(Math.round((absolute % 1) * 60)).padStart(2, '0');

  const parsed = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second ?? '00'}${sign}${offsetHh}:${offsetMm}`,
  );

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`날짜를 해석할 수 없습니다: "${value}" (offset ${offsetHours})`);
  }

  return parsed.toISOString();
}

/** UNIX 초 단위 타임스탬프(스팀 뉴스 등)를 UTC ISO 문자열로 바꾼다. */
export function unixSecondsToUtcIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** UTC ISO 문자열을 한국시간 기준 TZDate로 바꾼다. */
export function toKst(iso: string): TZDate {
  return new TZDate(new Date(iso).getTime(), KST);
}

/**
 * UTC ISO 문자열을 한국시간 기준으로 포맷한다.
 * @param pattern date-fns 포맷 패턴
 */
export function formatKst(iso: string, pattern = 'M월 d일 (E) HH:mm'): string {
  return format(toKst(iso), pattern, { locale: ko });
}

/** 캘린더 그리드 키로 쓰는 한국시간 기준 날짜 문자열(`YYYY-MM-DD`). */
export function toKstDateKey(iso: string): string {
  return format(toKst(iso), 'yyyy-MM-dd');
}
