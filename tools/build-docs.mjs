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
// Source of truth for this content is the platform repo's docs/ directory:
//
//   npm run sync -- ../platform
//
// Everything possible happens at build time — syntax highlighting, the search
// index, anchors, the table of contents. Docs should render instantly and stay
// readable with JavaScript off; the only client-side script is search and
// copy-to-clipboard, and both degrade to nothing.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execSync } from 'node:child_process'
import { marked } from 'marked'
import Prism from 'prismjs'
import loadLanguages from 'prismjs/components/index.js'

loadLanguages(['typescript', 'javascript', 'json', 'bash', 'diff', 'python'])

const CONTENT = 'content'
const OUT = 'docs'

// Reading order for someone new, not alphabetical. Drives prev/next paging.
const NAV = [
  ['quickstart', 'Quickstart'],
  ['concepts', 'Concepts'],
  ['recipes', 'Recipes'],
  ['guide-autopilot', 'Autopilot'],
  ['guide-sessions', 'Sessions & stable sessions'],
  ['guide-viewer', 'The live viewer'],
  ['guide-extract', 'Structured extraction'],
  ['guide-crawling', 'Crawling a site'],
  ['guide-capture', 'Screenshots & PDFs'],
  ['guide-proxies', 'Proxies & geo-targeting'],
  ['guide-device-profile', 'Device profiles'],
  ['guide-unblocking', 'Getting through walls'],
  ['api-reference', 'API reference'],
  ['errors', 'Errors'],
  ['guide-sdk', 'SDKs'],
  ['guide-integrations', 'Integrations'],
  ['mcp', 'MCP server'],
]

// The guide pages, in the order they appear in the sidebar's Guides group.
const GUIDES = [
  ['guide-autopilot', 'Autopilot'],
  ['guide-sessions', 'Sessions & stable sessions'],
  ['guide-viewer', 'The live viewer'],
  ['guide-extract', 'Structured extraction'],
  ['guide-crawling', 'Crawling a site'],
  ['guide-capture', 'Screenshots & PDFs'],
  ['guide-proxies', 'Proxies & geo-targeting'],
  ['guide-device-profile', 'Device profiles'],
  ['guide-unblocking', 'Getting through walls'],
]

/**
 * Search tie-breaker. Several guides repeat a heading that Concepts also
 * carries — "Concurrency" against "Concurrency and queueing" — so an
 * exact-match rule alone sends someone asking about a core concept to a
 * narrower page. The canonical pages win ties.
 */
const PAGE_WEIGHT = {
  quickstart: 1.4,
  concepts: 1.4,
  'api-reference': 1.3,
  errors: 1.3,
  mcp: 1.0,
}

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * A third of the code fences in these docs carry no language. Rather than
 * chase every one upstream (they live in another repo, and new ones will
 * appear), infer it. A wrong guess costs slightly duller colours; plain grey
 * code is the most obvious "cheap docs" tell there is.
 */
function inferLang(code, declared) {
  if (declared) return declared
  const t = code.trim()
  if (/^[[{]/.test(t) && /[}\]]$/.test(t)) return 'json'
  if (/^(curl|npm|npx|docker|sudo|cd |export |make |ssh |openssl)/m.test(t)) return 'bash'
  if (/^[+-]{1,2}\s*\S/m.test(t)) return 'diff'
  if (/^\s*(def |from \S+ import|import \w+$)/m.test(t)) return 'python'
  if (/\b(import|const|await|=>|function|export)\b/.test(t)) return 'typescript'
  return ''
}

const ALIAS = { ts: 'typescript', js: 'javascript', sh: 'bash', shell: 'bash', py: 'python' }

/** Display name for a language. Tab labels come from the fence's own tab=. */
const LANG_LABEL = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  bash: 'Shell',
  json: 'JSON',
}

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

/** Collected per page for the table of contents and the search index. */
let headings = []

/**
 * Fence info strings may carry a tab label: ```ts tab=TypeScript
 *
 * Chosen over a `:::tabs` container because GitHub and every other markdown
 * renderer ignores the extra word and still highlights by the first one — the
 * source stays readable in the platform repo, which is where it lives.
 */
function parseInfo(info = '') {
  const parts = String(info).trim().split(/\s+/)
  const raw = parts[0] || ''
  const tab = (parts.find((p) => p.startsWith('tab=')) || '').slice(4).replace(/_/g, ' ')
  return { language: ALIAS[raw] || raw, tab }
}

function highlight(text, language) {
  return language && Prism.languages[language]
    ? Prism.highlight(text, Prism.languages[language], language)
    : escapeHtml(text)
}

function codeBlock(text, language) {
  const label = language
    ? `<span class="code-lang">${escapeHtml(LANG_LABEL[language] || language)}</span>`
    : '<span></span>'
  // The raw source rides on a data attribute so copy never has to reconstruct
  // it from highlighted markup.
  const bar = `<div class="code-bar">${label}<button class="copy" type="button" data-code="${escapeHtml(text)}">Copy</button></div>`
  return `<div class="code-block">${bar}<pre class="language-${language}"><code>${highlight(text, language)}</code></pre></div>`
}

const renderer = new marked.Renderer()

renderer.code = function ({ text, lang }) {
  const { language } = parseInfo(lang)
  return codeBlock(text, inferLang(text, language))
}

// Wide tables must scroll inside their own box; letting them widen the page
// gives every paragraph a horizontal scrollbar on a phone.
renderer.table = function (token) {
  const inner = marked.Renderer.prototype.table.call(this, token)
  return `<div class="table-wrap">${inner}</div>`
}

renderer.heading = function ({ tokens, depth, text: raw }) {
  const text = this.parser.parseInline(tokens)
  // Slug and TOC label come from the raw markdown, not the parsed HTML: the
  // parsed form has already turned an apostrophe into &#39;, which would
  // escape again into visible junk and produce a "you39re" anchor.
  const plain = raw.replace(/[*`_[\]]|\(([^)]*)\)/g, '')
  const id = slugify(plain)
  if (depth === 2 || depth === 3) headings.push({ id, text: plain, depth })
  if (depth === 1) return `<h1 id="${id}">${text}</h1>\n`
  // Deep links are how one developer sends another the exact answer.
  return `<h${depth} id="${id}">${text}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`
}

marked.setOptions({ renderer })

/**
 * Collapses runs of adjacent `tab=`-labelled fences into one tab group.
 *
 * Showing the reader their own language, and remembering which that is, is
 * the single highest-leverage thing on a quickstart page — a reader who has
 * to mentally port the one example before evaluating us often just leaves.
 */
function groupTabs(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type !== 'code' || !parseInfo(t.lang).tab) {
      out.push(t)
      continue
    }
    // Gather this run, stepping over the blank lines between fences.
    const run = []
    let j = i
    while (j < tokens.length) {
      if (tokens[j].type === 'code' && parseInfo(tokens[j].lang).tab) {
        run.push(tokens[j])
        j++
      } else if (tokens[j].type === 'space' && run.length) {
        // Only skip a gap that another tab fence actually follows.
        let k = j
        while (k < tokens.length && tokens[k].type === 'space') k++
        if (tokens[k]?.type === 'code' && parseInfo(tokens[k].lang).tab) j = k
        else break
      } else break
    }
    i = j - 1

    // A lone labelled fence is just a code block; a tab bar over one tab is noise.
    if (run.length === 1) {
      const { language } = parseInfo(run[0].lang)
      out.push({ type: 'html', block: true, text: codeBlock(run[0].text, inferLang(run[0].text, language)) })
      continue
    }

    const tabs = run.map((tok) => {
      const { language, tab } = parseInfo(tok.lang)
      return { label: tab, text: tok.text, lang: inferLang(tok.text, language) }
    })
    const buttons = tabs
      .map(
        (t) =>
          `<button class="tab-btn" type="button" role="tab" aria-selected="false" data-lang="${escapeHtml(t.label)}">${escapeHtml(t.label)}</button>`,
      )
      .join('')
    // One copy button in the tab bar rather than one per panel: a second row
    // holding a lone button looks like a mistake, and copy needs JS anyway, so
    // it can live in the bar that JS also controls.
    const bar = `<div class="tab-bar" role="tablist"><div class="tab-btns">${buttons}</div><button class="copy tabs-copy" type="button" data-code="${escapeHtml(tabs[0].text)}">Copy</button></div>`
    const panels = tabs
      .map(
        (t) =>
          `<div class="tab-panel" role="tabpanel" data-lang="${escapeHtml(t.label)}" data-code="${escapeHtml(t.text)}">` +
          `<span class="code-lang panel-lang">${escapeHtml(t.label)}</span>` +
          `<pre class="language-${t.lang}"><code>${highlight(t.text, t.lang)}</code></pre></div>`,
      )
      .join('')
    out.push({ type: 'html', block: true, text: `<div class="tabs">${bar}${panels}</div>` })
  }
  return out
}

/** Lex, regroup tabbed fences, then render. */
function render(md) {
  return marked.parser(groupTabs(marked.lexer(md)))
}

/** Internal .md links point at rendered pages; extensionless, as Cloudflare serves them. */
function rewriteLinks(html) {
  return html
    .replace(/href="\.\.\/examples\/[^"]*"/g, 'href="/docs/"')
    .replace(/href="([a-z0-9-]+)\.md(#[^"]*)?"/gi, (_m, page, hash) => `href="/docs/${page}${hash || ''}"`)
    .replace(/href="\.\.\/[^"]*\.md"/g, 'href="/docs/"')
}

/**
 * Date this page's source last actually changed. Neither competitor shows a
 * freshness signal anywhere, and in a category that moves this fast, an undated
 * page is one the reader has to distrust.
 */
function lastUpdated(file) {
  try {
    const out = execSync(`git log -1 --format=%cs -- ${JSON.stringify(file)}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (out) return out
  } catch {
    /* not a git checkout, or the file is new — fall through */
  }
  return new Date().toISOString().slice(0, 10)
}

// Endpoints parsed from the API reference in pass 1, grouped by category, so
// the sidebar can list every endpoint under its section. Populated before any
// page is written.
let API_ENDPOINTS = []

// An H3 like "POST /screenshot → image/png|jpeg|webp" → { method, path, id }.
function parseEndpoint(headingText, id) {
  const m = headingText.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/)
  if (!m) return null
  return { method: m[1], path: m[2], id }
}

/**
 * The sidebar. A flat page list buries a 16-endpoint reference behind one
 * link; developers want to see the whole surface and jump straight to the
 * call they need. So the API reference expands inline into its categories,
 * with every endpoint a labelled row that deep-links to its section.
 */
function sidebarHtml(currentSlug) {
  const link = (s, label) =>
    `<a class="nav-link ${s === currentSlug ? 'active' : ''}" href="/docs/${s}">${escapeHtml(label)}</a>`

  // Group the parsed endpoints under their category heading, preserving order.
  const byCategory = []
  let bucket = null
  for (const h of API_ENDPOINTS) {
    if (h.type === 'category') {
      bucket = { title: h.text, id: h.id, items: [] }
      byCategory.push(bucket)
    } else if (h.type === 'endpoint' && bucket) {
      bucket.items.push(h)
    }
  }

  const apiTree = byCategory
    .map((cat) => {
      const rows = cat.items
        .map(
          (e) =>
            `<a class="ep" href="/docs/api-reference#${e.id}"><span class="m m-${e.method.toLowerCase()}">${e.method}</span><span class="ep-path">${escapeHtml(e.path)}</span></a>`,
        )
        .join('\n            ')
      return `<div class="nav-cat">
          <a class="nav-cat-label" href="/docs/api-reference#${cat.id}">${escapeHtml(cat.title)}</a>
          ${rows ? `<div class="nav-eps">\n            ${rows}\n          </div>` : ''}
        </div>`
    })
    .join('\n        ')

  const apiOpen = currentSlug === 'api-reference'
  const guides = GUIDES.map(([s, label]) => link(s, label)).join('\n        ')
  return `
    <span class="nav-title">Get started</span>
    <div class="nav-links">
        ${link('quickstart', 'Quickstart')}
        ${link('concepts', 'Concepts')}
        ${link('recipes', 'Recipes')}
    </div>

    <span class="nav-title nav-title-spaced">Guides</span>
    <div class="nav-links">
        ${guides}
    </div>

    <details class="nav-group" ${apiOpen ? 'open' : ''}>
      <summary class="nav-title nav-title-spaced">API reference</summary>
      <div class="nav-api">
        ${apiTree}
      </div>
    </details>

    <span class="nav-title nav-title-spaced">Integrations</span>
    <div class="nav-links">
        ${link('guide-sdk', 'SDKs')}
        ${link('guide-integrations', 'LangChain & n8n')}
        ${link('mcp', 'MCP server')}
    </div>

    <span class="nav-title nav-title-spaced">Migrating</span>
    <div class="nav-links">
    </div>

    <span class="nav-title nav-title-spaced">More</span>
    <div class="nav-links">
        ${link('errors', 'Errors')}
        <a class="nav-link" href="/#pricing">Pricing</a>
        <a class="nav-link" href="https://github.com/runbrowser-dev/runbrowser" target="_blank" rel="noopener">Chromium image</a>
    </div>`
}

function layout({ title, body, slug, toc, description, updated }) {
  const idx = NAV.findIndex(([s]) => s === slug)
  const prev = idx > 0 ? NAV[idx - 1] : null
  const next = idx >= 0 && idx < NAV.length - 1 ? NAV[idx + 1] : null

  const tocHtml = toc.length
    ? `<aside class="toc">
    <span class="toc-title">On this page</span>
    ${toc.map((h) => `<a class="toc-${h.depth}" href="#${h.id}">${escapeHtml(h.text)}</a>`).join('\n    ')}
  </aside>`
    : '<aside class="toc"></aside>'

  const pager =
    prev || next
      ? `<nav class="pager">
      ${prev ? `<a class="prev" href="/docs/${prev[0]}"><span>Previous</span>${escapeHtml(prev[1])}</a>` : '<span></span>'}
      ${next ? `<a class="next" href="/docs/${next[0]}"><span>Next</span>${escapeHtml(next[1])}</a>` : '<span></span>'}
    </nav>`
      : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — runbrowser docs</title>
<meta name="description" content="${escapeHtml(description || title + ' — runbrowser documentation.')}">
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/docs.css">
</head>
<body>
<header class="docs-header">
  <a class="logo" href="/">
    <span class="mark"><img src="/assets/logo.svg" alt="" width="24" height="24"></span>
    <span>runbrowser <span class="logo-docs">docs</span></span>
  </a>
  <button id="search-open" class="search-trigger" type="button">
    <span>Search the docs…</span><span><kbd class="kbd-mod">Ctrl</kbd> <kbd>K</kbd></span>
  </button>
  <a class="back" href="/">runbrowser.dev &rarr;</a>
</header>

<div id="search-modal" class="search-modal" hidden>
  <div class="search-panel" role="dialog" aria-modal="true" aria-label="Search documentation">
    <input id="search-input" type="search" placeholder="Search the docs…" autocomplete="off" spellcheck="false">
    <div id="search-results" class="search-results"></div>
    <div class="search-hint"><kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate · <kbd>&crarr;</kbd> open · <kbd>esc</kbd> close</div>
  </div>
</div>

<div class="layout">
  <nav class="sidebar">${sidebarHtml(slug)}
  </nav>
  <main class="prose">
    ${slug ? `<div class="breadcrumbs"><a href="/docs/">Docs</a><span>/</span><span>${escapeHtml(title)}</span></div>` : ''}
${body}
    ${pager}
    <hr>
    <p class="foot">
      Something wrong, missing, or just annoying here?
      <a href="mailto:hi@runbrowser.dev?subject=${encodeURIComponent('Docs feedback: ' + title)}">Tell us</a> —
      we'd rather fix it than have you work around it.
    </p>
    ${updated ? `<p class="updated">Last updated ${escapeHtml(updated)}</p>` : ''}
  </main>
  ${tocHtml}
</div>
<script src="/assets/docs.js" defer></script>
</body>
</html>
`
}

mkdirSync(OUT, { recursive: true })

const searchIndex = []
const files = readdirSync(CONTENT).filter((f) => f.endsWith('.md'))
let count = 0

// Pass 1: render every page and collect its headings. Writing is deferred to
// pass 2 so the sidebar, built from the API reference's endpoints, is complete
// before the first file is written.
const rendered = []
for (const file of files) {
  const slug = basename(file, '.md')
  const md = readFileSync(join(CONTENT, file), 'utf8')
  headings = []
  const titleMatch = md.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1] : slug
  const html = rewriteLinks(render(md))

  // One index entry per section, so a hit lands on the right heading rather
  // than the top of a 300-line page.
  md.split(/^##\s+/m).forEach((sec, i) => {
    const secTitle = i === 0 ? title : sec.split('\n')[0].trim()
    const bodyText = sec
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#*`>|[\]()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500)
    searchIndex.push({
      p: slug,
      t: title,
      s: i === 0 ? '' : slugify(secTitle),
      h: secTitle,
      b: bodyText,
      w: PAGE_WEIGHT[slug] ?? 1,
    })
  })

  const firstPara = md
    .replace(/^#\s+.+$/m, '')
    .split('\n\n')
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith('#') && !s.startsWith('```') && !s.startsWith('|'))

  rendered.push({
    slug, title, html,
    toc: headings.slice(),
    description: firstPara?.replace(/\s+/g, ' ').slice(0, 155),
    updated: lastUpdated(join(CONTENT, file)),
  })
}

// Build the endpoint tree from the API reference: each H2 is a category, each
// H3 that starts with an HTTP method is an endpoint under it.
{
  const api = rendered.find((p) => p.slug === 'api-reference')
  if (api) {
    for (const h of api.toc) {
      if (h.depth === 2) {
        API_ENDPOINTS.push({ type: 'category', text: h.text, id: h.id })
      } else if (h.depth === 3) {
        const ep = parseEndpoint(h.text, h.id)
        if (ep) API_ENDPOINTS.push({ type: 'endpoint', ...ep })
      }
    }
  }
}

// Pass 2: write every page with the finished sidebar.
for (const p of rendered) {
  writeFileSync(join(OUT, `${p.slug}.html`), layout({ title: p.title, body: p.html, slug: p.slug, toc: p.toc, description: p.description, updated: p.updated }))
  count++
}

const SNIPPET = `import { chromium } from 'playwright'

const browser = await chromium.connectOverCDP(
  'wss://connect.runbrowser.dev?token=' + process.env.RUNBROWSER_TOKEN,
)
const page = await browser.newPage()
await page.goto('https://example.com')`

const cards = [
  ['quickstart', 'Quickstart', 'Change one line and run your existing script on our browsers.'],
  ['guide-sessions', 'Sessions & stable sessions', 'One browser, yours while connected — and how to keep it alive between connects.'],
  ['guide-viewer', 'The live viewer', 'Watch a run in real time, or hand someone a signed link that carries no key.'],
  ['guide-extract', 'Structured extraction', 'A URL and a JSON Schema in, validated JSON out — on JavaScript sites too.'],
  ['guide-crawling', 'Crawling a site', 'Smart-scrape, map and crawl — cheapest-first, and honest about what they did.'],
  ['api-reference', 'API reference', 'Every endpoint, categorised, with request and response shapes.'],
  ['mcp', 'MCP server', 'Browser tools for Claude, Cursor, or anything that speaks MCP.'],
  ['errors', 'Errors', 'Every status code we return, what causes it, and what to do about it.'],
]
  .map(
    ([s, t, blurb]) =>
      `      <a class="card" href="/docs/${s}">
        <span class="card-title">${escapeHtml(t)}</span>
        <span class="card-blurb">${escapeHtml(blurb)}</span>
      </a>`,
  )
  .join('\n')

headings = []
writeFileSync(
  join(OUT, 'index.html'),
  layout({
    title: 'Documentation',
    slug: '',
    toc: [],
    description: 'Hosted Chromium you drive over CDP. Quickstart, API reference and migration guides.',
    body: `    <h1>Documentation</h1>
    <p class="lede-doc">Hosted Chromium you drive over CDP with Playwright, Puppeteer or
    anything else that speaks it. For most people the migration is one line.</p>

    <div class="code-block">
      <div class="code-bar"><span class="code-lang">typescript</span><button class="copy" type="button" data-code="${escapeHtml(SNIPPET)}">Copy</button></div>
      <pre class="language-typescript"><code>${Prism.highlight(SNIPPET, Prism.languages.typescript, 'typescript')}</code></pre>
    </div>

    <div class="cards">
${cards}
    </div>`,
  }),
)
count++

writeFileSync(join(OUT, 'search-index.json'), JSON.stringify(searchIndex))

// Agent-readable surfaces. A large share of the people evaluating a browser
// API are now doing it through a coding agent, and an agent that can read the
// whole corpus in one fetch will recommend what it actually understands.
//
// Sectioned with a sentence per page rather than a flat link dump. A flat list
// of URLs tells a model nothing about which page to open, so it opens several.
const BLURB = {
  quickstart: 'Connect an existing Playwright or Puppeteer script in one line, in TypeScript or Python.',
  concepts: 'Sessions, the session lifecycle, billing granularity, stable sessions, recording, stealth, proxies and the live viewer.',
  'api-reference': 'Every endpoint: the CDP WebSocket, sessions, autopilot runs, browser contexts, fetch, search and extract, with request and response shapes.',
  errors: 'Every status code and error code the API returns, with cause, fix, and whether it is worth retrying.',
  mcp: 'The hosted MCP server: browser tools for Claude, Cursor and other MCP clients.',
  'guide-autopilot': 'Describe a task in plain language: what comes back, how to turn it into a pass/fail check, and where it struggles.',
}

const SITE = 'https://runbrowser.dev'
const full = []
const llms = [
  '# runbrowser',
  '',
  '> Hosted Chromium you drive over CDP with Playwright, Puppeteer, or anything else that speaks it.',
  '> Hosted entirely in the EU. Sessions are billed by the second.',
  '',
  '## Getting started',
  '',
]
for (const [slug, label] of NAV) {
  const line = `- [${label}](${SITE}/docs/${slug}.md): ${BLURB[slug] || label}`
  if (slug === 'api-reference') llms.push('', '## Reference', '')
  else if (slug === 'mcp') llms.push('', '## Integrations', '')
  llms.push(line)
}
llms.push('', '## Optional', '', `- [Pricing](${SITE}/#pricing): Plan limits and prices.`, '')

for (const file of files) {
  const slug = basename(file, '.md')
  const md = readFileSync(join(CONTENT, file), 'utf8')
  // Same markdown the HTML was built from, served alongside it so a link to
  // /docs/errors.md is always the exact source of /docs/errors.
  writeFileSync(join(OUT, `${slug}.md`), md)
  full.push(md.trim())
}

writeFileSync('llms.txt', llms.join('\n'))
writeFileSync('llms-full.txt', full.join('\n\n---\n\n') + '\n')

console.log(
  `rendered ${count} pages, ${searchIndex.length} searchable sections, ` +
    `${files.length} markdown sources, llms.txt + llms-full.txt`,
)
