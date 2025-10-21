import { Html5QrcodeScanner } from 'html5-qrcode';
import { useEffect, useState } from 'react';

const QRScanner = () => {
  const [scanResult, setScanResult] = useState(null);
  const [cameraError, setCameraError] = useState(null);

  useEffect(() => {
    const scanner = new Html5QrcodeScanner('reader', {
      qrbox: {
        width: 250,
        height: 250,
      },
      fps: 5,
      supportedScanTypes: [
        Html5QrcodeScanType.SCAN_TYPE_QR_CODE,
        Html5QrcodeScanType.SCAN_TYPE_CODE_128,
        Html5QrcodeScanType.SCAN_TYPE_CODE_39
      ]
    }, false);

    const success = (result) => {
      console.log('✅ Código escaneado:', result);
      setScanResult(result);
      scanner.clear();
    };

    const error = (err) => {
      console.error('❌ Error escaneando:', err);
      setCameraError(err.message || 'Error accediendo a la cámara');
    };

    scanner.render(success, error);

    // Limpiar al desmontar
    return () => {
      scanner.clear();
    };
  }, []);

  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h2>Escáner de Códigos QR</h2>
      
      {cameraError && (
        <div style={{ color: 'red', margin: '10px 0' }}>
          Error: {cameraError}
        </div>
      )}

      <div id="reader" style={{ 
        width: '100%', 
        maxWidth: '500px', 
        margin: '0 auto' 
      }}></div>

      {scanResult && (
        <div style={{ 
          marginTop: '20px', 
          padding: '15px', 
          backgroundColor: '#e8f5e8',
          borderRadius: '8px'
        }}>
          <h3>✅ Escaneo exitoso:</h3>
          <p>{scanResult}</p>
          <button 
            onClick={() => setScanResult(null)}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Escanear otro código
          </button>
        </div>
      )}
    </div>
  );
};

export default QRScanner;