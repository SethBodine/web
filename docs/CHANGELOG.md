# Changelog — web.insecure.co.nz (web-main)

All changes follow [Conventional Commits](https://www.conventionalcommits.org/).

---

## [2.0.0] — 2025-05-03

### Security

- **fix(origin):** Replace broken `origin.includes(host)` check with exact-match
  allowlist (`ALLOWED_ORIGINS.includes(origin)`), closing a bypass where a
  hostname like `evil-web.insecure.co.nz.attacker.com` would have passed
  validation.

- **fix(cors):** CORS `Access-Control-Allow-Origin` now reflects only allowlisted
  origins. Previously any origin was echoed back, permitting cross-site reads
  from arbitrary domains.

- **fix(iframe):** Rendered HTML tab sandbox attribute changed from
  `sandbox="allow-same-origin"` to `sandbox=""`. Scripts and same-origin DOM
  access from fetched content are now fully blocked, preventing XSS from
  rendered responses.

- **fix(errors):** Raw `error.message` values (which could expose internal
  hostnames, file paths, or stack traces) are no longer forwarded to the client.
  A `sanitiseError()` helper maps all thrown errors to safe, user-facing
  categories (Timeout / Connection failed / Proxy error).

- **fix(curl-export):** cURL export now wraps every value — URL, headers, body —
  in POSIX single-quote escaping via `shellEscape()`. Handles single quotes,
  double quotes, `$`, `!`, backslashes, newlines, and all shell metacharacters.
  Previously a single quote in a URL or header value would break or inject into
  the generated command.

- **fix(localstorage):** Custom header values are no longer saved to
  `localStorage` by default. A clearly labelled opt-in checkbox with a hover
  tooltip disclosing the risk is required before headers are persisted. A yellow
  warning banner is shown while the option is active.

- **feat(size-limit):** Response body is now capped at 10 MB on the backend.
  Enforcement is two-layered: an early `Content-Length` rejection and a rolling
  byte counter during streaming. The Worker aborts the read and returns
  `HTTP 413` if the limit is exceeded. The frontend shows a warning banner when
  the response is at the limit.

- **feat(request-size):** Request body forwarded to the target is capped at 1 MB.

- **feat(method-allowlist):** Only `GET HEAD POST PUT PATCH DELETE OPTIONS` are
  forwarded. `CONNECT` and `TRACE` are explicitly excluded.

- **feat(timeout-cap):** Client-supplied timeout is clamped to a 30-second server
  maximum regardless of what the frontend sends.

### Features

- **feat(certificate):** TLS certificate tab completely rebuilt using the
  [crt.sh](https://crt.sh) Certificate Transparency API, replacing the
  non-functional `response.cf` approach (Cloudflare Workers do not expose TLS
  metadata for outbound fetches). Now surfaces: issuer, common name, valid
  from/until, days remaining, SAN list, expiry warnings (🔴 expired,
  ⚠️ < 30 days), and a note when no CT log entry exists (self-signed /
  private CA). Includes a Download JSON button.

- **feat(cookies):** Cookie parsing rewritten to use
  `response.headers.getAll('Set-Cookie')` (Cloudflare Workers API), returning
  one entry per cookie. Eliminates the previous `split(',')` approach which
  broke on `expires` dates and values containing commas.

- **feat(jwt):** JWT detection ported from api.insecure.co.nz. Automatically
  detects JWTs in response `Authorization` headers and response body fields
  (`token`, `access_token`, `id_token`). Displays decoded header, payload,
  expiry status, issued-at and expires-at timestamps in a dedicated tab.

- **feat(discord):** Abuse monitoring via Discord webhook, fired server-side
  via `ctx.waitUntil()` after the response is sent (zero latency impact).
  Webhook URL is stored in the `DISCORD_WEBHOOK` Cloudflare Pages environment
  variable — never exposed in page source or the browser. Logs: client IP
  (from `CF-Connecting-IP`), target URL, method, status, response size,
  duration, user-agent sent to target, custom header key names. Header values,
  auth tokens, and body content are never logged. Blocked-origin probe attempts
  generate a separate 🚨 embed.

- **feat(disclosure):** Abuse monitoring disclosure banner added below the page
  header, and a matching summary in the page footer. Wording is specific about
  what is and is not captured.

- **feat(sitemap):** `sitemap.xml` added.

- **feat(robots):** `robots.txt` added, disallowing all indexing.

- **feat(humans):** `humans.txt` added per [humanstxt.org](https://humanstxt.org).

- **feat(headers-file):** `_headers` file added for Cloudflare Pages, applying
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `Content-Security-Policy`,
  `Cross-Origin-Opener-Policy`, and `Cross-Origin-Resource-Policy` to all
  responses. Reference: OWASP Secure Headers Project.

### Performance

- **perf(runtime):** Replaced `@babel/standalone` (≈330 KB gzipped, runtime JSX
  compilation) with Preact 10 + htm (≈10 KB gzipped, no compilation step).
  Modules pinned to exact versions (`preact@10.23.2`, `htm@3.1.1`). SRI
  computation instructions included in source comments for self-hosters
  requiring stricter CSP.

### Deployment

- **docs(self-hosting):** Deployment notes added to `request.js` covering:
  RFC-1918 / loopback SSRF considerations for non-Cloudflare deployments,
  Tailwind CLI build recommendation to remove `unsafe-eval` from CSP, and
  SRI hash computation for CDN modules.

---

## [1.0.0] — initial release

- Basic HTTP proxy via Cloudflare Pages Function
- URL input, method selector, custom headers, user-agent presets
- Response overview, headers, raw, pretty, rendered tabs
- Request history in localStorage
- Light / dark theme with time-of-day default
- cURL export
- Cookie display
- Certificate tab (non-functional — `response.cf` not available on outbound fetch)
