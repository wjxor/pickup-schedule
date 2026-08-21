'use client';

import { useSyncExternalStore } from 'react';

/** 화면의 "지금"을 다시 계산하는 주기(ms). */
export const CLOCK_INTERVAL_MS = 60_000;

function subscribe(onStoreChange: () => void): () => void {
  const timer = setInterval(onStoreChange, CLOCK_INTERVAL_MS);
  return () => clearInterval(timer);
}

/**
 * 현재 시각 스냅샷.
 *
 * 분 단위로 잘라서 돌려주는 것이 중요하다. 매 호출마다 값이 달라지면
 * useSyncExternalStore가 "스토어가 계속 바뀐다"고 판단해 무한 렌더에 빠진다.
 */
function getSnapshot(): number {
  return Math.floor(Date.now() / CLOCK_INTERVAL_MS) * CLOCK_INTERVAL_MS;
}

/**
 * 주기적으로 갱신되는 현재 시각을 돌려준다.
 *
 * 시계는 React 바깥에 있는 외부 소스이므로 useEffect + setState 대신
 * useSyncExternalStore로 구독한다. 이 방식은 서버 렌더와 하이드레이션 시
 * `serverNow`를 그대로 쓰기 때문에 화면 불일치 경고도 나지 않는다.
 *
 * @param serverNow 서버가 렌더할 때의 기준 시각(ms).
 */
export function useNow(serverNow: number): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverNow);
}
