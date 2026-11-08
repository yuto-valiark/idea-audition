# アーキテクチャ概要

- Status: Accepted（ADR-0001〜0005 をまとめた全体図）
- Owner: TBD
- Updated: 2026-11-07

本番：https://idea-audition-852280753109.asia-northeast1.run.app （Cloud Run、合言葉が必要。手順は `docs/05-platform/deployment.md`）。「Day 2」と書いた部分は未実装。

## 全体図

```text
 ┌──────────── ブラウザ（審査員PC × 最大4台）────────────┐
 │  React + TypeScript + Vite                             │
 │  ├ 画面：ステージ・キャラ・フリップ（CSS Modules + Motion）│
 │  ├ 状態：Zustand                                        │
 │  │   ├ サーバーから届いた状態の写し（判定はしない）       │
 │  │   └ 表示用の状態（ドラッグ中・移動演出・吹き出し）     │
 │  ├ 通信：CAMPクライアント（再接続・未確定の操作の再送）    │
 │  └ 音声：マイク → 16kHz PCM（AudioWorklet）→ /voice       │
 └──────┬──────────────────────────────┬──────────────────┘
        │ 画面ファイル（HTML/JS/画像）  │ WebSocket：/camp（操作）・/voice（音声）
        ▼                              │  ・操作要求 / 結果通知（全員へ）
 ┌──────────────────┐                  │  ・カーソル（保存しない）
 │ Firebase Hosting │                  │  ・発言（文字にしたもの）
 │  （CDN 配信）     │                  ▼
 └──────────────────┘   ┌────────────────────────────────────┐
                        │ Cloud Run（Node.js + TS、インスタンス1台）│
                        │  ┌──────────────────────────────┐  │
                        │  │ WebSocket の窓口（/camp・/voice）  │  │
                        │  └──────────────┬───────────────┘  │
                        │  ┌──────────────▼───────────────┐  │
                        │  │ セッションアクター（セッションごと）│  │
                        │  │  ・操作を1件ずつ順に処理          │  │
                        │  │  ・ステージのルール（ドメイン）    │  │
                        │  │  ・メモリ上の最新状態             │  │
                        │  └───┬──────────────────┬───────┘  │
                        │  ┌───▼──────────┐ ┌─────▼────────┐ │
                        │  │ AIの差し替え口 │ │ 記録の差し替え口│ │
                        │  │ Gemini / 固定  │ │ Firestore      │ │
                        │  └───┬──────────┘ └─────┬────────┘ │
                        └──────┼──────────────────┼──────────┘
                               ▼                  ▼
                   ┌────────────────────┐ ┌──────────────────────┐
                   │ Gemini（Vertex AI） │ │ Firestore（東京）       │
                   │ 案の生成・改良・批評  │ │ 確定イベントの記録      │
                   │ 回答・Live 文字起こし  │ │ 最新のセッション状態    │
                   └────────────────────┘ └──────────────────────┘
                   APIキーは持たない（Cloud Run のサービスアカウントで Vertex AI を認証）
```

コード上の対応：

| 図の箱 | 場所 |
|---|---|
| 画面・表示用の状態 | `apps/web/src/scene`、`apps/web/src/features`、`apps/web/src/store/display-store.ts` |
| サーバー状態の写し | `apps/web/src/store/session-store.ts` |
| CAMPクライアント | `apps/web/src/net/camp-client.ts` |
| 通信の型（共有） | `packages/protocol` |
| WebSocket の窓口 | `apps/server/src/presentation/ws-server.ts` |
| セッションアクター | `apps/server/src/application/session-actor.ts` |
| ステージのルール | `apps/server/src/domain/` |
| 差し替え口（ポート） | `apps/server/src/application/ports.ts` |
| 固定データのAI | `apps/server/src/infrastructure/fixture/` |
| 音声の中継・文字起こし | `apps/server/src/presentation/voice-server.ts`、`apps/server/src/infrastructure/gemini/live-transcriber.ts`、`apps/web/src/features/voice/` |
| Firestore への保存 | `apps/server/src/infrastructure/persistence/` |
| 合意台帳（ADR-0007） | `apps/server/src/domain/consensus.ts`、`apps/server/src/application/consensus-context.ts`、`apps/web/src/features/consensus/` |
| Gemini のAI・失敗時の切り替え | `apps/server/src/infrastructure/gemini/`、`apps/server/src/infrastructure/resilient-gateway.ts` |

## 技術スタック

| 層 | 技術 | 状態 |
|---|---|---|
| フロント | React 19 + TypeScript + Vite、CSS Modules + CSS変数、Motion、Zustand | 実装済み |
| 通信の型 | Zod（`packages/protocol` を web と server で共有） | 実装済み |
| リアルタイム通信 | WebSocket（`ws`）＋ 独自のメッセージ仕様 CAMP v1 | 実装済み |
| サーバー | Node.js + TypeScript（tsup で1ファイルにまとめる） | 実装済み（ローカルのみ） |
| 実行環境 | Cloud Run（東京、最大1台、待機は通常0台・本番前だけ1台）。画面とサーバーを1つのコンテナから配る | デプロイ済み（2026-11-08） |
| 画面の配信 | Cloud Run から直接配る（ハッシュ付きファイルは1年キャッシュ）。Firebase Hosting を前に置くのは任意 | デプロイ済み |
| AI | Gemini（Vertex AI 経由。gemini-3.5-flash / gemini-3.8-flash、構造化出力）。失敗時は固定データ | 実装済み（ローカルで確認） |
| 音声 | Gemini Live（gemini-3.5-transcribe-live、サーバー中継）。テキスト入力を常に併設 | 実装済み（合成音声で確認、実マイクは未確認） |
| 永続化 | Firestore（asia-northeast1）。セッション状態と確定イベント | 実装済み（再起動からの復元を確認） |
| 認証・秘密情報 | Vertex AI はサービスアカウント認証で APIキー不要。その他の秘密情報が出たら Secret Manager | Gemini 分は実装済み |
| テスト | Vitest（ドメイン・通信の型・アクター）、Playwright（2ブラウザ同時操作） | Vitest のみ実装済み |

## キャッシュ

専用のキャッシュサーバー（Redis 等）は置かない。サーバーを1台に限るため、メモリ上の状態がそのままキャッシュを兼ねる。

| 置き場所 | 何を持つか | 目的 | 状態 |
|---|---|---|---|
| サーバーのメモリ | セッションの最新状態一式 | 正本として最速で判定する。Firestore は控え | 実装済み |
| サーバーのメモリ | 処理済みの操作の結果（直近500件） | 再送された操作を二重に実行しない | 実装済み |
| サーバーのメモリ | 発表待ちの案（2〜3件） | 補充で Gemini の応答を待たせない | 実装済み |
| サーバーのメモリ | 全員が抜けたあとのセッション（30分） | 一時的な切断から同じ状態に戻れる | 実装済み |
| ブラウザ | 自分の審査員ID（sessionStorage） | 再読み込みしても同じ審査員として戻る | 実装済み |
| ブラウザのキャッシュ（Cloud Run から配信） | 画面のファイルとキャラ画像 | ハッシュ付きファイルは1年、index.html はキャッシュしない | デプロイ済み。Firebase Hosting（CDN）を前に置くのは任意 |
| Gemini のコンテキストキャッシュ | 役割の指示と審査の文脈（合意台帳）を前半に固定順で置く | 待ち時間と料金を減らす | 形は実装済み。プロンプトが短く、実測ではまだ効いていない（ADR-0007） |
| Firestore | 確定イベントと最新のセッション状態 | サーバー再起動からの復元 | 実装済み |

**Redis（Memorystore）と Pub/Sub を検討する条件**：Cloud Run を2台以上に増やすとき。セッション状態をインスタンス間で共有する必要が出るため（ADR-0003）。

## データの流れ（例：ドラッグ昇格）

1. ブラウザ：キャラをつかむ → 表示用の状態だけで即座に持ち上げる。他の人には「つかみ中」をカーソルと同じ経路で知らせる
2. 上段にドロップ → `REQUEST_PROMOTION` をサーバーへ送る
3. アクター：定員・一意性を判定 → 確定したら `PROMOTION_CONFIRMED` と補充の `CANDIDATE_SPAWNED` を、最新状態つきで全員へ配信
4. ブラウザ：届いた状態に置き換え、キャラが上段へ飛ぶ演出を出す。拒否なら元の位置へ戻す
5. アクター：改良の順番待ちに入れ、AI（Gemini / 固定データ）を呼ぶ → 批評を間隔をあけて配信 → 改良版を公開
