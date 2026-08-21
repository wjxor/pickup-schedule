import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

// pino-pretty는 별도 프로세스를 띄우는 transport라서 Next.js 번들 안에서는 동작하지 않는다.
// 그래서 순수 Node 환경(수집 스크립트)에서 개발 중일 때만 켠다.
const isNextRuntime = process.env.NEXT_RUNTIME !== undefined;
const usePrettyOutput = !isProduction && !isNextRuntime;

/**
 * 애플리케이션 공용 로거.
 * console.log 대신 이 로거를 쓰면 로그마다 시각·레벨·맥락이 함께 남는다.
 *
 * @example
 * logger.info({ gameSlug: 'genshin', count: 12 }, '수집 완료');
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
  ...(usePrettyOutput
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});
