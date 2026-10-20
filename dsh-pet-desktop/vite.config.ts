import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 2 约定端口，避免与其他服务冲突；devUrl 见 src-tauri/tauri.conf.json
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Rust 源码目录变化不触发前端重载
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2021",
    outDir: "dist",
    sourcemap: false,
  },
});
