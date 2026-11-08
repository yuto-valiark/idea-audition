# @hip/kit — Human Intent Protocol

数人が同じ画面を同時に操作し、そこに AI の遅い処理が割り込んでくるアプリのための、WebSocket 上のアプリケーション層プロトコルとその実装です。

WebSocket は「1対1で届ける」だけです。HIP はその上で次を決めて、実装しています。

| 決めること | HIP |
|---|---|
| 誰が先か | サーバーが部屋ごとに1件ずつ処理し、連番 `seq` を振って全員に同じ順番で配る |
| 失敗の返し方 | 操作（Command）には必ず成否と理由コードが返る |
| 二度押し・再送 | `commandId` で重複を排除し、同じ結果を返す |
| 切断 | 自動で再接続し、同じ参加者として状態の全体を取り直す。返事の来ていない操作は送り直す |
| AI の遅い結果 | `room.task()` で走らせ、`room.reset()` をまたいだ結果は捨てる |
| 高頻度の情報 | カーソルなどは Ephemeral（保存しない・最新だけ）、「うーん」などは Signal（返事なし・間引く） |
| バージョン違い・壊れたメッセージ・送りすぎ | 理由を返して、決まった終了コードで閉じる |

仕様書：[docs/protocol/hip-v1.md](../../docs/protocol/hip-v1.md)

## 使い方

### 1. 語彙を決める（サーバーと画面で共有）

```ts
import { z } from 'zod';
import { defineVocabulary } from '@hip/kit';

export const quickVote = defineVocabulary({
  commands: {
    OPEN_POLL: z.object({ question: z.string(), options: z.array(z.string()).min(2) }),
    VOTE: z.object({ option: z.number().int() }),
    CLOSE_POLL: z.object({}),
  },
  events: ['POLL_OPENED', 'VOTED', 'POLL_CLOSED', 'SUMMARY_READY'],
  rejectReasons: ['NOT_HOST', 'POLL_NOT_OPEN', 'ALREADY_VOTED'],
  snapshot: z.object({ seq: z.number(), status: z.string(), votes: z.record(z.string(), z.number()), summary: z.string().nullable() /* … */ }),
  signals: { HMM: z.object({}) },
});
```

### 2. サーバー：操作ごとのルールだけ書く

```ts
import { createHipServer } from '@hip/kit/server';

createHipServer(quickVote, {
  port: 8790,
  room: {
    initialState: () => ({ status: 'idle', question: '', options: [], votes: {}, summary: null }),
    commands: {
      VOTE(room, { option }, { actor }) {
        if (room.state.status !== 'open') return room.reject('POLL_NOT_OPEN');
        if (actor in room.state.votes) return room.reject('ALREADY_VOTED');
        room.state.votes[actor] = option;
        room.emit('VOTED', { by: actor });                 // 連番と状態の全体つきで全員へ
      },
      CLOSE_POLL(room, _p, { actor }) {
        if (!room.isHost(actor)) return room.reject('NOT_HOST');
        room.state.status = 'closed';
        room.emit('POLL_CLOSED', {});
        room.task(() => ai.summarize(room.state), (summary) => {   // 遅い AI
          room.state.summary = summary;
          room.emit('SUMMARY_READY', {});
        });
      },
    },
  },
});
```

### 3. 画面：送る・受け取るだけ

```ts
import { HipClient } from '@hip/kit/client';

const hip = new HipClient(quickVote, { url: 'wss://example.com/hip', room: 'class-3b' })
  .on({ onSnapshot: (s) => render(s) })       // 届いた状態をそのまま描く
  .connect();

const r = await hip.send('VOTE', { option: 1 });
if (!r.ok) alert(r.reason);                   // 'ALREADY_VOTED' など
hip.signal('HMM', {});                        // 返事のいらない反応
```

Node で使うときは `createSocket: (url) => new WebSocket(url)`（`ws` パッケージ）を渡します。

### 状態を保存したい・独自の処理順が要るとき

`createHipTransport({ vocabulary, rooms })` に、`RoomEndpoint`（attach / detach / receiveCommand / receiveEphemeral / receiveSignal）を実装した自分の部屋を渡します。IDEA AUDITION の `SessionActor` はこの形で、Firestore への保存・AI の生成計画・合意台帳を持っています。

## 例

- [examples/quick-vote](examples/quick-vote)：みんなで投票（ホスト・投票・締め切り・遅い AI のまとめ・「うーん」）
  - `npx tsx examples/quick-vote/server.ts` を起動して、別の端末で `npx tsx examples/quick-vote/demo.ts`
- IDEA AUDITION（このリポジトリの apps/）：4人の審査員と AI キャラクターが企画を決める

## 構成

| 入口 | 中身 | 動く場所 |
|---|---|---|
| `@hip/kit` | 版・終了コード、封筒、`defineVocabulary`、`ResultCache`、`SeqGate` | どこでも（zod だけに依存） |
| `@hip/kit/client` | 再接続・再送・順序つきのクライアント | ブラウザ・Node |
| `@hip/kit/server` | WebSocket の終端（`createHipTransport`）、すぐ使える部屋（`HipRoom`）、`createHipServer` | Node（ws） |

## テスト

`pnpm --filter @hip/kit test`：境界（アプリに依存しない・クライアントが Node 専用のものを使わない）と、Quick Vote での同時操作・拒否・再送・再接続・遅い AI・観覧・Signal・版違い。

## 状態

0.1.0。IDEA AUDITION（DevFest Hackathon 2026、チーム VICTORY）の中で開発中。公開（ライセンスの付与）は、チームの同意をとってから行います。
