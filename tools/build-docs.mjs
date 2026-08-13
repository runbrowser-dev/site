// Renders content/*.md into docs/*.html.
//
// The output is committed rather than built at deploy time, deliberately: the
// Cloudflare project serves static assets with no build step, and that
// pipeline is proven. Adding an install-and-build to it would put the whole
// site behind a toolchain that can break, to save a command nobody runs often.
//
// Regenerate after editing anything in content/:
//
//   npm run docs
//
// Source of truth for this content is the platform repo's docs/ directory.
// Keep them in step — a docs site that disagrees with the product is worse
// than no docs site.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { marked } from 'marked'

const CONTENT = 'content'
const OUT = 'docs'

// Order matters: this is the reading order for someone new, not alphabetical.
const NAV = [
  ['quickstart', 'Quickstart'],
  ['concepts', 'Concepts'],
  ['api-reference', 'API reference'],
  ['mcp', 'MCP server'],
  ['migrating-from-browserless', 'From Browserless'],
  ['migrating-from-browserbase', 'From Browserbase'],
]

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Internal .md links must point at the rendered pages, not the source files. */
function rewriteLinks(html) {
  return html
    // ../examples/... lives in a private repo — send people to the docs index.
    .replace(/href="\.\.\/examples\/[^"]*"/g, 'href="/docs/"')
    .replace(/href="([a-z0-9-]+)\.md(#[^"]*)?"/gi, (_m, page, hash) => `href="/docs/${page}.html${hash || ''}"`)
    .replace(/href="\.\.\/[^"]*\.md"/g, 'href="/docs/"')
}

function page({ title, body, slug }) {
  const nav = NAV.map(
    ([s, label]) =>
      `<a class="${s === slug ? 'active' : ''}" href="/docs/${s}.html">${escapeHtml(label)}</a>`,
  ).join('\n        ')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — runbrowser docs</title>
<meta name="description" content="${escapeHtml(title)} — runbrowser documentation.">
<link rel="icon" type="image/svg+xml" href="/assets/logo.svg">
<link rel="stylesheet" href="/assets/docs.css">
</head>
<body>
<header class="docs-header">
  <a class="logo" href="/">
    <span class="mark"><img src="/assets/logo.svg" alt="" width="24" height="24"></span>
    <span>runbrowser</span>
  </a>
  <a class="back" href="/">&larr; back to site</a>
</header>
<div class="layout">
  <nav class="sidebar">
    <span class="nav-title">Docs</span>
    <div class="nav-links">
        ${nav}
    </div>
  </nav>
  <main class="prose">
${body}
    <hr>
    <p class="foot">
      Something wrong or missing here?
      <a href="mailto:hi@runbrowser.dev?subject=Docs%20feedback">Tell us</a> —
      we'd rather fix it than have you work around it.
    </p>
  </main>
</div>
</body>
</html>
`
}

mkdirSync(OUT, { recursive: true })

const files = readdirSync(CONTENT).filter((f) => f.endsWith('.md'))
let count = 0
for (const file of files) {
  const slug = basename(file, '.md')
  const md = readFileSync(join(CONTENT, file), 'utf8')
  // First H1 is the page title; strip it so it isn't duplicated by the layout.
  const titleMatch = md.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1] : slug
  const html = rewriteLinks(marked.parse(md))
  writeFileSync(join(OUT, `${slug}.html`), page({ title, body: html, slug }))
  count++
}

// Index page. Written here rather than as another markdown file so the
// descriptions can be shorter and more sales-y than a doc heading allows.
const cards = [
  ['quickstart', 'Quickstart', 'Change one line and run your existing script on our browsers.'],
  ['concepts', 'Concepts', 'Sessions, billing, stable sessions, the viewer, stealth and proxies.'],
  ['api-reference', 'API reference', 'Every endpoint, with request and response shapes.'],
  ['mcp', 'MCP server', 'Browser tools for Claude, Cursor, or anything that speaks MCP.'],
  ['migrating-from-browserless', 'From Browserless', 'A 1:1 mapping, the honest gaps, and how billing differs.'],
  ['migrating-from-browserbase', 'From Browserbase', 'Contexts vs stable sessions, and what we do not have.'],
]
  .map(
    ([slug, title, blurb]) =>
      `      <a class="card" href="/docs/${slug}.html">
        <span class="card-title">${escapeHtml(title)}</span>
        <span class="card-blurb">${escapeHtml(blurb)}</span>
      </a>`,
  )
  .join('\n')

writeFileSync(
  join(OUT, 'index.html'),
  page({
    title: 'Documentation',
    slug: '',
    body: `    <h1>Documentation</h1>
    <p>Hosted Chromium you drive over CDP. Start with the quickstart — for most
    people the migration is one line.</p>
    <div class="cards">
${cards}
    </div>`,
  }),
)
count++

console.log(`rendered ${count} pages into ${OUT}/`)
