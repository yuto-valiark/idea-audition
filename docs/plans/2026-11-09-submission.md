# 提出の準備（DevFest GDGoC Japan 2026 Hackathon）

- Date: 2026-11-09
- 出どころ：運営の説明スライド（提出ルール・提出物一覧・実行基盤の必須条件・Own the Why）と、「プロダクト説明ドキュメントサンプル.pdf」
- 発表の中身と数字は [2026-11-09-presentation-and-evidence.md](2026-11-09-presentation-and-evidence.md)、アプリの機能は [../backlog/2026-11-09-remaining-tasks.md](../backlog/2026-11-09-remaining-tasks.md)

## 提出ルール（運営の説明から）

| ルール | 中身 |
|---|---|
| 締切 | **2026-11-10（火）19:00** |
| 出し方 | 会場別の Google フォームに、GitHub の URL と、提出物を入れた Google Drive フォルダの URL を出す |
| Drive フォルダ | 「リンクを知っている全員が閲覧可」にする。**権限が足りずに開けない提出は審査されない** |
| デプロイ URL | **Regional Day（11/14）まで動かし続ける** |
| 実行基盤 | App Engine・Compute Engine・GKE・Cloud Run・Firebase App Hosting・Firebase Hosting のうち1つ以上 |

## 提出物と、今の状態

| 提出物 | 今の状態 | Issue |
|---|---|---|
| GitHub リポジトリ | ある。ただし **private**。審査員が見られるように公開するか招待するかを決める。README が古い（`?s=` で部屋を分ける説明など、今の作りと違う） | [#28](https://github.com/yuto-valiark/idea-audition/issues/28) |
| プロダクト説明ドキュメント（テンプレートあり） | まだ無い。材料（ADR・構成図・仕様）はある | [#25](https://github.com/yuto-valiark/idea-audition/issues/25) |
| デモ動画（オンライン会場はプレゼン動画） | まだ無い。どちらの会場かで中身が変わる | [#26](https://github.com/yuto-valiark/idea-audition/issues/26) |
| 著作物利用シート | まだ無い。キャラの画像・ロゴ・フォント・ライブラリなどの出どころの一覧が要る | [#27](https://github.com/yuto-valiark/idea-audition/issues/27) |
| ピッチ用スライド（現地会場の申込者だけ） | まだ無い | #16（P3） |
| 実行基盤 | **満たしている**：Cloud Run（asia-northeast1）。Firestore・Vertex AI の Gemini も使用 | — |
| デプロイ URL を 11/14 まで | 動いている。クレジット（$20）と費用・見張りの備えが要る | [#29](https://github.com/yuto-valiark/idea-audition/issues/29) |

## プロダクト説明ドキュメントの項目（テンプレート）

| 区分 | 項目 | 書く材料 |
|---|---|---|
| 表紙 | 会場・チーム名（VICTORY）・メンバー・アプリ名（IDEA AUDITION）・カテゴリ・GitHub URL | 会場とカテゴリの選択肢を確かめる |
| 必須 1 | プロジェクト概要 | README、トップ画面の文言 |
| 必須 2 | 解決する課題：対象ユーザー／課題と根拠／既存手法との違い（表） | 根拠は発表の M2（試算）と同じ材料。「誰の・どんな課題か」を根拠つきで |
| 必須 3 | Google 技術の活用：使った技術（チェック）／活用例（使用技術・使用箇所・選定理由とメリット・デメリットの表）／選定した理由 | ADR-0005（AI）・ADR-0003（サーバー）・docs/05-platform/deployment.md |
| 必須 4 | アーキテクチャ図 | docs/02-architecture/system-map.html から画像にする |
| 必須 5 | デプロイした URL | https://idea-audition-852280753109.asia-northeast1.run.app |
| 任意 6 | 動作確認の方法：テストアカウント／手順／サンプルデータ | ログインは無い（リンクで部屋に入る）。1人で試す手順（「ひとりで審査」）と、複数タブで試す手順。AI を使わない「固定データ」も書く |
| 任意 7 | アプリの詳細・機能の自由記述：主な機能／今後の展望 | 機能一覧、残りのタスク（#1〜#13） |
| 採点外 8 | AI をどの場面でどう使ったか、なぜか | 開発（Claude Code などのコーディング支援）とサービス（Gemini）の両方を正直に書く |
| 採点外 9 | 開発を通して何を得て、どれくらい成長できたか | メンバーそれぞれから集める |

## Own the Why（運営が求めている AI との付き合い方）

- AI の提案を鵜呑みにせず、複数案を出させて pros/cons を比べて選ぶ
- 選んだ理由と捨てた案をメモしておき、ドキュメントの「選定理由・メリット/デメリット」に書く
- 「誰の・どんな課題か」を根拠つきで書く

**今あるもの**：ADR（docs/adr、0001〜0011）に、案の比較・選んだ理由・捨てた案が残っている（描画方式、サーバー権威、AI の組み立て、合意台帳、好みエンジン、CAMP など）。これを必須 3 の「選定理由・メリット/デメリット」と、採点外 8 の材料に使える。アプリ自体も「AI に複数案を出させ、人間が理由を持って選ぶ」作りなので、Own the Why と主張がそのまま重なる（発表の強みにも使える）。

## 気をつけること

- **リポジトリを公開する場合**：秘密の情報が履歴に無いか確かめる（`.env` は追跡していない。合言葉は廃止済み）。GCP のプロジェクト ID やサービスアカウント名はドキュメントに出ている
- **11/14 までの費用**：審査員が「AI：Gemini」で遊ぶとクレジットを使う。予算アラートはあるが自動では止まらない
- **締切後の変更**：提出後は本番を壊さない。直すなら、動作を確かめてからデプロイする

## Issue

ラベル「提出」で起票した（#24〜#29）。

| | タスク | Issue |
|---|---|---|
| S1 | 提出の取りまとめ（Drive フォルダ・共有設定・フォーム提出、会場とカテゴリの確認） | [#24](https://github.com/yuto-valiark/idea-audition/issues/24) |
| S2 | プロダクト説明ドキュメントを書く | [#25](https://github.com/yuto-valiark/idea-audition/issues/25) |
| S3 | デモ動画（またはプレゼン動画）を作る | [#26](https://github.com/yuto-valiark/idea-audition/issues/26) |
| S4 | 著作物利用シートを作る | [#27](https://github.com/yuto-valiark/idea-audition/issues/27) |
| S5 | GitHub リポジトリを審査員が見られるようにし、README を今の作りに合わせる | [#28](https://github.com/yuto-valiark/idea-audition/issues/28) |
| S6 | 本番を 11/14 まで動かし続ける備え | [#29](https://github.com/yuto-valiark/idea-audition/issues/29) |
