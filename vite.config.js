import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  // 화면 구석에 표시할 버전 번호를 빌드 시점에 주입
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // GitHub Pages는 https://<user>.github.io/<repo>/ 하위 경로로 서빙된다.
  // dev / preview / production이 전부 같은 경로를 쓰도록 조건 없이 고정한다.
  // (개발 서버 주소도 http://localhost:5173/hololive-network/ 가 된다)
  base: '/hololive-network/',
  plugins: [react()],
  server: {
    port: 5173,
  },
});
