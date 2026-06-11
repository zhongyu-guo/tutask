import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 20000,
  use: { headless: true },
  webServer: {
    command: 'npm run build && npx serve dist -l 4175',
    port: 4175,
    reuseExistingServer: true
  }
})
