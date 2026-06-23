import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const svg = readFileSync(join(here, 'icon.svg'), 'utf8')

const sizes = [16, 32, 180, 240, 512, 1024]

const browser = await chromium.launch()
const page = await browser.newPage()

for (const size of sizes) {
  const html = `<!doctype html><html><head><style>
    *{margin:0;padding:0}
    html,body{background:transparent}
    #wrap{width:${size}px;height:${size}px}
    #wrap svg{display:block;width:${size}px;height:${size}px}
  </style></head><body><div id="wrap">${svg}</div></body></html>`
  await page.setContent(html)
  await page.setViewportSize({ width: size, height: size })
  const el = await page.$('#wrap')
  const out = join(here, `icon-${size}.png`)
  await el.screenshot({ path: out, omitBackground: true })
  console.log(`wrote icon-${size}.png`)
}

await browser.close()
