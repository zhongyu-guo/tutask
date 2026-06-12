// Watch src/ and rebuild dist/ on every change, so the dist server
// always serves the latest code — just refresh the browser.
import { watch } from 'node:fs'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')
const buildScript = join(root, 'scripts', 'build.mjs')

let timer = null
let building = false
let dirty = false

function rebuild(reason) {
  if (building) {
    dirty = true
    return
  }
  building = true
  execFile(process.execPath, [buildScript], (error, stdout, stderr) => {
    building = false
    if (error) {
      process.stderr.write(`[watch] build failed (${reason}): ${stderr || error.message}\n`)
    } else {
      process.stdout.write(`[watch] rebuilt (${reason}): ${stdout.trim()}\n`)
    }
    if (dirty) {
      dirty = false
      rebuild('queued change')
    }
  })
}

function schedule(reason) {
  clearTimeout(timer)
  timer = setTimeout(() => rebuild(reason), 150)
}

rebuild('initial')
watch(srcDir, { recursive: true }, (event, filename) => {
  if (filename && filename.endsWith('.DS_Store')) return
  schedule(filename ?? event)
})
process.stdout.write(`[watch] watching ${srcDir}\n`)
