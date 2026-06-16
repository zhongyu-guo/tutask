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

  // D on the project opens the floating detail panel
  await selectNodeByTitle(page, '前期筹备')
  await page.keyboard.press('d')
  await expect(page.locator('#stylePanel')).toBeVisible()
  await expect(page.locator('#stylePanel .sp-title')).toHaveText('前期筹备')
  await expect(page.locator('#stylePanel .f-status')).toHaveValue('todo')

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

test('multiple goals: create, switch, rename, delete', async ({ page }) => {
  // rename the default goal via the inline title control (name shown once)
  await page.locator('#goalName').click()
  await page.locator('#goalNameInput').fill('目标甲')
  await page.locator('#goalNameInput').press('Enter')
  await expect(page.locator('.node.goal .title')).toHaveText('目标甲')

  // create a second goal from the dropdown menu and add a node to it
  page.on('dialog', dialog => dialog.accept('目标乙'))
  await page.locator('#goalMenuBtn').click()
  await page.locator('#goalMenuNew').click()
  await expect(page.locator('.node.goal .title')).toHaveText('目标乙')
  await page.locator('.node[data-id="root"] .card').click()
  await page.keyboard.press('Tab')
  await page.locator('.title-input').fill('乙的项目')
  await page.keyboard.press('Enter')
  await expect(page.locator('.node')).toHaveCount(2)

  // switch back to the first goal via the dropdown — its canvas is separate
  await page.locator('#goalMenuBtn').click()
  await page.locator('.goal-menu-item', { hasText: '目标甲' }).click()
  await expect(page.locator('.node.goal .title')).toHaveText('目标甲')
  await expect(page.locator('.node')).toHaveCount(1)

  // survives reload (current goal remembered)
  await page.reload()
  await expect(page.locator('.node.goal .title')).toHaveText('目标甲')
  await page.locator('#goalMenuBtn').click()
  await expect(page.locator('.goal-menu-item')).toHaveCount(2)

  // delete current goal falls back to the other
  await page.locator('#goalMenuDelete').click() // confirm auto-accepted by dialog handler
  await expect(page.locator('.node.goal .title')).toHaveText('目标乙')
  await page.locator('#goalMenuBtn').click()
  await expect(page.locator('.goal-menu-item')).toHaveCount(1)
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

test('undo restores a deleted node and redo deletes it again', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').click()
  await page.keyboard.press('Tab')
  await page.locator('.title-input').fill('可恢复任务')
  await page.keyboard.press('Enter')
  await expect(page.locator('.node .title', { hasText: '可恢复任务' })).toBeVisible()

  await page.keyboard.press('Delete')
  await expect(page.locator('.node .title', { hasText: '可恢复任务' })).toHaveCount(0)

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
  await expect(page.locator('.node .title', { hasText: '可恢复任务' })).toBeVisible()

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z')
  await expect(page.locator('.node .title', { hasText: '可恢复任务' })).toHaveCount(0)
})

test('backspace deletes the selected edge without removing nodes', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').click()
  for (const name of ['A', 'B']) {
    await page.keyboard.press('Tab')
    await page.locator('.title-input').fill(name)
    await page.keyboard.press('Enter')
  }
  await expect(page.locator('.node')).toHaveCount(3)
  await expect(page.locator('#edges .edge')).toHaveCount(2)
  await selectNodeByTitle(page, 'B')
  await expect(page.locator('.node.selected .title')).toHaveText('B')

  await page.locator('#edges .edge-hit').first().click({ force: true })
  await page.keyboard.press('Backspace')
  await expect(page.locator('.node')).toHaveCount(3)
  await expect(page.locator('.node .title', { hasText: 'B' })).toBeVisible()
  await expect(page.locator('#edges .edge')).toHaveCount(1)
  await expect(page.locator('.node .title')).toHaveText(['双击编辑目标名称', 'A', 'B'])

  page.once('dialog', dialog => dialog.accept())
  await page.locator('#edges .edge-hit').first().click({ button: 'right', force: true })
  await expect(page.locator('.node')).toHaveCount(3)
  await expect(page.locator('#edges .edge')).toHaveCount(0)
})

test('rendered edge arrow points from child to parent', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').click()
  await page.keyboard.press('Tab')
  await page.locator('.title-input').fill('A')
  await page.keyboard.press('Enter')

  const metrics = await page.evaluate(() => {
    const root = document.querySelector('.node[data-id="root"]')
    const child = [...document.querySelectorAll('.node')].find(node =>
      node.querySelector('.title')?.textContent === 'A')
    const path = document.querySelector('#edges .edge')
    const d = path.getAttribute('d')
    const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number)
    return {
      startX: nums[0],
      endX: nums[nums.length - 2],
      rootX: parseFloat(root.style.left),
      childX: parseFloat(child.style.left),
      childRightX: parseFloat(child.style.left) + 210
    }
  })
  expect(metrics.startX).toBeGreaterThan(metrics.rootX)
  expect(metrics.startX).toBeLessThan(metrics.childX)
  expect(metrics.endX).toBeGreaterThan(metrics.rootX)
  expect(metrics.endX).toBeLessThan(metrics.startX)
})

test('saved positions on connected nodes are normalized back into auto layout', async ({ page }) => {
  const node = (id, title, x, y) => ({
    id, title, x, y,
    type: id === 'root' ? 'goal' : 'task',
    status: 'todo',
    description: '',
    estimatedHours: null,
    deadline: null,
    collapsed: false,
    detailOpen: false,
    fill: null,
    stroke: null
  })
  await page.evaluate(store => {
    localStorage.setItem('taskdag-store', JSON.stringify(store))
  }, {
    version: 2,
    currentId: 'g',
    goals: [{
      id: 'g',
      goal: {
        title: 'G',
        edgeDirection: 'child-to-parent',
        nodes: [
          node('root', 'G', 0, 0),
          node('a', 'A', 420, 0),
          node('b', 'B', 80, 120)
        ],
        edges: [{ from: 'b', to: 'a' }]
      }
    }]
  })
  await page.reload()

  const metrics = await page.evaluate(() => {
    const edge = document.querySelector('#edges .edge-hit')
    const a = document.querySelector('.node[data-id="a"]')
    const b = document.querySelector('.node[data-id="b"]')
    const nums = edge.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number)
    const saved = JSON.parse(localStorage.getItem('taskdag-store'))
      .goals[0].goal.nodes.map(n => [n.id, n.x, n.y])
    return {
      startX: nums[0],
      endX: nums[6],
      aX: parseFloat(a.style.left),
      bX: parseFloat(b.style.left),
      fromId: edge.dataset.from,
      toId: edge.dataset.to,
      saved
    }
  })
  expect(metrics.fromId).toBe('b')
  expect(metrics.toId).toBe('a')
  expect(metrics.bX).toBeGreaterThan(metrics.aX)
  expect(metrics.startX).toBeGreaterThan(metrics.endX)
  expect(metrics.saved).toEqual([
    ['root', null, null],
    ['a', null, null],
    ['b', null, null]
  ])
})

test('drag preview arrow points from source toward target', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').click()
  await page.keyboard.press('Tab')
  await page.locator('.title-input').fill('A')
  await page.keyboard.press('Enter')

  const connector = page.locator('.node[data-id="root"] .connector')
  const box = await connector.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 180, box.y + 60)

  const metrics = await page.evaluate(() => {
    const root = document.querySelector('.node[data-id="root"]')
    const path = document.querySelector('#templine')
    const nums = path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number)
    return {
      startX: nums[0],
      endX: nums[nums.length - 2],
      rootX: parseFloat(root.style.left),
      marker: path.getAttribute('marker-end')
    }
  })
  expect(metrics.marker).toBe('url(#arrow)')
  expect(metrics.startX).toBeGreaterThan(metrics.rootX)
  expect(metrics.endX).toBeGreaterThan(metrics.startX)

  await page.mouse.up()
})

test('dragging from A to B creates a source-to-target edge', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').dblclick()
  await page.locator('.title-input').fill('Root')
  await page.keyboard.press('Enter')

  await page.locator('.node[data-id="root"] .card').click()
  await page.keyboard.press('Tab')
  await page.locator('.title-input').fill('A')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.locator('.title-input').fill('B')
  await page.keyboard.press('Enter')

  page.once('dialog', dialog => dialog.accept())
  await page.locator('#edges .edge-hit').first().click({ button: 'right', force: true })
  await expect(page.locator('#edges .edge')).toHaveCount(1)

  const aConnector = page.locator('.node', { hasText: 'A' }).locator('.connector')
  const bCard = page.locator('.node', { hasText: 'B' }).locator('.card')
  const from = await aConnector.boundingBox()
  const to = await bCard.boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2)
  await page.mouse.up()

  await expect(page.locator('#edges .edge')).toHaveCount(2)
  const metrics = await page.evaluate(() => {
    const a = [...document.querySelectorAll('.node')].find(node =>
      node.querySelector('.title')?.textContent === 'A')
    const b = [...document.querySelectorAll('.node')].find(node =>
      node.querySelector('.title')?.textContent === 'B')
    const edge = [...document.querySelectorAll('#edges .edge-hit')].find(path =>
      path.dataset.from === a.dataset.id && path.dataset.to === b.dataset.id)
    const nums = edge.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number)
    return {
      startX: nums[0],
      endX: nums[nums.length - 2],
      aX: parseFloat(a.style.left),
      bX: parseFloat(b.style.left),
      fromId: edge.dataset.from,
      toId: edge.dataset.to,
      aId: a.dataset.id,
      bId: b.dataset.id,
      storedEdge: JSON.parse(localStorage.getItem('taskdag-store'))
        .goals[0].goal.edges.find(e => e.from === a.dataset.id && e.to === b.dataset.id)
        ?? null
    }
  })
  expect(metrics.fromId).toBe(metrics.aId)
  expect(metrics.toId).toBe(metrics.bId)
  expect(metrics.storedEdge).toMatchObject({ from: metrics.aId, to: metrics.bId })
  expect(metrics.storedEdge.visualDirection).toBeUndefined()
  expect(metrics.startX).toBeGreaterThan(metrics.endX)
})

test('ancestor collapse hides an already-collapsed child node', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').click()
  for (const name of ['A', 'B', 'C']) {
    await page.keyboard.press('Tab')
    await page.locator('.title-input').fill(name)
    await page.keyboard.press('Enter')
  }

  await selectNodeByTitle(page, 'B')
  await page.locator('.node.selected .collapse-btn').click()
  await expect(page.locator('.node .title')).toHaveText(['双击编辑目标名称', 'A', 'B'])
  await expect(page.locator('.node.selected .collapse-btn')).toHaveText('1▸')

  await selectNodeByTitle(page, 'A')
  await page.locator('.node.selected .collapse-btn').click()
  await expect(page.locator('.node .title')).toHaveText(['双击编辑目标名称', 'A'])
  await expect(page.locator('.node.selected .collapse-btn')).toHaveText('2▸')
})

test('double-click renames a tall multi-line node without the edit closing itself', async ({ page }) => {
  // a long title wraps to several lines, making the card taller than the
  // single-line edit input. Entering edit mode shrinks the card, and a stray
  // height-measurement re-render used to tear the focused input back out,
  // committing instantly so the rename appeared to do nothing.
  await page.locator('.node[data-id="root"] .card').dblclick()
  await page.locator('.title-input').fill('创造有需求的东西，解决他们的问题，build：做成事情赚到钱')
  await page.keyboard.press('Enter')

  // give the goal several predecessors so it matches the reported layout
  await page.locator('.node[data-id="root"] .card').click()
  for (const name of ['A', 'B', 'C']) {
    await page.keyboard.press('Tab')
    await page.locator('.title-input').fill(name)
    await page.keyboard.press('Enter')
  }

  await page.locator('.node[data-id="root"] .card').dblclick()
  const editor = page.locator('.title-input')
  await expect(editor).toBeVisible()
  await page.waitForTimeout(200) // outlast the async height-measurement re-render
  await expect(editor).toBeVisible()

  // the editor is a multi-line textarea grown to show the whole wrapped title,
  // not a cramped single-line box
  await expect(editor).toHaveJSProperty('tagName', 'TEXTAREA')
  const lineHeight = 13.5 * 1.35
  expect(await editor.evaluate(el => el.scrollHeight)).toBeGreaterThan(lineHeight * 2)

  await editor.fill('改名成功')
  await page.keyboard.press('Enter')
  await expect(page.locator('.node[data-id="root"] .title')).toHaveText('改名成功')
})
