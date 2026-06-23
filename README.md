# tutask  see your tasks' breakdown and timeline at a glance

<p align="right"><b>English</b> · <a href="README.zh-CN.md">中文</a></p>

## Core features

**① Visual, for humans — grasp the whole picture in one graph**

Not a flat todo list, but your goal broken down into a dependency graph: what blocks what, where the critical path runs, and which items you can actually start right now — all obvious at a glance. Every node whose prerequisites are all done gets a **golden glow**, telling you exactly "this is what you can work on next." With automatic layered layout, status colors, and collapsible subtrees, even complex goals stay clean.

The same data can switch to a **timeline view** — laid out along a time axis by deadline, with day / week / month scales and continuous / compact spacing. Overdue tasks turn red, perfect for tracking schedules.

**② Structured, for AI — a well-defined data contract**

Each Goal is a **schema-validated JSON** (`nodes` + `edges`, with fixed, documented fields), persisted as a plain `goals/<id>.json` file. This means:

- **AI tools (agents / automation scripts such as [OpenClaw](https://github.com/)) can read and write these JSON files directly** to add tasks, wire up dependencies, and change status — no clicking through the UI. Humans read the graph, AI edits the data, both sync through the same file.
- **Trivially customizable**: the format is simple and transparent. Whether you hand-write it, generate it with a script, or plug it into your own LLM pipeline, you're just producing JSON that conforms to the schema.



<p align="center">
  <img src="docs/screenshot-graph.png" alt="Dependency graph view: a goal broken into a DAG, child nodes pointing to parents, colors showing status" width="100%">
</p>

<p align="center"><em>Dependency graph view — the full breakdown and dependencies of a goal at a glance</em></p>

<p align="center">
  <img src="docs/screenshot-timeline.png" alt="Timeline view: the same data arranged along a time axis by deadline" width="100%">
</p>

<p align="center"><em>Timeline view — the same data spread along a time axis by deadline, overdue tasks in red</em></p>




Other perks: **truly local-first** (single file, pure front-end, your data stays with you) and **keyboard-driven** (`Tab` for a successor, `Enter` for a parallel task — graphing faster than outlining).

## Get started in 30 seconds

```bash
npm install
npm run build      # produces dist/index.html — just double-click it
```

To hack on the source / dev mode:

```bash
npm run watch      # watch and rebuild
npx serve src      # run ESM source directly, no build
npm test           # unit tests (Vitest)
npm run test:e2e   # end-to-end tests (Playwright)
```

## Core concepts

The whole thing is a **DAG (directed acyclic graph)**:

- **Nodes** are displayed by their depth as Goal (root) → Project (directly under the Goal) → Task (deeper levels).
- **Edges represent dependencies**, with a fixed direction: `child / prerequisite step → parent / the node it realizes`. On the canvas the arrow points from child to parent, and children sit to the right of their parent.
- Any edge that would create a cycle is **rejected and flashes red**, so the graph always stays topologically executable.

### Visual semantics

| Appearance | Meaning |
|---|---|
| Gray / Blue / Green | Todo / In progress / Done |
| **Golden glow** | All prerequisites done — **ready to start** |
| Red date badge | Past deadline and not done |

## Controls

### Keyboard

| Key | Action |
|---|---|
| `Tab` | Create a successor task after the selected node (auto-links the dependency) |
| `Enter` | Create a parallel task (inherits all prerequisites of the selected node) |
| Double-click / `F2` | Edit node title |
| `Space` | Cycle status: Todo → In progress → Done |
| `D` | Toggle the detail panel (description, status, hours, deadline, prerequisite list) |
| `Delete` | Delete the node (successors are kept, only dependencies are detached) |
| Arrow keys | Move the selection along dependency edges / within the same level |
| `Esc` | Cancel selection / cancel editing |

### Mouse

- Drag a node within the tree to reorder it among siblings; a free node created by double-clicking empty space keeps its manual position, and returns to auto-layout once wired into the graph.
- Drag from the dot on a node's right edge to create a dependency (circular dependencies are rejected and flash red).
- Right-click an edge to delete the dependency; drag on empty space to pan, scroll to zoom.
- The `▾` at a node's top-right collapses its prerequisite subtree (`N▸` shows the collapsed count — click again to expand).

## Multiple Goals & data storage

- The dropdown on the left of the toolbar switches between Goals (canvases); `＋` creates, `🗑` deletes, and the title input renames. "Import JSON" adds the data as a **new Goal** without overwriting existing data.
- Data is stored in the browser's **localStorage** by default, scoped to "browser + page origin" — opening via `localhost` and via `file://` are two independent copies.
- **Bind a data directory** (Chrome / Edge): read/write Goals to a local `goals/` directory, one `<id>.json` file per Goal. Bind both the `localhost` page and the double-clicked page to the **same directory** to share data; switching back to the tab auto-reloads new changes from the directory. The bound state is shown in the toolbar (click to unbind); after a browser restart, click "Reconnect" once to restore it.



## Documentation

- [Features](docs/features.md) — full feature and interaction details
- [Architecture](docs/architecture.md) — module breakdown and design trade-offs
