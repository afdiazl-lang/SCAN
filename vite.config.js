import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  
  server: {
    host: '0.0.0.0', // Permite acceso desde otros dispositivos en red local
    port: 5173,
    strictPort: true, // Falla si el puerto está ocupado
    
    // ⚠️ HTTPS local comentado - usar solo si tienes certificados válidos
    // https: {
    //   key: './localhost-key.pem',
    //   cert: './localhost-cert.pem'
    // },
    
    // Configuración de proxy si es necesario
    // proxy: {
    //   '/api': {
    //     target: 'https://scan-pwa.onrender.com',
    //     changeOrigin: true,
    //     secure: true
    //   }
    // }
  },
  
  // Optimizaciones de build
  build: {
    target: 'esnext',
    minify: 'terser',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          qr: ['html5-qrcode', 'qrcode'],
          socket: ['socket.io-client'],
          storage: ['localforage', 'idb']
        }
      }
    }
  },
  
  // Variables de entorno
  define: {
    'process.env': {},
    __APP_VERSION__: JSON.stringify('1.0.0'),
  },
  
  // Optimización de dependencias
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'html5-qrcode',
      'qrcode',
      'socket.io-client',
      'localforage',
      'xlsx'
    ]
  }
})