import { GoogleGenAI, type GoogleGenAIOptions } from '@google/genai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OAuth2Client } from 'google-auth-library';
import type { GeminiConfig } from './gemini-gateway.ts';

/**
 * Vertex AI 用のクライアント。
 * - Cloud Run：サービスアカウントの認証（ADC）を自動で使う。APIキーは持たない
 * - ローカル（開発専用）：LOCAL_GCLOUD_CONFIG に gcloud の設定名（例 victory）を入れると、
 *   その設定のログインで `gcloud auth print-access-token` を実行してトークンを取得・更新する。
 *   マシン全体の ADC を上書きせず、トークンをファイルにも残さない
 * - GOOGLE_OAUTH_ACCESS_TOKEN：一時的に直接トークンを渡す場合（約1時間で切れる）
 */
export function createVertexClient(env: NodeJS.ProcessEnv) {
  const project = env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT が未設定です');
  const accessToken = env.GOOGLE_OAUTH_ACCESS_TOKEN;
  const gcloudConfig = env.LOCAL_GCLOUD_CONFIG;
  let googleAuthOptions: GoogleGenAIOptions['googleAuthOptions'];
  if (gcloudConfig) {
    const authClient = new OAuth2Client();
    authClient.refreshHandler = () => gcloudAccessToken(gcloudConfig);
    googleAuthOptions = { authClient, projectId: project };
  } else if (accessToken) {
    const authClient = new OAuth2Client();
    authClient.setCredentials({ access_token: accessToken });
    googleAuthOptions = { authClient, projectId: project };
  }
  return new GoogleGenAI({
    vertexai: true,
    project,
    location: env.GOOGLE_CLOUD_LOCATION ?? 'global',
    ...(googleAuthOptions ? { googleAuthOptions } : {}),
  });
}

export function geminiConfigFromEnv(env: NodeJS.ProcessEnv): GeminiConfig {
  return {
    fast: {
      model: env.GEMINI_MODEL_FAST ?? 'gemini-3.5-flash',
      thinkingLevel: (env.GEMINI_THINKING_FAST as GeminiConfig['fast']['thinkingLevel']) ?? 'MINIMAL',
      timeoutMs: Number(env.GEMINI_TIMEOUT_FAST_MS ?? 12_000),
    },
    refine: {
      model: env.GEMINI_MODEL_REFINE ?? 'gemini-3.8-flash',
      thinkingLevel: (env.GEMINI_THINKING_REFINE as GeminiConfig['refine']['thinkingLevel']) ?? 'LOW',
      timeoutMs: Number(env.GEMINI_TIMEOUT_REFINE_MS ?? 25_000),
    },
  };
}

const run = promisify(execFile);

async function gcloudAccessToken(configName: string) {
  const { stdout } = await run('gcloud', ['auth', 'print-access-token'], {
    env: { ...process.env, CLOUDSDK_ACTIVE_CONFIG_NAME: configName },
  });
  // gcloud のトークンは約60分有効。余裕を見て50分で更新する
  return { access_token: stdout.trim(), expiry_date: Date.now() + 50 * 60_000 };
}
