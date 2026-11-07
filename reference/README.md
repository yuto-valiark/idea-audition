# reference/

本実装（`apps/` `packages/`）とは別に、参考資料として保管するもの。ここにあるコードは本実装のビルド・依存関係には含めない。

## mock-app/

- 出所：ChatGPTで作成したモックアプリ（`~/Downloads/IDEA_AUDITION` から 2026-11-07 にそのままコピー。公開ソースのコミット `bf054b2`）
- 構成：Vinext（Next.js互換）+ React + TypeScript + Tailwind CSS 4 + shadcn。AIの回答・他の審査員・投票は、ローカルのシナリオで動くデモ
- node_modules、ビルド結果、Gitの履歴は含まれていない。APIキーなどの秘密情報も含まれていない（確認済み）
- **本実装の技術選定とは異なる**：本実装は Vite + React + CSS Modules（ADR-0001、implementation-plan §2）。コードをそのまま移植せず、必要な部分を書き直して使う

### 流用の候補

| ファイル | 内容 | 使い方の案 |
|---|---|---|
| `public/mascots.png` | 8体のキャラ素材（1774×887、透過PNGのスプライトシート、MOMO / SPROUT / LUNA / POPO / NOVA / RIO / LEO / MIST） | 切り出してキャラ素材プールの最初の8体にする（ADR-0001、Q2） |
| `app/globals.css` | ネオンの舞台、リング、フリップの発光、アニメーション | 色・グロー・リングの値をデザイントークン（`tokens.css`）とCSS Modulesに移す |
| `app/page.tsx` | 画面構成、アイデアのサンプルデータ、キャラ名と色、審査の状態と操作 | サンプルの案を `FixtureGateway` の固定データに、キャラの色を素材プールの定義に流用する。状態の持ち方はADR-0003/0004に合わせて作り直す |
| `app/layout.tsx` | タイトル・メタデータ | 文言のみ参照 |

`.openai/`、`worker/`、`db/`、`drizzle/`、`scripts/`、`lib/connector*` は ChatGPT のホスティング環境向けのもので、本実装では使わない。
