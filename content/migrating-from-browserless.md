# Migrating from Browserless

Change the host. That's usually the whole migration.

```diff
- wss://production-sfo.browserless.io?token=YOUR_TOKEN
+ wss://connect.runbrowser.dev?token=ab_yourkey
```

Both speak CDP, both take the token as a query parameter, both work with
`chromium.connectOverCDP()` and `puppeteer.connect()`. Your selectors,
waits and assertions don't change.

## What maps directly

| Browserless | Us | Notes |
|---|---|---|
| `wss://…?token=` (Puppeteer, Playwright over CDP) | `wss://connect.runbrowser.dev?token=` | Identical |
| `POST /screenshot` | `POST /screenshot` | Same body shape |
| `POST /pdf` | `POST /pdf` | Same body shape |
| `POST /content` | `POST /content` | Same body shape |
| `POST /scrape` | `POST /scrape` | Same `elements[]` shape |

The REST bodies were written against Browserless's shapes on purpose, so
existing calls generally work untouched.

## What we don't have

Be honest with yourself about this list before you switch:

| Browserless | Status here |
|---|---|
| `/function` | **No equivalent.** You run your own code via CDP instead. |
| `/unblock` | No. Our stealth is always-on and there's no bypass endpoint to call. |
| `/download`, `/export` | No. Use CDP's download handling. |
| `/performance` (Lighthouse) | No. |
| `/crawl`, `/map`, `/smart-scrape` | No. `/v1/fetch` + `/v1/search` cover some of this differently. |
| BrowserQL (GraphQL automation language) | No, and not planned. We bet on plain Playwright. |
| Firefox, WebKit | No. Chromium only. |
| `/search` | Different: ours is `POST /v1/search` on the API host with `{q, count}`. |
| Session replay / recording | No. The [live viewer](concepts.md#live-viewer) shows the present, not the past. |
| Bundled proxies | BYO proxy. Wholesale pricing from your provider, no markup from us. |

If you depend on `/function` or BrowserQL, this isn't a drop-in and you
should budget real work — or stay where you are.

## What you get here

- **Stable sessions** that survive disconnect with *full* state — in-memory
  SPA state and open tabs, not just cookies. [Details](concepts.md#stable-sessions).
- **`/v1/extract`** — URL plus JSON Schema in, validated structured JSON out.
- **An MCP server**, so any MCP-aware agent gets browser tools with no
  integration code. [Details](mcp.md).
- **Live viewer with signed shareable URLs** that are safe to paste into a
  ticket — no API key inside.
- **EU residency.** Sessions and session data stay inside the EU. If EU-only
  matters to you legally, we're single-region by design; check their current
  region list against your own requirements.

## Billing differences that will actually surprise you

> Their pricing is theirs to change, and this page won't always keep up.
> The figures below were read off browserless.io's published pricing on
> **2026-08-13**; check the current terms before you make a decision on
> them. We describe the *shape* of the difference because that's what
> tends to persist — not to score a point on the numbers.

Browserless bills in **units**, where a unit covers a block of browser
time and partial blocks round **up**. We bill **browser-seconds**, floored
at 10 seconds per session, plus separate monthly allowances for
`/v1/fetch`, `/v1/search` and `/v1/extract`. Proxy traffic and CAPTCHA
solving stay on your providers' bills rather than ours.

The practical consequences:

- **Short sessions get cheaper.** Rounding a block up means a 3-second
  session bills as a whole block. Ours bills as 10 seconds. If your
  workload is many short sessions, this is the single biggest difference
  in the whole migration — and the one to model against your own numbers.
- **CAPTCHA solving moves to your own account.** We don't offer it. You
  bring a CapSolver or 2Captcha key to [`/unblock`](/docs/guide-unblocking) and
  pay them directly at their list price. Usually cheaper than a bundled
  rate, but it's a signup you didn't have before.
- **Your proxy bill becomes visible.** Bundled proxy traffic stops being
  part of one invoice and becomes a line item from your proxy provider.
  Usually cheaper at wholesale, but always more work to set up.
- **Parked stable sessions bill while parked.** Same as Browserbase, and
  worth knowing before you leave one open overnight.

## Concurrency

Browserless sells concurrency by plan; so do we, but at the limit we
**queue** for about 20 seconds before returning 429, where a hard cap
would reject immediately. Retry logic written against a strict cap still
works — it'll just fire less often.

Concurrency by tier: Free 3, Hobby 10, Startup 25, Scale 50.

There are two limits, and they return different codes:

| Limit | Meaning | Response |
|---|---|---|
| Your tier's concurrency | You're at your own ceiling | `429` after queueing |
| Fleet capacity | The whole box is full | `503` + `Retry-After` |

The `503` is rare and not your fault — it means every customer's traffic
together exceeded the hardware. Treat it as retryable. We'd rather return
it than keep spawning browsers until the box runs out of memory and takes
down sessions that were well inside their limits.

## A realistic migration

1. Point one non-critical script at `connect.runbrowser.dev` and run it.
2. Grep your codebase for `browserless.io` — that finds the REST calls
   you'd forgotten.
3. Check the "don't have" table above against those hits.
4. Move the rest, keeping your Browserless account alive for a week.

Most people are done in an afternoon. If you're not, the thing blocking
you is almost certainly on that list.
