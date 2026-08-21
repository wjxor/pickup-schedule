import { z } from 'zod';
import { GAME_SLUGS } from '@/config/games';

/**
 * 일정 분류.
 * 게임사마다 표기가 달라서, 수집 단계에서 이 목록 중 하나로 정규화한다.
 */
export const EVENT_TYPES = [
  '픽업',
  '복각',
  '이벤트',
  '콜라보',
  '공식방송',
  '업데이트',
  '버전',
  '스토리',
  '리딤코드',
  '공지',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** 서비스 권역. 현재는 한국 서버 기준만 다룬다. */
export const EVENT_REGIONS = ['KR', 'GLOBAL'] as const;
export type EventRegion = (typeof EVENT_REGIONS)[number];

/**
 * 데이터를 어떻게 얻었는지.
 * 신뢰도 순서는 official_api > crawler > manual 이 아니라,
 * manual(사람이 검수함) > official_api > crawler 로 본다.
 */
export const SOURCE_KINDS = ['official_api', 'crawler', 'manual'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * 수집기가 만들어내는 이벤트.
 * DB 저장 전 형태라 id·타임스탬프가 없다.
 *
 * 날짜는 반드시 ISO 8601 UTC 문자열로 정규화해서 담는다.
 * (게임사 API는 UTC+8 서버시간 같은 로컬 표기를 주므로 어댑터가 변환 책임을 진다.)
 */
export const collectedEventSchema = z.object({
  gameSlug: z.enum(GAME_SLUGS),
  type: z.enum(EVENT_TYPES),
  title: z.string().min(1),
  description: z.string().nullable(),
  /** ISO 8601 UTC. 예: 2026-08-09T15:00:00.000Z */
  startAt: z.iso.datetime(),
  /** 종료 시각을 알 수 없는 공지(리딤코드 등)는 null을 허용한다. */
  endAt: z.iso.datetime().nullable(),
  region: z.enum(EVENT_REGIONS),
  sourceUrl: z.url().nullable(),
  sourceKind: z.enum(SOURCE_KINDS),
  imageUrl: z.url().nullable(),
  /**
   * 원본 시스템의 식별자 (호요버스 ann_id, 스팀 gid 등).
   * gameSlug와 묶어 유니크 키로 쓰며, 재수집 시 중복 삽입을 막는다.
   */
  externalId: z.string().nullable(),
});

export type CollectedEvent = z.infer<typeof collectedEventSchema>;

/** DB에서 읽어온, 화면에 그릴 수 있는 완전한 이벤트. */
export interface GameEvent extends CollectedEvent {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** 현재 시각 기준으로 파생되는 진행 상태. 저장하지 않고 매번 계산한다. */
export type EventStatus = 'upcoming' | 'ongoing' | 'ended';
