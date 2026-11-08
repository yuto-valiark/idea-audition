# デプロイ手順（Cloud Run）

- Status: Accepted
- Owner: TBD
- Updated: 2026-11-08
- 関連：ADR-0003（サーバー権威・Cloud Run 1台）、`docs/02-architecture/overview.md`

## 構成

| 項目 | 値 |
|---|---|
| URL | https://idea-audition-852280753109.asia-northeast1.run.app （合言葉が必要） |
| GCP プロジェクト | `idea-audition`（請求先 VICTORY） |
| サービス | Cloud Run `idea-audition`（`asia-northeast1`） |
| 中身 | 1つのコンテナで、画面（`apps/web/dist`）と CAMP サーバー（`/camp`・`/voice`）を同じ URL から配る（`Dockerfile`） |
| 台数 | 最大1台（`--max-instances 1`）。待機は通常0台、本番前だけ1台（下記） |
| 接続の上限 | 60分（`--timeout 3600`、WebSocket 用）。セッションアフィニティ有効 |
| 実行アカウント | `idea-audition-run@idea-audition.iam.gserviceaccount.com`（Vertex AI 利用者・Firestore 利用者・合言葉の Secret の読み取りのみ） |
| APIキー | 使わない（Vertex AI・Firestore はサービスアカウントで認証） |
| 合言葉 | Secret Manager `idea-audition-access-code` を環境変数 `ACCESS_CODE` として渡す |
| AI のモード | `AI_GATEWAY=gemini` なので Gemini と固定データの両方を選べる（既定は Gemini）。チーム向けの説明は `gemini-credits.md` |
| 環境変数 | `AI_GATEWAY=gemini`、`GOOGLE_CLOUD_PROJECT=idea-audition`、`GOOGLE_CLOUD_LOCATION=global`、`PERSISTENCE=firestore` |
| 保存先 | 本番は Firestore の `(default)` データベース。手元の開発は別のデータベース `dev-local`（`.env` の `FIRESTORE_DATABASE=dev-local`）。同じプロジェクト・同じ場所（asia-northeast1）だが、データは完全に別 |
| 予算アラート | 請求先 VICTORY に ¥3,000（クレジット $20 相当）、50%・90%・100% でメール通知（クレジット適用前の金額で判定） |

gcloud は IDEA AUDITION 用の設定 `victory` を使う。以下のコマンドはすべて先頭に `CLOUDSDK_ACTIVE_CONFIG_NAME=victory` を付けるか、先に `export` する。

```bash
export CLOUDSDK_ACTIVE_CONFIG_NAME=victory
```

## デプロイ

リポジトリ直下で実行する。**ビルド → デプロイの2段階**で行う（`--source` で一度に行うと、ビルドの途中で CLI が先に終わることがあったため）。

1. Cloud Build でイメージを作る（1〜2分）。タグはコミットの短いハッシュ：

```bash
gcloud builds submit --project idea-audition --region asia-northeast1 --tag asia-northeast1-docker.pkg.dev/idea-audition/cloud-run-source-deploy/idea-audition:$(git rev-parse --short HEAD) --quiet .
```

2. そのイメージを Cloud Run に出す：

```bash
gcloud run deploy idea-audition --image asia-northeast1-docker.pkg.dev/idea-audition/cloud-run-source-deploy/idea-audition:$(git rev-parse --short HEAD) --project idea-audition --region asia-northeast1 --service-account idea-audition-run@idea-audition.iam.gserviceaccount.com --allow-unauthenticated --max-instances 1 --min-instances 0 --timeout 3600 --session-affinity --cpu 1 --memory 1Gi --cpu-boost --set-env-vars "AI_GATEWAY=gemini,GOOGLE_CLOUD_PROJECT=idea-audition,GOOGLE_CLOUD_LOCATION=global,PERSISTENCE=firestore" --set-secrets "ACCESS_CODE=idea-audition-access-code:latest" --quiet
```

3. 確認：`/health` が `ok` を返すこと、ログに `AI modes: gemini ..., fixture` と `access code: required` が出ること。

```bash
curl -s https://idea-audition-852280753109.asia-northeast1.run.app/health
```

- URL の確認：

```bash
gcloud run services describe idea-audition --project idea-audition --region asia-northeast1 --format='value(status.url)'
```

## 合言葉

- 確認（チームと審査員にだけ伝える。チャットやリポジトリに書かない）：

```bash
gcloud secrets versions access latest --secret idea-audition-access-code --project idea-audition
```

- 変更：新しい版を追加して、サービスを再デプロイ（または新しいリビジョンを作る）する。

```bash
printf '%s' '新しい合言葉' | gcloud secrets versions add idea-audition-access-code --project idea-audition --data-file=-
```

```bash
gcloud run services update idea-audition --project idea-audition --region asia-northeast1 --update-secrets "ACCESS_CODE=idea-audition-access-code:latest"
```

- 一度入れた合言葉はその端末のブラウザに保存される（違っていたら消えて、もう一度聞かれる）。

## 本番・リハーサルの前後

最初のアクセスの待ち時間（コールドスタート）をなくすため、本番とリハーサルの前だけ1台を常に起動しておく。終わったら0台に戻す（起動しっぱなしは費用がかかる）。

```bash
gcloud run services update idea-audition --project idea-audition --region asia-northeast1 --min-instances 1
```

```bash
gcloud run services update idea-audition --project idea-audition --region asia-northeast1 --min-instances 0
```

## ログ

```bash
gcloud run services logs read idea-audition --project idea-audition --region asia-northeast1 --limit 50
```

- `[ai] ... ok XXXms` で Gemini の待ち時間、`[proposal] ready` で企画書、`session restored` で再起動からの復元を確認できる。

## 注意

- ヘルスチェックは `/health`。Cloud Run は z で終わるパス（`/healthz` など）を予約しているので使わない。
- 以前は `gcloud run deploy --source .` で一度にデプロイしていたが、ビルドの途中で CLI が先に終わることがあったため、上の2段階に変えた（2026-11-08）。

- **最大1台が前提**（セッションの正本はメモリのアクター、ADR-0003）。台数を増やすとセッションが分かれるので増やさない。
- デプロイやインスタンスの入れ替えで接続が切れても、画面は自動で再接続し、Firestore から状態を戻す。
- マイク（音声入力）は https でのみ使える。Cloud Run の URL は https なので、どの PC からでも使える。
