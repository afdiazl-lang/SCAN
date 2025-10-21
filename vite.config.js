import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true
  },
  // Configuración para build
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})