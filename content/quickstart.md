# Quickstart

Change one line in a Playwright or Puppeteer script and it runs on our
browsers instead of yours.

## 1. Get a key

Sign in at `https://app.runbrowser.dev` (magic link, no password), then
**API keys → Create**. The key is shown once and looks like `ab_…`.

## 2. Point your script at us

```ts
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP(
  `https://connect.runbrowser.dev?token=${process.env.RUNBROWSER_TOKEN}`,
);
const page = await browser.newPage();
await page.goto('https://example.com');
await page.screenshot({ path: 'out.png' });
await browser.close();
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

## 3. Or skip the browser entirely

Half of what agents do with a browser doesn't need one. These cost no
browser-time:

```bash
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
- [Migrating from Browserless](migrating-from-browserless.md)
- [Migrating from Browserbase](migrating-from-browserbase.md)
