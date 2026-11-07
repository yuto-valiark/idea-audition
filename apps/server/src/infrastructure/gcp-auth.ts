import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OAuth2Client } from 'google-auth-library';

const run = promisify(execFile);

/**
 * GCP の認証クライアント（Vertex AI と Firestore で共用）。
 * - Cloud Run：null を返し、各 SDK がサービスアカウントの認証（ADC）を自動で使う
 * - ローカル開発：LOCAL_GCLOUD_CONFIG（gcloud の設定名）のログインでトークンを取得・更新する。
 *   マシン全体の ADC を上書きせず、トークンをファイルにも残さない
 * - GOOGLE_OAUTH_ACCESS_TOKEN：一時的にトークンを直接渡す場合（約1時間で切れる）
 */
export function localAuthClient(env: NodeJS.ProcessEnv): OAuth2Client | null {
  const gcloudConfig = env.LOCAL_GCLOUD_CONFIG;
  if (gcloudConfig) {
    const client = new OAuth2Client();
    client.refreshHandler = () => gcloudAccessToken(gcloudConfig);
    return client;
  }
  if (env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    const client = new OAuth2Client();
    client.setCredentials({ access_token: env.GOOGLE_OAUTH_ACCESS_TOKEN });
    return client;
  }
  return null;
}

async function gcloudAccessToken(configName: string) {
  const { stdout } = await run('gcloud', ['auth', 'print-access-token'], {
    env: { ...process.env, CLOUDSDK_ACTIVE_CONFIG_NAME: configName },
  });
  // gcloud のトークンは約60分有効。余裕を見て50分で更新する
  return { access_token: stdout.trim(), expiry_date: Date.now() + 50 * 60_000 };
}
