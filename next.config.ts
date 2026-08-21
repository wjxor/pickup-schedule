import type { NextConfig } from 'next';

import { ALLOWED_IMAGE_HOSTS } from './src/config/image-hosts';

const nextConfig: NextConfig = {
  images: {
    // 허용 호스트 목록은 src/config/image-hosts.ts 한 곳에서 관리한다.
    // 화면 컴포넌트도 같은 목록을 참조하므로 설정과 렌더링이 어긋나지 않는다.
    remotePatterns: ALLOWED_IMAGE_HOSTS.map((hostname) => ({
      protocol: 'https' as const,
      hostname,
    })),
  },
};

export default nextConfig;
