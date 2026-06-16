import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function bundleScript() {
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: ['src/ui/main.js'],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    charset: 'utf8',
    legalComments: 'none',
    write: false
  })
  return result.outputFiles[0].text
}

async function build() {
  const bundledScript = await bundleScript()
  const script = `<script>\n${bundledScript}\n</script>`
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

build().catch(error => {
  console.error(error)
  process.exitCode = 1
})
