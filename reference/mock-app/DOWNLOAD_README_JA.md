# IDEA AUDITION ソースコード

React + TypeScript + Tailwind CSS / Vinext のインタラクティブデモです。

## 起動

Node.js 22.13以上を用意し、このフォルダで実行してください。

```bash
npm ci
npm run dev
```

ターミナルに表示されたURLをブラウザで開きます。

```bash
npm run build
```

## 主なファイル

- app/page.tsx: 画面・アイデアデータ・審査の状態と操作
- app/globals.css: ネオン舞台・レイアウト・アニメーション
- app/layout.tsx: タイトル・メタデータ
- public/mascots.png: 8体のキャラクター画像素材

AI回答・他の審査員・投票はローカルシナリオによるデモです。APIキーは不要です。
元プロジェクトのREADME.mdには環境設定の詳細があります。

公開済みソースのコミット: bf054b222a903c0e3b184534b1e7713c700dbe99
node_modules、ビルド結果、Git履歴、環境固有のキャッシュは含めていません。
