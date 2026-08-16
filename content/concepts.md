# Concepts

## Sessions

A session is one browser. It begins when you connect and ends when you
disconnect; the container is then destroyed, never reused. Chromium state
isn't safe to recycle between tenants, so every customer gets a browser
that has never seen anyone else's traffic.

We keep a few browsers pre-warmed, so a connect usually costs ~16ms rather
than the ~350ms a cold spawn takes. Pre-warmed browsers are rotated out
after 15 minutes so you never receive one that has been sitting idle for
hours.

## Browser-time billing

You're billed for the seconds a browser exists, not for the number of
sessions you open. Per-session duration is floored at 10 seconds.

This is deliberate and it's the main thing that differs from
session-count pricing. Under per-session billing, the cheapest thing you
can do is cram work into fewer, longer sessions — which is the opposite of
what makes a fleet efficient. Under browser-time, short focused sessions
are cheap, and the incentive points the same way our capacity does.

| Tier | Price | Concurrent | Browser hours/mo | Max session | /fetch | /search | /extract |
|---|---|---|---|---|---|---|---|
| Free | €0 | 3 | 1 | 15 min | 1,000 | 100 | 25 |
| Hobby | €19/mo | 10 | 200 | 60 min | 5,000 | 1,000 | 100 |
| Startup | €99/mo | 25 | 1,200 | 180 min | 25,000 | 4,000 | 600 |
| Scale | Contact us | 50 | 6,500 | 360 min | 100,000 | 20,000 | 3,000 |

Free, Hobby and Startup are self-serve — sign up and start. Scale is priced
per deal, because at 50 concurrent browsers it is a conversation about
capacity rather than a checkout: we size hardware to it before we sell it.
Email [sales@runbrowser.dev](mailto:sales@runbrowser.dev) and we will quote
against what you actually intend to run.

Browser time is metered **while the session runs**, not only when it ends, so
your usage and your remaining allowance reflect what you are burning right
now. A session that runs past your monthly allowance is stopped during the
session rather than after you disconnect.

`/search` returns up to 3 results per query on Free, 10 on Hobby, and 20 on
Startup and Scale. Search is the one primitive we buy rather than run — every
query is a purchase from an upstream provider — which is why its allowances
are smaller than `/fetch`, which runs on our own hardware and is priced
accordingly. Ask for more results than your tier allows and you get your
tier's maximum, not an error; the `X-RunBrowser-Max-Results` response header
tells you what that was.

`/extract` has its own allowance because it costs twice — browser-time to
render the page, plus LLM tokens to read it. The numbers are sized against
worst-case content (a full 200k-char page); typical pages are a fraction of
that, so real usage goes considerably further than the figure suggests.

Concurrency is a ceiling, not a reservation, and the fleet has a hard cap
underneath it — see [Concurrency and queueing](#concurrency-and-queueing)
for what that means when the box is busy.

## Concurrency and queueing

Two separate limits apply, and they mean different things.

**Your tier's concurrency** — Free 3, Hobby 10, Startup 25, Scale 50 — is
your own ceiling. At it, new requests **wait** for a slot rather than
failing immediately: up to about 20 seconds, then a `429`. A burst of
parallel jobs against a small tier usually resolves itself in a second or
two, and that's a better experience than a wall of errors your retry
logic has to absorb.

If you're being queued regularly, that's a signal to move up a tier, and
it's visible to us in metrics before you complain.

**Fleet capacity** is the whole box, shared by everyone. Tier ceilings are
ceilings rather than reservations, so in principle the sum of what every
customer may use exceeds what the hardware runs. When that actually
happens you get a `503` with `Retry-After` after a short queue. It isn't
your fault and it isn't your limit — it's ours, and it's deliberately a
clean refusal: the alternative is spawning browsers past the box's memory
and killing live sessions that were well inside their limits.

Operationally the `503` is the signal to add capacity, and it's alarmed on
our side (`agentbrowser_fleet_rejections_total`) rather than left for you
to report.

## Stable sessions

Normally the browser dies when you disconnect. A stable session doesn't:

```ts
const res = await fetch(`https://connect.${domain}/v1/sessions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ keepAlive: true, maxIdleSeconds: 600 }),
});
const { sessionId, connectUrl } = await res.json();

const browser = await chromium.connectOverCDP(connectUrl);
// ... log in, do work, disconnect ...
// later, from a different process:
const again = await chromium.connectOverCDP(connectUrl);
```

Everything survives: cookies, localStorage, in-memory SPA state, open
tabs, in-flight requests, scroll position. We park the container rather
than snapshotting state, which is why the coverage is total instead of
"cookies and localStorage".

**The meter runs while it's parked.** You're holding a browser; nobody
else can use it. Close it when you're done:

```ts
await fetch(`https://connect.${domain}/v1/sessions/${sessionId}/close`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}` },
});
```

Two ceilings apply, whichever comes first: idle timeout (default 10 min)
and total session duration (per tier, above).

Parked sessions **survive a gateway restart**, including a redeploy. The
browser container keeps running while the gateway is down and is adopted
back on startup, so a reattach afterwards returns the same browser with
its page state intact — not a fresh one.

The clocks keep running while we're down. A session whose idle timeout or
maximum duration elapses during a restart is expired, not resumable: a
redeploy doesn't quietly extend anything you're being billed for.

**What doesn't survive:** a restart of the *machine*. Containers die with
the host, so a reboot or host failure loses parked sessions. Reattaching
then returns "not found", and that's the case worth writing a retry for.

## Live viewer

Watch a session in real time, or hand someone a link:

```ts
const res = await fetch(`https://connect.${domain}/v1/sessions/${id}/viewer-token`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ ttlSeconds: 3600 }),
});
const { webUrl } = await res.json();   // signed, expiring, no API key inside
```

The URL is HMAC-signed and expires (1h default, 24h max). Anyone holding
it can watch until then — no bearer token rides in the URL, so it's safe
to paste into a ticket. The page is built to be iframed: no chrome, no
controls, `?fit=cover|fill|contain` for sizing, `?debug=1` for a
diagnostic pill, and `postMessage` events to the parent frame.

Read-only in v1. Mouse and keyboard back through CDP is a v1.5 feature
waiting on someone asking for it.

## Device profile

More spoofing is not better, and we learned that the expensive way. An early
attempt at a fingerprint injector — hundreds of lines cycling dozens of
profiles — measured *worse* against real targets, not better: every extra
value we forced was one more thing that could disagree with the others, and
disagreement is exactly what a detector looks for.

So the philosophy inverted. What ships is a **coherent** device profile — one
consistent identity where every signal agrees with every other: user agent,
`navigator.platform`, the client-hint HTTP headers, the GPU string, the fonts,
and the Web Worker realms most setups forget. A browser that contradicts itself
is more conspicuous than a plain one, not less. The profile is seeded per
session, so no two customers share a fingerprint, and stable within a session,
because real hardware doesn't change between two reads a millisecond apart.

We run a weekly access-regression check against a panel of real,
bot-protected sites so we notice if that stops holding before a customer does.

The full picture — what's covered, and honestly what a coherent profile can't
do — is in [Device profiles](/docs/guide-device-profile). If a target still
blocks you, the lever is almost always a residential IP, not more JavaScript.

## Proxies

Bring your own, per session:

```ts
await chromium.connectOverCDP(`https://connect.${domain}?token=${key}&proxy=${encodeURIComponent(proxyUrl)}`);
```

Or keep the credentials out of the URL entirely by POSTing them to
`/v1/sessions` and connecting with the opaque token you get back. Proxy
URLs are validated against SSRF (RFC1918, loopback and link-local are
refused; http/https/socks5 only) and never logged.

### Managed pools

Where the operator has configured them, select one by name instead of
supplying a URL:

```ts
await chromium.connectOverCDP(
  `https://connect.${domain}?token=${key}&proxy=residential&country=de`);
```

Credentials stay on our side. Each session gets its own sticky exit IP, so a
multi-step flow doesn't change address halfway through — which, to the site
you're visiting, looks like account sharing.

**Asking for a country also sets the browser's timezone and
`Accept-Language`.** That coupling is the point rather than a convenience: an
IP in Tokyo paired with a New York clock is a contradiction any site can check
for free, and geo-targeting that only changes the address hands over a better
signal than it removes.

A country the pool doesn't carry is refused, and the error lists what is
available. Silently serving you from somewhere else would mean discovering the
substitution only once your data was already wrong.

Bring-your-own stays free of any markup, and remains the right choice if you
already have wholesale pricing.

## CAPTCHAs

**You hold the solving account; we do the orchestration.**
[`/unblock`](/docs/guide-unblocking) handles the wall end to end — but where a
challenge poses an actual question, the provider credential is yours:

```json
{ "url": "…", "solver": { "provider": "capsolver", "apiKey": "…" } }
```

The key is used for that one call, never stored and never logged. Prefer to
drive the solver yourself? Talk to CapSolver or 2Captcha directly from your own
process and pass the resulting token into the page — nothing here requires our
involvement.

We do the hard part — detecting the widget, picking the right task type,
delivering the token, and checking whether the page actually moved — without
becoming the party that holds an account for answering other people's access
controls. That split is deliberate, and it means you pay wholesale (~\$0.001
per solve) rather than a bundled allowance marked up to \$0.02–0.05.

**Most walls need no solver at all.** A passive interstitial clears itself in a
real browser given a few seconds; `/unblock` waits it out for you. And
invisible systems — reCAPTCHA v3, DataDome, PerimeterX — aren't solvable by
anyone, because they score your session rather than posing a question. A
residential proxy is the answer there, and you're told so in milliseconds
instead of timing out.

## Regions

**One region: the EU.** Every browser, and every byte of session data, stays
inside the European Union.

We name the union rather than the datacentre on purpose. The jurisdiction is
the part you can rely on and the part your DPA and procurement questionnaire
actually ask about; the specific facility is an operational detail we may
change without telling you, and a promise at that granularity would be one we
could break by accident.

Adding a second region — US or otherwise — is a post-revenue decision, not a
roadmap promise. If you need multi-region today, we are the wrong choice and
you should say so early.
