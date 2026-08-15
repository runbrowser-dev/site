# Sessions & stable sessions

A **session** is one browser, yours for as long as you're connected. Connect,
drive it with Playwright or Puppeteer, disconnect — and by default the browser
is destroyed and its state goes with it. A **stable session** keeps that
browser alive between connects, so the second connect lands on the same tabs,
the same in-memory SPA state, the same everything — not just the same cookies.

## An ordinary session

Connect over CDP and it's a normal Playwright script from there. One line
differs from running locally: the endpoint.

```ts tab=TypeScript
import { chromium } from 'playwright'

const browser = await chromium.connectOverCDP(
  `wss://connect.runbrowser.dev?token=${process.env.RUNBROWSER_TOKEN}`,
)
const page = await browser.newPage()
await page.goto('https://example.com')
console.log(await page.title())
await browser.close()   // the browser is destroyed here
```

```python tab=Python
from playwright.sync_api import sync_playwright
import os

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(
        f"wss://connect.runbrowser.dev?token={os.environ['RUNBROWSER_TOKEN']}"
    )
    page = browser.new_page()
    page.goto("https://example.com")
    print(page.title())
    browser.close()   # the browser is destroyed here
```

You're billed for the wall-clock time the browser is alive, per second, floored
at 10 seconds. Closing the browser stops the meter — see [Billing](/docs/concepts#browser-time-billing).

## A stable session

Two things change. You create the session up front, and you reconnect to it by
id instead of opening a fresh browser.

```ts tab=TypeScript
// 1. Create a session that outlives the connection.
const res = await fetch('https://connect.runbrowser.dev/v1/sessions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.RUNBROWSER_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ keepAlive: true, maxIdleSeconds: 600 }),
})
const { sessionId, connectUrl } = await res.json()

// 2. Connect, do the first half of the work, disconnect.
let browser = await chromium.connectOverCDP(connectUrl)
let page = (await browser.contexts())[0].pages()[0] ?? await browser.newPage()
await page.goto('https://app.example.com/login')
// … sign in …
await browser.close()   // the BROWSER stays alive; only your connection drops

// 3. Later — a different process, even — reconnect to the same browser.
browser = await chromium.connectOverCDP(connectUrl)
page = (await browser.contexts())[0].pages()[0]
// Still logged in. Still on the same page. Still holding SPA state.
```

Note the two `connectUrl` shapes, because they authenticate differently:

- An **ordinary** session's URL carries a one-use credential and connects on
  its own for 60 seconds. Don't append your API key to it.
- A **stable** session's URL carries the session *id* — an identifier, not a
  credential, because a session you reconnect to for an hour can't be
  expressed as one-use. Add your key: `?session=<sessionId>&token=<key>`.
  Handed to `connectOverCDP` without it, you get a `401`.

The [SDK](/docs/guide-sdk) hands you a URL that already works in both cases, so
this distinction never reaches your code.

**Reuse the existing page; don't call `newPage()`.** The example above takes
`pages()[0]` on purpose. A page Playwright creates is closed when your
connection drops, taking its state with it — which defeats the point. The tab
that's already there survives.

### What survives, and what doesn't

| Survives | Doesn't |
|---|---|
| Open tabs and their URLs | A restart of the **host machine** — containers die with it |
| In-memory JS state, a hydrated SPA | Anything past `maxIdleSeconds` of no connection |
| Cookies, localStorage, session storage | Anything past the hard max session lifetime |
| Our own redeploys of the platform | |

A reattach to a session that has since been reclaimed returns
[`404`](/docs/errors) — the case worth writing a retry around.

## Keeping the meter honest

A parked stable session **keeps billing** until it idles out — it's a live
browser holding a slot. `maxIdleSeconds` is your backstop, and the dashboard's
Sessions panel lists everything running so you can close what you forgot.

```ts tab=TypeScript
// Close a stable session explicitly when you're done with it.
await fetch(`https://connect.runbrowser.dev/v1/sessions/${sessionId}/close`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.RUNBROWSER_TOKEN}` },
})
```

## When to reach for which

- **Ordinary session** — a scrape, a screenshot, a one-shot automation. Open,
  work, close. Cheapest and simplest.
- **Stable session** — a multi-step agent flow, anything where signing in once
  and reusing the logged-in browser across several calls beats re-authenticating
  every time.

See also: [the live viewer](/docs/guide-viewer) to watch a session run, and the
[API reference](/docs/api-reference#sessions) for every session field.
