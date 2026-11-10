import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

/**
 * Node のコマンドのビルド (npm run build:cli): src/cli.ts を、依存パッケージを取り込まない ES モジュール dist-cli/cli.js にする
 * (vite build --ssr src/cli.ts と同じ)。public/ の中身 (画面用の favicon など。手元では public/fonts の書体も) は、
 * コマンドには要らず、npm の配布物に入ってしまうので、コピーしない。
 * LICENSE・NOTICE・THIRD_PARTY_NOTICES.md と shebang は、vite.config.ts の licenseFiles() が入れる
 */
export default mergeConfig(
  base,
  defineConfig({
    publicDir: false,
    build: {
      ssr: 'src/cli.ts',
      outDir: 'dist-cli',
      emptyOutDir: true,
    },
  }),
);
