/**
 * Web Request Inspector — Cloudflare Pages Function
 * insecure.co.nz
 *
 * Security hardening per OWASP guidelines:
 *   https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
 *   https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
 *
 * Deployment note (self-hosting): If running behind your own infrastructure instead of
 * Cloudflare Workers, consider adding RFC-1918 / loopback IP blocklisting to prevent
 * SSRF against internal hosts. Cloudflare Workers' network isolation mitigates most of
 * this risk on the managed platform, so it is not enforced here by default.
 *
 * Discord abuse monitoring:
 *   Set DISCORD_WEBHOOK in Cloudflare Pages → Settings → Environment Variables.
 *   The webhook URL is NEVER exposed to the browser or page source.
 *   Notifications fire via ctx.waitUntil() after the response is sent — zero
 *   latency impact on the end user.
 *
 *   What is logged:    client IP, target URL, method, status, size, duration,
 *                      user-agent, custom header KEYS (never values), errors.
 *   What is NOT logged: header values, request body, response body content.
 */

// ─── Configuration ────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS    = ['https://web.insecure.co.nz'];
const ALLOWED_METHODS    = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;   // 10 MB
const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_TIMEOUT_MS     = 30_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary':                         'Origin'
  };
}

function sanitiseError(err) {
  const msg = (err?.message || '').toLowerCase();
  if (err?.name === 'AbortError' || msg.includes('timeout') || msg.includes('aborted'))
    return 'Request timed out. Try increasing the timeout or check the target URL.';
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('fetch failed'))
    return 'Could not connect to the target URL. Check the address and try again.';
  if (msg.includes('invalid url'))
    return 'The target URL is invalid.';
  if (msg.includes('too large') || msg.includes('exceeded'))
    return 'Response body exceeded the 10 MB limit.';
  return 'Request failed. Verify the URL is reachable and try again.';
}

function validateOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

function validateUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol))
      return { ok: false, reason: 'Only HTTP and HTTPS protocols are supported.' };
    return { ok: true, parsed };
  } catch {
    return { ok: false, reason: 'Invalid URL — could not be parsed.' };
  }
}

function parseCookies(response) {
  const cookies = [];
  let cookieHeaders = [];
  try { cookieHeaders = response.headers.getAll('Set-Cookie'); }
  catch { const raw = response.headers.get('Set-Cookie'); if (raw) cookieHeaders = [raw]; }

  for (const cookieStr of cookieHeaders) {
    const [nameValue, ...attrs] = cookieStr.split(';').map(p => p.trim());
    const eqIdx = nameValue.indexOf('=');
    if (eqIdx === -1) continue;
    const cookie = { name: nameValue.slice(0, eqIdx).trim(), value: nameValue.slice(eqIdx + 1).trim() };
    for (const attr of attrs) {
      const eqPos = attr.indexOf('=');
      const key   = (eqPos === -1 ? attr : attr.slice(0, eqPos)).toLowerCase().trim();
      const val   = eqPos === -1 ? null : attr.slice(eqPos + 1).trim();
      switch (key) {
        case 'domain':   cookie.domain   = val;  break;
        case 'path':     cookie.path     = val;  break;
        case 'expires':  cookie.expires  = val;  break;
        case 'max-age':  cookie.maxAge   = val;  break;
        case 'samesite': cookie.sameSite = val;  break;
        case 'httponly': cookie.httpOnly = true; break;
        case 'secure':   cookie.secure   = true; break;
      }
    }
    cookies.push(cookie);
  }
  return cookies;
}

async function getCertInfo(hostname) {
  try {
    const res = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(hostname)}&output=json`,
      { method: 'GET', signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return { hostname, source: 'crt.sh', error: `crt.sh returned HTTP ${res.status}.` };
    const certs = await res.json();
    if (!Array.isArray(certs) || certs.length === 0) return {
      hostname, source: 'crt.sh', found: false,
      note: 'No entries in Certificate Transparency logs. This may indicate a self-signed certificate, a private CA, or a brand-new certificate that has not yet propagated to CT logs.'
    };
    const latest    = certs.sort((a, b) => new Date(b.not_before) - new Date(a.not_before))[0];
    const notAfter  = new Date(latest.not_after);
    const now       = new Date();
    const isExpired = notAfter < now;
    const sans      = latest.name_value
      ? [...new Set(latest.name_value.split(/\n/).map(s => s.trim()).filter(Boolean))]
      : [];
    return {
      hostname, source: 'Certificate Transparency (crt.sh)', found: true,
      issuer: latest.issuer_name || 'Unknown', commonName: latest.common_name || hostname,
      notBefore: latest.not_before, notAfter: latest.not_after, isExpired,
      daysUntilExpiry: isExpired ? 0 : Math.floor((notAfter - now) / 86_400_000),
      sans, crtShId: latest.id
    };
  } catch {
    return { hostname, source: 'crt.sh', found: false, error: 'Could not reach crt.sh to retrieve certificate information.' };
  }
}

// ─── Discord Abuse Monitoring ─────────────────────────────────────────────────

/**
 * Non-blocking Discord notification for abuse monitoring.
 *
 * Fired via ctx.waitUntil() — executes after the response is already sent
 * to the browser, so it has zero impact on end-user latency.
 *
 * NEVER logs: header values, auth tokens, request body, response body.
 * ALWAYS logs: client IP, target URL, method, status, size, duration,
 *              user-agent string, custom header key names only.
 *
 * Blocked/probe attempts are also reported so you can see if someone is
 * trying to call the API from an unauthorised origin.
 */
async function notifyDiscord(webhookUrl, {
  clientIP, targetUrl, method, status, statusText,
  bodySize, duration, userAgent, headerKeys, error, isBlocked, timestamp
}) {
  if (!webhookUrl || webhookUrl.includes('YOUR_WEBHOOK')) return;

  const isError   = !!error;
  const isSuccess = !isError && status >= 200 && status < 300;
  // Red for errors/blocks, green for success, orange for 4xx/5xx from target
  const colour    = isBlocked ? 0x992D22
    : isError     ? 0xE74C3C
    : isSuccess   ? 0x2ECC71
    : 0xF39C12;

  const displayUrl = (targetUrl || 'Unknown').length > 512
    ? targetUrl.slice(0, 509) + '…'
    : (targetUrl || 'Unknown');

  const sizeStr = bodySize != null
    ? (bodySize < 1024 ? `${bodySize} B` : `${(bodySize / 1024).toFixed(1)} KB`)
    : 'N/A';

  const fields = [
    { name: '🌐 Target URL',      value: `\`${displayUrl}\``,                                  inline: false },
    { name: '📡 Method',          value: method || '—',                                         inline: true  },
    { name: '📊 Status',          value: isBlocked ? '🚫 Blocked' : error ? `⚠️ Error` : `${status} ${statusText || ''}`, inline: true },
    { name: '⏱ Duration',         value: duration != null ? `${duration}ms` : '—',             inline: true  },
    { name: '📦 Response Size',   value: sizeStr,                                              inline: true  },
    { name: '🔌 Client IP',       value: `\`${clientIP || 'Unknown'}\``,                      inline: true  },
    { name: '🕐 Timestamp (UTC)', value: timestamp || new Date().toISOString(),                inline: true  },
    { name: '🖥 User-Agent',      value: userAgent ? `\`${String(userAgent).slice(0, 200)}\`` : 'None', inline: false }
  ];

  if (headerKeys?.length) {
    fields.push({ name: '📋 Custom Header Keys', value: headerKeys.join(', '), inline: false });
  }

  if (error) {
    fields.push({ name: '⚠️ Error', value: `\`${error}\``, inline: false });
  }

  const title = isBlocked
    ? '🚨 Web Inspector — Blocked Request (bad origin)'
    : `🔍 Web Inspector — ${method || 'Unknown'} ${isError ? '(failed)' : ''}`;

  try {
    await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        embeds: [{
          title,
          color:     colour,
          fields,
          footer:    { text: 'web.insecure.co.nz · abuse monitor' },
          timestamp: new Date().toISOString()
        }]
      }),
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    // Discord failure must never affect the user-facing response.
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function onRequestPost({ request, env, ctx }) {
  const origin   = request.headers.get('Origin');
  const clientIP = request.headers.get('CF-Connecting-IP')
                || request.headers.get('X-Forwarded-For')
                || 'Unknown';

  // 1. Origin validation
  if (!validateOrigin(request)) {
    ctx.waitUntil(notifyDiscord(env.DISCORD_WEBHOOK, {
      clientIP, targetUrl: '—', method: '—', isBlocked: true,
      error: `Unauthorised origin: ${origin || '(none)'}`,
      timestamp: new Date().toISOString()
    }));
    return new Response(
      JSON.stringify({ error: 'Forbidden: request origin is not permitted.' }),
      { status: 403, headers: corsHeaders(origin) }
    );
  }

  const startTime = Date.now();
  let targetUrl   = '—';
  let method      = '—';

  try {
    const body = await request.json();
    const {
      url,
      method:         rawMethod     = 'GET',
      headers:        customHeaders = {},
      body:           requestBody,
      followRedirects               = true,
      timeout                       = 30
    } = body;

    targetUrl = url;
    method    = rawMethod;

    // 2. URL validation
    const urlCheck = validateUrl(url);
    if (!urlCheck.ok)
      return new Response(JSON.stringify({ error: urlCheck.reason }), { status: 400, headers: corsHeaders(origin) });

    // 3. Method validation
    const upperMethod = rawMethod.toUpperCase();
    if (!ALLOWED_METHODS.has(upperMethod))
      return new Response(JSON.stringify({ error: `HTTP method '${rawMethod}' is not supported.` }), { status: 405, headers: corsHeaders(origin) });

    // 4. Request body size guard
    if (requestBody && requestBody.length > MAX_REQUEST_BODY_BYTES)
      return new Response(JSON.stringify({ error: 'Request body exceeds the 1 MB limit.' }), { status: 413, headers: corsHeaders(origin) });

    const fetchOptions = {
      method:   upperMethod,
      headers:  customHeaders || {},
      redirect: followRedirects ? 'follow' : 'manual',
      signal:   AbortSignal.timeout(Math.min((timeout * 1000) || 30_000, MAX_TIMEOUT_MS)),
      cf:       { cacheTtl: 0, cacheEverything: false }
    };
    if (requestBody && ['POST', 'PUT', 'PATCH'].includes(upperMethod)) fetchOptions.body = requestBody;

    const response      = await fetch(url, fetchOptions);
    const redirectChain = [];
    if (!followRedirects && [301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      if (location) redirectChain.push({ status: response.status, location });
    }

    const timings = { total: Date.now() - startTime };

    // 5. Early Content-Length size check
    const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
    if (contentLength > MAX_RESPONSE_BYTES)
      return new Response(JSON.stringify({
        error: `Response body is too large (${(contentLength / 1_048_576).toFixed(1)} MB reported). Maximum is 10 MB.`
      }), { status: 413, headers: corsHeaders(origin) });

    // 6. Stream with rolling size cap
    const reader  = response.body.getReader();
    const buffers = [];
    let   totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        reader.cancel();
        return new Response(JSON.stringify({ error: 'Response body exceeded the 10 MB limit and was aborted.' }), { status: 413, headers: corsHeaders(origin) });
      }
      buffers.push(value);
    }
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const buf of buffers) { merged.set(buf, offset); offset += buf.length; }
    const responseBody = new TextDecoder('utf-8', { fatal: false }).decode(merged);

    // 7. Cookies + cert
    const cookies  = parseCookies(response);
    let   certInfo = null;
    if (urlCheck.parsed.protocol === 'https:') certInfo = await getCertInfo(urlCheck.parsed.hostname);

    const duration = Date.now() - startTime;

    // 8. Non-blocking Discord notification (after response sent)
    ctx.waitUntil(notifyDiscord(env.DISCORD_WEBHOOK, {
      clientIP,
      targetUrl:  url,
      method:     upperMethod,
      status:     response.status,
      statusText: response.statusText,
      bodySize:   totalBytes,
      duration,
      // User-Agent is logged (it's the spoofed UA sent to the target, useful for abuse context)
      userAgent:  customHeaders?.['User-Agent'] || customHeaders?.['user-agent'],
      // Only log header KEY names — values may contain auth tokens
      headerKeys: Object.keys(customHeaders || {})
                    .filter(k => !['user-agent', 'User-Agent'].includes(k)),
      timestamp:  new Date().toISOString()
    }));

    return new Response(JSON.stringify({
      status:        response.status,
      statusText:    response.statusText,
      headers:       Object.fromEntries(response.headers.entries()),
      body:          responseBody,
      bodySize:      totalBytes,
      timing:        timings,
      redirectChain: redirectChain.length > 0 ? redirectChain : undefined,
      certificate:   certInfo,
      cookies:       cookies.length > 0 ? cookies : undefined,
      request:       { url, method: upperMethod, headers: customHeaders || {} }
    }), { headers: corsHeaders(origin) });

  } catch (error) {
    const duration   = Date.now() - startTime;
    const safeMsg    = sanitiseError(error);
    const errorLabel = error?.name === 'AbortError'    ? 'Timeout'
      : (error?.message || '').toLowerCase().includes('failed to fetch') ? 'Connection failed'
      : 'Proxy error';

    ctx.waitUntil(notifyDiscord(env.DISCORD_WEBHOOK, {
      clientIP, targetUrl, method, duration, error: errorLabel, timestamp: new Date().toISOString()
    }));

    return new Response(JSON.stringify({ error: safeMsg }), { status: 500, headers: corsHeaders(origin) });
  }
}

export async function onRequestOptions({ request }) {
  const origin = request.headers.get('Origin');
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    }
  });
}
