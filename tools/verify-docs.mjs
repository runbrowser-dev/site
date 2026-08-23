// Verifies the rendered docs in a real browser:
//
//   npm run verify
//
// Every page loads clean, search works end to end, tabs switch and persist,
// copy buttons carry real source, internal links resolve, nothing overflows on
// a phone, and the whole thing still reads with JavaScript off.
//
// It serves the site itself rather than expecting one running, and resolves
// extensionless paths the way Cloudflare Workers Assets does — so the URLs
// under test are the URLs customers get, not local approximations of them.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const PORT = 8899
const BASE = `http://localhost:${PORT}`
const PAGES = [
  // The marketing page was missing from this list for its whole life, which is
  // the page most likely to be read and the one where a layout break costs the
  // most. It is checked first now.
  '/',
  '/docs/',
  '/docs/quickstart',
  '/docs/concepts',
  '/docs/guide-autopilot',
  '/docs/guide-checks',
  '/docs/api-reference',
  '/docs/errors',
  '/docs/mcp',
]

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  // Cloudflare's order: exact file, then directory index, then +.html.
  for (const candidate of [path, join(path, 'index.html'), path + '.html']) {
    try {
      const body = await readFile(join(process.cwd(), candidate))
      res.writeHead(200, { 'content-type': TYPES[extname(candidate)] || 'application/octet-stream' })
      return res.end(body)
    } catch {
      /* try the next shape */
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})
await new Promise((r) => server.listen(PORT, r))

let failures = 0
const fail = (msg) => {
  failures++
  console.log(`  FAIL  ${msg}`)
}
const ok = (msg) => console.log(`  ok    ${msg}`)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`))

console.log('\n== pages load clean ==')
for (const p of PAGES) {
  errors.length = 0
  const res = await page.goto(BASE + p, { waitUntil: 'networkidle' })
  if (res.status() !== 200) fail(`${p} -> ${res.status()}`)
  else if (errors.length) fail(`${p}: ${errors.join('; ')}`)
  else ok(p)
}

console.log('\n== syntax highlighting ==')
await page.goto(BASE + '/docs/quickstart', { waitUntil: 'networkidle' })
const tokens = await page.locator('pre code .token').count()
tokens > 40 ? ok(`${tokens} highlighted tokens on quickstart`) : fail(`only ${tokens} tokens highlighted`)

console.log('\n== language tabs ==')
// Pinned to an exact count, this failed the moment quickstart gained a third
// example — reporting a docs improvement as a build break. What matters is
// that tabs render and switch, not how many there are.
const groups = await page.locator('.tabs').count()
groups >= 2 ? ok(`${groups} tab groups`) : fail(`expected tab groups, got ${groups}`)

const firstTab = page.locator('.tabs').first()
const buttons = firstTab.locator('button')
if (await buttons.count() < 2) {
  fail('a tab group with fewer than two tabs is not a tab group')
} else {
  const before = await firstTab.locator('pre:visible').first().textContent()
  await buttons.nth(1).click()
  const after = await firstTab.locator('pre:visible').first().textContent()
  before !== after ? ok('tabs switch the visible panel') : fail('clicking a tab changed nothing')
}
// Exactly one panel visible per group once JS has collapsed them.
for (let i = 0; i < groups; i++) {
  const vis = await page.locator('.tabs').nth(i).locator('.tab-panel:visible').count()
  vis === 1 ? ok(`group ${i + 1}: one panel visible`) : fail(`group ${i + 1}: ${vis} panels visible`)
}
await page.locator('.tab-btn[data-lang="Python"]').first().click()
const active = await page.locator('.tabs').nth(0).locator('.tab-panel:visible').getAttribute('data-lang')
active === 'Python' ? ok('clicking Python switches the panel') : fail(`panel is ${active}, expected Python`)

// Persistence across a navigation is the whole point of remembering the choice.
await page.goto(BASE + '/docs/quickstart', { waitUntil: 'networkidle' })
const remembered = await page.locator('.tabs').nth(0).locator('.tab-panel:visible').getAttribute('data-lang')
remembered === 'Python' ? ok('language choice persists across pages') : fail(`after reload panel is ${remembered}`)

console.log('\n== copy buttons ==')
const code = await page.locator('.copy').first().getAttribute('data-code')
code && code.includes('playwright') ? ok('copy button carries real source') : fail(`data-code looks wrong: ${code}`)

console.log('\n== search ==')
await page.keyboard.press('/')
await page.waitForSelector('#search-modal:not([hidden])', { timeout: 2000 }).then(
  () => ok('"/" opens search'),
  () => fail('"/" did not open search'),
)
await page.fill('#search-input', 'concurrency')
await page.waitForFunction(() => document.querySelectorAll('.search-hit').length > 0, null, { timeout: 3000 }).then(
  async () => ok(`"concurrency" -> ${await page.locator('.search-hit').count()} hits`),
  () => fail('"concurrency" returned no hits'),
)
const firstHit = await page.locator('.search-hit').first().getAttribute('href')
ok(`top hit: ${firstHit}`)

// The whole point of the errors page is that someone who just got a 429 can
// paste it into search and land on the answer. If that stops working, the
// page may as well not exist.
for (const q of ['429', '503', 'blocked', 'timeout', 'quota']) {
  await page.fill('#search-input', q)
  const hrefs = await page
    .waitForFunction(() => document.querySelectorAll('.search-hit').length > 0, null, { timeout: 3000 })
    .then(() => page.locator('.search-hit').evaluateAll((a) => a.map((x) => x.getAttribute('href'))))
    .catch(() => [])
  if (!hrefs.some((h) => h.startsWith('/docs/errors'))) {
    fail(`searching "${q}" surfaces no errors-page hit (got ${hrefs.slice(0, 3).join(', ') || 'nothing'})`)
  }
}
ok('status codes and failure words all reach the errors page')
await page.keyboard.press('Escape')
// Not waitForSelector: a hidden element is never "visible", so the default
// state would never match no matter how correct the behaviour is.
await page
  .waitForFunction(() => document.getElementById('search-modal').hidden, null, { timeout: 1000 })
  .then(
    () => ok('escape closes search'),
    () => fail('escape did not close search'),
  )
// Cmd/Ctrl+K is the shortcut developers actually reach for.
await page.keyboard.press('Control+k')
await page.waitForSelector('#search-modal:not([hidden])', { timeout: 2000 }).then(
  () => ok('ctrl+k opens search'),
  () => fail('ctrl+k did not open search'),
)
await page.keyboard.press('Escape')

console.log('\n== anchors + toc ==')
const anchors = await page.locator('.anchor').count()
const tocLinks = await page.locator('.toc a').count()
anchors > 0 ? ok(`${anchors} heading anchors`) : fail('no heading anchors')
tocLinks > 0 ? ok(`${tocLinks} toc entries`) : fail('no toc entries')

console.log('\n== no raw HTML entities leaked into text ==')
for (const p of PAGES) {
  await page.goto(BASE + p, { waitUntil: 'domcontentloaded' })
  const bad = await page.evaluate(() => {
    const text = document.querySelector('.layout')?.innerText || ''
    return (text.match(/&(amp|lt|gt|quot|#\d+);/g) || []).slice(0, 3)
  })
  if (bad.length) fail(`${p} shows raw entities: ${bad.join(', ')}`)
}
ok('no double-escaped entities in rendered text')

console.log('\n== internal links resolve ==')
const seen = new Set()
for (const p of PAGES) {
  await page.goto(BASE + p, { waitUntil: 'domcontentloaded' })
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')),
  )
  for (const href of links) {
    const path = href.split('#')[0]
    if (seen.has(path)) continue
    seen.add(path)
    const res = await page.request.get(BASE + path)
    if (!res.ok()) fail(`dead link ${href} (from ${p}) -> ${res.status()}`)
  }
}
ok(`${seen.size} distinct internal links checked`)

console.log('\n== no horizontal overflow ==')
for (const w of [390, 768, 1440]) {
  await page.setViewportSize({ width: w, height: 900 })
  for (const p of PAGES) {
    await page.goto(BASE + p, { waitUntil: 'domcontentloaded' })
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 1) fail(`${p} at ${w}px overflows by ${over}px`)
  }
  ok(`${w}px: no page overflows`)
}

console.log('\n== works with JavaScript disabled ==')
const noJs = await browser.newContext({ javaScriptEnabled: false })
const p2 = await noJs.newPage()
await p2.goto(BASE + '/docs/quickstart', { waitUntil: 'domcontentloaded' })
const visiblePanels = await p2.locator('.tab-panel:visible').count()
const prose = (await p2.locator('.prose').innerText()).length
visiblePanels >= 5 ? ok(`all ${visiblePanels} code panels visible without JS`) : fail(`only ${visiblePanels} panels without JS`)
prose > 2000 ? ok(`${prose} chars of prose without JS`) : fail(`only ${prose} chars without JS`)

await browser.close()
server.close()
console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nall checks passed\n')
process.exit(failures ? 1 : 0)
