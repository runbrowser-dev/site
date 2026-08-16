# Getting through walls

Some sites answer an automated request with a wall instead of the page: a
"just a moment" interstitial, a challenge widget, or a silent block. `/unblock`
lands on the page, waits out what waiting fixes, and hands you back the
clearance cookies so the session that does the real work starts already
through.

```bash tab=cURL
curl -X POST https://connect.runbrowser.dev/unblock \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com" }'
```

```ts tab=TypeScript
const res = await fetch('https://connect.runbrowser.dev/unblock', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.RUNBROWSER_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ url: 'https://example.com' }),
})
const { unblocked, cookies, challenge } = await res.json()
```

## The part that isn't solving anything

Most walls pose no question. A passive interstitial runs a proof-of-work in the
page and redirects itself; a real browser passes it by waiting a few seconds.
No solver is involved, and none would help.

The reason hand-written code fails here is subtle and almost universal: people
poll `document.readyState`, which is *already* `"complete"` on the wall they're
looking at. The check passes instantly, the script grabs the interstitial's
markup, and it gets parsed as though it were the content. `/unblock` waits on
the wall actually going away instead — and that single distinction is most of
what this endpoint is for.

## Cookie banners go first

Before anything else, a consent banner is declined — it is far more common than
a CAPTCHA and it covers the content just as effectively. Only reject/decline is
ever clicked; accepting would agree to data processing on your behalf, which is
not ours to do. A banner with no way to say no is reported and left alone.

## It names which wall you hit

The three kinds need completely different answers, so you're told which one is
in front of you rather than being left to guess.

| `type` | What it is | What actually clears it |
|---|---|---|
| `interstitial` | Passive JS challenge | Waiting — handled for you |
| `turnstile`, `recaptcha_v2`, `hcaptcha` | A question, with a sitekey | A solver, if you supply a key |
| `scoring` | reCAPTCHA v3, DataDome, PerimeterX | Nothing solvable — the exit IP |

That last row is the one worth dwelling on. Invisible systems score your
session rather than posing a challenge; there is no widget and no answer to
submit. A solver pointed at one burns two minutes and returns nothing. We check
for them first and come back in milliseconds:

```json
{
  "unblocked": false,
  "challenge": { "type": "scoring", "provider": "datadome", "interactive": false },
  "advice": "this site scores the session rather than posing a challenge, so no solver clears it; retry through a residential exit IP"
}
```

Being told "this won't work, here's what would" immediately beats a timeout
that bills you for the wait.

## Carrying the clearance forward

The cookies come back in the same shape every other endpoint takes as
`cookies`, because passing them on is the normal next step:

```ts tab=TypeScript
const { cookies } = await (await fetch('https://connect.runbrowser.dev/unblock', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ url: 'https://shop.example.com' }),
})).json()

// The scrape starts already through the wall.
const data = await fetch('https://connect.runbrowser.dev/scrape', {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    url: 'https://shop.example.com/products',
    cookies,
    elements: [{ selector: '.product' }],
  }),
})
```

## When a challenge does pose a question

Where a widget carries a sitekey, it can be answered by a solving service — and
**you hold that account.** Pass the credential and we do the orchestration:
detect the widget, submit it with the right task type, wait for the token,
deliver it to the page, and watch whether the page actually moves.

```json
{
  "url": "https://example.com/login",
  "solver": { "provider": "capsolver", "apiKey": "CAP-…" }
}
```

The key is used for that one call. It is never stored, never logged, and never
comes back in the response — only `solvedBy: "request"`, naming the source.

### Choosing a provider

`provider` accepts `capsolver` or `2captcha`. Both are supported for every
challenge type we solve, and neither is a default — pick per your workload.

| | CapSolver | 2Captcha |
|---|---|---|
| reCAPTCHA v2 | $1.00 / 1k | €0.99–2.80 / 1k |
| reCAPTCHA v3 | — | €1.40 / 1k (score ≤0.3), €2.80 (>0.3) |
| Cloudflare Turnstile | $1.20 / 1k | €1.40 / 1k |
| Image / normal | — | €0.50–1.00 / 1k |

Read off each vendor's own pricing page on **2026-08-16**; note the currencies
differ. CapSolver quotes ~$0.65/1k for reCAPTCHA at high volume. 2Captcha's
ranges reflect solving speed, so the low end is not what an impatient
integration pays.

On success rate we have no measurement of our own, so we publish none. Both
vendors benchmark themselves and each other, and both come out ahead in their
own numbers. Rates vary by challenge type and by target site, so if a specific
site matters to you, run a few hundred solves through each against *that*
site before committing.

This split is deliberate. We supply the engineering; the provider account, and
the decision to use it on a given site, stay with you. It also means you pay
your provider's wholesale rate — roughly $0.001–0.003 per solve depending on
the challenge type — rather than a bundled allowance marked up to $0.02–0.05.

## A widget isn't always a wall

A login modal, a comment box and a newsletter signup all match the same
selectors as a challenge. Treating them as blocks would tell you to spend a
solve on a page that was never blocked, so we check whether the content is
actually gated:

```json
{
  "unblocked": true,
  "challenge": { "type": "recaptcha_v2", "interactive": true, "wall": false },
  "advice": "a solvable widget is present but the page content is already accessible, so no solve was spent"
}
```

`wall: false` means read on — the widget is there, but nothing is stopping you.

## What it won't do

- **Nothing here defeats an access control that's meant to hold.** A wall that
  doesn't clear is reported as unclear, with the reason. We don't retry
  forever, and we don't hand you an interstitial dressed up as content.
- **The exit IP is usually the real lever.** Many sites decide at the edge,
  before any page script runs. When that's what happened, the advice says so —
  see [Proxies & geo-targeting](/docs/guide-proxies).
- **Respect the site's terms.** Every session carries attribution, and
  operators keep a kill switch, precisely so this stays infrastructure rather
  than a way around someone's rules.

See also: [Device profiles](/docs/guide-device-profile) for why a coherent
browser hits fewer walls in the first place.
