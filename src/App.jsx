import { useState, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Html5Qrcode } from 'html5-qrcode';
import localforage from 'localforage';
import './App.css';

// Configurar IndexedDB
localforage.config({
  name: 'ScanPWA',
  storeName: 'session_data'
});

// URL de la API (CAMBIAR DESPUÉS DEL DEPLOY DEL WORKER)
const API_URL = 'https://scan-pwa-api.afdiazl.workers.dev';

function App() {
  // Estados principales
  const [mode, setMode] = useState(null); // 'upload' | 'join' | 'scan'
  const [sessionCode, setSessionCode] = useState(null);
  const [excelData, setExcelData] = useState([]);
  const [scannedCodes, setScannedCodes] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [notification, setNotification] = useState(null);
  const [lastScanned, setLastScanned] = useState(null);

  // Refs
  const html5QrcodeRef = useRef(null);

  // Cargar sesión guardada al iniciar
  useEffect(() => {
    loadSavedSession();
  }, []);

  const loadSavedSession = async () => {
    try {
      const savedCode = await localforage.getItem('sessionCode');
      const savedExcel = await localforage.getItem('excelData');
      const savedScans = await localforage.getItem('scannedCodes');

      if (savedCode && savedExcel) {
        setSessionCode(savedCode);
        setExcelData(savedExcel);
        setScannedCodes(savedScans || []);
        setMode('scan');
      }
    } catch (err) {
      console.error('Error cargando sesión:', err);
    } finally {
      setLoading(false);
    }
  };

  // Mostrar notificación
  const showNotification = (message, type) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // Sincronizar datos desde el servidor
  const syncFromServer = useCallback(async () => {
    if (!sessionCode || !autoSync) return;
    
    try {
      const response = await fetch(`${API_URL}/api/session/${sessionCode}`);
      if (response.ok) {
        const data = await response.json();
        if (data.scannedCodes) {
          setScannedCodes(data.scannedCodes);
          await localforage.setItem('scannedCodes', data.scannedCodes);
        }
      }
    } catch (err) {
      console.error('Error sincronizando desde servidor:', err);
    }
  }, [sessionCode, autoSync]);

  // Sincronización automática cada 3 segundos
  useEffect(() => {
    if (!sessionCode || !autoSync) return;
    
    const interval = setInterval(syncFromServer, 3000);
    
    return () => clearInterval(interval);
  }, [sessionCode, autoSync, syncFromServer]);

  // ========================================
  // FUNCIÓN 1: SUBIR EXCEL Y CREAR SESIÓN
  // ========================================
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setError('');

    try {
      // Leer archivo Excel
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        throw new Error('El archivo Excel está vacío');
      }

      console.log('📊 Excel parseado:', jsonData.length, 'productos');

      // Subir a la API
      const response = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excelData: jsonData }),
      });

      if (!response.ok) {
        throw new Error('Error al crear sesión');
      }

      const result = await response.json();

      // Guardar localmente
      setSessionCode(result.code);
      setExcelData(jsonData);
      await localforage.setItem('sessionCode', result.code);
      await localforage.setItem('excelData', jsonData);

      console.log('✅ Sesión creada:', result.code);
      setMode('upload-success');

    } catch (err) {
      console.error('❌ Error:', err);
      setError(err.message || 'Error al subir archivo');
    } finally {
      setLoading(false);
    }
  };

  // ========================================
  // FUNCIÓN 2: UNIRSE CON CÓDIGO
  // ========================================
  const joinSession = async (code) => {
    if (!code || code.length !== 6) {
      setError('Código debe tener 6 caracteres');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/session?code=${code.toUpperCase()}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Código inválido o expirado');
        }
        throw new Error('Error al conectar');
      }

      const result = await response.json();
      const session = result.session;

      // Guardar localmente
      setSessionCode(session.code);
      setExcelData(session.excelData);
      setScannedCodes(session.scannedCodes || []);
      await localforage.setItem('sessionCode', session.code);
      await localforage.setItem('excelData', session.excelData);
      await localforage.setItem('scannedCodes', session.scannedCodes);

      console.log('✅ Conectado a sesión:', session.code);
      setMode('scan');

    } catch (err) {
      console.error('❌ Error:', err);
      setError(err.message || 'Error al conectar');
    } finally {
      setLoading(false);
    }
  };

  // ========================================
  // FUNCIÓN 3: INICIAR ESCÁNER
  // ========================================
  const startScanner = async () => {
    try {
      setError('');

      // Verificar contexto seguro
      if (!window.isSecureContext) {
        throw new Error('Se requiere HTTPS para usar la cámara');
      }

      if (!navigator.mediaDevices) {
        throw new Error('Tu navegador no soporta acceso a cámara');
      }

      if (html5QrcodeRef.current) {
        console.log('⚠️ Scanner ya está activo');
        return;
      }

      const html5QrCode = new Html5Qrcode("reader");
      html5QrcodeRef.current = html5QrCode;

      const config = {
        fps: 30,
        qrbox: { width: 250, height: 125 },
        aspectRatio: 2.0,
      };

      console.log('📷 Iniciando scanner...');

      await html5QrCode.start(
        { facingMode: "environment" },
        config,
        async (decodedText) => {
          console.log('📷 Código detectado:', decodedText);

          // Vibración de feedback
          if ('vibrate' in navigator) {
            navigator.vibrate(200);
          }

          // Buscar información en el Excel
          const producto = excelData.find(item => item.Guía?.toString() === decodedText);

          if (producto) {
            // Contar cuántas veces se ha escaneado esta guía
            const vecesEscaneada = scannedCodes.filter(c => c === decodedText).length;
            
            // Si ya se escanearon todas las piezas, rechazar
            if (vecesEscaneada >= producto.Cantidad) {
              setLastScanned({
                cliente: producto.Cliente,
                guia: producto.Guía,
                piezas: `${producto.Cantidad}/${producto.Cantidad}`
              });
              showNotification(
                `⚠️ Ya completo: ${producto.Cliente} | ${producto.Guía} | ${producto.Cantidad}/${producto.Cantidad}`,
                'warning'
              );
              return;
            }
          }

          // Agregar a la lista (permitir duplicados para multi-piezas)
          const newScannedCodes = [...scannedCodes, decodedText];
          setScannedCodes(newScannedCodes);

          // Guardar localmente
          await localforage.setItem('scannedCodes', newScannedCodes);

          // Mostrar notificación con info del cliente
          if (producto) {
            const piezasEscaneadas = newScannedCodes.filter(c => c === decodedText).length;
            setLastScanned({
              cliente: producto.Cliente,
              guia: decodedText,
              piezas: `${piezasEscaneadas}/${producto.Cantidad}`
            });
            showNotification(
              `✅ ${producto.Cliente} | ${piezasEscaneadas}/${producto.Cantidad}`,
              'success'
            );
          } else {
            setLastScanned({
              cliente: 'Sobrante',
              guia: decodedText,
              piezas: '-'
            });
            showNotification(`❌ Sobrante: ${decodedText}`, 'error');
          }

          // Cerrar scanner automáticamente después de escanear
          stopScanner();

          // Sincronizar con servidor
          try {
            await fetch(`${API_URL}/api/scan`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code: sessionCode,
                scannedCode: decodedText,
              }),
            });
            console.log('✅ Sincronizado con servidor');
          } catch (err) {
            console.error('❌ Error sincronizando:', err);
          }
        },
        (errorMessage) => {
          // Ignorar errores de "no QR found"
          if (!errorMessage.includes('NotFoundException')) {
            console.debug('Scanner:', errorMessage);
          }
        }
      );

      setScanning(true);
      console.log('✅ Scanner activo');

    } catch (err) {
      console.error('❌ Error iniciando scanner:', err);
      setError(err.message || 'Error al iniciar cámara');
      showNotification(err.message || 'Error al iniciar cámara', 'error');
    }
  };

  // ========================================
  // FUNCIÓN 4: DETENER ESCÁNER
  // ========================================
  const stopScanner = async () => {
    try {
      if (html5QrcodeRef.current) {
        await html5QrcodeRef.current.stop();
        html5QrcodeRef.current = null;
        setScanning(false);
        console.log('⏹️ Scanner detenido');
      }
    } catch (err) {
      console.error('Error deteniendo scanner:', err);
    }
  };

  // ========================================
  // FUNCIÓN 5: GENERAR REPORTE CSV
  // ========================================
  const generateReport = () => {
    const scannedArray = [...new Set(scannedCodes)]; // Guías únicas

    // Productos registrados (coinciden con base de datos)
    const registradas = excelData.filter(item =>
      scannedArray.includes(item.Guía?.toString())
    );

    // Productos faltantes
    const faltantes = excelData.filter(item =>
      !scannedArray.includes(item.Guía?.toString())
    );

    // Códigos sobrantes (escaneados pero no en Excel)
    const sobrantes = scannedArray.filter(code =>
      !excelData.some(item => item.Guía?.toString() === code)
    );

    // Crear mensaje detallado
    let mensaje = '📊 REPORTE DE ESCANEO\n\n';
    mensaje += `✅ Completas: ${registradas.length}\n\n`;
    
    if (faltantes.length > 0) {
      mensaje += `⚠️ Faltantes: ${faltantes.length}\n`;
      faltantes.forEach(item => {
        mensaje += `  • ${item.Guía} - ${item.Cliente} - ${item.Cantidad} piezas\n`;
      });
      mensaje += '\n';
    }
    
    if (sobrantes.length > 0) {
      mensaje += `❌ Sobrantes: ${sobrantes.length}\n`;
      sobrantes.forEach(code => {
        mensaje += `  • ${code} (código desconocido)\n`;
      });
    }

    // Mostrar en notificación
    showNotification(
      `📊 Reporte: ✅ ${registradas.length} | ⚠️ ${faltantes.length} | ❌ ${sobrantes.length}`,
      'success'
    );

    // Mostrar en alert con detalles
    alert(mensaje);

    console.log('📊 REPORTE COMPLETO:');
    console.log(mensaje);
  };

  // ========================================
  // FUNCIÓN 6: LIMPIAR SESIÓN
  // ========================================
  const clearSession = async () => {
    if (!confirm('¿Seguro que quieres limpiar todo?')) return;

    await stopScanner();

    setMode(null);
    setSessionCode(null);
    setExcelData([]);
    setScannedCodes([]);
    setError('');

    await localforage.clear();
    console.log('🗑️ Sesión limpiada');
  };

  // Calcular progreso
  const progress = {
    total: excelData.length,
    escaneados: [...new Set(scannedCodes)].filter(code =>
      excelData.some(item => item.Guía?.toString() === code)
    ).length,
    porcentaje: excelData.length > 0
      ? Math.round(
          ([...new Set(scannedCodes)].filter(code =>
            excelData.some(item => item.Guía?.toString() === code)
          ).length / excelData.length) * 100
        )
      : 0,
  };

  // Loading inicial
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 p-4">
      {/* Notificación flotante */}
      {notification && (
        <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-6 py-4 rounded-xl shadow-2xl animate-pulse ${
          notification.type === 'success' ? 'bg-green-500' :
          notification.type === 'warning' ? 'bg-yellow-500' :
          'bg-red-500'
        } text-white font-bold text-center max-w-md`}>
          {notification.message}
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">📦 Scan PWA</h1>
          <p className="text-gray-600">Sistema de escaneo de códigos de barras</p>
        </div>

        {/* Contenedor de cámara */}
        {scanning && (
          <div className="mb-6">
            <div className="bg-black rounded-xl overflow-hidden shadow-2xl">
              <div id="reader" className="w-full"></div>
            </div>
          </div>
        )}

        {/* Contenido principal */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          {/* MODO: SELECCIÓN INICIAL */}
          {!mode && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-center mb-6 text-gray-800">
                Selecciona una opción
              </h2>

              <button
                onClick={() => setMode('upload')}
                className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold py-4 px-4 rounded-xl shadow-lg transition-all duration-200 text-lg"
              >
                💻 Cargar Excel (PC)
              </button>

              <button
                onClick={() => setMode('join')}
                className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 px-4 rounded-xl shadow-lg transition-all duration-200 text-lg"
              >
                📱 Escanear (Móvil)
              </button>
            </div>
          )}

          {/* MODO: CARGAR EXCEL */}
          {mode === 'upload' && !sessionCode && (
            <div>
              <button
                onClick={() => setMode(null)}
                className="mb-4 text-gray-600 hover:text-gray-800"
              >
                ← Volver
              </button>

              <div className="text-center">
                <h3 className="text-xl font-semibold mb-4 text-gray-800">
                  Sube el archivo Excel
                </h3>

                <div className="mb-4 p-4 bg-blue-50 rounded-lg text-left text-sm">
                  <p className="font-medium text-gray-700 mb-2">📋 Formato requerido:</p>
                  <ul className="list-disc list-inside text-gray-600 space-y-1">
                    <li>Columna 1: <strong>Cantidad</strong></li>
                    <li>Columna 2: <strong>Guía</strong></li>
                    <li>Columna 3: <strong>Cliente</strong></li>
                  </ul>
                </div>

                {error && (
                  <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-700 text-sm">
                    ❌ {error}
                  </div>
                )}

                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileUpload}
                  disabled={loading}
                  className="block w-full text-sm text-gray-600 file:mr-4 file:py-3 file:px-6 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                />
              </div>

              {loading && (
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="text-sm text-gray-600 mt-2">Procesando archivo...</p>
                </div>
              )}
            </div>
          )}

          {/* MOSTRAR CÓDIGO GENERADO */}
          {mode === 'upload-success' && sessionCode && (
            <div className="text-center p-8 bg-gradient-to-r from-blue-50 to-green-50 rounded-xl border border-blue-100">
              <h2 className="text-2xl font-bold mb-4 text-gray-800">✅ Sesión Creada</h2>
              
              <div className="bg-white p-6 rounded-lg shadow-md mb-4">
                <p className="text-sm text-gray-600 mb-2">Código de sesión:</p>
                <div className="text-6xl font-bold text-blue-600 mb-2 tracking-wider">
                  {sessionCode}
                </div>
                <p className="text-xs text-gray-500">
                  (Válido por 24 horas)
                </p>
              </div>

              <p className="text-sm text-gray-700 mb-4">
                📱 Ingresa este código en el móvil para escanear
              </p>

              <p className="text-xs text-gray-600 mb-4">
                📦 {excelData.length} productos cargados
              </p>

              <button
                onClick={() => setMode('scan')}
                className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-3 px-4 rounded-lg shadow transition-all duration-200"
              >
                Continuar al Escáner
              </button>
            </div>
          )}

          {/* MODO: INGRESAR CÓDIGO */}
          {mode === 'join' && !sessionCode && (
            <div>
              <button
                onClick={() => setMode(null)}
                className="mb-4 text-gray-600 hover:text-gray-800"
              >
                ← Volver
              </button>

              <div className="text-center">
                <h3 className="text-xl font-semibold mb-4 text-gray-800">
                  Ingresa el código de sesión
                </h3>

                <input
                  type="text"
                  placeholder="ABC123"
                  maxLength={6}
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                  className="w-full text-4xl text-center uppercase font-bold p-4 border-2 border-gray-300 rounded-lg mb-4 tracking-widest"
                />

                <button
                  onClick={() => joinSession(inputCode)}
                  disabled={loading || inputCode.length !== 6}
                  className="w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 px-4 rounded-xl shadow-lg transition-all duration-200"
                >
                  {loading ? 'Conectando...' : 'Conectar'}
                </button>
              </div>
            </div>
          )}

          {/* MODO: ESCANEAR */}
          {mode === 'scan' && sessionCode && (
            <>
              {/* Info de sesión */}
              <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                <p className="text-sm text-gray-700">
                  <span className="font-semibold">Sesión:</span> {sessionCode}
                </p>
              </div>

              {/* Progreso */}
              {excelData.length > 0 && (
                <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-xl border border-blue-100">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-semibold text-gray-800">📈 Progreso</h3>
                    <span className="text-sm font-bold text-blue-600">
                      {progress.porcentaje}%
                    </span>
                  </div>

                  <div className="w-full bg-gray-200 rounded-full h-3 mb-3">
                    <div
                      className="bg-gradient-to-r from-green-400 to-green-600 h-3 rounded-full transition-all duration-500"
                      style={{ width: `${progress.porcentaje}%` }}
                    ></div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="text-center p-2 bg-green-100 rounded-lg">
                      <div className="font-bold text-green-700">{progress.escaneados}</div>
                      <div className="text-green-600">✅ Escaneados</div>
                    </div>
                    <div className="text-center p-2 bg-orange-100 rounded-lg">
                      <div className="font-bold text-orange-700">{progress.total - progress.escaneados}</div>
                      <div className="text-orange-600">⏳ Pendientes</div>
                    </div>
                    <div className="text-center p-2 bg-blue-100 rounded-lg">
                      <div className="font-bold text-blue-700">{progress.total}</div>
                      <div className="text-blue-600">📦 Total</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Botón de escáner */}
              <div className="mb-6">
                <button
                  onClick={scanning ? stopScanner : startScanner}
                  className={`w-full ${
                    scanning
                      ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700'
                      : 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700'
                  } text-white font-bold py-4 px-4 rounded-xl shadow-lg transition-all duration-200 text-lg`}
                >
                  {scanning ? (
                    <span className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                      Escaneando... (Toca para detener)
                    </span>
                  ) : (
                    <span className="flex items-center justify-center">
                      {scannedCodes.length > 0 ? '📷 Escanear Otro' : '📷 Escanear Códigos'}
                    </span>
                  )}
                </button>
                {/* Contenedor de la cámara */}
                <div id="reader" className="w-full mt-4 rounded-lg overflow-hidden"></div>

                {lastScanned && (
                  <div className="mt-4 p-4 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border-2 border-green-200">
                    <p className="text-sm font-semibold text-gray-700 mb-1">📦 Última guía escaneada:</p>
                    <p className="text-lg font-bold text-green-700">{lastScanned.cliente}</p>
                    <p className="text-sm text-gray-600">Guía: {lastScanned.guia}</p>
                    <p className="text-sm text-gray-600">Piezas: {lastScanned.piezas}</p>
                  </div>
                )}
              </div>

              {/* Botones de acción */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  onClick={generateReport}
                  disabled={excelData.length === 0}
                  className="bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-3 px-4 rounded-lg shadow transition-all duration-200 text-sm"
                >
                  📄 Reporte
                </button>

                <button
                  onClick={clearSession}
                  className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold py-3 px-4 rounded-lg shadow transition-all duration-200 text-sm"
                >
                  🗑️ Limpiar
                </button>
              </div>

              {/* Info del sistema */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">💾 Almacenamiento:</span>
                  <span className="font-medium text-green-600">Offline OK</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">📊 Productos:</span>
                  <span className="font-medium">{excelData.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">📷 Escaneos:</span>
                  <span className="font-medium">{scannedCodes.length}</span>
                </div>
              </div>

              {/* Estado de conexión */}
              <div className={`mt-4 p-3 rounded-lg text-center text-sm font-medium ${
                navigator.onLine
                  ? 'bg-green-100 text-green-800'
                  : 'bg-orange-100 text-orange-800'
              }`}>
                {navigator.onLine ? '🟢 Online' : '🟡 Offline'}
              </div>

              {/* Diagnóstico */}
              <details className="mt-4 cursor-pointer">
                <summary className="text-xs text-center text-gray-500 hover:text-gray-700">
                  🔍 Info de diagnóstico
                </summary>
                <div className="mt-2 text-xs bg-gray-50 p-3 rounded text-left">
                  <p><strong>Protocol:</strong> {window.location.protocol}</p>
                  <p><strong>Secure:</strong> {window.isSecureContext ? '✅' : '❌'}</p>
                  <p><strong>MediaDevices:</strong> {navigator.mediaDevices ? '✅' : '❌'}</p>
                  <p><strong>URL:</strong> {window.location.href}</p>
                </div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;