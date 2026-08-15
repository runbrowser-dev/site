// Pulls the customer-facing docs out of the platform repo and rebuilds the
// pages. The platform repo is the source of truth — these docs are tested
// there (PublishedPricingTableTest reads concepts.md), so editing the copies
// here would silently diverge from the product.
//
//   npm run sync -- ../platform      # or set PLATFORM_REPO
//
// deploy.md is deliberately NOT synced: it's the operator runbook, with secret
// names, backup/restore commands and the egress firewall. No customer needs
// it, and publishing it hands an attacker a map.

import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const PUBLIC_DOCS = [
  'quickstart.md',
  'concepts.md',
  'guide-sessions.md',
  'guide-viewer.md',
  'guide-extract.md',
  'guide-crawling.md',
  'guide-capture.md',
  'guide-proxies.md',
  'guide-stealth.md',
  'api-reference.md',
  'errors.md',
  'mcp.md',
  'migrating-from-browserless.md',
  'migrating-from-browserbase.md',
]

const repo = process.argv[2] || process.env.PLATFORM_REPO || '../platform'
const src = join(repo, 'docs')
if (!existsSync(src)) {
  console.error(`No docs/ at ${src}. Pass the platform repo path: npm run sync -- ../platform`)
  process.exit(1)
}

for (const file of PUBLIC_DOCS) {
  const from = join(src, file)
  if (!existsSync(from)) {
    console.error(`missing ${from} — did it get renamed in the platform repo?`)
    process.exit(1)
  }
  copyFileSync(from, join('content', file))
  console.log(`  synced ${file}`)
}

execSync('node tools/build-docs.mjs', { stdio: 'inherit' })
console.log('\nReview `git diff` before committing — this is what customers will read.')
