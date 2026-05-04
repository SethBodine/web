# Web Request Inspector

**web.insecure.co.nz** — A browser-based HTTP proxy tool for inspecting web requests, response headers, cookies, and TLS certificates. Built for security research and personal use by [insecure.co.nz](https://insecure.co.nz).

---

## What it does

Send any HTTP request through a server-side proxy and inspect every detail of the response — headers, cookies, certificate chain, redirect path, and body content — without installing anything.

### Features

| Feature | Detail |
|---------|--------|
| **HTTP methods** | GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS |
| **Custom headers** | Inject any request header by key/value |
| **User-agent spoofing** | Presets for Chrome (Win/Mac/Linux), Safari (macOS/iOS), Chrome Android, cURL, or custom |
| **Request body** | Send JSON, XML, or any payload with POST/PUT/PATCH |
| **Follow redirects** | Toggle on/off with full redirect chain display |
| **Timeout control** | 1–120 seconds (server maximum: 30s) |
| **Response overview** | Status, duration, size, timing breakdown, sent headers |
| **Response headers** | Full response header list |
| **Cookie inspector** | Per-cookie breakdown: domain, path, expires, HttpOnly, Secure, SameSite |
| **Certificate tab** | TLS info via Certificate Transparency logs (crt.sh + certspotter.com fallback): issuer, SANs, expiry warnings |
| **JWT detection** | Auto-detects JWTs in response Authorization header and body fields, displays decoded header/payload and expiry |
| **Raw body** | Full response body as received |
| **Pretty print** | Auto-formatted JSON, XML, HTML |
| **Rendered view** | HTML responses rendered in a sandboxed iframe (scripts blocked) |
| **cURL export** | Generates a correctly shell-escaped cURL command for any request |
| **Download** | Save the raw response body to disk |
| **Request history** | Last 50 requests stored in localStorage, deduplicated by URL + method |
| **Light / dark theme** | Defaults to light 06:00–18:00, dark outside those hours |
| **Abuse monitoring** | Every request logged server-side to Discord (see Monitoring below) |

---

## Project structure

```
web-main/
├── index.html                  # Shell — loads Tailwind and app.js
├── app.js                      # Full Preact application
├── functions/
│   └── api/
│       └── request.js          # Cloudflare Pages Function — proxy + cert lookup + Discord logging
├── _headers                    # Cloudflare Pages HTTP security headers
├── _redirects                  # Redirects .md and /docs/* back to /
├── robots.txt                  # Disallow all indexing
├── sitemap.xml
├── humans.txt
└── docs/
    └── CHANGELOG.md
```

---

## Deployment

### Requirements

- [Cloudflare Pages](https://pages.cloudflare.com/) (free plan is sufficient)
- A Cloudflare account with the domain `web.insecure.co.nz` (or your own domain) pointed at Pages

### Steps

1. **Fork or push this repo** to GitHub / GitLab.
2. In the Cloudflare Dashboard → **Pages** → **Create a project** → connect your repo.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** _(leave empty)_
   - **Output directory:** `/` (root)
4. Set the environment variable (see below).
5. Deploy.

### Environment variables

Set in **Cloudflare Pages → project → Settings → Environment Variables**. Apply to both Production and Preview environments.

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_WEBHOOK` | Recommended | Full Discord webhook URL for abuse monitoring. Leave unset to disable logging. |

> ⚠️ Never put the webhook URL in source code — it belongs in environment variables only. The URL is only ever read server-side by the Worker and is never sent to the browser.

### Custom domain

In Cloudflare Pages → project → **Custom domains** → add `web.insecure.co.nz`. Cloudflare handles the SSL certificate automatically.

---

## Abuse monitoring

Every request processed by the proxy is logged to Discord via a non-blocking webhook call (`ctx.waitUntil`) that fires **after** the response is sent to the browser — zero latency impact.

**What is logged:**
- Client IP address (from `CF-Connecting-IP` — cannot be spoofed)
- Target URL and HTTP method
- Response status code and status text
- Response body size
- Request duration
- User-agent string sent to the target
- Custom header **key names only** (e.g. `Authorization`, `X-API-Key`)
- Error category if the request fails
- Blocked-origin attempts (separate 🚨 embed)

**What is never logged:**
- Header values (auth tokens, API keys)
- Request body content
- Response body content

This is disclosed to users in a banner at the top of the page and in the footer.

---

## Security

### Backend (`request.js`)

| Control | Detail |
|---------|--------|
| Origin validation | Exact match against `ALLOWED_ORIGINS` — no partial/substring checks |
| CORS | Reflects only allowlisted origins; all others receive the first allowed origin so browsers reject the response |
| Method allowlist | GET HEAD POST PUT PATCH DELETE OPTIONS only — CONNECT and TRACE excluded |
| Response size cap | 10 MB enforced via streaming byte counter + early Content-Length check |
| Request body cap | 1 MB maximum forwarded to target |
| Timeout cap | Client timeout clamped to 30s server maximum |
| Error sanitisation | Raw error messages never forwarded to client — mapped to safe categories |
| Cache bypass | `cf: { cacheTtl: 0, cacheEverything: false }` on all outbound fetches |

### Frontend (`app.js`)

| Control | Detail |
|---------|--------|
| No inline scripts | All JS in external `app.js` — no `unsafe-inline` required for scripts |
| iframe sandbox | Rendered HTML tab uses `sandbox=""` — scripts, same-origin access, popups all blocked |
| localStorage opt-in | Headers only stored in history if user explicitly enables the checkbox |
| cURL shell escaping | All values wrapped in POSIX single-quote escaping — handles `'`, `"`, `$`, `!`, `\`, newlines |

### HTTP headers (`_headers`)

```
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Content-Security-Policy: default-src 'self'; script-src 'self' https://esm.sh https://cdn.tailwindcss.com 'unsafe-eval'; ...
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

> `'unsafe-eval'` is required by Tailwind CDN's runtime CSS generation. To remove it, replace the Tailwind CDN script with a pre-compiled CSS file using the Tailwind CLI.

---

## Self-hosting notes

If deploying to your own infrastructure (not Cloudflare Workers):

1. **SSRF:** Cloudflare Workers' network isolation prevents the proxy from reaching RFC-1918 addresses (10.x, 192.168.x, 172.16.x, 127.x). On a self-hosted deployment you should add explicit IP blocklisting in `request.js` before shipping.

2. **Rate limiting:** There is currently no in-code rate limiting — it relies on a Cloudflare WAF rule. See [`GITHUB_ISSUE_rate_limiting.md`](./GITHUB_ISSUE_rate_limiting.md) for implementation options.

3. **SRI hashes:** CDN modules are pinned to exact versions. To compute integrity hashes for a stricter CSP:
   ```bash
   curl -sL https://esm.sh/preact@10.23.2        | openssl dgst -sha384 -binary | openssl base64 -A
   curl -sL https://esm.sh/preact@10.23.2/hooks  | openssl dgst -sha384 -binary | openssl base64 -A
   curl -sL https://esm.sh/htm@3.1.1             | openssl dgst -sha384 -binary | openssl base64 -A
   ```

---

## Runtime dependencies

All loaded from CDN — no build step required.

| Package | Version | Purpose |
|---------|---------|---------|
| [Preact](https://preactjs.com/) | 10.23.2 | UI framework (React-compatible, 10 KB gzipped) |
| [htm](https://github.com/developit/htm) | 3.1.1 | JSX-like template literals without a compiler |
| [Tailwind CSS](https://tailwindcss.com/) | CDN | Utility CSS |

---

## Known issues / tracked work

- **Rate limiting** — no per-IP rate limiting enforced in code. See [`GITHUB_ISSUE_rate_limiting.md`](./GITHUB_ISSUE_rate_limiting.md).
