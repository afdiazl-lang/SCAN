/**
 * Cloudflare Worker API para Scan PWA
 * Maneja sesiones, carga de Excel y sincronización de escaneos
 */

// Configuración CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Función helper para respuestas JSON
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

// Generar código único de 6 caracteres
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Sin caracteres confusos (I, O, 0, 1)
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Manejar OPTIONS para CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ========================================
    // RUTA 1: SUBIR EXCEL Y CREAR SESIÓN
    // ========================================
    if (url.pathname === '/api/upload' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { excelData } = body;
        
        if (!excelData || !Array.isArray(excelData)) {
          return jsonResponse({ error: 'Excel data is required' }, 400);
        }
        
        // Generar código único
        let code = generateCode();
        
        // Verificar que el código no exista (muy raro, pero por seguridad)
        let exists = await env.SESSIONS.get(code);
        while (exists) {
          code = generateCode();
          exists = await env.SESSIONS.get(code);
        }
        
        // Crear sesión
        const session = {
          code,
          excelData,
          scannedCodes: [],
          createdAt: Date.now(),
          expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 horas
        };
        
        // Guardar en KV (expira automáticamente en 24h)
        await env.SESSIONS.put(code, JSON.stringify(session), {
          expirationTtl: 86400, // 24 horas en segundos
        });
        
        console.log(`✅ Sesión creada: ${code}`);
        
        return jsonResponse({
          success: true,
          code,
          expiresAt: session.expiresAt,
          itemCount: excelData.length,
        });
        
      } catch (error) {
        console.error('❌ Error en /api/upload:', error);
        return jsonResponse({ error: 'Error creating session' }, 500);
      }
    }

    // ========================================
    // RUTA 2: OBTENER SESIÓN POR CÓDIGO
    // ========================================
    if (url.pathname === '/api/session' && request.method === 'GET') {
      try {
        const code = url.searchParams.get('code');
        
        if (!code) {
          return jsonResponse({ error: 'Code parameter is required' }, 400);
        }
        
        // Buscar sesión
        const sessionData = await env.SESSIONS.get(code);
        
        if (!sessionData) {
          return jsonResponse({ error: 'Session not found or expired' }, 404);
        }
        
        const session = JSON.parse(sessionData);
        
        console.log(`✅ Sesión recuperada: ${code}`);
        
        return jsonResponse({
          success: true,
          session: {
            code: session.code,
            excelData: session.excelData,
            scannedCodes: session.scannedCodes,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
          },
        });
        
      } catch (error) {
        console.error('❌ Error en /api/session:', error);
        return jsonResponse({ error: 'Error retrieving session' }, 500);
      }
    }

    // ========================================
    // RUTA 3: SINCRONIZAR ESCANEO
    // ========================================
    if (url.pathname === '/api/scan' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { code, scannedCode } = body;
        
        if (!code || !scannedCode) {
          return jsonResponse({ error: 'Code and scannedCode are required' }, 400);
        }
        
        // Obtener sesión actual
        const sessionData = await env.SESSIONS.get(code);
        
        if (!sessionData) {
          return jsonResponse({ error: 'Session not found or expired' }, 404);
        }
        
        const session = JSON.parse(sessionData);
        
        // Verificar si ya existe
        const isDuplicate = session.scannedCodes.includes(scannedCode);
        
        // Agregar código si no existe
        if (!isDuplicate) {
          session.scannedCodes.push(scannedCode);
          
          // Guardar actualización (mantener el mismo TTL)
          await env.SESSIONS.put(code, JSON.stringify(session), {
            expirationTtl: 86400,
          });
          
          console.log(`✅ Código escaneado: ${scannedCode} en sesión ${code}`);
        } else {
          console.log(`⚠️ Código duplicado: ${scannedCode} en sesión ${code}`);
        }
        
        return jsonResponse({
          success: true,
          isDuplicate,
          totalScanned: session.scannedCodes.length,
        });
        
      } catch (error) {
        console.error('❌ Error en /api/scan:', error);
        return jsonResponse({ error: 'Error syncing scan' }, 500);
      }
    }

    // ========================================
    // RUTA 4: OBTENER ESTADÍSTICAS
    // ========================================
    if (url.pathname === '/api/stats' && request.method === 'GET') {
      try {
        const code = url.searchParams.get('code');
        
        if (!code) {
          return jsonResponse({ error: 'Code parameter is required' }, 400);
        }
        
        const sessionData = await env.SESSIONS.get(code);
        
        if (!sessionData) {
          return jsonResponse({ error: 'Session not found or expired' }, 404);
        }
        
        const session = JSON.parse(sessionData);
        
        const stats = {
          total: session.excelData.length,
          scanned: session.scannedCodes.length,
          pending: session.excelData.length - session.scannedCodes.length,
          percentage: session.excelData.length > 0 
            ? Math.round((session.scannedCodes.length / session.excelData.length) * 100)
            : 0,
        };
        
        return jsonResponse({
          success: true,
          stats,
        });
        
      } catch (error) {
        console.error('❌ Error en /api/stats:', error);
        return jsonResponse({ error: 'Error retrieving stats' }, 500);
      }
    }

    // ========================================
    // RUTA 5: HEALTH CHECK
    // ========================================
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return jsonResponse({
        status: 'ok',
        timestamp: Date.now(),
        version: '1.0.0',
      });
    }

    // Ruta no encontrada
    return jsonResponse({ error: 'Route not found' }, 404);
  },
};