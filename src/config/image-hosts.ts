/**
 * 외부 이미지를 불러올 수 있는 호스트 목록 (SSOT).
 *
 * Next.js는 아무 주소의 외부 이미지나 최적화해 주지 않는다. 허용 목록에 없으면
 * 이미지 요청이 막힌다. 남의 서버 이미지를 무제한으로 대신 내려받아 주면
 * 트래픽을 떠안게 되므로 걸어둔 안전장치다.
 *
 * 이 파일을 next.config.ts 와 화면 컴포넌트가 함께 참조한다.
 * 한쪽만 고쳐서 설정과 렌더링이 어긋나는 일을 막기 위해서다.
 *
 * 새 게임을 추가해 새 호스트가 생기면 여기에만 추가하면 된다.
 */
export const ALLOWED_IMAGE_HOSTS = [
  /** 호요버스 공지 배너 (원신, 붕괴: 스타레일) */
  'sdk.hoyoverse.com',
  /** HoYoLAB 게시글 이미지 (젠레스 존 제로) */
  'upload-os-bbs.hoyolab.com',
  /**
   * 스팀 커뮤니티 공지 이미지.
   * 지금 이 호스트를 쓰는 게임은 없다. 스팀 어댑터와 짝이라 함께 남겨 뒀다.
   */
  'clan.cloudflare.steamstatic.com',
  /** 쿠로게임 공식 사이트 공지 이미지 (명조) */
  'hw-media-cdn-mingchao.kurogame.com',
  /**
   * 레벨 인피니트 CMS 공지 이미지 (니케).
   * 니케는 공지를 구획으로 쪼개 담으므로 대부분의 카드에 이미지가 없다.
   * 구획이 없어 공지 한 건을 그대로 남길 때만 이 호스트를 쓴다.
   */
  'na-nikke-aws.playerinfinite.com',
] as const;

/**
 * 이 URL의 이미지를 화면에 그려도 되는지 판단한다.
 *
 * 허용 목록에 없는 호스트는 렌더링 자체를 건너뛴다. 그냥 그리면 Next.js가
 * 이미지 요청을 막아 깨진 이미지가 보이므로, 아예 안 보여주는 편이 낫다.
 */
export function isAllowedImageHost(url: string | null): boolean {
  if (url === null) return false;

  try {
    const { host, protocol } = new URL(url);
    if (protocol !== 'https:') return false;
    return (ALLOWED_IMAGE_HOSTS as readonly string[]).includes(host);
  } catch {
    // URL로 해석되지 않는 값은 그리지 않는다.
    return false;
  }
}
