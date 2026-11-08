import { defineConfig } from 'tsup';

// protocol と @hip/kit はワークスペースの TS ソースなので、サーバーのバンドルに含める
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  noExternal: ['@idea-audition/protocol', '@hip/kit'],
});
