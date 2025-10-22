// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Configuración SIMPLE para desarrollo
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Permite acceso desde otros dispositivos
    port: 5173,
    // SIN https - usar HTTP normal
  },
  // Opcional: definir variables de entorno
  define: {
    'process.env': {}
  }
})