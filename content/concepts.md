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
| Free | €0 | 3 | 1 | 15 min | 1,000 | 1,000 | 25 |
| Hobby | €19/mo | 10 | 150 | 60 min | 5,000 | 5,000 | 100 |
| Startup | €99/mo | 25 | 600 | 180 min | 25,000 | 25,000 | 600 |
| Scale | €499/mo | 50 | 2,500 | 360 min | 100,000 | 100,000 | 3,000 |

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

## Stealth

Our stealth is deliberately **not** a fingerprint injector.

We built nine iterations of one — an 883-line JS injector, a 50-profile
pool, a content-script extension — and measured them against both CreepJS
and real commercial targets. CreepJS scores climbed steadily. Real-world
outcomes got *worse*: more spoofing meant more detectable inconsistency,
and it got us reCAPTCHA'd on Google for four consecutive iterations.
Xvfb + headed Chromium measurably worsened Google detection too, and was
reverted.

What ships is ~60 lines of Dockerfile and launch flags: Debian-packaged
Chromium, no JS injection, no patches. On a 16-target harness of *painful*
pages (search results and listings, not homepages) across Cloudflare,
PerimeterX, Akamai and DataDome: 15 of 16 open. The exception is Walmart,
whose PerimeterX threshold for price-scraping is set lower than anyone
else's and which never offers a challenge to solve.

If a target still blocks you, the lever is almost always a residential
IP, not more JavaScript.

## Proxies

Bring your own, per session:

```ts
await chromium.connectOverCDP(`https://connect.${domain}?token=${key}&proxy=${encodeURIComponent(proxyUrl)}`);
```

Or keep the credentials out of the URL entirely by POSTing them to
`/v1/sessions` and connecting with the opaque token you get back. Proxy
URLs are validated against SSRF (RFC1918, loopback and link-local are
refused; http/https/socks5 only) and never logged.

Managed proxy pools are designed but not built — the trigger is a
customer saying they'd pay for it. Until then you get wholesale pricing
from your own provider instead of our markup.

## CAPTCHAs

**We don't solve CAPTCHAs for you.** You bring your own solver key, and the
helper in [examples/captcha](../examples/captcha/) wires it up:

```ts
await solveCaptcha(page, {
  provider: 'capsolver',            // or '2captcha'
  apiKey: process.env.CAPSOLVER_KEY!,
});
```

It talks to that provider directly from your process. Your key never
reaches us. Because it costs us nothing, it works on every tier including
Free, and you pay wholesale (~\$0.001/solve) rather than a marked-up
allowance — competitors bundle this at roughly \$0.02–0.05 per solve.

We used to offer managed solving on our own account and removed it. Doing
the solve ourselves and selling it as a plan feature makes us a participant
in circumventing an access control rather than neutral infrastructure. You
hold the provider account and make that call; we are only the browser.

Invisible systems — reCAPTCHA v3, DataDome, PerimeterX — aren't solvable
by anyone. They score your session rather than posing a question. A
residential proxy is the answer there, and both paths tell you so instead
of timing out.

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
