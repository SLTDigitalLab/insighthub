import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/n8n': {
        target: 'https://sltrnddigitallab.app.n8n.cloud',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/n8n/, '/webhook')
      },
      '/api/documents': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      },
      '/api/vector': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      },
      '/api/recommendations': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      },
      '/api/health': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      },
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
