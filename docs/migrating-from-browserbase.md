# Migrating from Browserbase

Browserbase gives you an SDK that creates a session and hands back a
`connectUrl`. We give you a URL. The shapes are close enough that the
migration is mostly deleting code.

## The direct translation

```diff
- import Browserbase from "@browserbasehq/sdk";
  import { chromium } from "playwright-core";

- const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
- const session = await bb.sessions.create();
- const browser = await chromium.connectOverCDP(session.connectUrl);
+ const browser = await chromium.connectOverCDP(
+   `wss://connect.runbrowser.dev?token=${process.env.RUNBROWSER_TOKEN}`,
+ );

  const context = browser.contexts()[0];
  const page = context.pages()[0];
```

No SDK, no project ID, no session-create round trip. One dependency
fewer in your `package.json`.

If you *want* the create-then-connect shape — to pass a proxy without
putting credentials in a URL, or to get a stable session — it exists:

```ts
const res = await fetch(`https://connect.runbrowser.dev/v1/sessions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ keepAlive: true, maxIdleSeconds: 600 }),
});
const { sessionId, connectUrl } = await res.json();
```

Same two-step, no SDK required.

## Feature-by-feature

| Browserbase | Us |
|---|---|
| `sessions.create()` → `connectUrl` | Direct connect URL, or `POST /v1/sessions` |
| Session persistence via **Contexts** | **Stable sessions** — see below, they're different |
| Live View | [Live viewer](concepts.md#live-viewer), signed expiring URLs |
| Session recording / replay | **No equivalent.** |
| Stagehand | Works — it connects over CDP like anything else |
| Advanced Stealth | Always-on here, no tier gate |
| Bundled CAPTCHA solving | **Not offered.** BYO solver key via the [helper](../examples/captcha/) — you pay wholesale |
| Bundled proxies | BYO proxy, no markup |
| Extensions, file uploads/downloads | Via CDP, no dedicated API |
| Multiple regions | EU only (Falkenstein) |
| Fetch, Search | `POST /v1/fetch`, `POST /v1/search` — comparable, separate allowance |
| Agents, Functions, Model Gateway | **No equivalent.** We're infrastructure; the agent framework is yours. |

## Contexts vs stable sessions — the one real difference

A Browserbase **Context** persists cookies, localStorage and cached auth,
and you attach it to a *new* browser on each run. Our **stable session**
keeps the actual browser alive between connects.

That difference cuts both ways, and which one you want depends on what
you're doing:

**Contexts are better when** you want to run the same logged-in identity
across many independent, spread-out runs. A context costs nothing while
idle, because there's no browser.

**Stable sessions are better when** you're mid-workflow — a multi-step
form, a flow behind MFA, an agent that needs to come back to a page it was
already on. Everything survives, including in-memory SPA state, open tabs,
in-flight requests and scroll position, because it's the same browser.

**The cost model differs and it matters.** A parked stable session bills
while parked; a context doesn't. If your pattern is "log in, do something
once a day", contexts are cheaper and we don't have an equivalent yet — a
Redis-persisted context is on the list, waiting on someone asking. If your
pattern is "an agent working through a flow over minutes", stable sessions
do something contexts can't.

Be honest about which one you actually have.

## Pricing

> Read off browserbase.com's published pricing on **2026-08-13**. Their
> terms are theirs to change and this page won't always keep up — verify
> before deciding on it. What follows describes the shape of the
> difference, which is what tends to persist.

Browserbase's structure is a monthly plan plus browser-hours, with some
capabilities associated with higher tiers. Ours is a plan plus
browser-hours too (€0 / €19 / €99 / €499), with two structural
differences:

- **Stealth isn't a tier here.** Free-tier browsers get the same stack as
  Scale. There's nothing to upgrade into, because our stealth is a handful
  of launch flags rather than a product SKU.
- **CAPTCHAs and proxies are both yours to buy.** We don't solve CAPTCHAs
  on your behalf and we don't resell proxies; you bring a key for each and
  pay wholesale. Cheaper, but more setup. If you'd rather the invoice be
  one line, we're the wrong choice today.

We deliberately don't publish a "cheaper by X%" claim: their pricing moves,
and per-tier comparisons depend on your mix of browser-hours, solves and
proxy traffic. Price both against your own workload.

Concurrency runs 3 / 10 / 25 / 50 across Free → Scale. Browserbase sells
higher ceilings than that; if you genuinely need hundreds of simultaneous
browsers, they have the fleet for it today and we don't. That is a real
capacity difference, not a pricing one.

## What we don't have, plainly

- No session recording or replay.
- No Director, no semantic actions (`clickByDescription`). Stagehand works
  against us, but the vision-based tooling is theirs.
- No Agents, Functions or Model Gateway. They offer a broader platform;
  we're deliberately staying infrastructure. If you want the agent runtime
  bundled with the browser, that's them, not us.
- One region.
- No bundled proxy and no bundled CAPTCHA solving — both are BYO.
- Lower concurrency ceiling.

If your product depends on any of those, stay. If you're paying premium
tiers mostly for stealth and stable sessions, that's the trade we're built
for.

## What you get instead

- **An MCP server** — nine tools, no integration code. [Details](mcp.md).
- **`/v1/fetch` and `/v1/search`**, billed against separate monthly
  allowances rather than browser-time, so agent loops stop burning
  browser-seconds on cheap operations. Browserbase ships Fetch and Search
  too — this isn't a capability we have and they don't. Compare the
  billing rather than the feature list: what matters is whether those
  calls draw from the same balance as your browser time.
- **EU residency** by default.
- **No proprietary SDK to unpick.** You connect over standard CDP, so the
  automation you write here runs anywhere that speaks it. The lock-in
  question for a browser service is whether *your code* is portable, and
  ours is. (The Chromium image our fleet runs is
  [published](https://github.com/runbrowser-dev/runbrowser) if you want to
  match your local environment to production — the hosted service itself is
  not open source.)
