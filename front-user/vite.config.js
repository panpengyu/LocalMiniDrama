import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// 端口与后端代理目标支持环境变量覆盖（避免硬编码）：PORT / API_PROXY_TARGET
const PORT = Number(process.env.PORT) || 3013
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://127.0.0.1:5679'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: PORT,
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        proxyTimeout: 600000,
        timeout: 600000
      },
      '/static': {
        target: API_PROXY_TARGET,
        changeOrigin: true
      },
      // Sprint 11 - S11-T01: 协作实时通信 WebSocket 代理到后端 Socket.io
      '/socket.io': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        ws: true
      }
    }
  }
})
