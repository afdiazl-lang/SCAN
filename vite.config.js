import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    
    // ✅ PERMITIR TODOS LOS HOSTS
    allowedHosts: [
      'localhost',
      '.loca.lt',           // LocalTunnel
      '.ngrok.io',          // Ngrok antiguo
      '.ngrok-free.app',    // Ngrok nuevo
      '.ngrok-free.dev',    // Ngrok dev (TU CASO)
      '.ngrok.app'          // Ngrok variante
    ]
  },
  
  define: {
    'process.env': {}
  }
})