/**
 * HIP の核（core）：どのアプリの言葉も知らない、プロトコルそのものの部分（ADR-0010 §5）。
 * このフォルダは ../vocabulary を import しない（test/boundary.test.ts で検査する）。
 */

export const HIP_VERSION = '1';
/** このサーバー・クライアントが話せる HIP のメジャー版 */
export const SUPPORTED_HIP_VERSIONS = [HIP_VERSION] as const;

/** WebSocket の終了コード（docs/protocol/hip-v1.md §11） */
export const HIP_CLOSE = {
  UNSUPPORTED_VERSION: 4400,
  ACCESS_DENIED: 4401,
  HELLO_TIMEOUT: 4408,
  RATE_LIMITED: 4429,
} as const;
