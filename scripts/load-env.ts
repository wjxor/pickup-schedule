import { existsSync } from 'node:fs';

import { logger } from '@/lib/logger';

/**
 * 스크립트 실행 시 환경변수 파일을 읽어들인다.
 *
 * Next.js는 dev/build 때 .env.local 을 알아서 읽지만, tsx로 직접 실행하는
 * 스크립트에는 그런 처리가 없다. 그래서 여기서 명시적으로 읽어준다.
 *
 * 앞에 오는 파일이 우선이며, 먼저 찾은 하나만 읽는다.
 */
const CANDIDATE_FILES = ['.env.local', '.env'];

export function loadEnvFiles(): void {
  for (const file of CANDIDATE_FILES) {
    if (!existsSync(file)) continue;

    try {
      process.loadEnvFile(file);
      logger.debug({ file }, '환경변수 파일을 읽었습니다');
      return;
    } catch (error) {
      logger.warn({ file, err: error }, '환경변수 파일을 읽지 못했습니다');
    }
  }

  logger.debug('환경변수 파일이 없어 시스템 환경변수만 사용합니다');
}
