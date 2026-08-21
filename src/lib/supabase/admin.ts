import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * service_role 키를 쓰는 관리자 클라이언트.
 *
 * 이 키는 RLS를 통째로 우회하는 전권 키라, 브라우저로 새어나가면 누구나
 * 데이터를 지우거나 바꿀 수 있다. 수집 스크립트와 서버 코드에서만 써야 한다.
 */

/** 브라우저 번들에 섞여 들어가는 사고를 실행 시점에 잡아낸다. */
function assertServerOnly(): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      'Supabase 관리자 클라이언트를 브라우저에서 생성하려고 했습니다. ' +
        'service_role 키는 서버에서만 사용해야 합니다.',
    );
  }
}

export interface AdminClientResult {
  client: SupabaseClient;
  url: string;
}

/**
 * 관리자 클라이언트를 만든다.
 *
 * 환경변수가 없으면 예외를 던진다. 조용히 넘어가면 "수집은 성공했는데 저장이
 * 안 됐다"는 상황을 눈치채지 못하기 때문이다.
 */
export function createAdminClient(): AdminClientResult {
  assertServerOnly();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    const missing = [
      !url && 'NEXT_PUBLIC_SUPABASE_URL',
      !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
    ]
      .filter(Boolean)
      .join(', ');

    throw new Error(
      `Supabase 환경변수가 없습니다: ${missing}\n` +
        '.env.local 파일을 만들고 값을 채운 뒤 다시 실행하세요. (docs/환경변수.md 참고)',
    );
  }

  const client = createClient(url, serviceRoleKey, {
    auth: {
      // 스크립트에서 쓰는 클라이언트라 세션을 파일에 남길 이유가 없다.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return { client, url };
}
