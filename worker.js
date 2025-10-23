export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Manejar preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Base de datos en memoria (KV se puede agregar después)
    const sessions = new Map();

    // SUBIR EXCEL Y CREAR SESIÓN
    if (path === '/api/upload' && request.method === 'POST') {
      const { excelData } = await request.json();
      const code = Math.random().toString(36).substr(2, 6).toUpperCase();
      
      sessions.set(code, {
        code,
        excelData,
        scannedCodes: [],
        createdAt: Date.now()
      });

      return new Response(JSON.stringify({ code }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // OBTENER SESIÓN
    if (path.startsWith('/api/session') && request.method === 'GET') {
      const code = url.searchParams.get('code');
      const session = sessions.get(code);

      if (!session) {
        return new Response(JSON.stringify({ error: 'Sesión no encontrada' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ session }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ESCANEAR CÓDIGO
    if (path === '/api/scan' && request.method === 'POST') {
      const { sessionCode, scannedCode } = await request.json();
      const session = sessions.get(sessionCode);

      if (!session) {
        return new Response(JSON.stringify({ error: 'Sesión no encontrada' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      session.scannedCodes.push(scannedCode);
      sessions.set(sessionCode, session);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};