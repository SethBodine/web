import { h, render }                         from 'https://esm.sh/preact@10.23.2';
import { useState, useEffect, useRef }       from 'https://esm.sh/preact@10.23.2/hooks';
import htm                                   from 'https://esm.sh/htm@3.1.1';
const html = htm.bind(h);

// ─── Theme ───────────────────────────────────────────────────────────────────
const getInitialTheme = () => {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? 'light' : 'dark';
};

// ─── Shell escaping for cURL export (fix #12) ────────────────────────────────
// Wraps any string in single quotes and escapes embedded single quotes using
// the standard POSIX trick: end quote, escaped quote, reopen quote.
// This correctly handles single quotes, double quotes, $, !, spaces, newlines,
// backslashes, and every other character that would otherwise be misinterpreted
// by a shell.
const shellEscape = str => "'" + String(str).replace(/'/g, "'\\''") + "'";

// ─── JWT decoder (feature port from api.insecure.co.nz) ──────────────────────
const decodeJWT = token => {
  try {
    const clean = token.replace(/^Bearer\s+/i, '');
    const parts = clean.split('.');
    if (parts.length !== 3) return null;
    const b64 = s => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const header  = JSON.parse(b64(parts[0]));
    const payload = JSON.parse(b64(parts[1]));
    const now     = Math.floor(Date.now() / 1000);
    return {
      header,
      payload,
      isExpired:       payload.exp ? payload.exp < now : false,
      expiresIn:       payload.exp ? payload.exp - now : null,
      expiresAt:       payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
      issuedAt:        payload.iat ? new Date(payload.iat * 1000).toISOString() : null
    };
  } catch { return null; }
};

// ─── Icons ───────────────────────────────────────────────────────────────────
const Send     = () => html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
const Lock     = ({ size=16 }) => html`<svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const Unlock   = ({ size=16 }) => html`<svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
const Trash2   = ({ size=16 }) => html`<svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const Download = ({ size=16 }) => html`<svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const Copy     = ({ size=16 }) => html`<svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const Clock    = ({ size=16 }) => html`<svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const Shield   = ({ size=16 }) => html`<svg xmlns="http://www.w3.org/2000/svg" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

// ─── Main Component ───────────────────────────────────────────────────────────
function WebRequestInspector() {
  const [theme,           setTheme]           = useState(getInitialTheme());
  const [url,             setUrl]             = useState('');
  const [method,          setMethod]          = useState('GET');
  const [headers,         setHeaders]         = useState([{ key: '', value: '' }]);
  const [body,            setBody]            = useState('');
  const [followRedirects, setFollowRedirects] = useState(true);
  const [timeout,         _setTimeout]        = useState(30);
  const [userAgent,       setUserAgent]       = useState('mozilla-linux');
  const [customUserAgent, setCustomUserAgent] = useState('');

  const [response,        setResponse]        = useState(null);
  const [loading,         setLoading]         = useState(false);
  const [activeTab,       setActiveTab]       = useState('overview');

  const [history,         setHistory]         = useState([]);
  // fix #13 — headers NOT saved to localStorage by default
  const [storeHeaders,    setStoreHeaders]    = useState(false);

  const iframeRef = useRef(null);

  const userAgents = {
    'mozilla-windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'mozilla-mac':     'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'mozilla-linux':   'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'safari-mac':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'safari-ios':      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    'chrome-android':  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'curl':            'curl/8.4.0',
    'custom':          ''
  };

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('requestHistory') || '[]');
      setHistory(saved);
    } catch { /* ignore corrupted storage */ }
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────
  const isSecure = url.startsWith('https://');

  const normalizeUrl = inputUrl => {
    if (!inputUrl) return '';
    return (inputUrl.startsWith('http://') || inputUrl.startsWith('https://'))
      ? inputUrl
      : 'https://' + inputUrl;
  };

  // ── Header management ──────────────────────────────────────────────────────
  const addHeader    = () => setHeaders([...headers, { key: '', value: '' }]);
  const removeHeader = i  => setHeaders(headers.filter((_, idx) => idx !== i));
  const updateHeader = (i, field, value) => {
    const updated = [...headers];
    updated[i] = { ...updated[i], [field]: value };
    setHeaders(updated);
  };

  // ── Request execution ──────────────────────────────────────────────────────
  const executeRequest = async () => {
    setLoading(true);
    setActiveTab('overview');
    const startTime = performance.now();

    try {
      const customHeaders = {};
      headers.forEach(h => { if (h.key && h.value) customHeaders[h.key] = h.value; });

      const selectedUA = userAgent === 'custom' ? customUserAgent : userAgents[userAgent];
      if (selectedUA) customHeaders['User-Agent'] = selectedUA;

      const normalizedUrl = normalizeUrl(url);

      const proxyResponse = await fetch('/api/request', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          url:   normalizedUrl,
          method,
          headers: customHeaders,
          body:    ['POST', 'PUT', 'PATCH'].includes(method) ? body : null,
          followRedirects,
          timeout
        })
      });

      const duration = performance.now() - startTime;
      const data = await proxyResponse.json();

      if (data.error) throw new Error(data.error);

      // JWT detection (ported from api.insecure.co.nz)
      let jwtInfo = null;
      const authRespHeader = data.headers?.['authorization'] || data.headers?.['Authorization'];
      if (authRespHeader) jwtInfo = decodeJWT(authRespHeader);
      if (!jwtInfo && data.body) {
        try {
          const parsed = JSON.parse(data.body);
          const tok = parsed.token || parsed.access_token || parsed.id_token;
          if (tok) jwtInfo = decodeJWT(tok);
        } catch { /* not JSON */ }
      }

      const result = {
        ...data,
        duration:  Math.round(duration),
        timestamp: new Date().toISOString(),
        jwtInfo,
        request: { url: normalizedUrl, method, headers: customHeaders, body: ['POST','PUT','PATCH'].includes(method) ? body : null }
      };

      setResponse(result);

      // fix #13 — only save headers when user has explicitly opted in
      const historyEntry = {
        id:        Date.now(),
        url:       normalizedUrl,
        method,
        status:    data.status,
        duration:  Math.round(duration),
        timestamp: new Date().toISOString(),
        ...(storeHeaders ? { headers: customHeaders } : {})
      };

      const updatedHistory = [historyEntry, ...history].slice(0, 50);
      setHistory(updatedHistory);
      try { localStorage.setItem('requestHistory', JSON.stringify(updatedHistory)); } catch { /* storage full */ }

    } catch (err) {
      setResponse({
        error:     err.message,
        duration:  Math.round(performance.now() - startTime),
        timestamp: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  // ── History ────────────────────────────────────────────────────────────────
  const loadFromHistory = item => {
    setUrl(item.url);
    setMethod(item.method);
    // Restore headers if they were saved (opt-in)
    if (item.headers && Object.keys(item.headers).length > 0) {
      const restored = Object.entries(item.headers).map(([key, value]) => ({ key, value }));
      setHeaders(restored.length ? restored : [{ key: '', value: '' }]);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    try { localStorage.removeItem('requestHistory'); } catch { /* ignore */ }
  };

  // ── cURL export (fix #12) ──────────────────────────────────────────────────
  // shellEscape() wraps every value in single quotes and handles embedded
  // single quotes, double quotes, $, !, backslashes, and all special chars.
  const copyAsCurl = () => {
    const normalizedUrl = normalizeUrl(url);
    let curl = `curl -X ${method} ${shellEscape(normalizedUrl)}`;

    const selectedUA = userAgent === 'custom' ? customUserAgent : userAgents[userAgent];
    if (selectedUA) curl += ` -A ${shellEscape(selectedUA)}`;

    headers.forEach(h => {
      if (h.key && h.value) curl += ` -H ${shellEscape(`${h.key}: ${h.value}`)}`;
    });

    // --data-raw prevents @ being interpreted as a filename
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      curl += ` --data-raw ${shellEscape(body)}`;
    }

    navigator.clipboard.writeText(curl);
  };

  // ── Download ───────────────────────────────────────────────────────────────
  const downloadResponse = () => {
    if (!response?.body) return;
    const blob = new Blob([response.body], { type: 'text/plain' });
    const blobUrl = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: blobUrl, download: `response-${Date.now()}.txt` });
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  // ── Response body rendering ────────────────────────────────────────────────
  // fix #14 — body display capped (backend enforces 10 MB; this is the UI guard)
  const MAX_DISPLAY_BYTES = 10 * 1024 * 1024;

  const renderResponseContent = () => {
    if (!response || response.error) return null;

    const contentType = response.headers?.['content-type'] || '';

    // fix #14 — warn if response is at/near the size limit
    const sizeBanner = response.bodySize >= MAX_DISPLAY_BYTES
      ? html`<div class="mb-3 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-400 text-xs">
          Response body reached the 10 MB limit. Content may be truncated.
        </div>`
      : null;

    if (activeTab === 'rendered' && contentType.includes('text/html')) {
      // fix #11 — sandbox has allow-same-origin removed; iframe cannot access
      // parent cookies, localStorage, or DOM. Scripts are also blocked.
      return html`
        <div>
          ${sizeBanner}
          <div class="mb-2 px-3 py-1.5 bg-orange-500/10 border border-orange-500/30 rounded text-orange-400 text-xs">
            ⚠️ Rendered in a sandboxed iframe — scripts and same-origin access are blocked.
          </div>
          <iframe
            ref=${iframeRef}
            srcdoc=${response.body}
            class="w-full h-96 border rounded"
            sandbox=""
          />
        </div>`;
    }

    if (activeTab === 'pretty') {
      let formatted = response.body;
      let lang = '';
      try {
        if (contentType.includes('application/json') || contentType.includes('text/json')) {
          formatted = JSON.stringify(JSON.parse(response.body), null, 2);
          lang = 'json';
        } else if (contentType.includes('xml')) {
          formatted = response.body.replace(/></g, '>\n<');
          lang = 'xml';
        } else if (contentType.includes('text/html')) {
          formatted = response.body.replace(/></g, '>\n<').replace(/\n\s*\n/g, '\n');
          lang = 'html';
        } else {
          return html`
            <div class="text-center py-8">
              <p class=${mutedTextClass}>Pretty view supports JSON, XML, HTML, JavaScript and CSS.</p>
              <p class=${'text-sm ' + mutedTextClass + ' mt-2'}>Current type: ${contentType || 'unknown'}</p>
            </div>`;
        }
      } catch {
        /* fall through to raw body */
      }
      return html`
        <div>
          ${sizeBanner}
          <pre class=${'text-sm p-4 rounded overflow-auto max-h-96 ' + (theme === 'light' ? 'bg-slate-100 text-slate-900' : 'bg-slate-700 text-slate-100')}>${formatted}</pre>
        </div>`;
    }

    if (activeTab === 'raw') {
      return html`
        <div>
          ${sizeBanner}
          <pre class=${'text-sm p-4 rounded overflow-auto max-h-96 ' + (theme === 'light' ? 'bg-slate-100 text-slate-900' : 'bg-slate-700 text-slate-100')}>${response.body}</pre>
        </div>`;
    }

    return null;
  };

  // ── Theme tokens ───────────────────────────────────────────────────────────
  const themeClasses    = theme === 'light'
    ? 'bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 text-slate-900'
    : 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100';

  const cardClass       = theme === 'light' ? 'bg-white/70 border-slate-300' : 'bg-slate-800/50 border-slate-700';
  const inputClass      = theme === 'light'
    ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-500 focus:border-blue-500 border'
    : 'bg-slate-700 border-slate-600 text-white placeholder-slate-400 focus:border-blue-500 border';
  const textClass       = theme === 'light' ? 'text-slate-900' : 'text-white';
  const mutedTextClass  = theme === 'light' ? 'text-slate-600' : 'text-slate-400';
  const bgSubtle        = theme === 'light' ? 'bg-slate-100' : 'bg-slate-700/50';

  // ── Tab button helper ──────────────────────────────────────────────────────
  const tabBtn = (id, label) => html`
    <button
      onClick=${() => setActiveTab(id)}
      class=${'px-4 py-2 text-sm font-medium rounded-t whitespace-nowrap ' +
        (activeTab === id
          ? (theme === 'light' ? 'bg-slate-200 text-slate-900' : 'bg-slate-700 text-white')
          : mutedTextClass)}
    >${label}</button>`;

  // ─── Render ────────────────────────────────────────────────────────────────
  return html`
    <div class=${'min-h-screen ' + themeClasses}>
      <div class="container mx-auto px-4 py-6 max-w-7xl">

        <!-- Header -->
        <div class="mb-4 flex justify-between items-center">
          <div>
            <h1 class=${'text-3xl font-bold ' + textClass + ' mb-2'}>Web Request Inspector</h1>
            <p class=${mutedTextClass}>Test HTTP requests with detailed response analysis</p>
          </div>
          <button
            onClick=${() => setTheme(t => t === 'light' ? 'dark' : 'light')}
            class=${'px-4 py-2 rounded hover:opacity-80 ' + (theme === 'light' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-900')}
          >${theme === 'light' ? '🌙 Dark' : '☀️ Light'}</button>
        </div>

        <!-- Abuse monitoring disclosure -->
        <div class=${'mb-6 px-4 py-3 rounded-lg border flex items-start gap-3 text-sm ' +
          (theme === 'light'
            ? 'bg-blue-50 border-blue-200 text-blue-800'
            : 'bg-blue-950/40 border-blue-800/50 text-blue-300')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mt-0.5 shrink-0 opacity-70"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>
            <strong>Abuse monitoring is active.</strong>
            ${' '}Each request logs your IP address, the target URL and method, response status and size, duration, and the user-agent string sent to the target.
            Custom header <em>key names</em> are noted (e.g. <code class="font-mono text-xs px-1 rounded bg-black/10">Authorization</code>, <code class="font-mono text-xs px-1 rounded bg-black/10">X-API-Key</code>) but header <em>values</em> are never captured.
            Request and response body content is never logged.
            Logs are retained by the site owner for security purposes only.
          </span>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">

          <!-- History Sidebar -->
          <div class=${'lg:col-span-1 ' + cardClass + ' rounded-lg p-4 border'}>
            <div class="flex justify-between items-center mb-4">
              <h2 class=${'text-lg font-semibold ' + textClass}>History</h2>
              ${history.length > 0 && html`
                <button onClick=${clearHistory} class="text-red-400 hover:text-red-300">
                  <${Trash2} size=${16} />
                </button>`}
            </div>

            <!-- fix #13: header storage opt-in -->
            <div class="mb-4 pb-3 border-b border-slate-600">
              <label
                class="flex items-center gap-2 text-xs cursor-pointer"
                data-tooltip="Headers may contain auth tokens (Bearer, API keys).\nOnly enable on devices you fully trust.\nHeaders are stored in browser localStorage."
              >
                <input
                  type="checkbox"
                  checked=${storeHeaders}
                  onChange=${e => setStoreHeaders(e.target.checked)}
                  class="rounded"
                />
                <span class=${mutedTextClass}>Save headers in history</span>
              </label>
              ${storeHeaders && html`
                <p class="mt-1.5 text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded px-2 py-1">
                  ⚠️ Headers including auth tokens will be stored in localStorage.
                </p>`}
            </div>

            <div class="space-y-2 max-h-80 overflow-y-auto">
              ${history.length === 0
                ? html`<p class=${'text-sm ' + mutedTextClass}>No requests yet</p>`
                : history.map(item => html`
                  <div
                    key=${item.id}
                    onClick=${() => loadFromHistory(item)}
                    class=${(theme === 'light'
                      ? 'bg-slate-100 border-slate-300 hover:bg-slate-200'
                      : 'bg-slate-700/50 border-slate-600 hover:bg-slate-700') +
                      ' p-3 rounded border cursor-pointer transition-colors'}
                  >
                    <div class="flex items-center gap-2 mb-1">
                      <span class=${'text-xs px-2 py-0.5 rounded font-medium ' +
                        (item.status >= 200 && item.status < 300 ? 'bg-green-500/20 text-green-400'
                         : item.status >= 400 ? 'bg-red-500/20 text-red-400'
                         : 'bg-yellow-500/20 text-yellow-400')}>
                        ${item.method}
                      </span>
                      <span class=${'text-xs ' + mutedTextClass}>${item.status}</span>
                      ${item.headers && html`<span class="text-xs text-yellow-500" title="Headers stored">🔑</span>`}
                    </div>
                    <p class=${'text-sm ' + textClass + ' truncate mb-1'}>${item.url}</p>
                    <p class=${'text-xs ' + mutedTextClass}>
                      ${item.duration}ms · ${new Date(item.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
              `)}
            </div>
          </div>

          <!-- Main Panel -->
          <div class="lg:col-span-3 space-y-6">

            <!-- Request Configuration -->
            <div class=${'rounded-lg border p-6 ' + cardClass}>
              <div class="flex items-center justify-between mb-4">
                <h2 class=${'text-lg font-semibold ' + textClass}>Request</h2>
                <div class="flex items-center gap-2">
                  ${isSecure
                    ? html`<div class="flex items-center gap-1 text-green-500 text-sm"><${Lock} size=${16}/><span>Secure</span></div>`
                    : url.startsWith('http://')
                      ? html`<div class="flex items-center gap-1 text-orange-500 text-sm"><${Unlock} size=${16}/><span>Insecure</span></div>`
                      : null}
                </div>
              </div>

              <div class="space-y-4">

                <!-- URL + Method -->
                <div class="flex gap-2">
                  <select
                    value=${method}
                    onChange=${e => setMethod(e.target.value)}
                    class=${inputClass + ' rounded px-3 py-2 font-medium focus:outline-none'}
                  >
                    <option>GET</option>
                    <option>POST</option>
                    <option>PUT</option>
                    <option>PATCH</option>
                    <option>DELETE</option>
                    <option>HEAD</option>
                    <option>OPTIONS</option>
                  </select>
                  <input
                    type="text"
                    value=${url}
                    onInput=${e => setUrl(e.target.value)}
                    placeholder="https://example.com/api"
                    class=${'flex-1 ' + inputClass + ' rounded px-4 py-2 focus:outline-none'}
                  />
                </div>

                <!-- Headers -->
                <div>
                  <div class="flex justify-between items-center mb-2">
                    <label class=${'text-sm font-medium ' + mutedTextClass}>Custom Headers</label>
                    <button onClick=${addHeader} class="text-sm text-blue-500 hover:text-blue-400">+ Add Header</button>
                  </div>
                  <div class="space-y-2">
                    ${headers.map((header, idx) => html`
                      <div key=${idx} class="flex gap-2">
                        <input
                          type="text"
                          value=${header.key}
                          onInput=${e => updateHeader(idx, 'key', e.target.value)}
                          placeholder="Header name"
                          class=${'flex-1 ' + inputClass + ' rounded px-3 py-2 text-sm focus:outline-none'}
                        />
                        <input
                          type="text"
                          value=${header.value}
                          onInput=${e => updateHeader(idx, 'value', e.target.value)}
                          placeholder="Header value"
                          class=${'flex-1 ' + inputClass + ' rounded px-3 py-2 text-sm focus:outline-none'}
                        />
                        <button onClick=${() => removeHeader(idx)} class="text-red-400 hover:text-red-300 px-2">
                          <${Trash2} size=${16} />
                        </button>
                      </div>
                    `)}
                  </div>
                </div>

                <!-- User Agent -->
                <div>
                  <label class=${'block text-sm font-medium ' + mutedTextClass + ' mb-2'}>User Agent</label>
                  <div class="flex gap-2">
                    <select
                      value=${userAgent}
                      onChange=${e => setUserAgent(e.target.value)}
                      class=${'flex-1 ' + inputClass + ' rounded px-3 py-2 text-sm focus:outline-none'}
                    >
                      <option value="mozilla-windows">Chrome — Windows</option>
                      <option value="mozilla-mac">Chrome — macOS</option>
                      <option value="mozilla-linux">Chrome — Linux</option>
                      <option value="safari-mac">Safari — macOS</option>
                      <option value="safari-ios">Safari — iOS</option>
                      <option value="chrome-android">Chrome — Android</option>
                      <option value="curl">cURL</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  ${userAgent === 'custom' && html`
                    <input
                      type="text"
                      value=${customUserAgent}
                      onInput=${e => setCustomUserAgent(e.target.value)}
                      placeholder="Enter custom user agent string"
                      class=${'w-full mt-2 ' + inputClass + ' rounded px-3 py-2 text-sm focus:outline-none'}
                    />`}
                </div>

                <!-- Request Body -->
                ${['POST', 'PUT', 'PATCH'].includes(method) && html`
                  <div>
                    <label class=${'block text-sm font-medium ' + mutedTextClass + ' mb-2'}>Request Body</label>
                    <textarea
                      value=${body}
                      onInput=${e => setBody(e.target.value)}
                      rows="6"
                      class=${'w-full ' + inputClass + ' rounded px-4 py-2 font-mono text-sm focus:outline-none'}
                      placeholder='{"key": "value"}'
                    />
                  </div>`}

                <!-- Options -->
                <div class="flex gap-4 items-center flex-wrap">
                  <label class="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked=${followRedirects}
                      onChange=${e => setFollowRedirects(e.target.checked)}
                      class="rounded"
                    />
                    <span class=${mutedTextClass}>Follow Redirects</span>
                  </label>
                  <div class="flex items-center gap-2">
                    <label class=${'text-sm ' + mutedTextClass}>Timeout:</label>
                    <input
                      type="number"
                      value=${timeout}
                      onInput=${e => _setTimeout(Math.min(120, Math.max(1, parseInt(e.target.value) || 30)))}
                      class=${inputClass + ' rounded px-3 py-1 text-sm w-20 focus:outline-none'}
                      min="1"
                      max="120"
                    />
                    <span class=${'text-sm ' + mutedTextClass}>seconds</span>
                  </div>
                </div>

                <!-- Actions -->
                <div class="flex gap-3 pt-2 flex-wrap">
                  <button
                    onClick=${executeRequest}
                    disabled=${!url || loading}
                    class="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium rounded"
                  >
                    <${Send} />
                    ${loading ? 'Sending…' : 'Send Request'}
                  </button>

                  ${response && html`
                    <button
                      onClick=${copyAsCurl}
                      class=${'flex items-center gap-2 px-4 py-2.5 font-medium rounded ' + (theme === 'light' ? 'bg-slate-200 hover:bg-slate-300 text-slate-900' : 'bg-slate-700 hover:bg-slate-600 text-white')}
                    >
                      <${Copy} />
                      Copy as cURL
                    </button>
                    <button
                      onClick=${downloadResponse}
                      class=${'flex items-center gap-2 px-4 py-2.5 font-medium rounded ' + (theme === 'light' ? 'bg-slate-200 hover:bg-slate-300 text-slate-900' : 'bg-slate-700 hover:bg-slate-600 text-white')}
                    >
                      <${Download} />
                      Download
                    </button>
                  `}
                </div>
              </div>
            </div>

            <!-- Response Panel -->
            ${response && html`
              <div class=${'rounded-lg border p-6 ' + cardClass}>
                <h2 class=${'text-lg font-semibold ' + textClass + ' mb-4'}>Response</h2>

                ${response.error
                  ? html`
                    <div class="bg-red-500/10 border border-red-500/30 rounded p-4">
                      <p class="text-red-400 font-semibold mb-2">Request Failed</p>
                      <p class="text-red-300 text-sm font-mono">${response.error}</p>
                    </div>`
                  : html`
                    <>
                      <!-- Tabs -->
                      <div class="flex gap-2 mb-4 border-b border-slate-600 pb-2 overflow-x-auto">
                        ${tabBtn('overview',  'Overview')}
                        ${tabBtn('headers',   'Headers')}
                        ${response.cookies?.length && tabBtn('cookies', `Cookies (${response.cookies.length})`)}
                        ${response.certificate && tabBtn('certificate', 'Certificate')}
                        ${response.jwtInfo && tabBtn('jwt', '🔑 JWT')}
                        ${tabBtn('raw',    'Raw')}
                        ${tabBtn('pretty', 'Pretty')}
                        ${response.headers?.['content-type']?.includes('text/html') && tabBtn('rendered', 'Rendered')}
                      </div>

                      <!-- Overview -->
                      ${activeTab === 'overview' && html`
                        <div class="space-y-4">
                          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div class=${bgSubtle + ' p-3 rounded'}>
                              <p class=${'text-xs ' + mutedTextClass + ' mb-1'}>Status</p>
                              <p class=${'text-lg font-semibold ' +
                                (response.status >= 200 && response.status < 300 ? 'text-green-400'
                                 : response.status >= 400 ? 'text-red-400' : 'text-yellow-400')}>
                                ${response.status} ${response.statusText}
                              </p>
                            </div>
                            <div class=${bgSubtle + ' p-3 rounded'}>
                              <p class=${'text-xs ' + mutedTextClass + ' mb-1'}>Duration</p>
                              <p class=${'text-lg font-semibold ' + textClass}>${response.duration}ms</p>
                            </div>
                            <div class=${bgSubtle + ' p-3 rounded'}>
                              <p class=${'text-xs ' + mutedTextClass + ' mb-1'}>Size</p>
                              <p class=${'text-lg font-semibold ' + textClass}>
                                ${response.bodySize != null
                                  ? (response.bodySize < 1024
                                    ? response.bodySize + ' B'
                                    : (response.bodySize / 1024).toFixed(1) + ' KB')
                                  : 'N/A'}
                              </p>
                            </div>
                            <div class=${bgSubtle + ' p-3 rounded'}>
                              <p class=${'text-xs ' + mutedTextClass + ' mb-1'}>Protocol</p>
                              <p class=${'text-lg font-semibold ' + textClass}>
                                ${response.headers?.['content-type'] ? 'HTTP' : 'HTTP'}
                              </p>
                            </div>
                          </div>

                          ${response.redirectChain?.length && html`
                            <div>
                              <h3 class=${'text-sm font-semibold ' + textClass + ' mb-2'}>Redirect Chain</h3>
                              <div class="space-y-1">
                                ${response.redirectChain.map((r, i) => html`
                                  <div key=${i} class=${'text-sm ' + mutedTextClass + ' pl-4 border-l-2 border-blue-500'}>
                                    ${i + 1}. ${r.status} → ${r.location}
                                  </div>`)}
                              </div>
                            </div>`}

                          <div>
                            <h3 class=${'text-sm font-semibold ' + textClass + ' mb-2'}>Timing</h3>
                            <div class=${bgSubtle + ' p-3 rounded space-y-1'}>
                              ${response.timing && Object.entries(response.timing).map(([k, v]) => html`
                                <div key=${k} class="flex justify-between text-sm">
                                  <span class=${mutedTextClass}>${k}:</span>
                                  <span class=${textClass}>${v}ms</span>
                                </div>`)}
                            </div>
                          </div>

                          <div>
                            <h3 class=${'text-sm font-semibold ' + textClass + ' mb-2'}>Request Sent</h3>
                            <div class=${bgSubtle + ' p-3 rounded space-y-1'}>
                              ${response.request && Object.entries(response.request.headers || {}).map(([k, v]) => html`
                                <div key=${k} class="flex gap-2 text-sm font-mono">
                                  <span class="text-green-400">${k}:</span>
                                  <span class=${textClass}>${v}</span>
                                </div>`)}
                            </div>
                          </div>
                        </div>`}

                      <!-- Headers tab -->
                      ${activeTab === 'headers' && html`
                        <div class="space-y-4">
                          <div>
                            <h3 class=${'text-sm font-semibold ' + textClass + ' mb-2'}>Response Headers</h3>
                            <div class=${bgSubtle + ' p-3 rounded space-y-1'}>
                              ${Object.entries(response.headers || {}).map(([k, v]) => html`
                                <div key=${k} class="flex gap-2 text-sm font-mono flex-wrap">
                                  <span class="text-blue-400">${k}:</span>
                                  <span class=${textClass + ' break-all'}>${v}</span>
                                </div>`)}
                            </div>
                          </div>
                        </div>`}

                      <!-- Cookies tab -->
                      ${activeTab === 'cookies' && response.cookies && html`
                        <div class="space-y-4">
                          <h3 class=${'text-sm font-semibold ' + textClass + ' mb-2'}>Cookies Received</h3>
                          ${response.cookies.map((cookie, i) => html`
                            <div key=${i} class=${bgSubtle + ' p-4 rounded'}>
                              <div class="space-y-2">
                                <div>
                                  <span class=${'text-sm font-semibold ' + textClass}>${cookie.name}</span>
                                  <p class=${'text-sm font-mono ' + mutedTextClass + ' mt-1 break-all'}>${cookie.value}</p>
                                </div>
                                ${cookie.domain  && html`<div class="text-xs"><span class=${mutedTextClass}>Domain:</span> <span class=${textClass}>${cookie.domain}</span></div>`}
                                ${cookie.path    && html`<div class="text-xs"><span class=${mutedTextClass}>Path:</span> <span class=${textClass}>${cookie.path}</span></div>`}
                                ${cookie.expires && html`<div class="text-xs"><span class=${mutedTextClass}>Expires:</span> <span class=${textClass}>${cookie.expires}</span></div>`}
                                <div class="flex gap-3 text-xs flex-wrap">
                                  ${cookie.httpOnly && html`<span class="text-orange-400">HttpOnly</span>`}
                                  ${cookie.secure   && html`<span class="text-green-400">Secure</span>`}
                                  ${cookie.sameSite && html`<span class=${mutedTextClass}>SameSite: ${cookie.sameSite}</span>`}
                                </div>
                              </div>
                            </div>`)}
                          <button
                            onClick=${() => {
                              const blob = new Blob([JSON.stringify(response.cookies, null, 2)], { type: 'application/json' });
                              const u = URL.createObjectURL(blob);
                              const a = Object.assign(document.createElement('a'), { href: u, download: `cookies-${Date.now()}.json` });
                              a.click(); URL.revokeObjectURL(u);
                            }}
                            class="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded"
                          ><${Download} /> Download Cookies</button>
                        </div>`}

                      <!-- Certificate tab (rebuilt with crt.sh data) -->
                      ${activeTab === 'certificate' && response.certificate && html`
                        <div class="space-y-4">
                          <h3 class=${'text-sm font-semibold ' + textClass + ' mb-2'}>TLS / Certificate Information</h3>

                          ${response.certificate.error && html`
                            <div class="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-400 text-sm">
                              ${response.certificate.error}
                            </div>`}

                          ${!response.certificate.found && !response.certificate.error && html`
                            <div class="bg-yellow-500/10 border border-yellow-500/30 rounded p-4">
                              <p class="text-yellow-400 font-semibold text-sm mb-1">⚠️ Not found in Certificate Transparency logs</p>
                              <p class=${'text-sm ' + mutedTextClass}>${response.certificate.note || 'This certificate may be self-signed or issued by a private CA.'}</p>
                            </div>`}

                          ${response.certificate.found && html`
                            <div class=${bgSubtle + ' p-4 rounded space-y-3'}>
                              ${response.certificate.isExpired && html`
                                <div class="bg-red-500/10 border border-red-500/30 rounded p-2 text-red-400 text-xs font-semibold">
                                  🔴 CERTIFICATE EXPIRED
                                </div>`}
                              ${!response.certificate.isExpired && response.certificate.daysUntilExpiry < 30 && html`
                                <div class="bg-yellow-500/10 border border-yellow-500/30 rounded p-2 text-yellow-400 text-xs font-semibold">
                                  ⚠️ Expires in ${response.certificate.daysUntilExpiry} days
                                </div>`}

                              ${[
                                ['Hostname',      response.certificate.hostname],
                                ['Common Name',   response.certificate.commonName],
                                ['Issuer',        response.certificate.issuer],
                                ['Valid From',    response.certificate.notBefore],
                                ['Valid Until',   response.certificate.notAfter],
                                ['Days Remaining', response.certificate.isExpired ? 'EXPIRED' : response.certificate.daysUntilExpiry + ' days'],
                                ['Source',        response.certificate.source]
                              ].map(([label, value]) => value && html`
                                <div key=${label}>
                                  <span class=${'text-sm ' + mutedTextClass}>${label}:</span>
                                  <p class=${'text-sm font-mono ' + textClass + ' mt-1 break-all'}>${value}</p>
                                </div>`)}

                              ${response.certificate.sans?.length && html`
                                <div>
                                  <span class=${'text-sm ' + mutedTextClass}>Subject Alternative Names:</span>
                                  <div class="mt-1 flex flex-wrap gap-1">
                                    ${response.certificate.sans.map(san => html`
                                      <span key=${san} class=${'text-xs font-mono px-2 py-0.5 rounded ' + bgSubtle + ' ' + textClass}>${san}</span>`)}
                                  </div>
                                </div>`}
                            </div>`}

                          <button
                            onClick=${() => {
                              const blob = new Blob([JSON.stringify(response.certificate, null, 2)], { type: 'application/json' });
                              const u = URL.createObjectURL(blob);
                              const a = Object.assign(document.createElement('a'), { href: u, download: `cert-info-${Date.now()}.json` });
                              a.click(); URL.revokeObjectURL(u);
                            }}
                            class="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded"
                          ><${Download} /> Download Certificate Info</button>
                          <p class=${'text-xs ' + mutedTextClass + ' mt-2'}>
                            Data sourced from Certificate Transparency logs via crt.sh.
                            Self-signed certificates and private-CA certificates will not appear.
                          </p>
                        </div>`}

                      <!-- JWT tab (ported from api.insecure.co.nz) -->
                      ${activeTab === 'jwt' && response.jwtInfo && html`
                        <div class="space-y-4">
                          <div class="flex items-center gap-2 mb-2">
                            <${Shield} size=${16} />
                            <h3 class=${'text-sm font-semibold ' + textClass}>JWT Decoded</h3>
                            ${response.jwtInfo.isExpired
                              ? html`<span class="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">EXPIRED</span>`
                              : html`<span class="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">Valid</span>`}
                          </div>

                          ${[
                            ['Issued At',  response.jwtInfo.issuedAt],
                            ['Expires At', response.jwtInfo.expiresAt],
                            ['Expires In', response.jwtInfo.expiresIn != null
                              ? (response.jwtInfo.isExpired ? 'Expired' : Math.floor(response.jwtInfo.expiresIn / 60) + ' min remaining')
                              : null]
                          ].map(([label, value]) => value && html`
                            <div key=${label}>
                              <span class=${'text-xs ' + mutedTextClass}>${label}:</span>
                              <p class=${'text-sm font-mono ' + textClass}>${value}</p>
                            </div>`)}

                          <div>
                            <p class=${'text-xs ' + mutedTextClass + ' mb-1'}>Header</p>
                            <pre class=${'text-sm p-3 rounded ' + bgSubtle + ' ' + textClass + ' overflow-auto'}>
${JSON.stringify(response.jwtInfo.header, null, 2)}</pre>
                          </div>
                          <div>
                            <p class=${'text-xs ' + mutedTextClass + ' mb-1'}>Payload</p>
                            <pre class=${'text-sm p-3 rounded ' + bgSubtle + ' ' + textClass + ' overflow-auto'}>
${JSON.stringify(response.jwtInfo.payload, null, 2)}</pre>
                          </div>
                        </div>`}

                      <!-- Raw / Pretty / Rendered -->
                      ${(activeTab === 'raw' || activeTab === 'pretty' || activeTab === 'rendered') && renderResponseContent()}
                    </>`}
              </div>`}

          </div><!-- /main panel -->
        </div><!-- /grid -->

        <!-- Footer -->
        <footer class=${'mt-10 pt-6 border-t text-center text-xs ' +
          (theme === 'light' ? 'border-slate-200 text-slate-400' : 'border-slate-700 text-slate-500')}>
          <p class="mb-1">
            <a href="https://insecure.co.nz" class="hover:underline opacity-70">insecure.co.nz</a>
            ${' · '}
            <a href="/humans.txt" class="hover:underline opacity-70">humans.txt</a>
            ${' · '}
            <a href="/robots.txt" class="hover:underline opacity-70">robots.txt</a>
          </p>
          <p class="opacity-50">
            Requests are logged for abuse monitoring. IP address, target URL, method, status, size, duration,
            and header key names only are retained. Header values, auth tokens, and body content are never logged.
          </p>
        </footer>

      </div>
    </div>`;
}

// ─── Mount ────────────────────────────────────────────────────────────────────
render(html`<${WebRequestInspector} />`, document.getElementById('root'));
