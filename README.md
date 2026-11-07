# IDEA AUDITION

AIがプレゼン。あなたが審査員。— アイデア出しをオーディション審査で終わらせる企画案決めツール。

設計資料は [docs/README.md](docs/README.md)。実装計画は [docs/implementation-plan.md](docs/implementation-plan.md)。

## 構成

```text
apps/web          React + TypeScript + Vite（ステージUI、HIPクライアント）
apps/server       Node.js + TypeScript（セッションアクター、HIP の WebSocket 終端）
packages/protocol HIP v1 の契約（Zod スキーマ・型・キャラ素材カタログ）
reference/        ChatGPT で作ったモックアプリ（参考資料。ビルド対象外）
```

## 起動

Node.js 22 以上と pnpm 10 以上を使います。

```bash
pnpm install
pnpm dev
```

- Web: http://localhost:5173 （`/hip` を Vite が server の 8787 番へプロキシ）
- Server: ws://localhost:8787/hip、ヘルスチェック http://localhost:8787/healthz
- 同じセッションに入るには同じ URL を開きます。`?s=<セッション名>` で別のセッションになります（省略時は `demo`）
- 審査員は1つのセッションに4人まで。5人目以降は観覧モード

AI は既定で固定データ（`FixtureGateway`）を使うので、APIキーなしで通しデモができます。設定は `.env.example` を参照。

## テスト・ビルド

```bash
pnpm test
pnpm typecheck
pnpm build
```
