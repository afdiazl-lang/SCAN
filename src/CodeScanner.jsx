import React, { useEffect, useRef, useState } from 'react';

const CodeScanner = () => {
    const videoRef = useRef(null);
    const [cameraStatus, setCameraStatus] = useState('checking'); // checking, success, error
    const [errorMessage, setErrorMessage] = useState('');
    const [stream, setStream] = useState(null);

    // Diagnóstico completo de la cámara
    const diagnoseCamera = async () => {
        console.log('🔍 Iniciando diagnóstico de cámara...');
        
        const results = {
            navigator: typeof navigator !== 'undefined',
            mediaDevices: typeof navigator.mediaDevices !== 'undefined',
            getUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
            https: window.location.protocol === 'https:',
            localhost: window.location.hostname === 'localhost',
            localNetwork: /^(192\.168|10\.|172\.|127\.)/.test(window.location.hostname),
            url: window.location.href
        };
        
        console.log('📊 Resultados del diagnóstico:', results);
        
        // Verificar soporte básico
        if (!results.navigator) {
            throw new Error('Objeto navigator no disponible');
        }
        
        if (!results.mediaDevices) {
            throw new Error('navigator.mediaDevices no existe');
        }
        
        if (!results.getUserMedia) {
            throw new Error('getUserMedia no soportado');
        }
        
        // Advertencia para HTTP
        if (!results.https && !results.localhost) {
            console.warn('⚠️ La cámara requiere HTTPS en redes locales');
            console.log('💡 Solución: Usa https:// o chrome://flags/');
        }
        
        return results;
    };

    // Inicializar cámara
    const initializeCamera = async () => {
        try {
            setCameraStatus('checking');
            setErrorMessage('');
            
            // Paso 1: Diagnóstico
            const diagnosis = await diagnoseCamera();
            console.log('✅ Diagnóstico exitoso:', diagnosis);
            
            // Paso 2: Solicitar permisos de cámara
            console.log('🎥 Solicitando acceso a la cámara...');
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment', // Cámara trasera
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            
            console.log('✅ Cámara accedida correctamente');
            setStream(mediaStream);
            setCameraStatus('success');
            
            // Paso 3: Conectar stream al video
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
                videoRef.current.play();
            }
            
        } catch (error) {
            console.error('❌ Error en cámara:', error);
            setCameraStatus('error');
            
            // Mensajes de error específicos
            if (error.name === 'NotAllowedError') {
                setErrorMessage('Permiso de cámara denegado. Por favor permite el acceso a la cámara en la configuración de tu navegador.');
            } else if (error.name === 'NotFoundError') {
                setErrorMessage('No se encontró ninguna cámara disponible.');
            } else if (error.name === 'NotSupportedError') {
                setErrorMessage('Tu navegador no soporta la función de cámara.');
            } else if (error.name === 'NotReadableError') {
                setErrorMessage('La cámara está siendo usada por otra aplicación.');
            } else {
                setErrorMessage(`Error: ${error.message}`);
            }
        }
    };

    // Detener cámara
    const stopCamera = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
        setCameraStatus('checking');
    };

    // Efecto al montar el componente
    useEffect(() => {
        initializeCamera();
        
        // Limpiar al desmontar
        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    // Reiniciar cámara
    const retryCamera = () => {
        stopCamera();
        setTimeout(() => initializeCamera(), 500);
    };

    return (
        <div style={styles.container}>
            <h1>🔍 Escáner de Códigos</h1>
            
            {/* Estado: Verificando */}
            {cameraStatus === 'checking' && (
                <div style={styles.message}>
                    <div style={styles.spinner}></div>
                    <p>Verificando cámara...</p>
                </div>
            )}
            
            {/* Estado: Error */}
            {cameraStatus === 'error' && (
                <div style={styles.error}>
                    <h3>❌ Error de Cámara</h3>
                    <p>{errorMessage}</p>
                    
                    <div style={styles.solutions}>
                        <h4>Soluciones:</h4>
                        <ul>
                            <li>✅ Asegúrate de permitir el acceso a la cámara</li>
                            <li>✅ Verifica que ninguna otra app use la cámara</li>
                            <li>✅ Si estás en HTTP, intenta en HTTPS</li>
                            <li>✅ Reinicia el navegador</li>
                        </ul>
                    </div>
                    
                    <button onClick={retryCamera} style={styles.retryButton}>
                        🔄 Reintentar
                    </button>
                </div>
            )}
            
            {/* Estado: Éxito */}
            {cameraStatus === 'success' && (
                <div style={styles.cameraContainer}>
                    <video 
                        ref={videoRef}
                        style={styles.video}
                        playsInline
                        muted
                    />
                    <div style={styles.scannerOverlay}>
                        <div style={styles.scannerFrame}></div>
                        <p>Apunta el código hacia el marco</p>
                    </div>
                    
                    <div style={styles.controls}>
                        <button onClick={stopCamera} style={styles.stopButton}>
                            ⏹️ Detener Cámara
                        </button>
                    </div>
                </div>
            )}
            
            {/* Información de diagnóstico */}
            <div style={styles.info}>
                <p><strong>URL:</strong> {window.location.href}</p>
                <p><strong>Navegador:</strong> {navigator.userAgent}</p>
                <p><strong>HTTPS:</strong> {window.location.protocol === 'https:' ? '✅ Sí' : '❌ No'}</p>
            </div>
        </div>
    );
};

// Estilos
const styles = {
    container: {
        padding: '20px',
        maxWidth: '500px',
        margin: '0 auto',
        fontFamily: 'Arial, sans-serif'
    },
    message: {
        textAlign: 'center',
        padding: '40px'
    },
    spinner: {
        border: '4px solid #f3f3f3',
        borderTop: '4px solid #3498db',
        borderRadius: '50%',
        width: '40px',
        height: '40px',
        animation: 'spin 2s linear infinite',
        margin: '0 auto 20px'
    },
    error: {
        background: '#ffeaea',
        padding: '20px',
        borderRadius: '8px',
        textAlign: 'center'
    },
    solutions: {
        textAlign: 'left',
        margin: '20px 0'
    },
    retryButton: {
        background: '#3498db',
        color: 'white',
        border: 'none',
        padding: '10px 20px',
        borderRadius: '5px',
        cursor: 'pointer',
        fontSize: '16px'
    },
    cameraContainer: {
        position: 'relative',
        margin: '20px 0'
    },
    video: {
        width: '100%',
        height: '300px',
        backgroundColor: '#000',
        borderRadius: '8px'
    },
    scannerOverlay: {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        color: 'white'
    },
    scannerFrame: {
        width: '200px',
        height: '200px',
        border: '2px solid #00ff00',
        borderRadius: '8px',
        marginBottom: '10px'
    },
    controls: {
        textAlign: 'center',
        marginTop: '10px'
    },
    stopButton: {
        background: '#e74c3c',
        color: 'white',
        border: 'none',
        padding: '10px 20px',
        borderRadius: '5px',
        cursor: 'pointer'
    },
    info: {
        background: '#f5f5f5',
        padding: '15px',
        borderRadius: '8px',
        fontSize: '12px',
        marginTop: '20px'
    }
};

// Agregar animación CSS
const styleSheet = document.styleSheets[0];
styleSheet.insertRule(`
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`, styleSheet.cssRules.length);

export default CodeScanner;
