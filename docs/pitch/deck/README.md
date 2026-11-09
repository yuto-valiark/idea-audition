# IDEA AUDITION pitch deck

15枚・5分・Demo-firstのピッチ資料です。PowerPointは各スライドをフルサイズ画像として埋め込むため、環境が変わってもフォントや図が崩れません。課題を見せる3枚目は画像生成で作ったビジュアル、体験・デモ・技術スライドは実際の画面キャプチャと実装に基づく図を使っています。

## 成果物

- `idea-audition-pitch-5min.pptx`: 投影用PowerPoint
- `speaker-notes.md`: 5分台本、24点の評価軸対応、差し替えチェック
- `image-generation-notes.md`: 生成画像の用途と再現用プロンプ
- `slide-07-video.png`: 完成動画を重ねるプレースホルダー
- `slide-13-oss.png`: GitHub/npm公開画面を重ねるプレースホルダー

## 再生成

ローカルHTMLの4枚をChromeでPNG化してからPowerPointを組み立てます。

```bash
./render.sh
python3 build_deck.py
```

6〜15枚目のソースHTMLから画像を作り直す場合は、先に次を実行します。

```bash
../slide-assets/v12/render.sh
```

PowerPoint内は一枚絵です。動画はスライド7の枠の上に、公開画面はスライド13の左枠の上に配置してください。
