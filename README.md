# IDEA AUDITION

AIがプレゼン。あなたが審査員。— アイデア出しをオーディション審査で終わらせる企画案決めツール。

設計資料は [docs/README.md](docs/README.md)。実装計画は [docs/implementation-plan.md](docs/implementation-plan.md)。

## 構成

```text
apps/web          React + TypeScript + Vite（ステージUI、CAMPクライアント）
apps/server       Node.js + TypeScript（セッションアクター、CAMP の WebSocket 終端）
packages/protocol CAMP v1 の契約（Zod スキーマ・型・キャラ素材カタログ）
reference/        ChatGPT で作ったモックアプリ（参考資料。ビルド対象外）
```

## 起動

Node.js 22 以上と pnpm 10 以上を使います。

```bash
pnpm install
pnpm dev
```

- Web: http://localhost:5173 （`/camp` を Vite が server の 8787 番へプロキシ）
- Server: ws://localhost:8787/camp、ヘルスチェック http://localhost:8787/health
- 同じセッションに入るには同じ URL を開きます。`?s=<セッション名>` で別のセッションになります（省略時は `demo`）
- 審査員は1つのセッションに4人まで。5人目以降は観覧モード

AI は既定で固定データ（`FixtureGateway`）を使うので、GCP の権限が無くても全機能を試せます。

- **AI のモード**：開始画面で「AI：Gemini（クレジットを使う）」と「固定データ（無料）」を選べ、審査の途中でもホストがヘッダーのバッジで切り替えられます（Gemini はサーバーが `AI_GATEWAY=gemini` のときだけ選べる）。
- **手元で Gemini を使う・クレジットの使い方**：[docs/05-platform/gemini-credits.md](docs/05-platform/gemini-credits.md)
- **本番**：https://idea-audition-852280753109.asia-northeast1.run.app （トップで部屋を作り、リンクを送って一緒に審査する）、デプロイ手順は [docs/05-platform/deployment.md](docs/05-platform/deployment.md)
- 設定の一覧は `.env.example`。

## テスト・ビルド

```bash
pnpm test
pnpm typecheck
pnpm build
```

## 素材のクレジット

| 素材 | 使っている場所 | 出典・ライセンス |
|---|---|---|
| 効果音「タイマー02」（Timbre1・10秒版の最後の3.4秒を切り出し、終わりにフェードアウトを加えたもの） | 予選の残り3秒のカウントダウン（`apps/web/public/sfx/countdown-last3.mp3`） | [OtoLogic](https://otologic.jp/free/se/countdown01.html)（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)） |

そのほかの効果音（ブザー・合格・見送り・優勝）は、音のファイルを使わず、ブラウザでその場で作っている（`apps/web/src/shared/sfx.ts`）。
