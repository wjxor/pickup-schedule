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
    <html lang="ko" className={`${notoSansKr.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
