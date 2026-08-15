# Device profiles

Every browser we hand you presents as a real, consistent device — a user
agent, platform, GPU, fonts, timezone and hardware signals that all agree with
each other, the way a genuine machine does. There's nothing to switch on; it's
the default.

This matters for one practical reason. Legitimate automation gets misclassified
when its browser looks like a bare headless server in a datacenter: your uptime
monitor, your integration tests, your price checks, your own site's
accessibility crawl all get wrongly blocked or quietly served degraded content.
A coherent profile is about your work not being mistaken for something it isn't
— reliability, not disguise.

## Why a profile has to be *coherent*, not just present

Most setups change the user agent and stop there. The trouble is that a modern
site doesn't read one value — it cross-checks several, and inconsistency between
any two is the cheapest possible signal that something is off. A browser
claiming one operating system in its user agent while its platform, GPU string
and HTTP headers say another isn't a better disguise than a plain headless
browser; it's a worse one, because now it looks like a machine actively
misrepresenting itself.

So the whole profile agrees with itself, in the places that are easy to forget:

- **Across HTTP and JavaScript.** The client-hint request headers
  (`sec-ch-ua`, `sec-ch-ua-platform`) are corrected at the network layer, so
  what the server sees in the headers matches what a script reads from
  `navigator`. These headers are emitted below the page — no amount of
  in-page JavaScript reaches them — so a profile that only patches `navigator`
  disagrees with its own request headers.
- **Inside Web Workers.** A single `new Worker()` opens a fresh realm that
  page-level patches never touch, and a worker's `navigator` and `OffscreenCanvas`
  report the raw host. It's the most common place a profile leaks — and the
  profile is carried into worker realms so it doesn't.
- **In the GPU string, the fonts, the screen, the media devices.** A window
  larger than its screen, or a desktop with no audio device, is a contradiction
  on its own. Each of those is made consistent.

## Stable per session, unique per customer

Two properties that are easy to get backwards, and that we get right:

**Stable, not shimmering.** A real machine produces the *same* canvas and audio
fingerprint every time you read it. A profile that randomises on every read is,
paradoxically, easier to flag — nothing real changes between two reads a
millisecond apart. Ours is fixed for the life of a session, so it reads as one
consistent device.

**Unique per session.** That fixed identity is seeded per browser, so no two of
our customers share a fingerprint. This is a fairness and reliability property
as much as anything: your sessions aren't clustered with a stranger's, and one
account behaving badly can't get an identity *you* depend on flagged. It's the
fingerprint equivalent of not sharing an IP.

## Locale that matches the exit

When you select a [proxy country](/docs/guide-proxies), the browser's timezone
and `Accept-Language` follow the exit IP. A connection leaving Germany while the
clock says New York is exactly the kind of internal contradiction the rest of
the profile works to avoid, so the locale moves with the address automatically.

## Where the honesty lives

A coherent profile makes a real browser look like a real browser. It is not,
and we don't market it as, a way around the things that are meant to stop you:

- **A CAPTCHA still needs solving.** A challenge you're explicitly asked to
  complete is a different problem from looking like a genuine browser. Solving
  is bring-your-own solver key — see [CAPTCHAs](/docs/concepts#captchas).
- **IP reputation is separate.** Many sites decide at the edge, on the address,
  before any page script runs. That's a [proxy](/docs/guide-proxies) question,
  not a profile one.
- **A site's terms still apply.** We provide per-session attribution and an
  operator kill switch precisely so the platform stays a good citizen; respect
  `robots.txt` and the terms of the sites you visit.

And we don't hand you a bot wall dressed up as content. `/v1/fetch` and
`/smart-scrape` tell you when a page is a challenge rather than the data you
asked for, so you can react instead of parsing an interstitial as if it were
real:

```json
{ "status": 403, "blocked": true, "blockProvider": "cloudflare", "body": "…" }
```

That's the point of the whole thing: a browser that behaves like a real one, and
tells you the truth when a site pushes back.

See also: [Proxies & geo-targeting](/docs/guide-proxies) for the address half of
the problem, which is usually the half that actually decides access.
