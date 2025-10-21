import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import localforage from 'localforage';
import QRCode from 'qrcode';
import { io } from 'socket.io-client';
import { Html5Qrcode } from 'html5-qrcode';

// Configurar IndexedDB
localforage.config({
  name: 'ScanPWA',
  storeName: 'inventario_data'
});

// Función para configurar eventos del socket (reutilizable)
const configureSocketEvents = (socket, setIsHost, setExcelData, setScannedCodes, setConnectedDevices, saveData) => {
  socket.on('session-data', (data) => {
    setExcelData(data.excelData || []);
    setScannedCodes(new Set(data.scannedCodes || []));
    saveData('excelData', data.excelData || []);
    saveData('scannedCodes', data.scannedCodes || []);
  });

  socket.on('scan-sincronizado', (data) => {
    setScannedCodes(prev => {
      const newSet = new Set(prev);
      newSet.add(data.code);
      saveData('scannedCodes', Array.from(newSet));
      return newSet;
    });
  });

  socket.on('scan-duplicado', (code) => {
    alert(`⚠️ Código duplicado: ${code}`);
  });

  socket.on('excel-actualizado', (data) => {
    setExcelData(data.excelData || []);
    setScannedCodes(new Set(data.scannedCodes || []));
    saveData('excelData', data.excelData || []);
    saveData('scannedCodes', data.scannedCodes || []);
  });

  socket.on('dispositivos-conectados', (count) => {
    setConnectedDevices(count);
  });

  socket.on('connect', () => {
    console.log('✅ Socket conectado');
  });

  socket.on('disconnect', () => {
    console.log('❌ Socket desconectado');
  });
};

function App() {
  const [excelData, setExcelData] = useState([]);
  const [scannedCodes, setScannedCodes] = useState(new Set());
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState(null);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [connectedDevices, setConnectedDevices] = useState(0);
  const [isHost, setIsHost] = useState(false);
  const [socket, setSocket] = useState(null);

  const socketRef = useRef(null);

 // Inicializar socket
    useEffect(() => {
    const socketUrl = 'https://scan-pwa.onrender.com';
    
    const newSocket = io(socketUrl);
    socketRef.current = newSocket;
    setSocket(newSocket);

    configureSocketEvents(
      newSocket, 
      setIsHost, 
      setExcelData, 
      setScannedCodes, 
      setConnectedDevices, 
      saveData
    );

    return () => {
      newSocket.disconnect();
    };
  }, [isHost]);

  // Cargar datos guardados al iniciar
  useEffect(() => {
    loadSavedData();
  }, []);

  const loadSavedData = async () => {
    try {
      const savedExcelData = await localforage.getItem('excelData');
      const savedScannedCodes = await localforage.getItem('scannedCodes');
      const savedSessionId = await localforage.getItem('sessionId');
      
      if (savedExcelData) setExcelData(savedExcelData);
      if (savedScannedCodes) setScannedCodes(new Set(savedScannedCodes));
      if (savedSessionId) {
        setSessionId(savedSessionId);
        socketRef.current?.emit('join-session', savedSessionId);
      }
    } catch (error) {
      console.error('Error cargando datos:', error);
    } finally {
      setLoading(false);
    }
  };

  // Guardar datos automáticamente
  const saveData = async (key, data) => {
    try {
      await localforage.setItem(key, data);
    } catch (error) {
      console.error('Error guardando datos:', error);
    }
  };

  // Crear nueva sesión (PC)
  const createSession = async () => {
    const newSessionId = 'session_' + Math.random().toString(36).substr(2, 9);
    setSessionId(newSessionId);
    setIsHost(true);
    
    await saveData('sessionId', newSessionId);
    socketRef.current?.emit('join-session', newSessionId);
    
    // URL del servidor WebSocket
    const serverUrl = 'wss://scan-pwa.onrender.com';
    
    const qrData = {
      sessionId: newSessionId,
      serverUrl: serverUrl,
      clientUrl: window.location.origin,
      type: 'scan-pwa-connect',
      timestamp: Date.now()
    };
    
    try {
      const qrUrl = await QRCode.toDataURL(JSON.stringify(qrData));
      setQrCodeUrl(qrUrl);
      console.log('QR generado para:', currentOrigin);
    } catch (err) {
      console.error('Error QR:', err);
    }
  };

  // Unirse a sesión existente (Móvil)
  const joinSession = async (sessionData) => {
    console.log('Uniéndose a sesión:', sessionData);
    
    if (sessionData.serverUrl && sessionData.serverUrl !== 'http://localhost:3000') {
      socketRef.current?.disconnect();
      const newSocket = io(sessionData.serverUrl);
      socketRef.current = newSocket;
      setSocket(newSocket);
      
      configureSocketEvents(
        newSocket, 
        setIsHost, 
        setExcelData, 
        setScannedCodes, 
        setConnectedDevices, 
        saveData
      );
    }
    
    setSessionId(sessionData.sessionId);
    setIsHost(false);
    
    await saveData('sessionId', sessionData.sessionId);
    
    setTimeout(() => {
      socketRef.current?.emit('join-session', sessionData.sessionId);
      console.log('Emitiendo join-session para:', sessionData.sessionId);
    }, 1000);
    
    setQrCodeUrl('');
    alert('✅ Conectado a la sesión de escaneo');
  };

  // Manejar carga de Excel (solo host)
  const handleFileUpload = (event) => {
    if (!isHost && sessionId) {
      alert('Solo el dispositivo principal puede cargar archivos Excel');
      return;
    }

    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      
      setExcelData(jsonData);
      saveData('excelData', jsonData);
      
      if (sessionId) {
        socketRef.current?.emit('update-excel', {
          sessionId,
          excelData: jsonData
        });
      }
      
      alert(`✅ Excel cargado: ${jsonData.length} registros`);
    };
    reader.readAsArrayBuffer(file);
  };

  // Agregar código escaneado
  const addScannedCode = (decodedText) => {
    setScannedCodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(decodedText)) {
        alert('⚠️ Código duplicado: ' + decodedText);
        return prev;
      } else {
        newSet.add(decodedText);
        saveData('scannedCodes', Array.from(newSet));
        
        if (sessionId) {
          socketRef.current?.emit('new-scan', {
            sessionId,
            code: decodedText
          });
        }
        
        alert('✅ Escaneado: ' + decodedText);
        return newSet;
      }
    });
  };

// Iniciar escáner - VERSIÓN SIMPLIFICADA
const startScanner = async () => {
  setScanning(true);
  
  const scannerElement = document.getElementById('qr-reader');
  scannerElement.innerHTML = '<div style="padding: 20px; text-align: center;">🔄 Iniciando cámara...</div>';

  try {
    // Usar Html5Qrcode directamente (más estable)
    const html5Qrcode = new Html5Qrcode("qr-reader");
    
    const config = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0,
      facingMode: "environment"
    };

    await html5Qrcode.start(
      { facingMode: "environment" }, 
      config,
      (decodedText) => {
        // Código escaneado exitosamente
        try {
          const data = JSON.parse(decodedText);
          if (data.type === 'scan-pwa-connect' && data.sessionId) {
            if (confirm('¿Conectar a sesión de escaneo?')) {
              joinSession(data);
              html5Qrcode.stop();
              setScanning(false);
            }
            return;
          }
        } catch (e) {
          addScannedCode(decodedText);
        }
        
        // Continuar escaneando después de éxito
        setTimeout(() => {
          html5Qrcode.resume();
        }, 1000);
      },
      (errorMessage) => {
        // Error de escaneo (silencioso)
      }
    );

    // Guardar referencia para poder detener
    window.currentQrcode = html5Qrcode;

  } catch (err) {
    console.error('Error iniciando escáner:', err);
    alert('No se pudo acceder a la cámara: ' + err.message);
    setScanning(false);
  }
};

  // Limpiar todos los datos
  const clearAllData = async () => {
    if (confirm('¿Estás seguro de limpiar todos los datos?')) {
      setExcelData([]);
      setScannedCodes(new Set());
      setSessionId(null);
      setQrCodeUrl('');
      setIsHost(false);
      await localforage.clear();
      alert('🗑️ Todos los datos limpiados');
    }
  };

  // Calcular progreso
  const calculateProgress = () => {
    if (excelData.length === 0) return 0;
    const scannedArray = Array.from(scannedCodes);
    
    const escaneados = excelData.filter(item => 
      scannedArray.includes(item.Código?.toString())
    ).length;
    
    return {
      escaneados,
      total: excelData.length,
      porcentaje: Math.round((escaneados / excelData.length) * 100)
    };
  };

  const progress = calculateProgress();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-xl">🔄 Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-3 safe-area-padding">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden p-4">
        
        {/* Header con estado de conexión */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-blue-600 mb-2">
            📱 Scan PWA {sessionId ? '🔗' : '🔴'}
          </h1>
          <p className="text-sm text-gray-600">
            {sessionId ? 
              (isHost ? 'Modo PC - Esperando móviles' : 'Modo Móvil - Conectado') : 
              'Desconectado'}
          </p>
          {sessionId && (
            <p className="text-xs text-green-600 mt-1">
              {connectedDevices > 0 ? `${connectedDevices} dispositivos conectados` : 'Conectado al servidor'}
            </p>
          )}
        </div>

        {/* Sistema de conexión */}
        {!sessionId ? (
          <div className="mb-6 text-center">
            <button
              onClick={createSession}
              className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded-xl text-lg mb-3"
            >
              🖥️ Modo PC - Crear Sesión
            </button>
            <p className="text-sm text-gray-600 mb-3">o</p>
            
            {/* BOTÓN ESCANEAR QR */}
            <button
              onClick={startScanner}
              className="w-full bg-green-500 hover:bg-green-700 text-white font-bold py-4 px-4 rounded-xl text-lg mb-3"
            >
              📱 Escanear QR
            </button>
            
            {/* BOTÓN MANUAL TEMPORAL */}
            <button
              onClick={() => {
                const sessionId = prompt('Ingresa el ID de sesión (mira en la PC):');
                if (sessionId) {
                  joinSession({
                    sessionId: sessionId,
                    serverUrl: 'https://scan-pwa.onrender.com'
                  });
                }
              }}
              className="w-full bg-orange-500 hover:bg-orange-700 text-white font-bold py-3 px-4 rounded-lg text-sm"
            >
              🔗 Conexión Manual (Si QR falla)
            </button>
          </div>
        ) : (
          <>
            {/* QR Code para conexión (solo host) */}
            {isHost && qrCodeUrl && (
              <div className="mb-6 text-center p-4 bg-blue-50 rounded-xl">
                <h3 className="font-semibold mb-3">📱 Escanear para conectar</h3>
                <img src={qrCodeUrl} alt="QR Code" className="mx-auto w-48 h-48 rounded-lg shadow-lg" />
                <p className="text-xs text-gray-600 mt-2">
                  Usa el modo móvil en otro dispositivo para escanear este código
                </p>
              </div>
            )}

            {isHost && sessionId && (
              <div className="text-center text-sm text-gray-600 mt-2 p-3 bg-yellow-50 rounded-lg mb-4">
                <p>📋 <strong>ID de sesión para conexión manual:</strong></p>
                <p className="font-mono text-blue-600 bg-white p-2 rounded mt-1 border">
                  {sessionId}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Copia este ID para usar en "Conexión Manual" del móvil
                </p>
              </div>
            )}

            {/* Cargar Excel (solo host) */}
            {isHost && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  📊 Cargar Archivo Excel
                </label>
                <div className="relative">
                  <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleFileUpload}
                    className="block w-full text-sm text-gray-500 
                              file:mr-4 file:py-3 file:px-4 
                              file:rounded-lg file:border-0 
                              file:text-sm file:font-semibold 
                              file:bg-blue-500 file:text-white 
                              hover:file:bg-blue-600 
                              transition-colors duration-200"
                  />
                </div>
              </div>
            )}

            {/* Progreso */}
            {excelData.length > 0 && (
              <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-xl border border-blue-100">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-gray-800">📈 Progreso</h3>
                  <span className="text-sm font-bold text-blue-600">
                    {progress.porcentaje}%
                  </span>
                </div>
                
                {/* Barra de progreso */}
                <div className="w-full bg-gray-200 rounded-full h-3 mb-3">
                  <div 
                    className="bg-gradient-to-r from-green-400 to-green-600 h-3 rounded-full transition-all duration-500 shadow-sm"
                    style={{ width: `${progress.porcentaje}%` }}
                  ></div>
                </div>
                
                {/* Estadísticas */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="text-center p-2 bg-green-100 rounded-lg">
                    <div className="font-bold text-green-700">{progress.escaneados}</div>
                    <div className="text-green-600">✅</div>
                  </div>
                  <div className="text-center p-2 bg-orange-100 rounded-lg">
                    <div className="font-bold text-orange-700">{progress.total - progress.escaneados}</div>
                    <div className="text-orange-600">⏳</div>
                  </div>
                  <div className="text-center p-2 bg-blue-100 rounded-lg">
                    <div className="font-bold text-blue-700">{progress.total}</div>
                    <div className="text-blue-600">📦</div>
                  </div>
                </div>
              </div>
            )}

            {/* Escáner */}
            <div className="mb-6">
              <button
                onClick={startScanner}
                disabled={scanning}
                className="w-full bg-gradient-to-r from-green-500 to-green-600 
                          hover:from-green-600 hover:to-green-700 
                          disabled:from-gray-400 disabled:to-gray-500 
                          text-white font-bold py-4 px-4 rounded-xl 
                          shadow-lg transition-all duration-200 
                          disabled:shadow-none mb-4 text-lg"
              >
                {scanning ? (
                  <span className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    Escaneando...
                  </span>
                ) : (
                  <span className="flex items-center justify-center">
                    📷 {isHost ? 'Escanear QR Conexión' : 'Escanear Códigos'}
                  </span>
                )}
              </button>
              
            {/* Contenedor del escáner */}
<div id="qr-reader" className="mt-4 rounded-xl overflow-hidden shadow-lg"></div>

{/* BOTÓN CERRAR CÁMARA */}
{scanning && (
  <button
    onClick={() => {
      if (window.currentQrcode) {
        window.currentQrcode.stop().then(() => {
          setScanning(false);
        }).catch(err => {
          console.error('Error deteniendo escáner:', err);
          setScanning(false);
        });
      }
    }}
    className="w-full bg-red-500 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg mt-4 transition-colors duration-200"
  >
    ❌ Detener Escáner
  </button>
)}

{/* Contador de escaneos */}
{scannedCodes.size > 0 && (
  <div className="mt-3 text-center">
    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
      🔢 {scannedCodes.size} códigos escaneados
    </span>
  </div>
)}
            </div>

            {/* Panel de Control */}
            <div className="border-t border-gray-200 pt-4 space-y-4">
              
              {/* Botones de acción */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={clearAllData}
                  className="bg-gradient-to-r from-red-500 to-red-600 
                            hover:from-red-600 hover:to-red-700 
                            text-white font-bold py-3 px-4 rounded-lg 
                            shadow transition-all duration-200 text-sm"
                >
                  🗑️ Limpiar
                </button>
                <button
                  onClick={() => {
                    const reporte = generarReporte(excelData, scannedCodes);
                    exportarACSV(reporte);
                    alert(`📊 Reporte exportado!\n\n✅ Escaneados: ${reporte.resumen.escaneados}\n❌ Faltantes: ${reporte.resumen.faltantes}\n⚠️ Sobrantes: ${reporte.resumen.sobrantes}`);
                  }}
                  disabled={excelData.length === 0}
                  className="bg-gradient-to-r from-purple-500 to-purple-600 
                            hover:from-purple-600 hover:to-purple-700 
                            disabled:from-gray-400 disabled:to-gray-500 
                            text-white font-bold py-3 px-4 rounded-lg 
                            shadow transition-all duration-200 text-sm"
                >
                  📄 Exportar CSV
                </button>
              </div>

              {/* Información del sistema */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">💾 Almacenamiento:</span>
                  <span className="text-sm font-medium text-green-600">Offline</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">📊 Productos:</span>
                  <span className="text-sm font-medium">{excelData.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">📷 Escaneos:</span>
                  <span className="text-sm font-medium">{scannedCodes.size}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">🔗 Sesión:</span>
                  <span className="text-sm font-medium text-blue-600">
                    {sessionId.substring(0, 8)}...
                  </span>
                </div>
              </div>

              {/* Estado de conexión */}
              <div className={`p-3 rounded-lg text-center text-sm font-medium ${
                navigator.onLine 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-orange-100 text-orange-800'
              }`}>
                {navigator.onLine ? '🟢 Conectado' : '🟡 Modo Offline'}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Funciones auxiliares
const generarReporte = (excelData, scannedCodes) => {
  const scannedArray = Array.from(scannedCodes);
  
  const faltantes = excelData.filter(item => 
    !scannedArray.includes(item.Código?.toString())
  );
  
  const sobrantes = scannedArray.filter(scannedCode =>
    !excelData.some(item => item.Código?.toString() === scannedCode)
  );

  const escaneados = excelData.filter(item => 
    scannedArray.includes(item.Código?.toString())
  );

  return { 
    faltantes, 
    sobrantes, 
    escaneados,
    resumen: {
      total: excelData.length,
      escaneados: escaneados.length,
      faltantes: faltantes.length,
      sobrantes: sobrantes.length,
      porcentajeCompletado: excelData.length > 0 ? 
        Math.round((escaneados.length / excelData.length) * 100) : 0
    }
  };
};

const exportarACSV = (reporte) => {
  let csvContent = "Tipo,Código,Producto,Cantidad,Guía,Cliente\n";
  
  // Faltantes
  reporte.faltantes.forEach(item => {
    csvContent += `FALTANTE,${item.Código || ''},${item.Producto || ''},${item.Cantidad || ''},${item.Guía || ''},${item.Cliente || ''}\n`;
  });
  
  // Sobrantes
  reporte.sobrantes.forEach(codigo => {
    csvContent += `SOBRANTE,${codigo},,,,\n`;
  });
  
  // Escaneados
  reporte.escaneados.forEach(item => {
    csvContent += `ESCANEADO,${item.Código || ''},${item.Producto || ''},${item.Cantidad || ''},${item.Guía || ''},${item.Cliente || ''}\n`;
  });
  
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reporte_inventario_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export default App;