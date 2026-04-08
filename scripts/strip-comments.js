'use strict'

// Strip EVERY comment (// and /* */ and /** */ JSDoc) from a JS/TS/TSX
// source file. Keeps only section headers that match:
//
//   // ---------- Label ----------
//   // ========== Label ==========
//
// Uses the TypeScript scanner so JSX text content (e.g. "http://...")
// is never confused with JS line comments.
//
// Usage:
//   node scripts/strip-comments.js <file-or-dir> [<file-or-dir> ...]

const fs = require('node:fs')
const path = require('node:path')

let ts
try {
  ts = require('typescript')
} catch {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'FactorPro', 'apps', 'frontend', 'node_modules', 'typescript'),
    path.resolve(__dirname, '..', '..', '..', 'FactorPro', 'apps', 'frontend', 'node_modules', 'typescript'),
    path.resolve(__dirname, '..', 'node_modules', 'typescript'),
  ]
  for (const p of candidates) {
    try {
      ts = require(p)
      break
    } catch {}
  }
  if (!ts) {
    console.error('typescript package not found — install it in the target project first')
    process.exit(1)
  }
}

const EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'])
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nixpacks',
  '.adonisjs',
  '.turbo',
  'dist',
  'build',
  'out',
  '.vscode',
  '.idea',
  '.cache',
])

function isSectionHeader(_commentText) {
  return false
}

function isTsx(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.tsx' || ext === '.jsx'
}

function getScriptKind(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.tsx') return ts.ScriptKind.TSX
  if (ext === '.jsx') return ts.ScriptKind.JSX
  if (ext === '.ts') return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

function collectScannerComments(source, filePath) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    isTsx(filePath) ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard
  )
  scanner.setText(source)

  const ranges = []
  let token = scanner.scan()
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      ranges.push({
        pos: scanner.getTokenPos(),
        end: scanner.getTextPos(),
        text: scanner.getTokenText(),
        kind: token,
      })
    }
    token = scanner.scan()
  }
  return ranges
}

function collectJsxProtectedRanges(sourceFile) {
  const ranges = []
  function visit(node) {
    if (
      node.kind === ts.SyntaxKind.JsxText ||
      node.kind === ts.SyntaxKind.StringLiteral ||
      node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail ||
      node.kind === ts.SyntaxKind.RegularExpressionLiteral
    ) {
      ranges.push({ pos: node.getStart(sourceFile), end: node.end })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return ranges
}

function collectCommentRanges(source, filePath) {
  const scanner = collectScannerComments(source, filePath)
  let sourceFile
  try {
    sourceFile = ts.createSourceFile(
      path.basename(filePath),
      source,
      ts.ScriptTarget.Latest,
      true,
      getScriptKind(filePath)
    )
  } catch {
    return scanner
  }
  const protectedRanges = collectJsxProtectedRanges(sourceFile)
  return scanner.filter((c) => {
    for (const p of protectedRanges) {
      if (c.pos < p.end && c.end > p.pos) return false
    }
    return true
  })
}

function findLineStart(source, pos) {
  let i = pos
  while (i > 0 && source[i - 1] !== '\n') i--
  return i
}

function findLineEnd(source, pos) {
  let i = pos
  while (i < source.length && source[i] !== '\n') i++
  return i
}

function isWhitespaceOnly(str) {
  return /^[ \t\r]*$/.test(str)
}

function stripFromSource(source, filePath) {
  const ranges = collectCommentRanges(source, filePath)

  const removable = ranges.filter((r) => !isSectionHeader(r.text))
  removable.sort((a, b) => b.pos - a.pos)

  let result = source
  for (const r of removable) {
    const lineStart = findLineStart(result, r.pos)
    const lineEnd = findLineEnd(result, r.end)
    const before = result.slice(lineStart, r.pos)
    const after = result.slice(r.end, lineEnd)

    if (isWhitespaceOnly(before) && isWhitespaceOnly(after)) {
      const nextNewline = lineEnd < result.length && result[lineEnd] === '\n' ? lineEnd + 1 : lineEnd
      result = result.slice(0, lineStart) + result.slice(nextNewline)
    } else {
      let cutEnd = r.end
      if (isWhitespaceOnly(after)) {
        cutEnd = lineEnd
      }
      let cutStart = r.pos
      while (cutStart > lineStart && (result[cutStart - 1] === ' ' || result[cutStart - 1] === '\t')) {
        cutStart--
      }
      result = result.slice(0, cutStart) + result.slice(cutEnd)
    }
  }

  result = result.replace(/[ \t]+$/gm, '')
  result = result.replace(/\n{3,}/g, '\n\n')
  if (result.length > 0 && !result.endsWith('\n')) result += '\n'
  return result
}

function shouldProcess(file) {
  return EXTS.has(path.extname(file).toLowerCase())
}

function walk(root, out) {
  let stat
  try {
    stat = fs.statSync(root)
  } catch {
    return
  }
  if (stat.isDirectory()) {
    const base = path.basename(root)
    if (SKIP_DIRS.has(base)) return
    if (base.startsWith('.') && base !== '.') return
    let entries
    try {
      entries = fs.readdirSync(root)
    } catch {
      return
    }
    for (const name of entries) walk(path.join(root, name), out)
  } else if (stat.isFile() && shouldProcess(root)) {
    out.push(root)
  }
}

function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('Usage: node scripts/strip-comments.js <file-or-dir> [...]')
    process.exit(1)
  }

  const files = []
  for (const arg of args) walk(path.resolve(arg), files)

  let changed = 0
  let scanned = 0
  for (const file of files) {
    scanned++
    try {
      const before = fs.readFileSync(file, 'utf8')
      const after = stripFromSource(before, file)
      if (after !== before) {
        fs.writeFileSync(file, after, 'utf8')
        changed++
      }
    } catch (err) {
      console.error(`  ✗ ${file}: ${err.message}`)
    }
  }
  console.log(`${changed}/${scanned} files stripped`)
}

main()
