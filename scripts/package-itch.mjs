import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { entriesFrom, sha256, walk, zip } from './zip.mjs'

// Builds the game and writes an itch.io-ready ZIP, with index.html at the ZIP
// root as itch requires. Run it with `npm run package:itch`.
//
// itch.io's HTML5 limits, checked below rather than discovered on upload:
// at most 1,000 files, 500 MB in total, 200 MB per file, paths under 240 chars.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const OUT_DIR = join(ROOT, 'packages-out')
const OUT = join(OUT_DIR, 'cupcake-unicorn-itch.zip')

const LIMITS = { files: 1000, total: 500 * 1024 * 1024, perFile: 200 * 1024 * 1024, path: 240 }

const skipBuild = process.argv.includes('--no-build')
if (!skipBuild) {
  console.log('> npm run build')
  // Through a shell, because on Windows `npm` is a script rather than an
  // executable. There is nothing to interpolate, so there is nothing to quote.
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' })
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html is missing — itch.io needs the entry file at the ZIP root.')
  process.exit(1)
}

const paths = walk(DIST).sort()
const entries = entriesFrom(DIST, paths)
const problems = []
if (entries.length > LIMITS.files) problems.push(`${entries.length} files, over itch's ${LIMITS.files}`)
let total = 0
for (const [name, buf] of entries) {
  total += buf.length
  if (buf.length > LIMITS.perFile) problems.push(`${name} is ${(buf.length / 1e6).toFixed(1)} MB, over 200 MB`)
  if (name.length > LIMITS.path) problems.push(`${name} is ${name.length} chars, over ${LIMITS.path}`)
  // itch serves from a case-sensitive filesystem; a Windows build can hide a clash.
  if (/[\\:*?"<>|]/.test(name)) problems.push(`${name} has a character some unzippers refuse`)
}
if (total > LIMITS.total) problems.push(`${(total / 1e6).toFixed(0)} MB in total, over 500 MB`)

const lower = new Map()
for (const [name] of entries) {
  const key = name.toLowerCase()
  if (lower.has(key)) problems.push(`${name} and ${lower.get(key)} differ only in case`)
  lower.set(key, name)
}

if (problems.length) {
  console.error('\nThis build would not upload cleanly:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
const buf = zip(entries)
writeFileSync(OUT, buf)

console.log(`\n${OUT}`)
console.log(`  ${entries.length} files, ${(total / 1e6).toFixed(1)} MB uncompressed, ${(buf.length / 1e6).toFixed(1)} MB zipped`)
console.log(`  sha256 ${sha256(buf)}`)
console.log('  index.html is at the ZIP root; upload it to itch.io as an HTML5 game.')
