# 技术架构

tutask 是一个零运行时依赖的浏览器单页工具。源码按 ESM 模块组织，构建时由 esbuild 解析依赖图并 bundle 成单段脚本，再和 CSS 一起内联进 `dist/index.html`。

## 分层

### `src/core`

核心层只处理数据和算法，不依赖 DOM。

- `schema.js` 是数据结构的单一来源：版本号、枚举、默认字段、Goal/Store normalize。
- `model.js` 提供不可变 CRUD：创建 Goal/节点/边，更新和删除节点/边。
- `graph.js` 提供图算法：前序/后继、环检测、可开始状态、折叠可见性、有效节点类型推导。
- `layout.js` 提供自动布局、边方向归一、手动位置解析和同层排序。
- `serialize.js` 负责 JSON 导入导出和 schema-backed validation。
- `store.js` 负责多 Goal store、legacy 数据迁移和当前 Goal 切换。

核心层的约束是：输入旧数据时先 normalize，再 validate；对外返回当前版本结构。

### `src/ui`

UI 层负责浏览器细节，但图结构变更尽量通过 command 层表达。

- `commands.js` 是纯函数 command 层：节点创建、并行节点、浮动节点、删除、改名、状态切换。
- `state.js` 是应用状态协调点：当前 store/goal、选择态、撤销重做、保存和 render 调度。
- `render.js` 重绘 DOM/SVG：节点、边、折叠按钮、Goal 菜单、可开始高亮、缩放信息。
- `interactions.js` 绑定键盘、鼠标、拖拽、菜单和导入导出事件。
- `style-panel.js` 处理节点详情和边样式面板。
- `storage.js` 处理 localStorage、IndexedDB 目录句柄和 File System Access 目录同步。

## 数据流

1. 用户事件由 `interactions.js` 或 `style-panel.js` 捕获。
2. 能表达为图结构变化的动作调用 `commands.js` 或 core 函数生成新 Goal。
3. `state.setGoal()` 或 `state.setStore()` 更新状态、写入存储、触发重绘。
4. `render.js` 根据当前 Goal 计算可见节点、布局和 SVG 路径。

## 持久化

默认持久化到 `localStorage` 的 `taskdag-store`。Chrome/Edge 可通过 File System Access API 绑定目录，每个 Goal 对应一个 `<goalId>.json` 文件。目录同步是单用户本地同步模型：目录内容按 id 与本地 store 合并，切回标签页时扫描外部变化。

当前没有多人协作冲突协议。如果要演进到多端同步，应先引入 per-goal revision、写入前冲突检测和可解释的 merge 策略。

## 构建

`npm run build` 调用 `scripts/build.mjs`：

1. esbuild 从 `src/ui/main.js` 开始 bundle ESM 依赖。
2. 读取 `src/styles.css` 并内联到模板。
3. 替换 `src/index.html` 的 `BUILD:STYLE` 和 `BUILD:SCRIPT` 区块。
4. 写入 `dist/index.html`。

这个流程保留单 HTML 交付目标，同时避免正则拼接模块带来的顺序和命名风险。

## 测试

- `npm test`：Vitest 单元测试，覆盖 core 和纯函数 command 层。
- `npm run test:e2e`：Playwright 端到端测试，覆盖创建、编辑、拖拽、折叠、暂停、撤销、导入导出相关主流程。
- `npm run build`：验证 bundle 和单文件产物。

## 演进原则

- 新字段先加到 `schema.js`，再补 normalize/validate 测试。
- 新图操作优先加到 `commands.js` 或 core，UI 事件层只负责把用户输入翻译成 command 参数。
- 新存储后端不直接读写 UI 状态，应以 normalized store 为边界。
- 大图性能优化应优先建立邻接索引和命令级 history，再考虑局部 DOM diff。
