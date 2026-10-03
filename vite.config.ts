import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverPort = process.env.GAMESTUDIO_PORT || process.env.PORT || env.GAMESTUDIO_PORT || env.PORT || '4100';
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1', port: 5173, strictPort: true,
      watch: { ignored: ['**/data/**', '**/work/**', '**/tests/**', '**/docs/**'] },
      proxy: { '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: true } }
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true }
  };
});
