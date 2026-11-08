# ADR-0010: HIP をアプリケーション層プロトコルとして仕様にし、OSS に切り出せる境界を作る

- Status: Proposed（2026-11-08）
- Owner: 牧 夢斗
- 関連：ADR-0003（サーバー権威）／ADR-0004（HIP v1 最小仕様）／ADR-0009（好みエンジン）／[HIP v1 仕様書](../protocol/hip-v1.md)

## Context

- チームの中で「HIP は独自プロトコルと呼べるか」「OSS にできるか」という話が出た。
  - メッセージの形を決めただけなら「イベントスキーマ」。
  - 誰が・いつ・どの順で送れるか、成否の返し方、同時操作の衝突、切断からの復旧、バージョン違いの扱いまで決めて実装・検証すれば、「WebSocket 上の独自アプリケーション層プロトコル」と言える。
- 実は、その大半はもう実装して本番で動いている。足りないのは、仕様書・いくつかの穴・それを示すテストの3つ。

### いまの実装で満たしていること

| 観点 | 実装 | 場所 |
|---|---|---|
| メッセージの種類 | hello / welcome / command / result / event / ephemeral / access_denied | `packages/protocol/src/messages.ts` |
| 形の検証 | すべて Zod で検証。壊れた Command には `INVALID_PAYLOAD` | `ws-server.ts` |
| 誰が送れるか | 審査員4人・ホスト・観覧者。`NOT_HOST` / `SPECTATOR` で拒否 | `session.ts`・`session-actor.ts` |
| 処理の順序 | セッションごとに1本の直列キュー（SessionActor）。Event にセッション単位の連番 `seq` | `session-actor.ts` |
| 成否の返し方 | 送った本人に `result{commandId, ok, reason}`、状態の変化は Event で全員へ | 同上 |
| 二重処理の防止 | `commandId` ごとに結果を覚え（最大500件）、同じ ID が来たら再実行せず同じ結果を返す | 同上 |
| 同時操作の衝突 | 前提条件を状態で検査（`UPPER_FULL`・`NOT_IN_LOWER` など）。4人が同時に昇格しても上段は3体を超えない | `session.ts` |
| 切断と復旧 | 25秒ごとの ping、指数バックオフ（最大5秒）で再接続、`judgeId`・`lastSeq` 付きの hello、未確定の Command を同じ ID で再送、welcome の snapshot で全体を取り直す | `hip-client.ts` |
| 古い Event | `seq <= lastSeq` を捨てる | `hip-client.ts` |
| 古い AI の結果 | `epoch` を進め、出し直し・リセット前に始まった Gemini の結果を捨てる | `session-actor.ts` |
| 永続化 | Command の結果として出た Event を Firestore の `events/{seq}` に追記、状態は `sessions/{id}` | `firestore-store.ts` |

### 足りないこと

1. **仕様書が無い**。ADR-0004 は「案」のままで、実装とずれた所がある（差分の再送はせず snapshot で取り直す、など）。
2. **バージョン違いを伝えられない**。`hip: "1"` 以外は検証に落ちて黙って捨てられる。
3. **壊れたメッセージへの返事が無い**。`commandId` が読めないと何も返らない。
4. **古い画面からの操作を検出できるのは論点の確定（`PIN_CLAIM`）だけ**。`STALE_VERSION` はそこでしか使っておらず、画面が古いまま「この版に対して磨いて」と頼んだ場合などは検出できない。
5. **未知の type の扱い**が仕様（無視して記録）と実装（`INVALID_PAYLOAD`）で違う。
6. **好みエンジンの迷いや沈黙**は、Command（必ず返事）とも Ephemeral（状態を変えない）とも性質が違う。
7. **それを示すテスト**が、ドメインの単体テストに散らばっていて、プロトコルとしての検証（同時昇格・再送・再接続・古い AI の結果・バージョン違い）がまとまっていない。
8. **汎用の部分とアプリ固有の語彙が同じファイルに混ざっている**ので、そのままでは OSS に切り出せない。

## Decision（提案）

### 1. 仕様書を書く

[`docs/protocol/hip-v1.md`](../protocol/hip-v1.md) を正本とする。メッセージの形だけでなく、送ってよい人・前提条件・処理順・成否・衝突・復旧・バージョン・終了コードを決める。ADR-0004 はこの仕様書に置き換わる（Superseded にはせず、経緯として残す）。

### 2. 穴をふさぐ（小さい変更）

| # | 変更 | 理由 |
|---|---|---|
| a | `protocol_error{code, detail, supported}` を追加。`UNSUPPORTED_VERSION` / `MALFORMED` / `UNKNOWN_TYPE` / `NOT_JOINED` | 黙って捨てない。相手が直せる情報を返す |
| b | hello の `hip` が違えば `protocol_error{UNSUPPORTED_VERSION, supported:["1"]}` を返し、終了コード 4400 で閉じる | バージョンの交渉 |
| c | 未知の Command type には `result{ok:false, reason:UNKNOWN_TYPE}`。クライアントは未知の Event type を無視して snapshot だけ反映する | 前方互換 |
| d | 対象の版を指定できる Command に `expected: { rev }` を任意で追加。違えば `STALE_VERSION` | 古い画面からの操作を検出する |
| e | 5種類目の **Signal**（client → server、返事なし、間引きあり、状態はまとめた Event でしか返さない）を追加し、`SOFT_SIGNAL` をこれにする | 迷い・沈黙・笑いは失われてもよいが、状態（好み）には効く |
| f | 終了コードを決める：4400 バージョン違い・4401 合言葉・4408 hello が来ない・4429 送りすぎ | 切断の理由をクライアントが区別できる |

**`expected.rev` を「セッション全体の seq」ではなく「対象ごとの版」にする理由**：
下段は数秒ごとに入れ替わるので、セッション全体の `seq` で比べると、関係ない変化（別のキャラの登場）まで衝突として拒否してしまう。昇格のように「状態を見れば正しいか分かる」操作は、これまでどおり前提条件で検査する。版で比べるのは「どの版に対しての指示か」が意味を持つ操作（磨き込み・別案への返事・企画書の作り直し）だけにする。

### 3. 好みエンジンの新しいメッセージもこの仕様に沿って足す

| 種類 | type | 送る人 | 返事 | 保存 |
|---|---|---|---|---|
| Signal | `SOFT_SIGNAL{kind, targetInstanceId?, features}` | 審査員 | なし（1人あたり毎秒2件まで） | しない（まとめた結果だけ Event で保存） |
| Event | `TASTE_UPDATED` / `CANDIDATE_REACTED` / `CANDIDATE_REVISED` | サーバー | — | する |

### 4. テストで示す（適合テスト）

`apps/server/test/conformance.test.ts` に、サーバーを実際に立てて WebSocket で話すテストを置く（サーバーの実装が要るので apps/server 側。2026-11-08 実装、13本すべて通過）。

| テスト | 確かめること |
|---|---|
| 同時昇格 | 4つのクライアントが同じ瞬間に別々のキャラを昇格 → 成功は空き席の数だけ、残りは `UPPER_FULL`、上段は3体を超えない |
| 同じキャラの取り合い | 2人が同じキャラを同時に昇格 → 1人が成功、1人が `NOT_IN_LOWER` |
| 再送 | 同じ `commandId` を3回送る → Event は1回だけ、result は3回とも同じ |
| 返事の前に切断 | Command を送って result の前に切る → 再接続して同じ ID で再送 → 二重に実行されない |
| 再接続 | 切断中に起きた変化が welcome の snapshot に入っている、`seq` が戻らない |
| 古い AI の結果 | 生成中にリセット → 遅れて返った Gemini の結果が反映されない（固定データの遅延で再現） |
| 古い版への指示 | `expected.rev` が古い磨き込みの依頼 → `STALE_VERSION` |
| バージョン違い | `hip:"2"` の hello → `protocol_error{UNSUPPORTED_VERSION}` と 4400 |
| Signal の間引き | Signal を50件 → 返事は無く、続く Command は普通に処理される |
| 送りすぎ | 1秒に120件を超える → `RATE_LIMITED` と 4429 |
| 未知の type・壊れたメッセージ・hello の時間切れ | `UNKNOWN_TYPE`・`MALFORMED`・`NOT_JOINED`・4408 |

### 5. OSS に切り出せる境界を、今はフォルダで作る

ハッカソン中はパッケージを分けず、`packages/protocol/src/` の中を2つに分ける。アプリ側の import は変えない。

```text
packages/protocol/src/
  core/                 ← 将来の @hip/core（アプリの言葉を知らない）
    envelope.ts           hello / welcome / result / event / ephemeral / signal / protocol_error を
                          「語彙（Command と Event の一覧）」を受け取って組み立てる関数
    errors.ts             プロトコル共通のエラー（UNSUPPORTED_VERSION など）と終了コード
    client.ts             再接続・再送・seq の管理（いまの hip-client.ts の中身から UI を除いたもの）
    server.ts             commandId の結果キャッシュ・直列キュー・seq 付きの配信
  vocabulary/           ← IDEA AUDITION の言葉
    commands.ts           START_AUDITION、REQUEST_PROMOTION …
    events.ts             CANDIDATE_SPAWNED …
    model.ts / reasons.ts / taste.ts …
  index.ts              core を vocabulary で組み立てて、今と同じ名前で export
```

- ルール：`core/` は `vocabulary/` を import しない（テストで検査する）。
- 締切後に、`core/` をそのまま別パッケージ（`@hip/core` などの名前）に移し、IDEA AUDITION はそれを使う側になる。

### 6. OSS として公開するのは締切後

- ライセンスは**取るものではなく、選んで付けるもの**。審査や申請は無い。第一候補は MIT（短く、商用でも使える）。特許の扱いを明示したくなったら Apache-2.0。
- ただし、チーム4人で書いたコードなので、**公開する部分の著作権者と公開に4人が同意してから**にする。DevFest Hackathon の規約で成果物の権利に条件が無いかも確認する。
- 公開するのは `core/`（汎用部分）と仕様書だけにし、アプリ本体のリポジトリは private のままにできる。
- 公開の手順：別リポジトリを作る → LICENSE（MIT の全文と著作権者）→ README（何を解決するか・最小の例）→ 仕様書・適合テスト → npm に出すかは後で決める。

## 説明のしかた（ガクチカ・審査）

- 正確な言い方：「WebSocket の上で動く、リアルタイム共同審査のための独自アプリケーション層プロトコル HIP を設計・実装した」。TCP や WebSocket を作ったわけではない。
- なぜ既存のもので足りないか：WebSocket は双方向にバイトを届けるだけで、「4人が同時に昇格したら誰が勝つか」「返事が来る前に切れた操作をもう一度送ったらどうなるか」「人の操作の後に遅れて返ってきた AI の結果をどう扱うか」は決めてくれない。HIP はそこを決めている。
- HIP は速くするためのものではない。価値は、共同操作の意味と状態の整合性を決めて、それをテストで示せること。
- 時制を守る：適合テストが通るまでは「設計・実装している」、`core/` を分けて公開作業を始めたら「OSS 公開に向けて開発中」、公開したら「OSS として公開」。

## Alternatives

- **今すぐパッケージを分けて公開する**：締切まで2日で、好みエンジンと同時には無理。境界だけ今作れば、締切後の作業はファイルの移動で済む。
- **Socket.IO や Firebase Realtime Database / Firestore の同期に任せる**：配送や同期はしてくれるが、前提条件・拒否理由・重複排除・古い AI の結果の扱いは結局アプリ側で決める必要があり、それが HIP そのもの。
- **セッション全体の seq で楽観ロック**：実装は簡単だが、入れ替えが多いこのアプリでは関係ない衝突が増える（上の理由）。
- **JSON-RPC 2.0 に乗せる**：要求と返事の対応は表せるが、全員への順序付き配信・再接続・Ephemeral の区別は範囲外。

## Consequences / リスク

- 仕様書と実装のずれが新しい負債になる。適合テストを CI 代わりにデプロイ前に必ず回す。
- `core/` と `vocabulary/` に分けるとき、今の import が壊れないよう `index.ts` で同じ名前を出し直す。
- 「独自プロトコル」と言い過ぎると面接で突っ込まれる。上の「説明のしかた」に合わせる。

## 実装の順番（好みエンジンと合わせて）

1. 仕様書（このADRと同時）
2. 穴をふさぐ a〜f（`protocol_error`・バージョン・未知の type・`expected.rev`・Signal・終了コード）
3. 適合テスト（同時昇格・再送・再接続・古い AI・バージョン）
4. 好みエンジン（ADR-0009 の 1〜8）。新しいメッセージは最初からこの仕様に沿って足す
5. `core/` と `vocabulary/` にフォルダを分ける（時間があれば。無ければ締切後）
6. 締切後：チームの同意 → LICENSE → 公開
