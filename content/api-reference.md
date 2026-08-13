# API reference

Three surfaces, three hostnames:

| Host | What lives there |
|---|---|
| `connect.runbrowser.dev` | CDP, REST shortcuts, sessions, viewer, MCP |
| `api.runbrowser.dev` | `/v1` primitives (fetch, search, extract) |
| `app.runbrowser.dev` | Dashboard, auth, keys, billing, usage |

Auth everywhere is your API key, as `Authorization: Bearer ab_…` or
`?token=ab_…` on connect URLs. The machine-readable spec for the `/v1`
primitives is served at `GET https://api.runbrowser.dev/v1/openapi.yml`.

---

## Connecting a browser

```
wss://connect.runbrowser.dev?token=ab_…
```

Works with `chromium.connectOverCDP()` and `puppeteer.connect({browserWSEndpoint})`.

| Query param | |
|---|---|
| `token` | your API key |
| `proxy` | egress proxy URL, credentials embedded. Validated against SSRF. |
| `session` | reattach to a stable session (`ssn_…`) or redeem a one-use token (`tk_…`) |

---

## Sessions

### `POST /v1/sessions`

Create a session up front instead of connecting directly. Two reasons to
bother: it keeps proxy credentials out of the connect URL, and it's how
you get a stable session.

```json
{
  "keepAlive": true,
  "maxIdleSeconds": 600,
  "proxy": { "type": "external", "url": "http://user:pass@host:port" }
}
```

```json
{
  "sessionId": "ssn_…",
  "connectUrl": "wss://connect.runbrowser.dev/connect?session=ssn_…",
  "expiresAt": "2026-08-12T12:00:00Z",
  "maxIdleSeconds": 600,
  "maxDurationSeconds": 3600
}
```

Without `keepAlive`, you get a short-lived one-use `tk_…` token instead —
the credential-safe connect flow, with no parked browser and no idle
billing.

### `GET /v1/sessions`

Every session your org currently has running, newest first. Use it to find
sessions you've lost track of — a parked stable session keeps billing until
it idles out, so this is how you see what you're paying for.

```json
{
  "count": 1,
  "sessions": [
    {
      "sessionId": "ssn_…",
      "startedAt": "2026-08-12T22:03:04Z",
      "keepAlive": true,
      "parked": true,
      "parkedAt": "2026-08-12T22:03:04Z",
      "idleExpiresAt": "2026-08-12T22:08:04Z",
      "expiresAt": "2026-08-12T22:18:04Z"
    }
  ]
}
```

`parked` means no client is attached right now. `idleExpiresAt` is when the
session releases itself if nobody reconnects; `expiresAt` is the absolute
ceiling. Whichever comes first wins. Both are absent for a one-shot session.

### `POST /v1/sessions/{id}/close`

Force-release. Stops the meter. Call it when you're done with a stable
session.

### `POST /v1/sessions/{id}/viewer-token`

```json
{ "ttlSeconds": 3600 }
```

```json
{
  "sessionId": "ssn_…",
  "viewerUrl": "wss://connect.runbrowser.dev/view/active?session=…&exp=…&sig=…",
  "webUrl":    "https://connect.runbrowser.dev/viewer?session=…&exp=…&sig=…",
  "expiresAt": "2026-08-12T13:00:00Z"
}
```

Default TTL 1 hour, max 24. HMAC-signed; no API key in the URL.

---

## REST shortcuts

Browserless-compatible body shapes, on `connect.runbrowser.dev`. Each one
provisions a browser, does the work, and releases it.

All four accept:

```json
{
  "url": "https://example.com",
  "waitForTimeout": 5000,
  "cookies": [{ "name": "session", "value": "…" }],
  "headers": { "X-Custom": "value" }
}
```

`cookies` defaults its URL scope to the page you're loading, so
`{name, value}` alone works for the common case — that's what gets you
past consent walls and age gates in a single call.

### `POST /screenshot` → `image/png|jpeg|webp`

```json
{ "url": "…", "options": { "format": "png", "fullPage": true, "quality": 80,
                           "selector": "#chart",
                           "viewport": { "width": 1280, "height": 720 } } }
```

`selector` clips the shot to the first matching element, including one below
the fold, and takes precedence over `fullPage`. A selector that matches
nothing returns `400` rather than quietly handing back the whole page.
`quality` applies to `jpeg` and `webp` only.

### `POST /pdf` → `application/pdf`

```json
{ "url": "…", "options": { "format": "A4", "landscape": false, "printBackground": true,
                           "marginTop": "0.4in", "marginBottom": "0.4in" } }
```

### `POST /content` → `text/html`

Post-JavaScript rendered DOM.

### `POST /scrape` → JSON

```json
{ "url": "…", "elements": [
  { "selector": "h1" },
  { "selector": "a", "result": "attr", "attribute": "href" }
] }
```

---

## Primitives

On `api.runbrowser.dev`. These are the ones that make agent loops cheap.

### `POST /v1/fetch`

**Plain HTTP — no browser, no JavaScript.** Fast and billed against a
separate allowance rather than browser-time. For pages that need
rendering, use `/v1/extract` or a browser.

```json
{ "url": "…", "format": "markdown", "method": "GET",
  "headers": {}, "timeoutMs": 30000, "followRedirects": true }
```

`format` is `html` (default), `text` or `markdown`. The response carries
the body plus block detection — `blocked`, `blockProvider`, `blockReason`
— so an agent can tell "this page is a Cloudflare wall" from "this page is
empty" without guessing.

### `POST /v1/search`

```json
{ "q": "browser automation", "count": 10, "lang": "en",
  "phrase": false, "include_hosts": ["example.com"], "exclude_hosts": ["spam.example"] }
```

Note the field names: `q` and `count`, not `query` and `limit`.
`count` maxes at 20.

### `POST /v1/extract`

Renders the page in a real browser, then asks an LLM for exactly the
shape you asked for.

```json
{
  "url": "…",
  "schema": { "type": "object", "properties": { … }, "required": [ … ] },
  "instructions": "only in-stock items",
  "contentFormat": "markdown-full",
  "cookies": [ … ],
  "headers": { … },
  "waitForSelector": ".results"
}
```

`contentFormat` is worth knowing: `markdown` runs Readability first (right
for articles), `markdown-full` skips it and converts the whole
noise-stripped body (right for listings, grids and search results), `text`
and `html` do what they say. It cuts token cost 5–10x and makes small
models dramatically more accurate.

Counts against a separate monthly `/extract` allowance (25 / 100 / 600 /
3,000 by tier) on top of browser-time, because each call spends both a
browser and LLM tokens.

Returns `{data, usage, trace}`. Output is validated against your schema;
on a mismatch we retry once with the validation errors fed back, then
return 422 rather than handing you data that doesn't fit.

### `POST /v1/captcha/solve`

Solve a CAPTCHA on our provider account — no solver signup, no key of your
own.

```json
{ "type": "turnstile", "websiteURL": "https://example.com/login",
  "websiteKey": "0x4AAA…", "action": "login", "cdata": "…" }
```

```json
{ "token": "…", "type": "turnstile", "durationMs": 14320,
  "used": 41, "limit": 1000, "remaining": 959 }
```

`type` is `recaptcha_v2`, `hcaptcha` or `turnstile`. `action` and `cdata`
are Turnstile-only, read off the widget's data attributes. Inject the
returned token into the page's response field **and** invoke the widget's
`data-callback` — most forms submit from the callback, not a button. The
[helper](../examples/captcha/) does both for you.

Counts against your plan's monthly allowance: 0 on Free, 100 on Hobby,
1,000 on Startup, 10,000 on Scale. **Failed solves are refunded** — the
provider doesn't charge us for challenges it can't clear, so we don't
charge you.

| Status | Means |
|---|---|
| 402 | Your plan includes no allowance (Free). Use your own key instead. |
| 422 | The provider couldn't solve this one. |
| 429 | Monthly allowance exhausted. |
| 503 | Managed solving isn't enabled on this deployment. |

Not everything is solvable. reCAPTCHA v3, DataDome and PerimeterX score the
session rather than posing a challenge; `type` rejects them with an
explanation rather than taking your money for a request that can't succeed.

---

## MCP

`POST https://connect.runbrowser.dev/mcp` — Model Context Protocol over
Streamable HTTP. Nine tools. See [mcp.md](mcp.md).

---

## Metrics

`GET /metrics` on the gateway and `/actuator/prometheus` on the control
plane, both Prometheus format. Neither is routed publicly; they're for
whoever operates the box. See [deploy.md](deploy.md#monitoring).

---

## Errors

`/v1` endpoints return a JSON envelope:

```json
{ "error": "invalid_request", "fields": ["q: must not be blank"] }
```

`error` is always present. `fields` appears on validation failures, one
entry per offending field as `name: reason`. `message` appears when there
is something to say beyond the code, and is omitted otherwise — so read
`error` first and treat the other two as optional.

Quota rejections carry the numbers:

```json
{ "error": "monthly_quota_exceeded", "type": "browser_seconds", "used": 3600, "limit": 3600 }
```

| Status | Means |
|---|---|
| 401 | Missing, malformed, or revoked key |
| 422 | Extraction couldn't produce data matching your schema |
| 429 | Concurrency limit (after waiting for a slot) or monthly quota |
| 502 | The browser or an upstream failed |
| 504 | The page never finished loading |

Revoking a key takes effect in about 100–150ms across the fleet, not at
the end of a cache TTL.
