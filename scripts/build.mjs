import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// dependency order matters: later files use names defined in earlier ones
const MODULES = [
  'src/core/model.js',
  'src/core/graph.js',
  'src/core/layout.js',
  'src/core/serialize.js',
  'src/core/store.js',
  'src/ui/storage.js',
  'src/ui/state.js',
  'src/ui/render.js',
  'src/ui/style-panel.js',
  'src/ui/interactions.js',
  'src/ui/main.js'
]

function stripModuleSyntax(source) {
  return source
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
    .replace(/^export\s+\{[^}]*\}\s*$/gm, '')
    .replace(/^export\s+/gm, '')
}

function build() {
  const scriptParts = MODULES.map(file => {
    const source = readFileSync(join(root, file), 'utf8')
    return `// ===== ${file} =====\n${stripModuleSyntax(source)}`
  })
  const script = `<script>\n'use strict';\n(function () {\n${scriptParts.join('\n')}\n})();\n</script>`
  const style = `<style>\n${readFileSync(join(root, 'src/styles.css'), 'utf8')}\n</style>`

  let html = readFileSync(join(root, 'src/index.html'), 'utf8')
  html = html.replace(/<!-- BUILD:STYLE -->[\s\S]*?<!-- \/BUILD:STYLE -->/, style)
  html = html.replace(/<!-- BUILD:SCRIPT -->[\s\S]*?<!-- \/BUILD:SCRIPT -->/, script)

  if (/^\s*(import|export)\s/m.test(html.replace(/<style>[\s\S]*?<\/style>/, ''))) {
    throw new Error('build failed: import/export statements remain in output')
  }

  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist/index.html'), html)
  process.stdout.write(`dist/index.html written (${(html.length / 1024).toFixed(1)} KB)\n`)
}

build()
