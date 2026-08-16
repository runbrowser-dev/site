# Errors

Every status we return, what actually causes it, and what to do about it.

Browser automation fails constantly and mostly not because of your code —
pages hang, sites block you, proxies die, capacity runs out. This page
exists so that when something breaks at 3am you can look up the exact
status you got instead of guessing.

## The one thing to know first

**Two services answer you, and their error bodies are not the same shape.**

`connect.runbrowser.dev` (browsers, sessions, the REST shortcuts, MCP)
answers with **plain text**. `api.runbrowser.dev` (`/v1/fetch`,
`/v1/extract`) answers with **JSON**.

If you write one error handler that assumes JSON everywhere, it will throw
a parse error on the exact request that was already failing, and you'll
debug the wrong thing. Branch on the host, or on the response's
content type.

```
connect.*  →  concurrency limit reached for this org
              (text/plain, with a trailing newline)

api.*      →  { "error": "target_timeout" }
              (application/json)
```

There is one exception, and it is the one you are most likely to hit:
**quota rejections from `connect.*` are JSON**, and they use different
field names from the ones `api.*` uses for the same idea.

```json
{ "error": "monthly_quota_exceeded", "used_seconds": 3600, "limit_seconds": 3600 }
```

versus, from `api.*`:

```json
{ "error": "monthly_quota_exceeded", "type": "extract", "used": 105, "limit": 100 }
```

We would rather tell you this than have you find it in production.

## JSON error shapes on api.runbrowser.dev

`error` is always present and is the thing to branch on. Everything else
is optional and you must not assume it exists.

| Shape | When | Example |
|---|---|---|
| Code only | Most execution failures. **There is no `message` key at all** | `{"error": "target_timeout"}` |
| Code + message | When there's something useful to add | `{"error": "schema_invalid", "message": "schema is not valid JSON Schema: …"}` |
| Validation | Bad request fields, one entry per field as `name: reason` | `{"error": "invalid_request", "fields": ["url: must not be blank"]}` |
| Quota | Allowance exhausted. Details are **flat**, not nested | `{"error": "monthly_quota_exceeded", "type": "fetch", "used": 5001, "limit": 5000}` |

Read `error` first. Treat `message`, `fields`, `type`, `used` and `limit`
as all potentially absent.

## What to retry, and what not to

The short version, before the exhaustive tables.

| Status | Retry? | How |
|---|---|---|
| 400, 403, 413, 415 | **No** | Your request is wrong. Retrying sends the same wrong request |
| 421 | **No** — retry elsewhere | Right session, wrong machine. Use the `connectUrl` you were given; the body names the host |
| 401 | **No** | Fix the key |
| 402 | **No** | A spend or plan ceiling. Nothing changes until the month rolls over or the ceiling is raised |
| 404 | **No** | The session is gone. Create a new one |
| 409 | Yes | Something else holds the session. Retry after closing it |
| 422 | Sometimes | The model couldn't match your schema. A retry may succeed; two won't |
| 429 | **Yes, with backoff** — unless it's a monthly quota, which won't clear until you upgrade or the month rolls over |
| 502, 504 | Yes, with backoff | Something upstream failed or was too slow |
| 503 | **Yes, after 30s** | We're full. `Retry-After: 30` is on the response |

**`Retry-After` is only ever set on the fleet-capacity 503**, always with
the value `30`. We do not send it on 429, and we do not send
`X-RateLimit-*` headers on anything. Don't build a client that depends on
headers we don't send — use exponential backoff with jitter.

## Connecting a browser

Failures at `wss://connect.runbrowser.dev` split cleanly in two, and the
split matters more than any individual code.

**Before the WebSocket upgrade**, you get a normal HTTP response with a
status and a plain-text body. Playwright and Puppeteer surface this as
`Unexpected server response: 429`. The status is the real information.

| Status | Body | Cause | What to do |
|---|---|---|---|
| 401 | `invalid or missing token` | No key, unknown key, or one you revoked | Fix the key. Revocation normally takes effect fleet-wide in ~100–150ms; if that signal is missed it clears within 5 minutes |
| 401 | `stable session reattach requires bearer auth` | Reattaching to a stable session without auth | Send `Authorization: Bearer` or `?token=` |
| 401 | `session token invalid, expired, or already used` | One-use tokens live **60 seconds** and work once | Call `POST /v1/sessions` again and connect promptly |
| 400 | `invalid proxy parameter: …` | Your proxy URL didn't validate | See [Proxies](#proxies) below |
| 400 | `session was not created with keepAlive=true and cannot be reattached` | Only stable sessions can be reattached | Recreate with `keepAlive: true` |
| 403 | `session belongs to a different org` | That session isn't yours | Check which key you're using |
| 404 | `session not found, expired, or already destroyed` | It idled out, hit its ceiling, or was closed | Create a new one |
| 409 | `session is currently attached; close the existing CDP connection first` | One CDP client per session | Close the other connection first |
| 421 | `this session is running on <host>; …` | The session exists but its browser is on a different machine, and browsers don't move | Reconnect using the `connectUrl` you were given. The message names the host if you built the URL yourself |
| 429 | JSON `monthly_quota_exceeded` | Monthly browser-seconds are gone | Upgrade, or wait for the UTC month to roll over |
| 429 | `concurrency limit reached for this org` | You're at your tier's concurrent limit, after waiting ~20s for a slot | Close a session, back off, or upgrade |
| 503 | `the fleet is at capacity; retry shortly` | The box is genuinely full. **Not your fault and not your limit** | Retry after 30s. `Retry-After: 30` is set |
| 502 | `could not provision browser: …` | The browser failed to start | Retry with backoff |
| 502 | `upstream chrome dial failed: …` | We couldn't reach the browser we just started | Retry |

**After the upgrade**, there is no such luxury. When a session ends, the
socket closes **without a close frame** — your client reports code `1006`
(abnormal closure), or `Target closed` / `Connection closed`. There is no
reason string and no status field.

That is a real limitation and worth being explicit about: **you cannot
tell from the connection itself why a session ended.** To find out, ask:

- `GET /v1/sessions` — if it's not listed, it's gone
- Try to reattach — a `404` confirms it was destroyed

## Why did my session end?

Every termination looks identical on the wire (see above), so here is the
list of things that actually cause one.

| Reason | When | Applies to |
|---|---|---|
| **Max session duration** | After **1 hour**, or your plan's ceiling if it's lower — Free 15 min, Hobby 60 min, Startup 3 hours, Scale 6 hours | **Every session**, whether or not it's stable |
| **Idle timeout** | **10 minutes** with nothing connected | Stable (`keepAlive`) sessions only |
| **You closed it** | `POST /v1/sessions/{id}/close`, or the dashboard | Any |
| **You disconnected** | Ordinary sessions end when your CDP connection does | Non-`keepAlive` sessions |
| **MCP session reaped** | **30 minutes** idle | Browsers owned by the MCP server |
| **We restarted the gateway** | Stable sessions survive with their remaining time intact. Ordinary sessions do not | Depends |

`GET /v1/sessions` tells you both deadlines **before** they fire, as
`expiresAt` and (for stable sessions) `idleExpiresAt`. If you have a
long-running job, read those rather than being surprised by them.

The lower of your plan's ceiling and the platform ceiling always wins.

## Sessions API

`POST /v1/sessions` and its subresources, on `connect.runbrowser.dev`.
Plain-text bodies.

| Status | Body | Cause |
|---|---|---|
| 405 | `method not allowed` | Wrong verb. The `Allow` header lists what's accepted |
| 401 | `invalid or missing token` | Bad key |
| 415 | `Content-Type must be application/json` | Wrong content type. Omitting the header entirely is fine |
| 413 | `request body too large (16 KB limit)` | Body over 16 KB |
| 400 | `invalid JSON: …` | Malformed body — **or an unknown field**. We reject fields we don't recognise rather than ignoring them, so a typo'd option is an error instead of a silent no-op |
| 400 | `proxy.url is required for type=external` | Missing proxy URL |
| 400 | `unsupported proxy.type … (only "external" in v1)` | Only external proxies for now |
| 404 | `session not found` | Already gone |
| 403 | `session belongs to a different org` | Wrong key |
| 502 | `could not create session: …` | We failed to record it. Retry |

## REST shortcuts

`/screenshot`, `/pdf`, `/content`, `/scrape`, `/function`, `/export`,
`/smart-scrape`, `/map`, `/crawl`, `/download` and `/unblock` on
`connect.runbrowser.dev`. Plain-text bodies.

| Status | Body | Cause | What to do |
|---|---|---|---|
| 401 | `invalid or missing token` | Bad key. We check auth **before** reading your body | Fix the key |
| 400 | `url must be http(s)://...` | Bad scheme, **or** a URL pointing at a private/internal address, which we refuse | Use a public http(s) URL |
| 400 | `invalid json: …` | Malformed body. Limit is 1 MiB | Fix the body |
| 400 | `invalid cookies: …` | e.g. `cookies[0].name is required` | Fix the cookie |
| 400 | `format must be png\|jpeg\|webp` | `/screenshot` only | Use a supported format |
| 400 | `selector "…" matched no element` | `/screenshot`. Note `/scrape` returns an **empty result set**, not an error, for the same situation | Fix the selector |
| 400 | `elements must be a non-empty array` | `/scrape` without `elements` | Supply them |
| **504** | `page never reached document.readyState=complete: …` | **The page never finished loading.** Default 30s, max 60s | Raise `waitForTimeout` (in ms, ≤60000), or target a page that settles |
| 502 | `navigate failed: …`, `attach failed: …`, `printToPDF failed: …` | The browser failed mid-operation | Retry with backoff |
| 429 / 503 | as [Connecting a browser](#connecting-a-browser) | Quota, concurrency, or fleet capacity | Same handling |

## /v1/fetch

JSON bodies. Note that most of these have **no `message` field** — the
code is the whole answer.

| Status | `error` | Cause | What to do |
|---|---|---|---|
| 403 | `invalid_url` | Blank, unparseable, or hostless | Send an absolute URL |
| 400 | `url_too_long` | Over 2048 characters | Shorten it |
| 403 | `invalid_url_scheme` | Not http or https | Use http(s) |
| 403 | `blocked_target` | The hostname or the address it resolves to is internal | Target a public address |
| 403 | `dns_unresolved` | The hostname didn't resolve | Check it; may be transient |
| 400 | `invalid_method` | Method not allowed | Use a standard method |
| 400 | `request_body_too_large` | Over 1,000,000 bytes | Shrink it |
| 400 | `headers_too_large` | Over 100 headers, or one over 8192 characters | Send fewer |
| **504** | `target_timeout` | **The site didn't respond in time.** Default 30s, max 60s | Raise `timeoutMs` (≤60000), or retry |
| 502 | `target_unreachable` | Connection refused, or the transfer failed | Check the URL; retry |
| 502 | `target_tls_error` | Their certificate is broken | Usually not fixable from your side |
| 429 | `monthly_quota_exceeded` | Fetch allowance exhausted | Upgrade or wait for month rollover |

A response over 10 MB comes back as a **success** with `truncated: true`.
It is not an error.

## /v1/extract

Extract is the one endpoint where two different things both return `429`,
so this is the clearest case for branching on `error` rather than status.

| Status | `error` | Cause | What to do |
|---|---|---|---|
| **402** | `spend_cap_exceeded` | **Your account has reached its monthly third-party spend ceiling.** Separate from the extract allowance: large pages cost more, so you can hit this while still inside your call allowance | Wait for the month to roll over, or contact us to raise it. `spentUsd` and `capUsd` are in the response |
| 400 | `schema_invalid` | Your JSON Schema isn't valid | Fix the schema; `message` says how |
| **422** | `schema_validation_failed` | **The model couldn't produce data matching your schema**, even after a retry | Simplify the schema, or add `instructions` telling it where to look |
| 401 / 403 | `auth_failed` | Your key was rejected downstream | Fix the key |
| **429** | `rate_limited` | A concurrency or capacity limit downstream — **transient** | Back off and retry |
| **429** | `monthly_quota_exceeded` | Your extract allowance is gone — **not transient** | Upgrade or wait for rollover |
| 502 | `gateway_unreachable`, `gateway_error` | The browser tier failed | Retry |
| 502 | `llm_transport_failed`, `llm_provider_error`, `llm_unparseable` | The model provider failed | Retry |
| 503 | `llm_not_configured` | Extraction is temporarily unavailable | Contact us |

`422` is worth internalising: it means we reached the page and read it,
but the result didn't fit the shape you asked for. That is usually a
schema problem, not a page problem. Loosen the required fields first.

## MCP server

Two layers, and they fail differently.

**HTTP layer** — plain text:

| Status | Body | What to do |
|---|---|---|
| 401 | `invalid or missing token` | Fix the key |
| **404** | `unknown or expired MCP session` | **Your session was reaped after 30 minutes idle.** Send `initialize` again — the MCP spec expects clients to handle this |
| 400 | `Mcp-Session-Id header required` | Send the ID you got from `initialize` |
| 400 | `unsupported MCP-Protocol-Version` | Use `2025-06-18` or `2025-03-26` |
| 403 | `origin not allowed` | You're calling from a browser origin we don't allow |
| 405 | `this server does not offer an SSE stream` | Use POST, not GET |

**Tool failures are not HTTP errors.** A tool that fails returns `200`
with `isError: true` and the reason as text, because that's what lets a
model read the problem and adapt instead of crashing:

```json
{ "content": [{ "type": "text", "text": "this account already has the maximum number of browsers running; close one and retry" }], "isError": true }
```

Tools time out at 120 seconds, and returned content is truncated at
120,000 characters with a marker saying so.

## Live viewer

Viewer URLs are signed and short-lived on purpose — anyone with the link
can watch the session.

| Status | Body | What to do |
|---|---|---|
| 401 | `a signed viewer URL is required; …` | Mint one with `POST /v1/sessions/{id}/viewer-token`. **Bearer tokens are not accepted here** |
| 401 | `viewer URL: viewer URL expired` | Mint a new one. Default life is 1 hour, max 24 |
| 403 | `viewer URL: viewer URL signature invalid` | The URL was altered, or was minted before a gateway restart. Mint a new one |
| 404 | `session not found` | The session has ended |

## Blocked, not broken

The most confusing failure in this whole product is not an error at all.

When a site blocks you, `/v1/fetch` returns **HTTP 200**. The block is
reported in the body, and `status` carries the site's real status:

```json
{
  "status": 403,
  "blocked": true,
  "blockReason": "bot_blocked",
  "blockProvider": "cloudflare",
  "body": "…"
}
```

Check `blocked` before you trust `body`. Otherwise you will happily parse
a "Checking your browser" interstitial as if it were the page, and the
bug will surface much later as bad data rather than as a failure.

`blockReason` is one of:

| Value | Meaning |
|---|---|
| `waf_challenge` | A firewall is running an interstitial challenge |
| `captcha` | A CAPTCHA wall |
| `rate_limited` | The site is rate-limiting you |
| `geo_blocked` | Refused in this region |
| `waf_block` | A firewall refused outright |
| `bot_blocked` | Identified as a bot |
| `shell_page` | A suspiciously empty page — usually a soft block |

`blockProvider` is one of `cloudflare`, `aws_waf`, `akamai`, `datadome`,
`imperva`, `perimeterx`, `kasada`, `vercel` — **and may be `null` even
when `blocked` is true**, because not every blocker identifies itself.

When you hit this, `/v1/fetch` is the wrong tool: it's plain HTTP and runs
no JavaScript. Use a real browser session, optionally with
[a coherent device profile and a residential proxy](concepts.md#device-profile).

The MCP `fetch` tool prepends `[anti-bot block detected: …]` to the text
for the same reason — so a model doesn't summarise a block page as
content.

## Proxies

We validate the **syntax and safety** of your proxy URL, not whether it
works. A proxy that is unreachable, or whose credentials are wrong, will
pass validation and then fail inside the browser as ordinary navigation
failures. That's deliberate — we can't reach your proxy to test it — but
it does mean a broken proxy looks like a broken site.

Proxy problems that *are* immediate 400s:

| Message | Cause |
|---|---|
| `scheme "…" not supported; use http, https, or socks5` | SOCKS4 isn't supported — it has no authentication |
| `proxy port is required` | No port |
| `proxy host is empty` | No host |
| `proxy URL exceeds 2048 bytes` | Too long |
| `proxy points to disallowed address …` | Points at a private or loopback address |
| `proxy hostname "…" is disallowed` | `localhost`, `*.local`, `*.internal`, `*.localdomain` |
| `proxy hostname "…" resolves to disallowed address …` | Resolves to something internal |

If pages fail only when a proxy is set, and you get no proxy error from
us, the proxy itself is the first thing to check.

## Quotas and limits

Every monthly allowance resets at the **UTC** month boundary. Not your
timezone, not your billing date.

| Limit | Behaviour at the limit |
|---|---|
| Concurrent sessions | Requests **wait ~20 seconds** for a free slot, then `429`. A short burst usually resolves itself |
| Monthly browser-seconds | `429 monthly_quota_exceeded` with `used_seconds`/`limit_seconds` |
| Monthly fetches, extracts | `429 monthly_quota_exceeded` with `type`/`used`/`limit` |
| Fleet capacity | `503` with `Retry-After: 30` |

The difference between `429` and `503` is worth keeping straight: `429`
means *you* hit a limit, `503` means *we* did. See
[Concurrency and queueing](concepts.md#concurrency-and-queueing) for why
both exist.

## A retry policy that works

Retry the transient things, fail fast on the rest, and always cap it.

```ts tab=TypeScript
const TRANSIENT = new Set([409, 502, 503, 504]);

async function call(path: string, body: unknown, attempt = 0): Promise<any> {
  const res = await fetch(`https://api.runbrowser.dev${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RUNBROWSER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.ok) return res.json();

  const err = await res.json().catch(() => ({}));

  // A monthly quota will not clear by retrying — only an upgrade or the
  // UTC month rollover fixes it. Every other 429 is worth backing off for.
  const permanent429 = res.status === 429 && err.error === 'monthly_quota_exceeded';
  const worthRetrying = (TRANSIENT.has(res.status) || res.status === 429) && !permanent429;

  if (!worthRetrying || attempt >= 4) {
    throw new Error(`${path} failed: ${res.status} ${err.error ?? ''}`);
  }

  // Honour Retry-After when we send it (only on the 503), else back off.
  const after = Number(res.headers.get('retry-after'));
  const delay = after ? after * 1000 : 2 ** attempt * 500 + Math.random() * 250;
  await new Promise((r) => setTimeout(r, delay));
  return call(path, body, attempt + 1);
}
```

```python tab=Python
import os, random, time, requests

TRANSIENT = {409, 502, 503, 504}
API = "https://api.runbrowser.dev"


def call(path, body, attempts=5):
    headers = {"Authorization": f"Bearer {os.environ['RUNBROWSER_TOKEN']}"}
    for attempt in range(attempts):
        res = requests.post(f"{API}{path}", headers=headers, json=body)
        if res.ok:
            return res.json()

        err = res.json() if "json" in res.headers.get("content-type", "") else {}

        # A monthly quota will not clear by retrying — only an upgrade or the
        # UTC month rollover fixes it. Every other 429 is worth backing off for.
        permanent_429 = res.status_code == 429 and err.get("error") == "monthly_quota_exceeded"
        worth_retrying = (res.status_code in TRANSIENT or res.status_code == 429) and not permanent_429

        if not worth_retrying or attempt == attempts - 1:
            raise RuntimeError(f"{path} failed: {res.status_code} {err.get('error', '')}")

        # Honour Retry-After when we send it (only on the 503), else back off.
        after = res.headers.get("retry-after")
        time.sleep(int(after) if after else 2**attempt * 0.5 + random.random() * 0.25)
```

For CDP connections, the equivalent is to catch the connect failure, read
the status out of the message, and reconnect on `429`/`503` only.

## Reporting abuse

If traffic from our addresses is causing you a problem — scraping you didn't
consent to, login attempts you didn't expect, anything that looks like an
attack — mail <abuse@runbrowser.dev> with the target, the timestamps and any
log lines you have.

We can suspend a customer account, and we will where it's warranted. We would
much rather hear from you than from your hosting provider.

## Still stuck?

If you get a status that isn't on this page, or one that is but the
explanation doesn't match what you're seeing, that's a bug in our docs and
we want to know. Mail <hi@runbrowser.dev> with the status, the `error`
code, and roughly when it happened, and we'll look at the actual logs.

## Next

- [Concepts](concepts.md) — sessions, quotas, stable sessions, the viewer
- [API reference](api-reference.md) — every endpoint
- [Quickstart](quickstart.md) — connect in one line
