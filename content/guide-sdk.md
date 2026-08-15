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

## What they deliberately don't do

They don't wrap Playwright or Puppeteer. You already know those, and standard
CDP is the point of the product — a client that hides it behind its own
vocabulary would make this platform something you have to learn instead of
something you point your existing code at.

So the SDK hands you a connect URL and gets out of the way:

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

## Self-hosted and testing

```ts tab=TypeScript
new RunBrowser({
  apiKey: '…',
  connectUrl: 'http://localhost:3000',
  apiUrl: 'http://localhost:8080',
  fetch: myInstrumentedFetch,     // proxy agent, tracing, a test double
})
```

```python tab=Python
RunBrowser(
    api_key="…",
    connect_url="http://localhost:3000",
    api_url="http://localhost:8080",
)
```

The TypeScript client needs Node 18+ and has no runtime dependencies. The
Python client needs 3.9+ and uses only the standard library.

See also: [Sessions](/docs/guide-sessions), [Getting through
walls](/docs/guide-unblocking), and the
[MCP server](/docs/mcp) if you're wiring an agent rather than writing code.
