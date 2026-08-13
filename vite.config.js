import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages는 https://<user>.github.io/<repo>/ 하위 경로로 서빙된다.
  // dev / preview / production이 전부 같은 경로를 쓰도록 조건 없이 고정한다.
  // (개발 서버 주소도 http://localhost:5173/hololive-network/ 가 된다)
  base: '/hololive-network/',
  plugins: [react()],
  server: {
    port: 5173,
  },
});
