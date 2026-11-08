/**
 * 起動：npx tsx packages/hip/examples/quick-vote/server.ts
 * 別の端末で：npx tsx packages/hip/examples/quick-vote/demo.ts
 */
import { createHipServer } from '../../src/server/index.ts';
import { pollRoom } from './room.ts';
import { quickVote } from './vocabulary.ts';

const server = createHipServer(quickVote, { port: Number(process.env.PORT ?? 8790), room: pollRoom() });
console.log(`Quick Vote: ws://localhost:${await server.port}/hip`);
