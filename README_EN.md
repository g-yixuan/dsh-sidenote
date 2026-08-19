# dsh-sidechat

A [DSH (DeepSeek Harness)](https://github.com/DeepSeek-ai) web plugin: Codex-style **side chat** and **selection annotations**. A thin consumer of [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar), registering its sidebar tabs through the `ctx.betterSidebar` service.

English · [中文](README.md)

## Features

### 💬 Side chat

**Fork** the current main session (full history snapshot) into an independent side session that lives in a「侧边」tab of the right sidebar — keep the main thread moving while you chase side questions:

- Open from the sidebar `+` menu →「侧边聊天」, or the `/side` slash command;
- The fork carries the full main-session context at fork time; afterwards the two sessions evolve independently;
- Multiple side chats coexist («侧边», «侧边 2», …), each closable on its own;
- The model follows the main session's current selection (synced at fork);
- Persistent: restored with the layout across reloads/restarts; hidden from the session list (archived); only closing the tab removes it from the UI.

![Side chat panel](docs/assets/04-side-chat-panel.png)

### 🗒️ Selection annotations

Select text in an assistant message and turn "quote + your note" into context for the model:

- **Add to conversation**: the selection stays highlighted with a blue numbered badge, an annotation editor pops up (notes optional); the composer shows an「N 条注释」chip, and all live annotations ride along with your next message;
- **Ask in side chat**: after the note editor, the quote + note lands straight in a side chat's composer;
- Click a badge to reopen the editor (edit/delete); numbers follow creation order and are never re-packed on delete; page-level lifecycle (gone on reload).

| Selection popover | Annotation editor | Badge + chip |
|---|---|---|
| ![selection popover](docs/assets/01-selection-popover.png) | ![annotation editor](docs/assets/02-annotation-editor.png) | ![badge and chip](docs/assets/03-badge-and-chip.png) |

## Install

Prerequisite: [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) installed (hard peer dependency).

```bash
dsh plugin --profile web add dsh-sidechat
```

For local development: `dsh plugin --profile web add link:<path-to-this-repo>` (client changes hot-reload; host changes need a `dsh web` restart).

## Design notes

- **Real fork, no compression**: a side chat is a real DSH session (full-history fork) with the same powers as the main session (tool calls, deeper dives, re-forking) — not a "compress-to-summary one-shot Q&A".
- **List hygiene**: side sessions are archived out of the session list — the list stays clean.
- **Accumulating annotation workflow**: multiple selections stack up as multiple annotations — edit, delete, and send them together; not a one-shot single quote.

## Development

| Command | What it does |
|---|---|
| `pnpm typecheck` | tsc --noEmit |
| `pnpm test` | vitest pure-function unit tests |
| `pnpm build` | type declarations + tsdown (host ESM + client CJS bundle, purity gate) |
| `pnpm test:mount` | mount smoke: scratch profile + fabricated session jsonl + real `dsh web` + Playwright journey lanes (set `BS_VERSION` to test against a different better-sidebar version) |

## License

MIT
