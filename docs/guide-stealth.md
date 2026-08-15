# Stealth & fingerprinting

Every browser we hand you already carries a coherent device profile — a
consistent, per-session identity rather than the obvious tells of a headless
Chromium in a datacenter. There's nothing to turn on; it's the default.

This page is about what that means, and — just as importantly — what it
doesn't, so you can set expectations before you point it at a hard target.

## What's handled for you

- **No automation tells.** `navigator.webdriver` is false, the plugin and
  language sets look real, `window.chrome` is present. The launch never passes
  `--enable-automation`.
- **A coherent OS persona.** The user agent, `navigator.platform`, the
  client-hint headers, the WebGL renderer string and the worker-thread realm all
  agree with each other. A mismatch between any two of those is the cheapest
  possible bot check, and this closes them.
- **Per-tenant isolation.** The canvas and audio fingerprints are seeded per
  container, so no two customers share one identity. One abusive user can't get
  the whole fleet blocked — and your sessions aren't clustered with anyone
  else's.
- **Coherent locale.** When you select a [proxy country](/docs/guide-proxies),
  the timezone and `Accept-Language` move with the exit IP.

## What it is not

We flag bot walls; we don't pretend they aren't there, and we don't sell
guaranteed evasion.

- **A page behind a CAPTCHA still needs solving.** Fingerprint quality gets you
  past *detection*; it does nothing about a challenge you're explicitly asked to
  complete. See [CAPTCHAs](/docs/concepts#captchas) — solving is bring-your-own
  solver key, at your provider's wholesale price.
- **IP reputation is separate.** Many sites decide at the edge, on the address,
  before a line of JavaScript runs. No amount of fingerprint work changes that —
  [a proxy](/docs/guide-proxies) does.
- **The GPU is real software rendering.** The reported strings are coherent, but
  a timing or behavioural WebGL probe can still tell it's not a discrete GPU.

## Knowing when you're blocked

The primitives don't hand you a bot wall dressed up as content. `/v1/fetch` and
`/smart-scrape` return a block signal so you can react instead of parsing a
CAPTCHA page as if it were data.

```json
// A blocked fetch reports it rather than returning the wall as the body.
{ "status": 403, "blocked": true, "blockProvider": "cloudflare", "body": "…" }
```

That honesty is the point: you find out a target is defended in the response,
not three steps later when your extracted "data" turns out to be an interstitial.

See also: [Proxies & geo-targeting](/docs/guide-proxies) for the IP half of the
problem, which is usually the half that matters.
