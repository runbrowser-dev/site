# Structured extraction

Give `/v1/extract` a URL and a JSON Schema; get back JSON that matches the
schema. It renders the page in a real browser first, so it works on JavaScript
sites, then asks a model to fill your shape and validates the result before
returning it. When the model's output doesn't match, it retries with the
validation errors fed back, and if it still can't comply you get a `422` — not
malformed data you have to defend against downstream.

It's the difference between "scrape the page and parse the HTML yourself" and
"tell me what you want and get it typed."

## A worked example

Pull the fields you care about off a product page:

```bash tab=cURL
curl -X POST https://api.runbrowser.dev/v1/extract \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product/42",
    "schema": {
      "type": "object",
      "properties": {
        "title":       { "type": "string" },
        "priceUsd":    { "type": "number" },
        "inStock":     { "type": "boolean" },
        "sizes":       { "type": "array", "items": { "type": "string" } }
      },
      "required": ["title", "priceUsd", "inStock"]
    }
  }'
```

```ts tab=TypeScript
const res = await fetch('https://api.runbrowser.dev/v1/extract', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.RUNBROWSER_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://example.com/product/42',
    schema: {
      type: 'object',
      properties: {
        title:    { type: 'string' },
        priceUsd: { type: 'number' },
        inStock:  { type: 'boolean' },
        sizes:    { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'priceUsd', 'inStock'],
    },
  }),
})
const { data } = await res.json()
// data.priceUsd is a number, not a string you have to clean.
```

**Response**

```json
{
  "data": {
    "title": "Merino Runner",
    "priceUsd": 129,
    "inStock": true,
    "sizes": ["S", "M", "L", "XL"]
  },
  "usage": { "promptTokens": 4210, "completionTokens": 96 },
  "trace": { "screenshotUrl": null }
}
```

## Steering it

- **`instructions`** — a sentence of natural-language guidance, for when the
  schema alone is ambiguous. *"Only in-stock items."* *"Prices in USD, convert
  if the page shows another currency."*
- **`contentFormat`** — how the page is fed to the model. `markdown` (default)
  runs Readability and is right for articles; `markdown-full` keeps the whole
  page including navigation and is right for listings and grids; `text` and
  `html` do what they say. Getting this right cuts token cost several-fold and
  makes small models markedly more accurate.
- **`waitForSelector`** — hold until an element appears before extracting, for
  pages that render their content late.

```json
{
  "url": "https://example.com/search?q=boots",
  "instructions": "Only the sponsored results.",
  "contentFormat": "markdown-full",
  "waitForSelector": ".results",
  "schema": { "type": "array", "items": { "type": "object", "properties": {
    "name": { "type": "string" }, "url": { "type": "string" } } } }
}
```

## Billing & failure

- Counts against a separate monthly **extract** allowance, because each call
  spends both browser-time and model tokens. The `usage` block reports the exact
  token counts.
- A schema the output can't satisfy after one retry returns
  [`422 schema_validation_failed`](/docs/errors) rather than best-effort data.
- A page behind a bot wall is reported as blocked, not summarised as if the
  wall were the content.

See also: [`/v1/fetch`](/docs/api-reference#post-v1fetch) when you want the page
text without a model, and [crawling](/docs/guide-crawling) to extract across a
whole site.
