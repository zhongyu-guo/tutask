import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:4175/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

async function selectNodeByTitle(page, title) {
  await page.locator('.node .title', { hasText: title }).first().click()
}

test('happy path: edit goal, build chain, cycle status, persist across reload', async ({ page }) => {
  // edit goal title via double-click
  await page.locator('.node[data-id="root"] .card').dblclick()
  await page.locator('.title-input').fill('一周年活动')
  await page.keyboard.press('Enter')
  await expect(page.locator('.node.goal .title')).toHaveText('一周年活动')

  // Tab on root creates a project
  await selectNodeByTitle(page, '一周年活动')
  await page.keyboard.press('Tab')
  await page.locator('.title-input').fill('前期筹备')
  await page.keyboard.press('Enter')
  await expect(page.locator('.node.project .title')).toHaveText('前期筹备')
  await expect(page.locator('#edges .edge')).toHaveCount(1)

  // Tab on project creates a task
  await selectNodeByTitle(page, '前期筹备')
  await page.keyboard.press('Tab')
  await page.locator('.title-input').fill('写文案')
  await page.keyboard.press('Enter')

  // Enter creates a parallel task sharing the same predecessor
  await page.keyboard.press('Enter')
  await page.locator('.title-input').fill('做海报')
  await page.keyboard.press('Enter')
  await expect(page.locator('.node')).toHaveCount(4)
  await expect(page.locator('#edges .edge')).toHaveCount(3)

  // Space cycles status: todo → doing
  await expect(page.locator('.node.selected .title')).toHaveText('做海报')
  await page.keyboard.press(' ')
  await expect(page.locator('.node.doing .title')).toHaveText('做海报')

  // D on the project opens the detail panel listing its prerequisite sub-steps
  await selectNodeByTitle(page, '前期筹备')
  await page.keyboard.press('d')
  await expect(page.locator('.node.selected .detail-panel')).toBeVisible()
  await expect(page.locator('.node.selected .prereq-title')).toHaveText(['写文案', '做海报'])

  // reload: everything persisted
  await page.reload()
  await expect(page.locator('.node')).toHaveCount(4)
  await expect(page.locator('.node.doing .title')).toHaveText('做海报')
  await expect(page.locator('#edges .edge')).toHaveCount(3)

  // export triggers a download
  const downloadPromise = page.waitForEvent('download')
  await page.locator('#btnExport').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toContain('taskdag-')
})

test('collapse folds the prerequisite sub-step chain with count badge', async ({ page }) => {
  // build root → A → B → C (B, C are the sub-steps that realize A)
  await page.locator('.node[data-id="root"] .card').click()
  for (const name of ['A', 'B', 'C']) {
    await page.keyboard.press('Tab')
    await page.locator('.title-input').fill(name)
    await page.keyboard.press('Enter')
  }
  await expect(page.locator('.node')).toHaveCount(4)

  // collapse A's prerequisite subtree: B and C hidden
  await selectNodeByTitle(page, 'A')
  await page.locator('.node.selected .collapse-btn').click()
  await expect(page.locator('.node')).toHaveCount(2)
  await expect(page.locator('.collapse-btn.collapsed')).toHaveText('2▸')

  // expand restores them
  await page.locator('.collapse-btn.collapsed').click()
  await expect(page.locator('.node')).toHaveCount(4)
})
