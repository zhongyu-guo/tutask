# Task DAG Tool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建设计文档 `2026-06-11-task-dag-design.md` 中确认的单 HTML 任务依赖管理工具。

**Architecture:** core（纯函数：模型/图算法/布局/序列化，Vitest TDD）+ ui（DOM/SVG 薄层）
+ build 脚本将 ESM 模块去除 import/export 后按依赖序内联进单 HTML。交付物为
`dist/index.html`（零依赖，双击可用）。

**Tech Stack:** vanilla JS (ESM source), SVG, Vitest, Node build script, Playwright (E2E)。

---

## 约定

- 所有 core 函数**不可变**：返回新对象，绝不修改入参。
- Goal 根是真实节点 `{id:'root', type:'goal'}`，永远存在、不可删除、不可隐藏。
- Project 节点 = `type:'project'`，由 root 直连；Task = `type:'task'`。
- 每个任务遵循 TDD：先写失败测试 → 跑确认失败 → 最小实现 → 跑通过 → 提交。

## Task 1: 脚手架

**Files:** Create `package.json`, `.gitignore`, `vitest.config.js`, 目录 `src/core/`, `src/ui/`, `tests/`, `scripts/`

1. `npm init -y`；`npm i -D vitest`；package.json 加 `"scripts": {"test": "vitest run", "build": "node scripts/build.mjs"}`，`"type": "module"`
2. `.gitignore`: `node_modules/`, `dist/`
3. 提交 `chore: scaffold project with vitest`

## Task 2: core/model.js — 数据模型 CRUD（TDD）

**Files:** Create `src/core/model.js`, `tests/model.test.js`

测试用例（每个先红后绿，逐个提交或整组提交）：

- `createGoal('我的目标')` → `{title, nodes:[root], edges:[]}`，root 为 `{id:'root', type:'goal', title:'我的目标'}`
- `addNode(goal, {title:'A', type:'project'})` → 新 goal，节点含自动生成 id、默认 `status:'todo'`、`description:''`、`estimatedHours:null`、`deadline:null`、`x:null,y:null`、`collapsed:false`、`detailOpen:false`；原 goal 未被修改（immutability 断言）
- `updateNode(goal, id, {title:'B'})` → 仅该节点变化；更新不存在的 id 抛错
- `removeNode(goal, id)` → 节点与所有相关边移除；`removeNode(goal,'root')` 抛错
- `addEdge(goal, a, b)` → edges 增加 `{from:a,to:b}`；重复边/自环/不存在的端点 → 抛错
- `removeEdge(goal, a, b)` → 移除该边

实现要点：`genId()` 用 `'n' + Date.now().toString(36) + Math.random().toString(36).slice(2,7)`；全部展开运算符构造新对象。

提交：`feat: core data model with immutable CRUD`

## Task 3: core/graph.js — 图算法（TDD）

**Files:** Create `src/core/graph.js`, `tests/graph.test.js`

- `predecessorsOf(goal, id)` / `successorsOf(goal, id)` → 节点数组
- `wouldCreateCycle(goal, from, to)` → 从 `to` 出发 DFS 能到 `from` 则 true；`from===to` true
- `isReady(goal, id)` → `status==='todo'` 且所有前序 `done`（无前序也算 ready）；root/done/doing → false
- `hiddenByCollapse(goal)` → `Set<id>`：不动点算法——节点 h 被隐藏当且仅当 h 的**每个**后继要么是 `collapsed:true` 的节点、要么已被隐藏；root 永不隐藏。测试覆盖：链式上游全隐、共享前序（同时连向可见节点的前序不隐藏）、嵌套折叠
- `collapsedCount(goal, id)` → 仅因 id 折叠而隐藏的上游数量（给角标显示）：`hiddenByCollapse` 全集与"除 id 外其他折叠"集合的差

提交：`feat: graph algorithms (cycle detection, ready state, collapse visibility)`

## Task 4: core/layout.js — 分层布局（TDD）

**Files:** Create `src/core/layout.js`, `tests/layout.test.js`

- `computeLayers(goal, visibleIds)` → `Map<id, layer>`：root=0，其余 = max(可见前序 layer)+1；无可见前序的非 root 节点 = 1
- `autoLayout(goal, visibleIds, opts={gapX:260, gapY:90, detailHeights:{}})` → `Map<id, {x,y}>`：
  - 按层分组；层内排序按各自可见前序 y 均值（barycenter，迭代 2 轮）
  - x = layer * gapX；y 同层依次堆叠，节点若 `detailOpen` 占用额外高度 `detailHeights[id]`
  - 每层整体垂直居中对齐（总高/2 偏移）
- `resolvePositions(goal, autoPos)` → 节点有手动 `x,y` 则用手动值，否则用 autoPos

测试：菱形依赖（A→B, A→C, B→D, C→D）层级 0/1/1/2；手动覆盖优先；折叠节点不参与。

提交：`feat: layered auto-layout with manual override`

## Task 5: core/serialize.js — 校验与导入导出（TDD）

**Files:** Create `src/core/serialize.js`, `tests/serialize.test.js`

- `validateGoal(obj)` → `{valid:boolean, errors:string[]}`：检查 title 为字符串、nodes 数组且含 root、每节点 id/title/type/status 合法、edges 端点存在且无重复
- `exportJSON(goal)` → 带缩进字符串；`importJSON(str)` → 解析+校验，失败抛带信息的 Error

提交：`feat: JSON schema validation and import/export`

## Task 6: ui 骨架 + 渲染

**Files:** Create `src/ui/state.js`, `src/ui/render.js`, `src/ui/storage.js`, `src/ui/main.js`, `src/index.html`, `src/styles.css`

无单测（DOM 薄层），开发时浏览器手动验证，行为最终由 E2E 覆盖。

- `state.js`：`appState = {goal, selectedId, editingId, pan:{x,y}, zoom, dragEdgeFrom}`；`setGoal(g)` 入口统一：更新状态 → `render()` → `storage.save(g)`
- `storage.js`：`save/load`（localStorage key `taskdag-goal`，try/catch，不可用时置 `storageBroken` 标志）；`backupBeforeImport/undoImport`（备份槽 key `taskdag-backup`）
- `render.js`：整体重绘（数据量小，不做 diff）——
  - SVG 层画边：三次贝塞尔 `M x1 y1 C x1+dx y1, x2-dx y2, x2 y2` + marker 箭头；边带透明宽 hitbox path 供右键删除
  - HTML 层画节点：绝对定位卡片 div；状态色类 `todo/doing/done`、`ready` 发光类、过期红角标；左侧 `▸/▾`+`◂N` 折叠钮、右侧连接点 `●`、`⊕` 详情钮
  - 详情面板：节点下方嵌入 div——前序列表（状态色点+点击跳转）、描述 textarea、状态 select、工时 number、截止 date
  - 画布 transform: `translate(pan) scale(zoom)`；点阵网格背景 CSS
- `index.html`（开发版）：工具栏（Goal 标题 input、整理布局、导出、导入 file input、缩放显示/重置）+ 画布容器 + 按依赖序 `<script type="module" src="ui/main.js">`
- `main.js`：启动时 `storage.load()` 或 `createGoal('新目标')` + 示例提示

提交：`feat: canvas rendering, node cards, edge curves, detail panel`

## Task 7: 交互

**Files:** Create `src/ui/interactions.js`; Modify `src/ui/main.js`

- 键盘（document keydown，输入框聚焦时直接 return）：Tab=后继+连边、Enter=并行（继承前序；project 选中时 Enter 建兄弟 project 连 root）、F2/双击=行内编辑（输入框覆盖标题，Enter 确认 Esc 取消）、Delete=确认后删、Space=状态循环、D=详情开关、方向键=沿边/同层移动选中、Esc=取消选中
- Tab/Enter 创建后:新节点继承定位逻辑、立即进入编辑、若视野外则平移跟随
- 鼠标:节点 mousedown+move=拖拽（mouseup 时写回 x,y）、连接点拖出=临时虚线跟随、落到目标节点=`wouldCreateCycle` 检查后建边（成环则目标闪红 CSS 动画）、边 hitbox 右键=confirm 删边、空白拖=平移、wheel=以鼠标为中心缩放(0.25–2)、双击空白=该位置建游离 task
- 工具栏:整理布局=confirm 后清除全部手动 x,y、导出=Blob 下载 `taskdag-<title>.json`、导入=备份后 `importJSON`（失败 alert 不覆盖）+ 顶部"撤销导入"条、标题 input 改 root title

提交：`feat: keyboard and mouse interactions`

## Task 8: build 脚本 + 单文件产出

**Files:** Create `scripts/build.mjs`

- 读 `src/index.html` 模板，按固定顺序读 core 4 文件 + ui 5 文件，正则去掉 `^import .*$` 与 `export ` 前缀，拼接为一个 `<script>`；`styles.css` 内联 `<style>`；写 `dist/index.html`
- 验证：`npm run build` 后用 `node -e` 检查产物无 `import`/`export` 残留；浏览器打开 dist 手动冒烟

提交：`feat: build script producing self-contained dist/index.html`

## Task 9: Playwright E2E

**Files:** Create `tests/e2e/basic.spec.js`, `playwright.config.js`

- `npm i -D @playwright/test`；config 用 `file://` 或 `npx serve dist`
- 一条主流程用例：打开 → 双击根编辑标题 → 选根按 Tab 建 project → 输入标题回车 → 再 Tab 建 task → Space 切状态 → 刷新页面断言数据仍在 → 导出按钮触发下载
- 折叠用例：构造 A→B→C，选 C 折叠 → 断言 A、B 隐藏、角标 `◂2`

提交：`test: e2e happy path and collapse`

## Task 10: 收尾

- `npm test` 全绿 + 覆盖率（`vitest run --coverage`）core ≥80%
- 清理 console.log；跑一遍设计文档边界清单核对
- 更新根 `README.md`（一段话+使用方法+快捷键表）
- 提交 `docs: add README`，合并回 main
