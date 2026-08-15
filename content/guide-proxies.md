# Proxies & geo-targeting

Route a session's traffic through a proxy — bring your own, or select a managed
pool by name and country. When you pick a country, the browser's timezone and
`Accept-Language` follow the exit IP, so you don't hand a site a New York clock
on a Frankfurt address.

## Bring your own

Pass a full proxy URL, credentials embedded. It's validated against SSRF and
never logged.

```ts tab=TypeScript
const proxy = encodeURIComponent('http://user:pass@proxy.example.com:8080')
const browser = await chromium.connectOverCDP(
  `wss://connect.runbrowser.dev?token=${TOKEN}&proxy=${proxy}`,
)
```

Prefer to keep the credentials off the connect URL entirely? Put them in a
[session](/docs/guide-sessions) instead and connect with the opaque id it
returns. BYO proxies carry **no markup** — you pay your provider's wholesale
price and nothing to us.

## Managed pools

Where your operator has configured them, select a pool by name and, for
geo-targeting, a country. Credentials stay on our side; you never see them.

```ts tab=TypeScript
const browser = await chromium.connectOverCDP(
  `wss://connect.runbrowser.dev?token=${TOKEN}&proxy=residential&country=de`,
)
```

```bash tab=cURL
# The same selection works on the REST endpoints, as query params.
curl -X POST "https://connect.runbrowser.dev/screenshot?proxy=residential&country=de" \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com" }' --output shot.png
```

Each session gets its own **sticky exit IP**, so a multi-step flow doesn't
change address halfway through — which, to the site you're visiting, looks like
account sharing.

### Geo sets more than the IP

Asking for `country=de` also sets the browser's timezone to `Europe/Berlin` and
its `Accept-Language` to `de-DE`. That coupling is the point: an IP in one place
paired with a clock from another is a contradiction any site can check for free,
and geo-targeting that only changes the address gives a site a *better* signal
than it removes.

A country a pool doesn't carry is **refused, with the list of what's
available** — you find out immediately, not after your data comes back from the
wrong region.

```json
// GET a pool that doesn't offer that country →
{ "error": "pool \"residential\" does not offer country \"br\"; available: de, gb, jp" }
```

## Which to use

- **BYO** — you already have a proxy provider and want wholesale pricing.
- **Managed pool** — you want geo-targeting without sourcing IPs, and you want
  the locale kept coherent automatically.

See also: [Stealth & fingerprinting](/docs/guide-stealth) for what the browser
presents beyond the IP, and the
[proxy query params](/docs/api-reference#connecting-a-browser).
