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
| `proxy` | egress proxy URL with credentials embedded (validated against SSRF), **or** the name of an operator-configured pool such as `residential` |
| `country` | ISO-3166 alpha-2, with a named pool. Also sets the browser's timezone and `Accept-Language` to match the exit country |
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

All four take **either** a `url` to load **or** `html` to render directly —
one or the other, not both. `html` is what you want for documents you
generated yourself: an invoice, a report, an OG image. Publishing a
customer's billing details to a public URL just to turn them into a PDF is
not a step anyone should have to take.

```json
{ "html": "<h1>Invoice INV-2026-0001</h1>…", "options": { "printBackground": true } }
```

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

Capture the rendered page — or one element of it — as an image. The response
body is the image bytes with the matching `Content-Type`; there is no JSON
envelope to unwrap.

**Options**

| Field | Type | Default | Notes |
|---|---|---|---|
| `format` | `png` \| `jpeg` \| `webp` | `png` | `Content-Type` follows this |
| `fullPage` | boolean | `false` | The whole scrollable page, not just the viewport |
| `selector` | string | — | Clip to the first match, even below the fold. Takes precedence over `fullPage` |
| `quality` | 1–100 | 80 | `jpeg` and `webp` only; ignored for `png` |
| `viewport` | `{width,height}` | 1280×720 | The emulated screen size |

**Request**

```bash
curl -X POST https://connect.runbrowser.dev/screenshot \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com", "options": { "fullPage": true } }' \
  --output page.png
```

A `selector` that matches nothing returns `400` rather than quietly handing
back the whole page.

### `POST /pdf` → `application/pdf`

Render the page to a PDF. The response body is the PDF bytes.

**Options**

| Field | Type | Default | Notes |
|---|---|---|---|
| `format` | `A4` \| `Letter` \| … | `Letter` | Paper size |
| `landscape` | boolean | `false` | |
| `printBackground` | boolean | `false` | **See the warning below** |
| `marginTop` / `marginBottom` / `marginLeft` / `marginRight` | CSS length | `0` | e.g. `"0.4in"` |

**Request**

```bash
curl -X POST https://connect.runbrowser.dev/pdf \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "html": "<h1>Invoice INV-2026-0001</h1>", "options": { "printBackground": true } }' \
  --output invoice.pdf
```

**Set `printBackground` unless you mean not to.** It defaults to `false`,
matching Chrome, which means every background colour in your document is
dropped: header blocks, table shading, status badges. You get a valid PDF
with no error and no warning — and white text on a coloured block becomes
white text on white. It is the most common way a generated document is
silently wrong.

### `POST /content` → `text/html`

The page's HTML **after JavaScript has run** — `document.documentElement.outerHTML`,
not the raw server response. Use it when you want the fully-hydrated DOM to
parse yourself; use [`/v1/fetch`](#post-v1fetch) instead if you want it
cleaned into markdown or text.

**Request**

```bash
curl -X POST https://connect.runbrowser.dev/content \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com", "waitForTimeout": 3000 }'
```

The response is the raw HTML string with `Content-Type: text/html`.

### `POST /scrape` → JSON

Pull specific values out of the page by CSS selector, in one call, without
shipping your own extraction code.

**Request**

```json
{ "url": "https://example.com", "elements": [
  { "selector": "h1" },
  { "selector": "a", "result": "attr", "attribute": "href" }
] }
```

`result` is `text` (default, `innerText`), `html` (`innerHTML`), or `attr`
(the named `attribute`).

**Response** — one entry per selector, each with every match:

```json
{
  "data": [
    { "selector": "h1", "results": ["Example Domain"] },
    { "selector": "a", "results": ["https://www.iana.org/domains/example"] }
  ]
}
```

A selector that matches nothing returns an **empty** `results` array, not an
error — a missing element is a normal result when you're scraping.

### `POST /function` → JSON

Run your own JavaScript against the rendered page, in one call.

```json
{ "url": "…", "code": "return { title: document.title, n: args.n * 2 }", "args": { "n": 21 } }
```

`code` is the body of an async function receiving `args`. `await` freely and
`return` a JSON-serialisable value.

The code runs **in the page**, not in a server-side Puppeteer — there is no
`page` object and no filesystem, but there is the DOM, `fetch`, and the page's
own session. It grants nothing you couldn't already do over CDP; it removes
having to open and close a session to do it.

Two failures are reported as `400` rather than disguised. If your code throws
you get its message and stack back, because a stack from your own code is what
makes it debuggable. And if you return something that cannot be JSON — a DOM
node, a function — you get told so, rather than a `200` containing `{}`. Return
`el.textContent`, not `el`.

### `POST /export` → the resource, as-is

Pull a non-HTML resource out through the browser's session: a PDF behind a
login, an image, a CSV an application only serves to an authenticated user.

```json
{ "url": "https://example.com/private/invoice.pdf", "cookies": [ … ] }
```

The response is the file itself with its own content type — not JSON, not
base64. The upstream status is passed through, so a `404` arrives as a `404`.

It navigates to the URL's **origin** and fetches the target from inside that
page. Navigating straight at a PDF hands it to Chrome's viewer, where there is
no script context to read the bytes back from; from the origin the fetch is
same-origin, carries the session, and works for any content type.

### `POST /smart-scrape` → JSON

Get the page without deciding first whether it needs a browser.

```json
{ "url": "…", "format": "markdown-full", "forceBrowser": false }
```

It tries `/v1/fetch` — plain HTTP, no browser, a fraction of the cost — and
escalates to a real render only when that comes back blocked, empty, or
client-rendered. The response tells you which path it took:

```json
{ "url": "…", "method": "http", "status": 200, "content": "…" }
{ "url": "…", "method": "browser", "escalationReason": "thin_body_probably_js_rendered", "content": "…" }
```

`escalationReason` is worth reading rather than ignoring. `anti_bot_cloudflare`
and `thin_body_probably_js_rendered` are different facts about a target, and
both are worth knowing before you build a job around it. Set `forceBrowser`
when you already know.

### `POST /map` → JSON

What is on this site.

```json
{ "url": "…", "limit": 500, "includeExternal": false }
```

Two sources, reported separately, because neither is sufficient alone. The
sitemap is authoritative and often absent or stale; on-page links are always
there and only cover one page's worth. `sources.sitemap` versus `sources.page`
tells you which you got — a 40,000-URL sitemap and forty footer links are very
different starting points.

```json
{ "total": 47, "sources": { "sitemap": 0, "page": 53 }, "urls": [ … ] }
```

Same-origin only unless you ask otherwise, since a crawl seeded with every
outbound link is not a crawl of that site. Discovery runs inside the page, so
a sitemap behind a login is readable for the same reason the page was.

### `POST /crawl` → JSON

Walk a site and get every page back in one call.

```json
{ "url": "…", "maxPages": 10, "maxDepth": 2, "includeExternal": false }
```

The whole walk happens **inside one browser**. The obvious alternative — a loop
around `/content` — acquires and releases a browser per page, so a 25-page
crawl pays 25 cold starts. Here the browser is leased once and navigated
repeatedly, which is both cheaper and session-like: a cookie set on page one
still applies on page twelve.

It is synchronous and bounded (50 pages, depth 5, 150s), and it always tells
you why it stopped:

```json
{ "total": 6, "stoppedBecause": "maxPages", "queuedButNotVisited": 43, "pages": [ … ] }
```

`stoppedBecause` is `exhausted`, `maxPages`, `maxDepth` or `deadline`. *"Did I
get everything?"* is the first question worth asking of a crawl and the
expensive one to get wrong, so it is never omitted. A page that fails to load
is recorded with an `error` and stepped over rather than ending the run.

### `POST /download` → the file, as-is

Get a file a page links to, through that page's session.

```json
{ "url": "…", "selector": "a.report-download" }
{ "url": "…", "code": "return document.querySelector('a').href" }
```

Give it a selector whose `href`/`src` points at the file, or code that computes
the URL. The response is the bytes with their own content type, the server's
`Content-Disposition` when it sent one, and an `X-Runbrowser-Source-Url` header
naming what was actually fetched.

Cross-origin links work: it moves to the file's origin first, and follows any
redirect that origin performs — a link to `iana.org` that redirects to
`www.iana.org` is fetched from where it landed rather than failing CORS.

**One thing it cannot do:** a download built entirely in JavaScript, with no
URL to point at — a blob assembled in the page — is out of reach, and you get
a clear `404` saying so rather than an empty file.

### `POST /unblock` → JSON

Land on a page that puts up a wall, wait out the interstitial if there is one,
and hand back the clearance cookies.

```json
{ "url": "https://example.com" }
{ "url": "…", "waitMs": 30000, "content": true }
{ "url": "…", "solver": { "provider": "capsolver", "apiKey": "…" } }
```

| Field | Default | Meaning |
|---|---|---|
| `waitMs` | `20000` | How long to wait for a passive interstitial to clear (max 60s) |
| `content` | `false` | Include the page markup in the response |
| `solve` | `true` | Set `false` for the wait only, never a solve |
| `solver` | — | Your own solving credential; used for this call and never stored |

**Response**

```json
{
  "url": "https://example.com/",
  "unblocked": true,
  "challenge": { "type": "interstitial", "provider": "cloudflare",
                 "interactive": false, "wall": true, "solved": false, "waitedMs": 4200 },
  "cookies": [ { "name": "cf_clearance", "value": "…", "domain": "…" } ]
}
```

The `cookies` are the point of the call: they come back in the same shape every
other endpoint accepts as `cookies`, so the clearance carries straight into the
session that does the real work.

A cookie banner is declined on the way in — reject only, never accept — and
reported when one was there:

```json
{ "consent": { "found": true, "dismissed": true, "method": "onetrust" } }
```

**It tells you which wall you hit,** because the walls need different answers:

| `type` | What it is | What clears it |
|---|---|---|
| `interstitial` | A passive JS challenge — "Just a moment…" | Waiting. Handled for you |
| `turnstile`, `recaptcha_v2`, `hcaptcha` | A question with a sitekey | A solver, if you supply a key |
| `scoring` | reCAPTCHA v3, DataDome, PerimeterX | Nothing solvable — a residential exit IP |

A `scoring` result comes back in milliseconds rather than after a two-minute
timeout, with `advice` naming the exit IP as the actual lever. That honesty is
the feature: the alternative is billing you for a wait that was never going to
work.

**`wall` tells you whether the widget was actually gating anything.** A login
modal on a page you can already read matches every CAPTCHA selector, so a naive
check would tell you to spend a solve on a page that was never blocked. When
the content is accessible you get `unblocked: true` and no solve is spent.

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

`format` is `html` (default), `text`, `markdown` or `markdown-full`.

`markdown` runs Readability first: you get the main article and none of the
site chrome, which is what you want for prose. That also means navigation
is stripped — including pagination links — so a listing page comes back
without the `Next` link you would need to keep crawling.

`markdown-full` skips Readability and converts the whole page. Use it for
listings, product grids, search results, and anything you intend to walk.

The response carries the body plus `status`, `headers`, and block detection
— `blocked`, `blockProvider`, `blockReason` — so an agent can tell "this
page is a Cloudflare wall" from "this page is empty" from "this page is a
404" without guessing. Check `status`: an error page is still a page, and
its body reads like ordinary content.

### `POST /v1/search`

```json
{ "q": "browser automation", "count": 10, "lang": "en",
  "phrase": false, "include_hosts": ["example.com"], "exclude_hosts": ["spam.example"] }
```

Note the field names: `q` and `count`, not `query` and `limit`.

`count` maxes at 20, and your plan caps it further: 3 on Free, 10 on Hobby,
20 on Startup and Scale. Ask for more than your plan allows and you get your
plan's maximum rather than an error, so a downgrade never breaks a working
integration. The `X-RunBrowser-Max-Results` response header carries the cap
that was applied. Omit `count` entirely and you get your plan's maximum.

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

**`trace.screenshot_url` is `null`, and that is deliberate.** We don't keep
a picture of your page. Capturing one would mean loading the page a second
time — the extraction itself works from the text — so it would cost you an
extra page load, show you something the model never actually read, and, on
anything dynamic, potentially show different content than what you got
back. We'd rather not hold that, and you'd rather not pay for it.

If you need to see what the extractor saw, ask for it in your schema: a
field for the page title, a heading, the raw text of a section. That comes
from the same content the model read, so it actually answers the question
a screenshot only appears to.

Screenshot capture is off. If your use case genuinely needs it, get in
touch — where it is enabled, retention is bounded by construction and there
is no "keep forever".

### CAPTCHAs

[`/unblock`](#post-unblock-json) handles the wall for you, including the
passive interstitials that need no solver at all. Where a challenge does pose a
question, **you hold the solving account** — pass `solver.provider` and
`solver.apiKey` and we orchestrate it, or talk to your provider directly from
your own process. Either way the key is yours, used for that call, and never
stored. See
[Concepts](concepts.md#captchas) for why it works that way.

---

## MCP

`POST https://connect.runbrowser.dev/mcp` — Model Context Protocol over
Streamable HTTP. Thirteen tools. See [mcp.md](mcp.md).

---

## Metrics

`GET /metrics` on the gateway and `/actuator/prometheus` on the control
plane, both Prometheus format. Neither is routed publicly — they are for
whoever operates the box, and there is nothing here for you to call. Your
own usage is in the dashboard.

---

## Errors

Full reference, including every code and what to do about it:
**[Errors](errors.md)**.

The essentials. `api.runbrowser.dev` returns a JSON envelope in which
`error` is always present and everything else is optional:

```json
{ "error": "invalid_request", "fields": ["q: must not be blank"] }
```

`connect.runbrowser.dev` returns **plain text** instead — with one
exception, quota rejections, which are JSON. A handler that assumes JSON
from both will fail to parse the error it was trying to report. See
[the shapes](errors.md#the-one-thing-to-know-first).

| Status | Means |
|---|---|
| 401 | Missing, malformed, or revoked key |
| 402 | Your plan doesn't include this |
| 422 | Extraction couldn't produce data matching your schema |
| 429 | Concurrency limit (after waiting for a slot) or monthly quota |
| 502 | The browser or an upstream failed |
| 503 | The fleet is full — retry after 30s (`Retry-After` is set) |
| 504 | The page or the target never finished loading |

Revoking a key propagates across the fleet in about 100–150ms rather than
waiting out a cache TTL.
