# The live viewer

Watch a session as it runs. Not a recording played back later, not a log —
the actual browser, streamed live, that you can open in a tab or hand to a
teammate. It's the fastest way to answer "what is my agent actually doing?",
and it's on every plan.

## Get a viewer link

Mint a signed, expiring URL for a running session. It carries no API key, so
it's safe to paste into a ticket or embed in your own dashboard.

```ts tab=TypeScript
const res = await fetch(
  `https://connect.runbrowser.dev/v1/sessions/${sessionId}/viewer-token`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RUNBROWSER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttlSeconds: 3600 }),   // 1h default, 24h max
  },
)
const { webUrl } = await res.json()
// https://connect.runbrowser.dev/viewer?...  — signed, expiring, no token inside
```

```bash tab=cURL
curl -X POST \
  https://connect.runbrowser.dev/v1/sessions/$SESSION_ID/viewer-token \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "ttlSeconds": 3600 }'
```

Open `webUrl` in any browser. Anyone holding it can watch until it expires;
because there's no bearer token in the URL, sharing the link never shares your
key.

## Embed it

The viewer page is built to be put in an `<iframe>` — no chrome, no controls of
its own, so it drops cleanly into your product.

```html
<iframe
  src="https://connect.runbrowser.dev/viewer?...&fit=cover"
  style="width: 100%; aspect-ratio: 16/10; border: 0; border-radius: 12px"
  allow="clipboard-read"
></iframe>
```

**Query options**

| Param | Values | Effect |
|---|---|---|
| `fit` | `cover` \| `contain` \| `fill` | How the stream sizes into the frame |
| `debug` | `1` | Show a small diagnostic pill (fps, connection state) |

The page also posts `postMessage` events to the parent frame as the session
connects, streams and ends, so you can react to state in your own UI.

## A watched run, end to end

```ts tab=TypeScript
// 1. Start a stable session so it's alive to watch.
const { sessionId, connectUrl } = await (await fetch(
  'https://connect.runbrowser.dev/v1/sessions',
  { method: 'POST', headers: auth, body: JSON.stringify({ keepAlive: true }) },
)).json()

// 2. Mint a viewer link and print it before you start driving.
const { webUrl } = await (await fetch(
  `https://connect.runbrowser.dev/v1/sessions/${sessionId}/viewer-token`,
  { method: 'POST', headers: auth, body: JSON.stringify({ ttlSeconds: 900 }) },
)).json()
console.log('Watch it here →', webUrl)

// 3. Drive. Whoever opened the link sees every step as it happens.
const browser = await chromium.connectOverCDP(connectUrl)
const page = await browser.newPage()
await page.goto('https://example.com')
```

## Notes

- The stream is **not recorded** and nothing from it is written to disk. When
  the link expires or the session ends, it's gone.
- Streaming a session costs the normal browser-time it's already running; the
  viewer itself adds no separate charge.
- Available on **every plan**, including Free — it isn't gated to a higher tier.

See also: [Sessions](/docs/guide-sessions) for creating something to watch, and
the [API reference](/docs/api-reference#sessions) for the token fields.
