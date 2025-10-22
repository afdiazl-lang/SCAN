import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Html5Qrcode } from 'html5-qrcode'; 
import localforage from 'localforage';
import QRCode from 'qrcode';
import { io } from 'socket.io-client';
import './App.css';

// Configurar IndexedDB
localforage.config({
  name: 'ScanPWA',
  storeName: 'inventario_data'
});

// Función para configurar eventos del socket (reutilizable)
const configureSocketEvents = (socket, setIsHost, setExcelData, setScannedCodes, setConnectedDevices, saveData) => {
  socket.on('session-data', (data) => {
    console.log('📥 Datos de sesión recibidos:', data);
    setExcelData(data.excelData || []);
    setScannedCodes(new Set(data.scannedCodes || []));
    saveData('excelData', data.excelData || []);
    saveData('scannedCodes', data.scannedCodes || []);
  });

  socket.on('scan-sincronizado', (data) => {
    console.log('✅ Scan sincronizado:', data.code);
    setScannedCodes(prev => {
      const newSet = new Set(prev);
      newSet.add(data.code);
      saveData('scannedCodes', Array.from(newSet));
      return newSet;
    });
  });

  socket.on('scan-duplicado', (code) => {
    console.warn('⚠️ Código duplicado detectado:', code);
    alert(`⚠️ Código duplicado: ${code}`);
  });

  socket.on('excel-actualizado', (data) => {
    console.log('📊 Excel actualizado');
    setExcelData(data.excelData || []);
    setScannedCodes(new Set(data.scannedCodes || []));
    saveData('excelData', data.excelData || []);
    saveData('scannedCodes', data.scannedCodes || []);
  });

  socket.on('dispositivos-conectados', (count) => {
    console.log('👥 Dispositivos conectados:', count);
    setConnectedDevices(count);
  });

  socket.on('connect', () => {
    console.log('✅ Socket conectado');
  });

  socket.on('disconnect', () => {
    console.warn('❌ Socket desconectado');
  });

  socket.on('error', (error) => {
    console.error('🔴 Socket error:', error);
  });
};

// Función de diagnóstico de cámara MEJORADA
const diagnoseCamera = async () => {
  console.log('🔍 Iniciando diagnóstico de cámara...');
  
  const results = {
    navigator: typeof navigator !== 'undefined',
    mediaDevices: typeof navigator.mediaDevices !== 'undefined',
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
    https: window.location.protocol === 'https:',
    isSecureContext: window.isSecureContext, // ✅ AGREGADO
    localhost: window.location.hostname === 'localhost',
    localNetwork: /^(192\.168|10\.|172\.|127\.)/.test(window.location.hostname),
    url: window.location.href,
    userAgent: navigator.userAgent
  };
  
  console.log('📊 Resultados del diagnóstico:', results);
  
  // Verificar soporte básico
  if (!results.navigator) {
    throw new Error('Objeto navigator no disponible');
  }
  
  if (!results.mediaDevices) {
    throw new Error('❌ navigator.mediaDevices no existe. Verifica que estés en HTTPS o localhost.');
  }
  
  if (!results.getUserMedia) {
    throw new Error('❌ getUserMedia no soportado en este navegador');
  }
  
  // ✅ CRÍTICO: Verificar contexto seguro
  if (!results.isSecureContext) {
    throw new Error('❌ NO SECURE CONTEXT - La cámara requiere HTTPS en redes locales. Usa LocalTunnel o Ngrok.');
  }
  
  // Advertencia para HTTP
  if (!results.https && !results.localhost) {
    console.warn('⚠️ Usando HTTP en red local - puede fallar en móviles');
  }

  // Intentar enumerar dispositivos
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === 'videoinput');
    console.log(`📷 Cámaras disponibles: ${cameras.length}`, cameras);
    
    if (cameras.length === 0) {
      throw new Error('❌ No se detectaron cámaras en el dispositivo');
    }
  } catch (error) {
    console.error('Error enumerando dispositivos:', error);
    throw new Error(`Error al detectar cámaras: ${error.message}`);
  }
  
  return results;
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
  const [cameraError, setCameraError] = useState('');
  const [cameraPermission, setCameraPermission] = useState('unknown'); // ✅ NUEVO

  const socketRef = useRef(null);
  const html5QrcodeRef = useRef(null);

  // Inicializar socket - ✅ CORREGIDO: Sin dependencia de isHost
  useEffect(() => {
    const socketUrl = 'https://scan-pwa.onrender.com';
    
    console.log('🔌 Conectando a socket:', socketUrl);
    const newSocket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });
    
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
      console.log('🔌 Desconectando socket');
      newSocket.disconnect();
    };
  }, []); // ✅ SOLO AL MONTAR

  // Cargar datos guardados al iniciar
  useEffect(() => {
    loadSavedData();
  }, []);

  // Detectar conexión via QR
  useEffect(() => {
    const checkConnectionParams = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const connectSession = urlParams.get('connect');
      const serverUrl = urlParams.get('server');
      
      if (connectSession && !sessionId) {
        console.log('🔄 Conectando via parámetros QR...');
        await joinSession({
          sessionId: connectSession,
          serverUrl: serverUrl || 'https://scan-pwa.onrender.com'
        });
        
        // Limpiar URL
        window.history.replaceState({}, '', window.location.pathname);
      }
    };
    
    checkConnectionParams();
  }, [sessionId]);

  // Ejecutar diagnóstico al cargar
  useEffect(() => {
    const initialDiagnose = async () => {
      try {
        await diagnoseCamera();
        console.log('✅ Cámara compatible');
        setCameraError('');
      } catch (error) {
        console.error('❌ Error cámara:', error.message);
        setCameraError(error.message);
      }
    };
    
    initialDiagnose();
  }, []);

  const loadSavedData = async () => {
    try {
      const savedExcelData = await localforage.getItem('excelData');
      const savedScannedCodes = await localforage.getItem('scannedCodes');
      const savedSessionId = await localforage.getItem('sessionId');
      
      if (savedExcelData) {
        console.log('📥 Datos de Excel cargados:', savedExcelData.length);
        setExcelData(savedExcelData);
      }
      if (savedScannedCodes) {
        console.log('📥 Códigos escaneados cargados:', savedScannedCodes.length);
        setScannedCodes(new Set(savedScannedCodes));
      }
      if (savedSessionId) {
        console.log('📥 Sesión guardada:', savedSessionId);
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
      console.log(`💾 Guardado: ${key}`);
    } catch (error) {
      console.error('Error guardando datos:', error);
    }
  };

  // ✅ CORREGIDO: Crear nueva sesión con URL dinámica
  const createSession = async () => {
    const newSessionId = 'session_' + Math.random().toString(36).substr(2, 9);
    setSessionId(newSessionId);
    setIsHost(true);
    
    await saveData('sessionId', newSessionId);
    socketRef.current?.emit('join-session', newSessionId);
    
    // ✅ CORREGIDO: Usar protocol y host actuales
    const connectUrl = `${window.location.protocol}//${window.location.host}?connect=${newSessionId}&server=https://scan-pwa.onrender.com&type=scan-pwa`;
    
    try {
      const qrUrl = await QRCode.toDataURL(connectUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      setQrCodeUrl(qrUrl);
      console.log('✅ QR generado para:', connectUrl);
    } catch (error) {
      console.error('Error generando QR:', error);
      alert('Error generando código QR');
    }
  };

  // Unirse a sesión existente
  const joinSession = async ({ sessionId: sid, serverUrl }) => {
    if (!sid) {
      alert('⚠️ ID de sesión inválido');
      return;
    }

    setSessionId(sid);
    setIsHost(false);
    await saveData('sessionId', sid);
    
    socketRef.current?.emit('join-session', sid);
    console.log('✅ Unido a sesión:', sid);
  };

  // Manejar carga de Excel
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      setExcelData(jsonData);
      await saveData('excelData', jsonData);

      if (sessionId && socketRef.current) {
        socketRef.current.emit('actualizar-excel', {
          sessionId,
          excelData: jsonData
        });
      }

      console.log('✅ Excel cargado:', jsonData.length, 'productos');
      alert(`✅ ${jsonData.length} productos cargados`);
    } catch (error) {
      console.error('Error cargando Excel:', error);
      alert('❌ Error al cargar el archivo Excel');
    }
  };

  // ✅ MEJORADO: Iniciar scanner con mejor manejo de errores
  const startScanner = async () => {
    try {
      // Verificar diagnóstico
      await diagnoseCamera();

      if (html5QrcodeRef.current) {
        console.log('⚠️ Scanner ya está activo');
        return;
      }

      const html5QrCode = new Html5Qrcode("reader");
      html5QrcodeRef.current = html5QrCode;

      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
        disableFlip: false,
        rememberLastUsedCamera: true,
        showTorchButtonIfSupported: true
      };

      console.log('📷 Iniciando scanner...');
      
      await html5QrCode.start(
        { facingMode: "environment" }, // Cámara trasera
        config,
        async (decodedText, decodedResult) => {
          console.log('📷 Código detectado:', decodedText);
          
          // Vibración de feedback
          if ('vibrate' in navigator) {
            navigator.vibrate(200);
          }

          // Si es HOST y escanea QR de conexión
          if (isHost && decodedText.includes('connect=')) {
            console.log('🔗 QR de conexión detectado (ignorando en host)');
            return;
          }

          // Procesar scan normal
          if (scannedCodes.has(decodedText)) {
            console.warn('⚠️ Código duplicado:', decodedText);
            alert(`⚠️ Código ya escaneado: ${decodedText}`);
            
            if (socketRef.current && sessionId) {
              socketRef.current.emit('scan-duplicado', {
                sessionId,
                code: decodedText
              });
            }
            return;
          }

          // Agregar código nuevo
          setScannedCodes(prev => {
            const newSet = new Set(prev);
            newSet.add(decodedText);
            saveData('scannedCodes', Array.from(newSet));
            return newSet;
          });

          // Sincronizar con servidor
          if (socketRef.current && sessionId) {
            socketRef.current.emit('scan-code', {
              sessionId,
              code: decodedText,
              timestamp: new Date().toISOString()
            });
          }

          console.log('✅ Código agregado:', decodedText);
        },
        (errorMessage) => {
          // Solo loguear errores reales, no "No QR code found"
          if (!errorMessage.includes('NotFoundException')) {
            console.debug('Scanner:', errorMessage);
          }
        }
      );

      setScanning(true);
      setCameraPermission('granted');
      setCameraError('');
      console.log('✅ Scanner activo');

    } catch (error) {
      console.error('❌ Error iniciando scanner:', error);
      
      let errorMsg = 'Error al acceder a la cámara';
      
      if (error.name === 'NotAllowedError') {
        errorMsg = '❌ Permiso de cámara denegado. Por favor, permite el acceso a la cámara.';
        setCameraPermission('denied');
      } else if (error.name === 'NotFoundError') {
        errorMsg = '❌ No se encontró ninguna cámara en este dispositivo.';
      } else if (error.name === 'NotReadableError') {
        errorMsg = '❌ La cámara está siendo usada por otra aplicación.';
      } else if (error.message.includes('SECURE CONTEXT')) {
        errorMsg = '❌ Se requiere HTTPS para usar la cámara. Usa LocalTunnel o Ngrok.';
      }
      
      setCameraError(errorMsg);
      alert(errorMsg);
    }
  };

  // Detener scanner
  const stopScanner = async () => {
    try {
      if (html5QrcodeRef.current) {
        await html5QrcodeRef.current.stop();
        html5QrcodeRef.current = null;
        setScanning(false);
        console.log('⏹️ Scanner detenido');
      }
    } catch (error) {
      console.error('Error deteniendo scanner:', error);
    }
  };

  // Limpiar todos los datos
  const clearAllData = async () => {
    if (!confirm('¿Seguro que quieres borrar todos los datos?')) return;

    await stopScanner();
    
    setExcelData([]);
    setScannedCodes(new Set());
    setSessionId(null);
    setQrCodeUrl('');
    setIsHost(false);

    await localforage.clear();
    console.log('🗑️ Datos limpiados');
  };

  // Calcular progreso
  const progress = {
    total: excelData.length,
    escaneados: Array.from(scannedCodes).filter(code =>
      excelData.some(item => item.Código?.toString() === code)
    ).length,
    porcentaje: excelData.length > 0
      ? Math.round(
          (Array.from(scannedCodes).filter(code =>
            excelData.some(item => item.Código?.toString() === code)
          ).length / excelData.length) * 100
        )
      : 0
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-500 to-purple-600">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-xl font-bold">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 p-4">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-2xl p-6">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
            📦 Scan PWA
          </h1>
          <p className="text-sm text-gray-600">
            Escaneo offline con sincronización en tiempo real
          </p>
          
          {/* ✅ NUEVO: Mostrar advertencia de cámara */}
          {cameraError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800 font-medium">{cameraError}</p>
              {!window.isSecureContext && (
                <p className="text-xs text-red-600 mt-2">
                  💡 Solución: Usa LocalTunnel o Ngrok para obtener HTTPS
                </p>
              )}
            </div>
          )}
        </div>

        {/* Sección de escáner */}
        <div id="reader" className="mb-6 rounded-xl overflow-hidden shadow-lg"></div>

        {/* Selección de Modo */}
        {!sessionId && (
          <div className="mb-6 space-y-3">
            <button
              onClick={createSession}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold py-4 px-4 rounded-xl shadow-lg transition-all duration-200"
            >
              🖥️ Modo PC (Host)
            </button>
            <button
              onClick={() => {
                const sid = prompt('Ingresa el ID de sesión:');
                if (sid) joinSession({ sessionId: sid, serverUrl: 'https://scan-pwa.onrender.com' });
              }}
              className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 px-4 rounded-xl shadow-lg transition-all duration-200"
            >
              📱 Modo Móvil (Client)
            </button>
          </div>
        )}

        {/* Interfaz Principal */}
        {sessionId && (
          <>
            {/* QR de Conexión (Solo Host) */}
            {isHost && qrCodeUrl && (
              <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-100">
                <h3 className="font-semibold text-center mb-3 text-gray-800">
                  📱 Escanea para conectar dispositivos
                </h3>
                <div className="flex justify-center">
                  <img src={qrCodeUrl} alt="QR Conexión" className="w-48 h-48 rounded-lg shadow-md" />
                </div>
                <p className="text-xs text-center text-gray-600 mt-2">
                  Dispositivos conectados: <span className="font-bold text-blue-600">{connectedDevices}</span>
                </p>
              </div>
            )}

            {/* Cargar Excel (Solo Host) */}
            {isHost && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
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
                onClick={scanning ? stopScanner : startScanner}
                disabled={!!cameraError && !window.isSecureContext}
                className={`w-full ${
                  scanning 
                    ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700' 
                    : 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700'
                } ${
                  (cameraError && !window.isSecureContext) ? 'opacity-50 cursor-not-allowed' : ''
                } text-white font-bold py-4 px-4 rounded-xl shadow-lg transition-all duration-200 text-lg`}
              >
                {scanning ? (
                  <span className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    Escaneando... (Toca para detener)
                  </span>
                ) : (
                  <span className="flex items-center justify-center">
                    📷 {isHost ? 'Escanear QR Conexión' : 'Escanear Códigos'}
                  </span>
                )}
              </button>

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
                {/* ✅ NUEVO: Estado de cámara */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">📷 Cámara:</span>
                  <span className={`text-sm font-medium ${
                    cameraPermission === 'granted' ? 'text-green-600' : 
                    cameraPermission === 'denied' ? 'text-red-600' : 'text-gray-600'
                  }`}>
                    {cameraPermission === 'granted' ? '✅ OK' : 
                     cameraPermission === 'denied' ? '❌ Bloqueada' : '⏳ Pendiente'}
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

              {/* ✅ NUEVO: Diagnóstico rápido */}
              <div className="text-xs text-center text-gray-500">
                <details className="cursor-pointer">
                  <summary className="hover:text-gray-700">🔍 Info de diagnóstico</summary>
                  <div className="mt-2 text-left bg-gray-50 p-2 rounded">
                    <p>Protocol: {window.location.protocol}</p>
                    <p>Secure: {window.isSecureContext ? '✅' : '❌'}</p>
                    <p>MediaDevices: {navigator.mediaDevices ? '✅' : '❌'}</p>
                    <p>URL: {window.location.href}</p>
                  </div>
                </details>
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
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
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