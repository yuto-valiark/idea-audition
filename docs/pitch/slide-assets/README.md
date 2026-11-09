# ピッチ用スライドの図と画像

`IDEA_AUDITION_Pitch_v6.pptx`（牧の Downloads）に入れた図と画像の元。2026-11-09 作成。

| ファイル | スライド | 中身 |
|---|---|---|
| `arch.html` → `arch.png` | 10 技術アーキテクチャ | ブラウザ → CAMP サーバー → 合意台帳・好み → Gemini → 同じ列で確定 → 全員へ |
| `camp.html` → `camp.png` | 12 CAMP の内部 | 検査 → 重複の確認 → アプリのルール → 確定（seq）→ 配信。task() と epoch で古い AI 結果を捨てる |
| `ab.html` → `ab.png` | 13 BEFORE / AFTER | 作り置きを順に出す方式（想定）と、合意台帳で次の生成が変わる IDEA AUDITION（実際の画面の切り抜き） |
| `chaos.html` → `chaos.png` | 4 会議の混乱 | 再現イメージ |
| `sb.html` → `storyboard.png` | 7 デモの流れ | 実際の画面5枚（登場・選抜・改善・投票・企画書） |
| `github_readme.png` | 14 OSS 公開 | 公開リポジトリ camp-protocol/camp の実物（ヘッダーと README だけ） |
| `stage.jpg` | 6 実アプリ | 4人で審査中の実際の画面（Gemini、ローカル） |
| `icon_1024.png` | 1・16 | 角を透明にしたアプリのアイコン |

作り直すとき：HTML を headless Chrome で 1175×440（storyboard は 1140×320、chaos は 690×290）、倍率2で撮る。`sb.html` は sb1〜sb5.png（実際の画面を 1600×900 にしたもの）を読むので、撮り直した画面を置いてから撮る。

注意：
- 図は実装（packages/camp と apps/server の SessionActor）に合わせて描いた。CAMP がするのは「1件ずつの処理・seq・重複の排除・reset 後の古い結果の破棄」。合意台帳で作り置きを捨てるのは IDEA AUDITION 側のルール
- GitHub の画面は、今の公開リポジトリだとコミットの一覧と Contributors に日本語のメッセージと AI ツールの名前が出るので、README の部分だけを使った。npm 公開（#23）のあとに撮り直す
