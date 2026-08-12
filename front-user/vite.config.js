import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 3013,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5679',
        changeOrigin: true,
        proxyTimeout: 600000,
        timeout: 600000
      },
      '/static': {
        target: 'http://127.0.0.1:5679',
        changeOrigin: true
      },
      // Sprint 11 - S11-T01: 协作实时通信 WebSocket 代理到后端 Socket.io
      '/socket.io': {
        target: 'http://127.0.0.1:5679',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
