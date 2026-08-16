# SDKs

Typed clients for TypeScript and Python. Both are thin, both are optional, and
neither hides the browser from you.

```bash tab=npm
npm install runbrowser
```

```bash tab=pip
pip install runbrowser
```

```ts tab=TypeScript
import { RunBrowser } from 'runbrowser'

const rb = new RunBrowser()          // reads RUNBROWSER_API_KEY
const png = await rb.screenshot({ url: 'https://example.com' })
```

```python tab=Python
from runbrowser import RunBrowser

rb = RunBrowser()                    # reads RUNBROWSER_API_KEY
png = rb.screenshot(url="https://example.com")
```

## Two libraries, and which does what

The most confusing thing about these clients is the split, so here it is
plainly:

| | Does what | Which library |
|---|---|---|
| **Control** | Sessions, quotas, proxies, and the one-shot calls — screenshot, extract, unblock, crawl | **RunBrowser SDK** |
| **Driving** | Clicking, typing, waiting, evaluating — everything inside a page | **Playwright** (or Puppeteer) |

The SDK does **not** have `click()` or `type()`, and that is deliberate rather
than unfinished. Playwright already does those better than we would, you
already know it, and standard CDP is the point of the product. A client that
reimplemented page driving would make this platform something you have to
learn instead of something you point existing code at — and it would make
leaving expensive, which is not a thing worth building on purpose.

## `connect()` — the one-call path

If you want a browser and a page, you don't have to do the three-step dance
yourself:

```ts tab=TypeScript
import { chromium } from 'playwright'
import { RunBrowser } from 'runbrowser'

const rb = new RunBrowser()
const { page, session, close } = await rb.connect({ chromium, keepAlive: true })

await page.goto('https://example.com')          // ← Playwright's own Page
console.log('watch it:', await session.viewerUrl())

await close()                                   // browser AND session
```

```python tab=Python
from playwright.sync_api import sync_playwright
from runbrowser import RunBrowser

rb = RunBrowser()

with sync_playwright() as p:
    with rb.connect(p.chromium, keepAlive=True) as (browser, page, session):
        page.goto("https://example.com")        # ← Playwright's own Page
        print("watch it:", session.viewer_url())
# browser and session both closed here
```

`page` and `browser` are Playwright's own objects — not wrappers — so every
method you know works unchanged, and the API docs you already read still apply.

Two things it handles that are easy to get wrong by hand: it reuses the tab
that is already open (a page *you* create is closed when the connection drops,
taking its state with it), and `close()` shuts the browser **and** the session.
Closing only the browser leaves a stable session parked and still billing.

You pass `chromium` in rather than the SDK importing it, so installing the SDK
never drags a browser stack into a project that only wanted a screenshot — and
so it works under pnpm and Yarn PnP, where a library importing its consumer's
dependency does not resolve.

## Prefer to wire it yourself

`connectUrl()` hands you a URL and gets out of the way:

```ts tab=TypeScript
import { chromium } from 'playwright'

const browser = await chromium.connectOverCDP(rb.connectUrl())
// Every script you already have works unchanged from here.
```

```python tab=Python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(rb.connect_url())
```

Adopting RunBrowser stays a one-line change. So does leaving, which is the
honest test of whether a client is thin.

## What they're worth using for

**Routing that lands in the right place.** `proxy`, `country` and `session` are
query parameters server-side. Put them in a JSON body by hand and they are
silently ignored — the request succeeds and simply doesn't use your proxy. The
clients lift them into the query string for you.

```ts tab=TypeScript
await rb.screenshot({ url, proxy: 'residential', country: 'de' })
```

```python tab=Python
rb.screenshot(url=url, proxy="residential", country="de")
```

**Sessions that stop billing.** A parked stable session keeps charging until it
idles out. Both clients bind that to a scope:

```ts tab=TypeScript
const session = await rb.sessions.create({ keepAlive: true })
try {
  const browser = await chromium.connectOverCDP(session.connectUrl)
  // Reuse the existing tab — a page you create dies with your connection.
  const page = browser.contexts()[0].pages()[0]
  await page.goto('https://app.example.com')
  await browser.close()
} finally {
  await session.close()
}
```

```python tab=Python
with rb.create_session(keepAlive=True) as session:
    ...
# closed here, even if the block raised
```

**A connect URL that actually connects.** A stable session's URL from the API
carries the session *id*, not a credential — handed straight to
`connectOverCDP` it's a `401`. An ordinary session's URL carries a one-use
token and needs nothing added. The clients handle both, so the distinction
never reaches your code.

**Errors you can branch on.** The status and the server's own error code
survive, because the difference between `429` and `422` is the difference
between waiting and fixing your schema.

```ts tab=TypeScript
try {
  await rb.extract({ url, schema })
} catch (err) {
  if (err instanceof RunBrowserError && err.retryable) await backoff()
}
```

```python tab=Python
try:
    rb.extract(url=url, schema=schema)
except RunBrowserError as err:
    if err.retryable:
        backoff()
```

## Everything else is the REST API

Every method maps to one documented endpoint, using the server's own field
names, so the [API reference](/docs/api-reference) reads as the client's
reference too:

| Client | Endpoint |
|---|---|
| `screenshot` `pdf` `content` `scrape` `function` | [REST shortcuts](/docs/api-reference#rest-shortcuts) |
| `unblock` | [`POST /unblock`](/docs/api-reference#post-unblock--json) |
| `map` `crawl` `download` | [Crawling](/docs/guide-crawling) |
| `fetch` `extract` | [Primitives](/docs/api-reference#primitives) |
| `sessions.*` | [Sessions](/docs/api-reference#sessions) |

If a client is ever missing something, the endpoint is right there and a plain
HTTP call is a supported way to use this platform — not a workaround.

## Testing

Swap in your own `fetch` to assert what your code sends without touching the
network — a test double, a proxy agent, or a tracing wrapper:

```ts tab=TypeScript
new RunBrowser({
  apiKey: 'test-key',
  fetch: async (url, init) => {
    recorded.push({ url, init })
    return new Response(JSON.stringify({ data: { title: 'stub' } }))
  },
})
```

```python tab=Python
# The Python client speaks plain HTTP, so point it at a local stub server:
RunBrowser("test-key", connect_url="http://127.0.0.1:8931", api_url="http://127.0.0.1:8931")
```

The TypeScript client needs Node 18+ and has no runtime dependencies. The
Python client needs 3.9+ and uses only the standard library.

See also: [Sessions](/docs/guide-sessions), [Getting through
walls](/docs/guide-unblocking), and the
[MCP server](/docs/mcp) if you're wiring an agent rather than writing code.
