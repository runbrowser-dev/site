# Screenshots & PDFs

Turn a page — or HTML you already hold — into an image or a PDF in one call.
No browser to drive, no fleet to run: `POST` the request, get the bytes back
with the right `Content-Type`.

Both endpoints take **either** a `url` to load **or** `html` to render
directly. Inline `html` is for documents you generated yourself — an invoice, a
report, an OG image — so you never have to publish a customer's billing details
to a public URL just to render them.

## A screenshot

```bash tab=cURL
curl -X POST https://connect.runbrowser.dev/screenshot \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com", "options": { "fullPage": true } }' \
  --output page.png
```

```ts tab=TypeScript
const res = await fetch('https://connect.runbrowser.dev/screenshot', {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://example.com', options: { fullPage: true } }),
})
const buffer = Buffer.from(await res.arrayBuffer())
await fs.writeFile('page.png', buffer)
```

**Clip to one element** with a selector — it captures the match even below the
fold, and takes precedence over `fullPage`. A selector that matches nothing is a
`400`, not a silent full-page shot.

```json
{ "url": "…", "options": { "selector": "#pricing-table", "format": "webp", "quality": 90 } }
```

## A PDF

```bash tab=cURL
curl -X POST https://connect.runbrowser.dev/pdf \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "html": "<h1>Invoice INV-2026-0001</h1>", "options": { "printBackground": true, "format": "A4" } }' \
  --output invoice.pdf
```

> **Set `printBackground` unless you mean not to.** It defaults to `false`, matching
> Chrome — which drops every background colour in your document: header blocks,
> table shading, status badges. You get a valid PDF with no error, and white text
> on a coloured block becomes white text on white. It's the most common way a
> generated document is silently wrong.

## Common options

Both endpoints accept the shared browser controls:

```json
{
  "url": "https://example.com",
  "waitForTimeout": 5000,
  "cookies": [{ "name": "session", "value": "…" }],
  "headers": { "X-Custom": "value" }
}
```

`cookies` default their scope to the page you're loading, so `{name, value}`
alone gets you past a consent wall or age gate in the same call.

See the full option tables in the reference:
[`/screenshot`](/docs/api-reference#post-screenshot-imagepngjpegwebp) ·
[`/pdf`](/docs/api-reference#post-pdf-applicationpdf).
