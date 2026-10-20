import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 前端开发/构建配置。生产构建产物输出到 dist/，由 server.mjs 托管。
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/assets/videos': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
