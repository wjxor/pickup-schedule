import { type CollectorAdapter, skipped } from '@/lib/collectors/types';

/**
 * 수동 입력 전용 게임을 위한 어댑터.
 *
 * 공개 API도 없고 공지 구조도 자동 수집에 맞지 않는 게임을 위한 자리다.
 * 자동 수집 대상이 아님을 로그에 남기는 것 외에는 하는 일이 없다.
 *
 * 지금은 이 방식을 쓰는 게임이 없지만, 새 게임을 붙일 때 데이터 출처를 확보하기
 * 전까지 임시로 지정해 두면 수집 배치를 건드리지 않고 목록에만 올릴 수 있다.
 */
export const collectManual: CollectorAdapter = async (game) =>
  skipped(game, '수동 입력 전용 게임입니다. 자동 수집을 시도하지 않습니다.');
