# Recipes

Complete, runnable answers to the jobs people actually bring here. Each one
says what it costs and where it usually goes wrong.

The guides explain features; these solve tasks. If your job isn't here,
[tell us](mailto:hi@runbrowser.dev) — the gaps in this page are the most
useful bug reports we get.

---

## Log in once, then scrape behind the login

The most common real job, and the one where the naive version quietly burns
money: signing in on every run costs a fresh login every time, and some sites
start challenging you for it.

Sign in once into a [stable session](/docs/guide-sessions), then reconnect to
that same browser for as many runs as you need.

```ts tab=TypeScript
import { chromium } from 'playwright'
import { RunBrowser } from 'runbrowser'

const rb = new RunBrowser()

// One session, alive between connections.
const session = await rb.sessions.create({ keepAlive: true, maxIdleSeconds: 900 })

// --- run 1: sign in -------------------------------------------------------
{
  const browser = await chromium.connectOverCDP(session.connectUrl)
  const page = browser.contexts()[0].pages()[0]        // reuse the open tab

  await page.goto('https://app.example.com/login')
  await page.fill('#email', process.env.APP_USER!)
  await page.fill('#password', process.env.APP_PASS!)
  await page.click('button[type=submit]')
  await page.waitForURL('**/dashboard')

  await browser.close()      // your connection drops; the browser stays alive
}

// --- run 2: minutes later, a different process ---------------------------
{
  const browser = await chromium.connectOverCDP(session.connectUrl)
  const page = browser.contexts()[0].pages()[0]
  // Still signed in. Still on the dashboard.
  await page.goto('https://app.example.com/reports')
  console.log(await page.textContent('.report-total'))
  await browser.close()
}

await session.close()        // stops the meter
```

```python tab=Python
from playwright.sync_api import sync_playwright
from runbrowser import RunBrowser
import os

rb = RunBrowser()

with rb.create_session(keepAlive=True, maxIdleSeconds=900) as session:
    with sync_playwright() as p:
        # --- run 1: sign in ---
        browser = p.chromium.connect_over_cdp(session.connect_url)
        page = browser.contexts[0].pages[0]            # reuse the open tab
        page.goto("https://app.example.com/login")
        page.fill("#email", os.environ["APP_USER"])
        page.fill("#password", os.environ["APP_PASS"])
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard")
        browser.close()      # connection drops; browser stays alive

        # --- run 2 ---
        browser = p.chromium.connect_over_cdp(session.connect_url)
        page = browser.contexts[0].pages[0]
        page.goto("https://app.example.com/reports")   # still signed in
        print(page.text_content(".report-total"))
        browser.close()
# session closed here — the meter stops
```

> **The mistake everyone makes:** calling `newPage()` instead of taking
> `pages()[0]`. A page *you* create is closed when your connection drops, and
> its state goes with it — which defeats the entire point. Reuse the tab that
> is already there.

**Cost:** the browser bills for the whole time it is alive, *including while
parked between runs*. That trade is the feature, but set `maxIdleSeconds` so a
forgotten session can't run all night. If your runs are hours apart, sign in
each time instead — it's cheaper.

---

## Turn a whole site into typed data

Two steps: find the pages, then extract each one against a schema. Don't crawl
when a sitemap will do — [`/map`](/docs/guide-crawling) reads the sitemap *and*
the on-page links, and tells you which gave what.

```ts tab=TypeScript
const rb = new RunBrowser()

// 1. Discover. Cheap — one page load.
const { urls, sources, total } = await rb.map({
  url: 'https://shop.example.com',
  limit: 500,
})
console.log(`${total} urls (${sources.sitemap} from sitemap, ${sources.page} from links)`)

// 2. Keep only what you want.
const products = urls.filter((u) => u.includes('/product/'))

// 3. Extract each against one schema, a few at a time.
const schema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    priceEur: { type: 'number' },
    inStock: { type: 'boolean' },
  },
  required: ['name', 'priceEur'],
}

const results = []
for (let i = 0; i < products.length; i += 5) {
  const batch = products.slice(i, i + 5)
  results.push(
    ...(await Promise.all(
      batch.map((url) =>
        rb.extract({ url, schema, contentFormat: 'markdown-full' })
          .then((r) => ({ url, ...r.data }))
          .catch((err) => ({ url, error: err.code ?? String(err) })),
      ),
    )),
  )
}
```

```python tab=Python
rb = RunBrowser()

found = rb.map(url="https://shop.example.com", limit=500)
print(f"{found['total']} urls "
      f"({found['sources']['sitemap']} sitemap, {found['sources']['page']} links)")

products = [u for u in found["urls"] if "/product/" in u]

schema = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "priceEur": {"type": "number"},
        "inStock": {"type": "boolean"},
    },
    "required": ["name", "priceEur"],
}

results = []
for url in products:
    try:
        r = rb.extract(url=url, schema=schema, contentFormat="markdown-full")
        results.append({"url": url, **r["data"]})
    except Exception as err:
        results.append({"url": url, "error": str(err)})
```

> **Use `contentFormat: "markdown-full"` for listings and product grids.** The
> default (`markdown`) runs article extraction, which is right for prose and
> wrong here — it strips the navigation and repeated blocks that a product page
> keeps its data in.

**Cost:** `/map` is one page load. `/extract` renders a browser *and* spends
model tokens, so it draws on a separate allowance — batch it, cache the
results, and don't re-extract pages that haven't changed.

**When the link graph matters more than the sitemap** — docs sites, wikis,
anything without a sitemap — use [`/crawl`](/docs/guide-crawling) instead, and
always read `stoppedBecause`. A short result with `stoppedBecause: "maxPages"`
is a truncated crawl, not a small site.

---

## Watch a page and tell me when it changes

Monitoring doesn't need a browser most of the time, and using one is the
difference between pennies and real money at hourly frequency.

```ts tab=TypeScript
import { createHash } from 'node:crypto'

const rb = new RunBrowser()

async function check(url: string, lastHash: string | null) {
  const res = await rb.fetch({ url, format: 'markdown' })

  // Check this BEFORE trusting the body, or you'll diff a bot wall against
  // yesterday's real content and alert on nothing.
  if (res.blocked) {
    return { changed: false, blocked: true, provider: res.blockProvider }
  }

  const hash = createHash('sha256').update(res.body).digest('hex')
  return { changed: lastHash !== null && hash !== lastHash, hash, body: res.body }
}
```

```python tab=Python
import hashlib

rb = RunBrowser()

def check(url: str, last_hash: str | None):
    res = rb.fetch(url=url, format="markdown")

    # Check this BEFORE trusting the body.
    if res.get("blocked"):
        return {"changed": False, "blocked": True, "provider": res.get("blockProvider")}

    digest = hashlib.sha256(res["body"].encode()).hexdigest()
    return {"changed": last_hash is not None and digest != last_hash,
            "hash": digest, "body": res["body"]}
```

> **Hash the markdown, not the HTML.** Raw HTML changes on every request —
> CSRF tokens, build hashes, timestamps, ad slots — so an HTML diff alerts
> constantly and you stop reading the alerts. `format: "markdown"` strips all
> of that and leaves the content a human would notice changing.

**If the page needs JavaScript**, swap `fetch` for
[`/smart-scrape`](/docs/guide-crawling), which tries plain HTTP first and only
pays for a browser when the cheap path comes back thin or blocked. It reports
which path it took in `method`, so you can see what you're spending on.

**Cost:** `/v1/fetch` draws on a monthly call allowance and uses **no
browser-time at all**. Hourly checks on a hundred pages is well inside Hobby.

---

## Fill in a form and grab the file it generates

Invoices, exports, reports — the file is behind a form, and often behind a
login too, so a plain HTTP fetch of the download URL returns a login page.
Driving the page keeps the session that authorises the file.

```ts tab=TypeScript
const rb = new RunBrowser()
const { page, close } = await rb.connect({ chromium, keepAlive: true })

try {
  await page.goto('https://portal.example.com/reports')
  await page.selectOption('#period', '2026-07')
  await page.click('#generate')
  await page.waitForSelector('a.download-ready', { timeout: 60_000 })

  // Pull the file through the page's own session — no cookie replay needed.
  const pdf = await rb.download({
    url: page.url(),
    selector: 'a.download-ready',
  })
  await fs.writeFile('report-2026-07.pdf', pdf)
} finally {
  await close()
}
```

> **`/download` follows the link from the page it landed on**, including
> cross-origin redirects, so a link to `files.example.com` that bounces to a
> CDN still resolves. What it cannot do is fetch a download built entirely in
> JavaScript with no URL behind it — a blob assembled in the page. You get a
> clear `404` saying so rather than an empty file.

If the link needs computing rather than reading, pass `code` instead of
`selector`:

```json
{ "url": "…", "code": "return document.querySelector('[data-file]').dataset.file" }
```

---

## Get past a wall, then keep the clearance

When a site puts up an interstitial, don't fight it in a loop — clear it once
and carry the cookies into the calls that do the real work.

```ts tab=TypeScript
const rb = new RunBrowser()

const wall = await rb.unblock({ url: 'https://shop.example.com' })

if (!wall.unblocked) {
  // It tells you which kind of wall, because they need different answers.
  console.error(wall.challenge?.type, '→', wall.advice)
  //   interstitial  → waiting; already done for you
  //   turnstile     → pass solver.provider + solver.apiKey
  //   scoring       → nothing solvable; you need a residential exit IP
  process.exit(1)
}

// The clearance carries into anything else you call.
const data = await rb.scrape({
  url: 'https://shop.example.com/products',
  cookies: wall.cookies,
  elements: [{ selector: '.product-title' }, { selector: '.price' }],
})
```

> **A `scoring` result is not a retry.** reCAPTCHA v3, DataDome and PerimeterX
> score your session rather than posing a question, so no solver clears them
> and no amount of waiting helps. It comes back in milliseconds naming the exit
> IP as the actual lever — see [Proxies](/docs/guide-proxies). Retrying that
> call just spends money to be told the same thing.

**Most walls need no solver.** A passive interstitial resolves itself in a real
browser and `/unblock` waits it out for you at no extra cost. Solving only
enters the picture for a challenge that literally asks a question, and then
[the provider account is yours](/docs/guide-unblocking).

---

## Give an agent the browser as a tool

No glue code: point an MCP-aware agent at the server and it gets twelve tools.

```json
{
  "mcpServers": {
    "runbrowser": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://connect.runbrowser.dev/mcp",
               "--header", "Authorization: Bearer ab_yourkey"]
    }
  }
}
```

Building the loop yourself with LangChain instead:

```python tab=Python
from runbrowser.langchain import get_runbrowser_tools

tools = get_runbrowser_tools()                 # reads RUNBROWSER_API_KEY
agent = create_react_agent(llm, tools)
```

```ts tab=TypeScript
import { getRunBrowserTools } from 'runbrowser/langchain'

const tools = getRunBrowserTools()
```

> **Give the model fewer tools than you have.** `include=["browse_page"]`
> reliably beats handing it all four — a model choosing between two clearly
> different tools picks correctly far more often than one choosing between
> four similar ones.

The tools report failures in terms a model can act on: *"the account is out of
quota, do not retry"*, or *"this site scores the session, no solver clears it —
move on"*. An agent told the truth changes plan; one told `403` retries until
it runs out of steps. See [Integrations](/docs/guide-integrations).

---

## Watch it happen

Any session can be watched live, which is usually faster than adding logging:

```ts tab=TypeScript
const session = await rb.sessions.create({ keepAlive: true })
console.log('watch:', await session.viewerUrl(900))   // signed, expiring, no key inside
```

Safe to paste into a ticket or a Slack thread — the URL carries a signature,
not your API key. See [the live viewer](/docs/guide-viewer).

---

See also: [Sessions](/docs/guide-sessions) · [Crawling](/docs/guide-crawling) ·
[Getting through walls](/docs/guide-unblocking) · [Errors](/docs/errors)
