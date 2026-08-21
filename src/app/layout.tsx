import type { Metadata, Viewport } from 'next';
import { Noto_Sans_KR } from 'next/font/google';

import './globals.css';

const notoSansKr = Noto_Sans_KR({
  variable: '--font-noto-sans-kr',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: '픽업 스케줄 | 서브컬처 게임 일정 통합 캘린더',
    template: '%s | 픽업 스케줄',
  },
  description:
    '원신, 붕괴: 스타레일, 젠레스 존 제로, 승리의 여신: 니케, 명조, 림버스 컴퍼니의 픽업·이벤트 일정을 한곳에서 확인하세요.',
  openGraph: {
    title: '픽업 스케줄',
    description: '서브컬처 게임 픽업·이벤트 일정 통합 캘린더',
    type: 'website',
    locale: 'ko_KR',
  },
};

export const viewport: Viewport = {
  themeColor: '#0d0e12',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // suppressHydrationWarning: 일부 브라우저 확장 프로그램이 페이지 로드 직후
    // <html>에 자기 표시용 속성(data-* 등)을 붙인다. 서버가 보낸 HTML에는 없는
    // 속성이라 React가 하이드레이션 불일치로 경고하는데, 우리가 고칠 수 있는
    // 문제가 아니다.
    //
    // 이 속성은 붙인 요소 "자신"의 속성·텍스트 불일치만 무시하고 자식에는
    // 전파되지 않는다. 따라서 실제 컴포넌트 버그를 가릴 위험은 없다.
    <html
      lang="ko"
      className={`${notoSansKr.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
