import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",  // ← Esto ya está bien, permite todas las conexiones
    methods: ["GET", "POST"]
  }
});

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'dist')));

// Almacenamiento en memoria (sesiones activas)
const activeSessions = new Map();

// Endpoint para obtener IP local (usando ES modules)
import { networkInterfaces } from 'os';

app.get('/ip', (req, res) => {
  let localIP = 'localhost';
  const nets = networkInterfaces();
  
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip over non-IPv4 and internal addresses
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
        break;
      }
    }
    if (localIP !== 'localhost') break;
  }
  
  console.log('📍 IP local detectada:', localIP);
  res.json({ ip: localIP });
});

io.on('connection', (socket) => {
  console.log('🔌 Dispositivo conectado:', socket.id);

  // Unirse a una sesión específica
socket.on('join-session', (sessionId) => {
  // --- AGREGA ESTA LÍNEA ---
  console.log(`🔗 Solicitud join-session: ${sessionId} desde ${socket.id}`);
  
  socket.join(sessionId);
  socket.sessionId = sessionId;
  
  if (!activeSessions.has(sessionId)) {
    activeSessions.set(sessionId, {
      excelData: [],
      scannedCodes: new Set(),
      connectedDevices: new Set()
    });
  }
  
  const session = activeSessions.get(sessionId);
  session.connectedDevices.add(socket.id);
  
  console.log(`📱 Dispositivo ${socket.id} unido a sesión: ${sessionId}`);
  
  // Enviar datos actuales al nuevo dispositivo
  socket.emit('session-data', {
    excelData: session.excelData,
    scannedCodes: Array.from(session.scannedCodes)
  });
});
  // Sincronizar nuevo código escaneado
  socket.on('new-scan', (data) => {
    const { sessionId, code } = data;
    const session = activeSessions.get(sessionId);
    
    if (session) {
      if (session.scannedCodes.has(code)) {
        socket.emit('scan-duplicado', code);
      } else {
        session.scannedCodes.add(code);
        
        // Broadcast a todos los dispositivos en la sesión
        io.to(sessionId).emit('scan-sincronizado', {
          code,
          totalScanned: session.scannedCodes.size,
          progress: session.excelData.length > 0 ? 
            Math.round((session.scannedCodes.size / session.excelData.length) * 100) : 0
        });
        
        console.log(`✅ Código sincronizado: ${code} en sesión ${sessionId}`);
      }
    }
  });

  // Actualizar datos de Excel desde PC
  socket.on('update-excel', (data) => {
    const { sessionId, excelData } = data;
    const session = activeSessions.get(sessionId);
    
    if (session) {
      session.excelData = excelData;
      // Limpiar códigos escaneados al actualizar Excel
      session.scannedCodes.clear();
      
      io.to(sessionId).emit('excel-actualizado', {
        excelData,
        scannedCodes: Array.from(session.scannedCodes)
      });
      
      console.log(`📊 Excel actualizado en sesión ${sessionId}: ${excelData.length} registros`);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Dispositivo desconectado:', socket.id);
    
    // Limpiar sesión si no hay dispositivos conectados
    if (socket.sessionId) {
      const session = activeSessions.get(socket.sessionId);
      if (session) {
        session.connectedDevices.delete(socket.id);
        
        if (session.connectedDevices.size === 0) {
          // Opcional: mantener sesión por un tiempo
          setTimeout(() => {
            if (activeSessions.get(socket.sessionId)?.connectedDevices.size === 0) {
              activeSessions.delete(socket.sessionId);
              console.log(`🗑️ Sesión ${socket.sessionId} eliminada`);
            }
          }, 300000); // 5 minutos
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`📡 WebSockets activos para sincronización`);
});
