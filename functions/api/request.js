export async function onRequestPost({ request, env }) {
  try {
    // Security: Verify same-origin
    const origin = request.headers.get('Origin');
    const host = request.headers.get('Host');
    
    if (origin && !origin.includes(host)) {
      return new Response(JSON.stringify({ error: 'Unauthorized origin' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { url, method, headers, body, followRedirects, timeout } = await request.json();
    
    const startTime = Date.now();
    const timings = {};
    const redirectChain = [];
    let certInfo = null;

    // Build fetch options
    const fetchOptions = {
      method,
      headers: headers || {},
      redirect: followRedirects ? 'follow' : 'manual',
      signal: AbortSignal.timeout(timeout || 30000),
      // Request certificate info from Cloudflare
      cf: {
        cacheTtl: 0,
        cacheEverything: false
      }
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = body;
    }

    // Make the request
    let response = await fetch(url, fetchOptions);
    
    // Try to get TLS/Certificate info from Cloudflare's cf object
    if (response.cf) {
      certInfo = {
        tlsVersion: response.cf.tlsVersion || 'Unknown',
        tlsCipher: response.cf.tlsCipher || 'Unknown',
        country: response.cf.country || 'Unknown',
        colo: response.cf.colo || 'Unknown',
        asn: response.cf.asn || 'Unknown',
        httpProtocol: response.cf.httpProtocol || 'Unknown'
      };
    }
    
    // For HTTPS URLs, try to extract cert details from the hostname
    if (url.startsWith('https://')) {
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;
        
        // Make a separate request to get cert info
        const certCheckResponse = await fetch(url, {
          method: 'HEAD',
          cf: { cacheTtl: 0 }
        });
        
        if (certCheckResponse.cf) {
          certInfo = {
            ...certInfo,
            hostname: hostname,
            tlsVersion: certCheckResponse.cf.tlsVersion,
            tlsCipher: certCheckResponse.cf.tlsCipher,
            tlsClientAuth: certCheckResponse.cf.tlsClientAuth || null,
            // Note: Full certificate chain not available in Workers
            // but we can provide what Cloudflare exposes
          };
        }
      } catch (certError) {
        console.error('Could not fetch cert info:', certError);
      }
    }
    
    // Track redirects if manual
    if (!followRedirects && [301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      if (location) {
        redirectChain.push({
          status: response.status,
          location
        });
      }
    }

    timings.total = Date.now() - startTime;

    // Get response body
    const responseBody = await response.text();
    
    // Parse cookies from Set-Cookie headers
    const cookies = [];
    const setCookieHeaders = response.headers.get('set-cookie');
    if (setCookieHeaders) {
      // Note: In Workers, set-cookie may be a single string or need special handling
      const cookieStrings = setCookieHeaders.split(',').map(s => s.trim());
      
      cookieStrings.forEach(cookieStr => {
        const parts = cookieStr.split(';').map(p => p.trim());
        const [nameValue, ...attributes] = parts;
        const [name, value] = nameValue.split('=');
        
        const cookie = { name, value };
        
        attributes.forEach(attr => {
          const [key, val] = attr.split('=');
          const lowerKey = key.toLowerCase();
          
          if (lowerKey === 'domain') cookie.domain = val;
          else if (lowerKey === 'path') cookie.path = val;
          else if (lowerKey === 'expires') cookie.expires = val;
          else if (lowerKey === 'max-age') cookie.maxAge = val;
          else if (lowerKey === 'httponly') cookie.httpOnly = true;
          else if (lowerKey === 'secure') cookie.secure = true;
          else if (lowerKey === 'samesite') cookie.sameSite = val;
        });
        
        cookies.push(cookie);
      });
    }
    
    // Collect response data
    const result = {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBody,
      timing: timings,
      redirectChain: redirectChain.length > 0 ? redirectChain : undefined,
      certificate: certInfo,
      cookies: cookies.length > 0 ? cookies : undefined,
      request: {
        url,
        method,
        headers: headers || {}
      }
    };

    return new Response(JSON.stringify(result), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || '*'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error.message || 'Request failed'
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json'
      }
    });
  }
}

export async function onRequestOptions({ request }) {
  const origin = request.headers.get('Origin');
  
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
