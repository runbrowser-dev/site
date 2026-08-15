# Crawling a site

Three endpoints that build on each other: `/smart-scrape` reads one page the
cheapest way that works, `/map` discovers what's on a site, and `/crawl` walks
it. All three keep the browser cost down and tell you what they did.

## One page, cheapest-first: `/smart-scrape`

The expensive part of this platform is the browser. Plain HTTP has none — so
`/smart-scrape` tries that first and only pays for a render when the page comes
back blocked, empty, or client-rendered. It tells you which path it took.

```bash tab=cURL
curl -X POST https://connect.runbrowser.dev/smart-scrape \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com", "format": "markdown-full" }'
```

```json
// A server-rendered page — no browser was used.
{ "url": "…", "method": "http", "status": 200, "content": "…" }

// A JavaScript app — it escalated and rendered.
{ "url": "…", "method": "browser", "escalationReason": "thin_body_probably_js_rendered", "content": "…" }
```

`escalationReason` is worth reading: `anti_bot_cloudflare` and
`thin_body_probably_js_rendered` are different facts about a target, and both
are worth knowing before you build a job around it.

## What's on the site: `/map`

Discover URLs from two sources at once — the sitemap (authoritative, often
absent) and the on-page links (always present, one page's worth). It reports
them separately so you can tell a 40,000-URL sitemap from forty footer links.

```bash tab=cURL
curl -X POST https://connect.runbrowser.dev/map \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com", "limit": 500 }'
```

```json
{ "total": 128, "sources": { "sitemap": 96, "page": 41 }, "urls": ["…"] }
```

Same-origin only unless you pass `includeExternal`. Discovery runs inside the
page, so a sitemap behind a login is reachable for the same reason the page is.

## Walk it: `/crawl`

Follow links from a seed, breadth-first, up to `maxPages` and `maxDepth` — all
inside **one browser lease** rather than a cold start per page. It always tells
you why it stopped.

```bash tab=cURL
curl -X POST https://connect.runbrowser.dev/crawl \
  -H "Authorization: Bearer $RUNBROWSER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com", "maxPages": 20, "maxDepth": 2 }'
```

```json
{
  "total": 20,
  "stoppedBecause": "maxPages",
  "queuedButNotVisited": 43,
  "pages": [ { "url": "…", "depth": 0, "chars": 1713, "content": "…" } ]
}
```

`stoppedBecause` is `exhausted`, `maxPages`, `maxDepth` or `deadline` — the
first question worth asking of a crawl, and the expensive one to get wrong. A
page that fails to load is recorded with an `error` and stepped over rather than
ending the run.

## Putting them together

A typical pipeline: `/map` to find the pages, then `/v1/extract` on each to get
structured data, or `/crawl` when the link graph matters more than the sitemap.

See also: [Structured extraction](/docs/guide-extract) to type the results, and
the reference for [`/smart-scrape`](/docs/api-reference#post-smart-scrape-json),
[`/map`](/docs/api-reference#post-map-json) and
[`/crawl`](/docs/api-reference#post-crawl-json).
