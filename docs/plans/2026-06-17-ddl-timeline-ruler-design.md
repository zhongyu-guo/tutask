# DDL 时间轴标尺 — 设计文档

- 日期：2026-06-17
- 分支：`feat/ddl-timeline-ruler`
- 状态：设计已与用户确认，待实现

## 目标

为任务画布增加一种**时间轴布局**：把任务按截止日（DDL）排进纵向分隔的时间列，
让"每个任务离截止日还有多远"一眼可见。可在日 / 周 / 月尺度间切换，可在
连续 / 紧凑两种轴范围间切换。

## 核心概念

- 时间从左到右铺开，用纵向分隔线把画布切成一列一列，每列 = 一个时间桶（日/周/月）。
- 同一截止日（同桶）的任务在同一纵列里上下堆叠。
- "今天"列高亮 + 今天竖线；逾期任务落在今天左侧的列。
- 无 DDL 的任务（含 `root` 目标节点）放到最右侧独立的「无 DDL」泳道。

## 关键设计决策（与用户确认）

1. **画布内布局模式**：时间轴不是独立页面，而是叠加在现有 DAG 画布上的一种布局模式。
   打开时间轴 → 现有节点重新排布到时间列；关闭 → 恢复原 DAG 布局。
2. **非破坏性 / 解耦**：时间轴是独立的覆盖层模块，只读任务的
   `id / title / deadline / status`，纯计算位置，**不写 `x/y`、不改连线顺序、不动 goal 数据**。
   它不污染 DAG 的手动摆位与自动布局；DAG 里拖节点也不影响时间轴（每次从 deadline 重算）。
3. **保留依赖连线**：节点按 DDL 列对齐后，依赖连线照常画（会出现跨列曲线）。
4. **轴范围可切**：
   - `continuous`（连续）：从最早 DDL 到最晚 DDL（并入今天）逐桶铺开，含空列，距离成比例；日尺度需横向平移。
   - `compact`（紧凑）：只画有任务的桶 + 今天列。
5. **横拖 = 改期**：横向把任务拖到另一列，吸附后把 deadline 改成该列锚点日期。纵向拖动忽略（列内序由状态决定）。
6. **保留建边**：时间轴模式下拖连接点照常能建依赖边。
7. **倒计时**：节点卡 deadline 徽章后追加 `距今 X 天 / 今天截止 / 逾期 X 天`，DAG 与时间轴两个视图都显示。

## 架构

### 状态（`src/ui/state.js` → `appState`）

会话级，先不持久化（与现有 `layoutDirection` 一致）：

```js
layoutMode: 'dag' | 'timeline'   // 默认 'dag'
timelineScale: 'day' | 'week' | 'month'   // 默认 'day'
timelineRange: 'continuous' | 'compact'   // 默认 'continuous'
```

### 核心模块 `src/core/timeline-layout.js`（纯函数，可单测）

```
timelineLayout(goal, { scale, range, today }) -> {
  positions: Map<id, { x, y }>,
  axis: {
    columns: [{ key, label: { primary, secondary }, x, width, isToday, isEmpty }],
    todayKey,
    noDate: { x, width, ids },
    contentHeight
  }
}
```

- **分桶 key**：日 = 当天 `YYYY-M-D`；周 = ISO 周一日期；月 = `YYYY-M`。
- **列序**：
  - continuous：min(所有 deadline ∪ today) → max，按尺度逐桶步进，含空桶。
  - compact：仅保留有任务的桶，并确保今天列在内。
- **列宽**：日 ≈ 220、周 ≈ 240、月 ≈ 260（容纳节点宽 `NODE_W=210` + 内边距）。
- **列内堆叠**：按状态优先级（doing → todo → done）再按 title 排序；
  `y = HEADER_H + row * (NODE_H + GAP_Y)`。
- **无 deadline**：归入 `noDate` 泳道（含 `root`）。
- **today 锚点**：day = 今天；week = 本周周一；month = 当月 1 号。

辅助纯函数（单测覆盖）：`bucketKey(date, scale)`、`bucketAnchor(date, scale)`、
`countdownLabel(deadline, today)`、`columnForX(x, axis)`（拖拽吸附用）。

### 渲染层（`src/ui/render.js`）

- `render()` 在 `layoutMode === 'timeline'` 时改用 `timelineLayout()` 的 positions，
  否则走现有 `autoLayout` / `resolvePositions`。
- `#world` 内新增一层 `#ruler`（z 序在 `#edges`、`#nodes` 之下）：
  - 隔列淡色背景带；
  - 顶部日期表头（primary 主标 + secondary 副标，今天列用强调色）；
  - 今天竖线高亮；
  - 最右「无 DDL」泳道虚线分隔。
- 刻度数据全部来自 `axis` 元数据。表头先放在 world 坐标（随平移缩放）；
  "平移时表头吸顶"列为后续增强。
- 节点、连线复用现有 `#nodes` / `#edges`，仅坐标来自时间布局。
- `renderBadges(node)`：deadline 徽章后追加倒计时文案（两视图通用）。

### 交互（`src/ui/interactions.js`）

- **工具栏**：加「时间轴」开关按钮；开启后显示尺度（日/周/月）分段控件 + 范围（连续/紧凑）切换。
- 时间轴模式下：pan / zoom / 点选 / 双击编辑面板 / 拖连接点建边——照常。
- **横拖改期**：拖动节点结束时，用 `columnForX` 找最近列 → `bucketAnchor` 得新日期 →
  `setGoal(updateNode(goal, id, { deadline }))`（进 undo 历史）。纵向位移忽略。
- 在编辑面板改某任务 deadline → 自动重新分桶刷新。

## 边界情况

- 全部任务无 deadline：只显示「无 DDL」泳道 + 一条今天列。
- 只有一个 deadline：continuous 至少画出该桶与今天桶之间的范围。
- 逾期任务：落在今天左侧列，倒计时显示「逾期 X 天」，沿用现有 `overdue` 红色标记。
- `root`（目标节点）无 deadline → 「无 DDL」泳道；其入边会跨到最右侧（可接受）。

## 测试计划（vitest，沿用 `tests/*.test.js` 风格）

`tests/timeline-layout.test.js` 覆盖：

- `bucketKey` / `bucketAnchor`：日 / 周（跨周一） / 月。
- `countdownLabel`：未来 / 今天 / 逾期。
- 列序：continuous 含空列、compact 仅有任务桶 + 今天。
- 列坐标与列宽随尺度变化。
- 列内堆叠顺序（状态优先级）。
- 无 deadline 归入 noDate；today 列定位正确。
- `columnForX` 吸附到正确列。

## 不做 / 后续（YAGNI）

- 表头吸顶（随横向平移固定在顶部）——后续增强。
- 横拖改期时"保留原星期几/原几号"——v1 先吸附到列锚点，后续微调。
- 跨目标聚合时间轴——只看当前目标。
- 时间轴视图偏好持久化——先会话级。
