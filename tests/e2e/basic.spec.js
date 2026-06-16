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
  // edit goal title in the detail panel opened by double-click
  await page.locator('.node[data-id="root"] .card').dblclick()
  await page.locator('#stylePanel .sp-title').fill('一周年活动')
  await page.locator('#stylePanel .sp-title').press('Enter')
  await expect(page.locator('.node.goal .title')).toHaveText('一周年活动')
  await expect(page.locator('.title-input')).toHaveCount(0)

  // Tab on root creates a project
  await selectNodeByTitle(page, '一周年活动')
  await expect(page.locator('#stylePanel')).toBeHidden()
  await expect(page.locator('.node.selected .connector')).toHaveCSS('opacity', '1')
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

  // Space cycles node status: todo → doing
  await expect(page.locator('.node.selected .title')).toHaveText('做海报')
  await page.keyboard.press(' ')
  await expect(page.locator('.node.doing .title')).toHaveText('做海报')

  // D on the project opens the floating detail panel
  await selectNodeByTitle(page, '前期筹备')
  await page.keyboard.press('d')
  await expect(page.locator('#stylePanel')).toBeVisible()
  await expect(page.locator('#stylePanel .sp-title')).toHaveValue('前期筹备')
  await expect(page.locator('#stylePanel .f-status')).toHaveValue('todo')
  await expect(page.locator('#stylePanel .sp-close')).toHaveCount(0)

  // reload: everything persisted
  await page.reload()
  await expect(page.locator('.node')).toHaveCount(4)
  await expect(page.locator('.node.doing .title')).toHaveText('做海报')
  await expect(page.locator('#edges .edge')).toHaveCount(3)

  // export triggers a download
  const downloadPromise = page.waitForEvent('download')
  await page.locator('#goalMenuBtn').click()
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

test('command-click toggles multiple selected nodes', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').click()
  await page.keyboard.press('Tab')
  await page.locator('.title-input').fill('A')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.locator('.title-input').fill('B')
  await page.keyboard.press('Enter')

  await expect(page.locator('.node.selected .title')).toHaveText('B')

  await page.locator('.node .title', { hasText: 'A' }).click({ modifiers: ['Meta'] })
  await expect(page.locator('.node.selected .title')).toHaveText(['A', 'B'])

  await page.locator('.node .title', { hasText: 'B' }).click({ modifiers: ['Meta'] })
  await expect(page.locator('.node.selected .title')).toHaveText('A')

  await page.locator('.node[data-id="root"] .card').click()
  await expect(page.locator('.node.selected')).toHaveCount(1)
  await expect(page.locator('.node.selected')).toHaveAttribute('data-id', 'root')
})

test('dragging a node onto another node proposes and replaces its parent connection', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').click()
  await page.keyboard.press('Tab')
  await page.locator('.title-input').fill('A')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.locator('.title-input').fill('B')
  await page.keyboard.press('Enter')

  const before = await page.evaluate(() => {
    const byTitle = title => [...document.querySelectorAll('.node')]
      .find(node => node.querySelector('.title')?.textContent === title)
    return {
      aId: byTitle('A').dataset.id,
      bId: byTitle('B').dataset.id,
      rootId: document.querySelector('.node[data-id="root"]').dataset.id
    }
  })
  await expect(page.locator('#edges .edge')).toHaveCount(2)

  const target = await page.locator('.node .title', { hasText: 'A' }).locator('..').boundingBox()
  const source = await page.locator('.node .title', { hasText: 'B' }).locator('..').boundingBox()
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width + 150, target.y + target.height / 2, { steps: 12 })
  await expect(page.locator('#reparent-preview-line')).toHaveCount(1)
  await expect(page.locator('#reparent-preview-line')).toHaveAttribute('d', /M /)
  await expect(page.locator('.node.reparent-target .title')).toHaveText('A')
  await page.mouse.up()

  const after = await page.evaluate(({ aId, bId, rootId }) => {
    const store = JSON.parse(localStorage.getItem('taskdag-store'))
    const goal = store.goals.find(entry => entry.id === store.currentId).goal
    return {
      hasOldParent: goal.edges.some(edge => edge.from === bId && edge.to === rootId),
      hasNewParent: goal.edges.some(edge => edge.from === bId && edge.to === aId),
      edgeCount: goal.edges.length
    }
  }, before)
  expect(after).toEqual({ hasOldParent: false, hasNewParent: true, edgeCount: 2 })
  await expect(page.locator('#reparent-preview-line')).toHaveCount(0)
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

test('pausing a chain greys the node and folds its sub-step descendants', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').click()
  for (const name of ['A', 'B', 'C']) {
    await page.keyboard.press('Tab')
    await page.locator('.title-input').fill(name)
    await page.keyboard.press('Enter')
  }

  const edgeToRoot = async () => page.evaluate(() => {
    const node = [...document.querySelectorAll('.node')]
      .find(item => item.querySelector('.title')?.textContent === 'A')
    const hit = [...document.querySelectorAll('#edges .edge-hit')]
      .find(path => path.dataset.from === node.dataset.id && path.dataset.to === 'root')
    const edge = hit.previousElementSibling
    return {
      marker: edge.getAttribute('marker-end'),
      chainStatus: edge.dataset.chainStatus,
      stroke: getComputedStyle(edge).stroke
    }
  })

  await expect.poll(async () => (await edgeToRoot()).chainStatus).toBe('active')
  let edge = await edgeToRoot()
  expect(edge.marker).toBe('url(#arrow)')
  expect(edge.stroke).toBe('rgb(59, 130, 246)')
  await expect(page.locator('.node .title', { hasText: 'A' }).locator('..')).toHaveCSS('border-color', 'rgb(191, 219, 254)')
  const todoBeforeContent = await page.locator('.node .title', { hasText: 'A' }).locator('..')
    .evaluate(card => getComputedStyle(card, '::before').content)
  expect(todoBeforeContent).toBe('none')

  await selectNodeByTitle(page, 'A')
  await page.locator('.node.selected .card').dblclick()
  await page.locator('#stylePanel .f-chain-status').selectOption('paused')
  await expect(page.locator('.node')).toHaveCount(2)
  await expect(page.locator('.node.chain-paused .title')).toHaveText('A')
  await expect(page.locator('.node.chain-paused .card')).toHaveCSS('background-color', 'rgb(233, 237, 242)')
  await expect(page.locator('.node.chain-paused .card')).toHaveCSS('border-color', 'rgb(170, 178, 189)')
  await expect(page.locator('.node.chain-paused .collapse-btn')).toHaveText('2▸')
  edge = await edgeToRoot()
  expect(edge.chainStatus).toBe('paused')
  expect(edge.marker).toBe('url(#arrow-paused)')
  expect(edge.stroke).toBe('rgb(138, 145, 156)')

  await page.reload()
  await expect(page.locator('.node')).toHaveCount(2)
  await expect(page.locator('.node.chain-paused .title')).toHaveText('A')
  edge = await edgeToRoot()
  expect(edge.chainStatus).toBe('paused')
  expect(edge.marker).toBe('url(#arrow-paused)')

  await page.locator('.node.chain-paused .card').dblclick()
  await page.locator('#stylePanel .f-chain-status').selectOption('active')
  await expect(page.locator('.node')).toHaveCount(4)
  edge = await edgeToRoot()
  expect(edge.chainStatus).toBe('active')
  expect(edge.marker).toBe('url(#arrow)')
})

test('active chain edges render above paused chain edges', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').click()
  for (const name of ['Paused path', 'Active path']) {
    await page.keyboard.press('Tab')
    await page.locator('.title-input').fill(name)
    await page.keyboard.press('Enter')
    await page.locator('.node[data-id="root"] .card').click()
  }

  await selectNodeByTitle(page, 'Paused path')
  await page.locator('.node.selected .card').dblclick()
  await page.locator('#stylePanel .f-chain-status').selectOption('paused')

  const order = await page.evaluate(() => {
    const edgeIndex = edge => [...document.querySelectorAll('#edges .edge')].indexOf(edge)
    const edgeForTitle = title => {
      const node = [...document.querySelectorAll('.node')]
        .find(item => item.querySelector('.title')?.textContent === title)
      const hit = [...document.querySelectorAll('#edges .edge-hit')]
        .find(path => path.dataset.from === node.dataset.id && path.dataset.to === 'root')
      return hit.previousElementSibling
    }
    const paused = edgeForTitle('Paused path')
    const active = edgeForTitle('Active path')
    return {
      pausedIndex: edgeIndex(paused),
      activeIndex: edgeIndex(active),
      pausedStatus: paused.dataset.chainStatus,
      activeStatus: active.dataset.chainStatus
    }
  })

  expect(order.pausedStatus).toBe('paused')
  expect(order.activeStatus).toBe('active')
  expect(order.activeIndex).toBeGreaterThan(order.pausedIndex)
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

test('composing Enter from an IME does not create a parallel node', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').click()
  await page.keyboard.press('Tab')
  await page.locator('.title-input').fill('输入法测试')
  await page.keyboard.press('Enter')
  await selectNodeByTitle(page, '输入法测试')
  await expect(page.locator('.node')).toHaveCount(2)

  await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    Object.defineProperty(event, 'isComposing', { value: true })
    document.dispatchEvent(event)
  })

  await expect(page.locator('.node')).toHaveCount(2)
  await expect(page.locator('.title-input')).toHaveCount(0)
})

test('IME composition in the detail title writes the committed text only once', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').dblclick()
  await page.locator('#stylePanel .sp-title').focus()

  const valueDuringComposition = await page.evaluate(() => {
    const input = document.querySelector('#stylePanel .sp-title')
    input.value = '构建flowtasks'
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'flowtasks' }))
    const titleBeforeCommit = document.querySelector('.node[data-id="root"] .title').textContent
    input.value = '构建flowtasks'
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'flowtasks' }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    return {
      inputValue: input.value,
      titleBeforeCommit,
      titleAfterCommit: document.querySelector('.node[data-id="root"] .title').textContent,
      panelHidden: document.querySelector('#stylePanel').hidden
    }
  })

  expect(valueDuringComposition).toEqual({
    inputValue: '构建flowtasks',
    titleBeforeCommit: '双击编辑目标名称',
    titleAfterCommit: '构建flowtasks',
    panelHidden: false
  })
})

test('Enter inserts a parallel node directly below the selected sibling', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').click()
  await page.keyboard.press('Tab')
  await page.locator('.title-input').fill('A')
  await page.keyboard.press('Enter')
  for (const name of ['B', 'C']) {
    await page.keyboard.press('Enter')
    await page.locator('.title-input').fill(name)
    await page.keyboard.press('Enter')
  }

  await selectNodeByTitle(page, 'A')
  await page.keyboard.press('Enter')
  await page.locator('.title-input').fill('A 后面')
  await page.keyboard.press('Enter')

  const order = await page.evaluate(() => [...document.querySelectorAll('.node.project')]
    .map(node => ({
      title: node.querySelector('.title')?.textContent,
      top: node.getBoundingClientRect().top
    }))
    .sort((a, b) => a.top - b.top)
    .map(item => item.title))
  expect(order).toEqual(['A', 'A 后面', 'B', 'C'])
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

test('default view centers the visible graph vertically', async ({ page }) => {
  const node = (id, title) => ({
    id, title,
    x: null,
    y: null,
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
          node('root', 'G'),
          node('a', 'A'),
          node('b', 'B'),
          node('c', 'C')
        ],
        edges: [
          { from: 'a', to: 'root' },
          { from: 'b', to: 'root' },
          { from: 'c', to: 'root' }
        ]
      }
    }]
  })
  await page.reload()

  const metrics = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('.node .card')]
      .map(el => el.getBoundingClientRect())
    const top = Math.min(...rects.map(r => r.top))
    const bottom = Math.max(...rects.map(r => r.bottom))
    return {
      graphCenterY: (top + bottom) / 2,
      viewportCenterY: window.innerHeight / 2
    }
  })
  expect(Math.abs(metrics.graphCenterY - metrics.viewportCenterY)).toBeLessThan(2)
})

test('direction button mirrors the graph order from a stable goal anchor', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').click()
  await page.keyboard.press('Tab')
  await page.locator('.title-input').fill('Project')
  await page.keyboard.press('Enter')
  await selectNodeByTitle(page, 'Project')
  await page.keyboard.press('Tab')
  await page.locator('.title-input').fill('Task')
  await page.keyboard.press('Enter')

  const positions = async () => page.evaluate(() => {
    const nodeByTitle = title => [...document.querySelectorAll('.node')]
      .find(node => node.querySelector('.title')?.textContent === title)
    const root = document.querySelector('.node[data-id="root"]')
    return {
      root: root.getBoundingClientRect().left,
      project: nodeByTitle('Project').getBoundingClientRect().left,
      task: nodeByTitle('Task').getBoundingClientRect().left
    }
  })

  const ltr = await positions()
  expect(ltr.root).toBeLessThan(ltr.project)
  expect(ltr.project).toBeLessThan(ltr.task)
  expect(ltr.root).toBeCloseTo(80, 0)
  await expect(page.locator('#btnDirection')).toHaveAttribute('aria-pressed', 'false')

  await page.locator('#btnDirection').click()
  const rtl = await positions()
  expect(rtl.task).toBeLessThan(rtl.project)
  expect(rtl.project).toBeLessThan(rtl.root)
  const rtlAnchor = await page.evaluate(() => {
    const canvas = document.getElementById('canvas')
    const root = document.querySelector('.node[data-id="root"]')
    return canvas.clientWidth - 80 - root.getBoundingClientRect().width
  })
  expect(rtl.root).toBeCloseTo(rtlAnchor, 0)
  await expect(page.locator('#btnDirection')).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  const persisted = await positions()
  expect(persisted.task).toBeLessThan(persisted.project)
  expect(persisted.project).toBeLessThan(persisted.root)
  expect(persisted.root).toBeCloseTo(rtlAnchor, 0)
  await expect(page.locator('#btnDirection')).toHaveAttribute('aria-pressed', 'true')
})

test('info button toggles the keyboard and mouse help', async ({ page }) => {
  await expect(page.locator('#hint')).toBeHidden()
  await expect(page.locator('#btnInfo')).toHaveAttribute('aria-expanded', 'false')

  await page.locator('#btnInfo').click()
  await expect(page.locator('#hint')).toBeVisible()
  await expect(page.locator('#hint')).toContainText('单击节点选中')
  await expect(page.locator('#hint')).toContainText('Space 切节点状态')
  await expect(page.locator('#btnInfo')).toHaveAttribute('aria-expanded', 'true')

  await page.mouse.click(600, 300)
  await expect(page.locator('#hint')).toBeHidden()
  await expect(page.locator('#btnInfo')).toHaveAttribute('aria-expanded', 'false')
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
  expect(metrics.startX).toBeLessThan(metrics.rootX)
  expect(metrics.endX).toBeGreaterThan(metrics.startX)

  await page.mouse.up()
})

test('dragging from A to B creates a source-to-target edge', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').dblclick()
  await page.locator('#stylePanel .sp-title').fill('Root')
  await page.locator('#stylePanel .sp-title').press('Enter')

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
  const targetConnectorOpacity = await page.locator('.node', { hasText: 'B' }).locator('.connector')
    .evaluate(connector => getComputedStyle(connector).opacity)
  expect(targetConnectorOpacity).toBe('0')
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

test('double-click opens details and renames the node from the panel', async ({ page }) => {
  await page.locator('.node[data-id="root"] .card').dblclick()
  await page.locator('#stylePanel .sp-title').fill('创造有需求的东西，解决他们的问题，build：做成事情赚到钱')
  await page.locator('#stylePanel .sp-title').press('Enter')

  // give the goal several predecessors so it matches the reported layout
  await page.locator('.node[data-id="root"] .card').click()
  for (const name of ['A', 'B', 'C']) {
    await page.keyboard.press('Tab')
    await page.locator('.title-input').fill(name)
    await page.keyboard.press('Enter')
  }

  await page.locator('.node[data-id="root"] .card').dblclick()
  const editor = page.locator('#stylePanel .sp-title')
  await expect(editor).toBeVisible()
  await expect(page.locator('.title-input')).toHaveCount(0)

  await editor.fill('改名成功')
  await editor.press('Enter')
  await expect(page.locator('.node[data-id="root"] .title')).toHaveText('改名成功')
  await expect(page.locator('#goalName')).toHaveText('改名成功')
})
