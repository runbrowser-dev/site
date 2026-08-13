# Quickstart

Change one line in a Playwright or Puppeteer script and it runs on our
browsers instead of yours.

## 1. Get a key

Sign in at `https://app.runbrowser.dev` (magic link, no password), then
**API keys → Create**. The key is shown once and looks like `ab_…`.

Keep it in an environment variable. A key pasted into source is a key that
ends up in git history, and ours grant browser-time that costs real money.

## 2. Point your script at us

```ts tab=TypeScript
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP(
  `https://connect.runbrowser.dev?token=${process.env.RUNBROWSER_TOKEN}`,
);
const page = await browser.newPage();
await page.goto('https://example.com');
await page.screenshot({ path: 'out.png' });
await browser.close();
```

```python tab=Python
import os
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(
        f"https://connect.runbrowser.dev?token={os.environ['RUNBROWSER_TOKEN']}"
    )
    page = browser.new_page()
    page.goto("https://example.com")
    page.screenshot(path="out.png")
    browser.close()
```

Puppeteer is the same idea:

```ts
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: `wss://connect.runbrowser.dev?token=${process.env.RUNBROWSER_TOKEN}`,
});
```

That's the whole migration. No SDK, no wrapper, no rewrite — your
existing selectors, waits and assertions are unchanged.

If the connection is refused, the reason is in the close code — see
[Errors](errors.md).

## 3. Or skip the browser entirely

Half of what agents do with a browser doesn't need one. These cost no
browser-time:

```bash tab=cURL
# Read a page as markdown (plain HTTP — fast, but no JavaScript runs)
curl -X POST https://api.runbrowser.dev/v1/fetch \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "format": "markdown"}'

# Search the web
curl -X POST https://api.runbrowser.dev/v1/search \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"q": "browser automation", "count": 5}'

# Pull structured data out of a page (renders it in a real browser first)
curl -X POST https://api.runbrowser.dev/v1/extract \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "schema": {
      "type": "object",
      "properties": { "title": {"type": "string"} },
      "required": ["title"]
    }
  }'
```

```python tab=Python
import os, requests

API = "https://api.runbrowser.dev"
auth = {"Authorization": f"Bearer {os.environ['RUNBROWSER_TOKEN']}"}

# Read a page as markdown (plain HTTP — fast, but no JavaScript runs)
page = requests.post(
    f"{API}/v1/fetch", headers=auth,
    json={"url": "https://example.com", "format": "markdown"},
).json()

# Search the web
hits = requests.post(
    f"{API}/v1/search", headers=auth,
    json={"q": "browser automation", "count": 5},
).json()

# Pull structured data out of a page (renders it in a real browser first)
data = requests.post(
    f"{API}/v1/extract", headers=auth,
    json={
        "url": "https://example.com",
        "schema": {
            "type": "object",
            "properties": {"title": {"type": "string"}},
            "required": ["title"],
        },
    },
).json()
```

```ts tab=TypeScript
const API = 'https://api.runbrowser.dev';
const auth = {
  Authorization: `Bearer ${process.env.RUNBROWSER_TOKEN}`,
  'Content-Type': 'application/json',
};

const call = async (path: string, body: unknown) => {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
};

// Read a page as markdown (plain HTTP — fast, but no JavaScript runs)
const page = await call('/v1/fetch', { url: 'https://example.com', format: 'markdown' });

// Search the web
const hits = await call('/v1/search', { q: 'browser automation', count: 5 });

// Pull structured data out of a page (renders it in a real browser first)
const data = await call('/v1/extract', {
  url: 'https://example.com',
  schema: {
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
  },
});
```

## 4. Or give your agent the browser as a tool

If you're building with an MCP-aware agent, skip the code entirely:

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

Nine tools appear: `fetch`, `search`, `extract`, and a `browser_*` family
that drives one persistent browser across calls. See [mcp.md](mcp.md).

## What you're billed for

**Browser-time, by the second** — from the moment a browser is provisioned
to the moment it's released. Not per session, so a script that opens one
browser and drives it for an hour costs the same as sixty scripts that
each take a minute.

`/v1/fetch` and `/v1/search` are billed per call against a separate
monthly allowance and consume no browser-time at all. `/v1/extract` uses a
browser, so it does.

The meter stops when your CDP connection closes — unless you asked for a
[stable session](concepts.md#stable-sessions), which keeps the browser
parked and *keeps billing* until it's closed or idles out. That trade is
the point of the feature, but know that you're making it.

## Next

- [Concepts](concepts.md) — sessions, quotas, stable sessions, the viewer
- [API reference](api-reference.md) — every endpoint
- [Errors](errors.md) — every status code, what causes it, what to do
- [Migrating from Browserless](migrating-from-browserless.md)
- [Migrating from Browserbase](migrating-from-browserbase.md)
