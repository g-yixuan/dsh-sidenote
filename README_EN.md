<p align="center">
  <img src="docs/assets/banner-en.png" alt="dsh-sidenote — side lanes for side questions, notes on any passage" width="100%">
</p>

<p align="center">
  A DSH (DeepSeek Harness) plugin — side questions never derail the main thread, and answers flow back home.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-sidenote"><img src="https://img.shields.io/npm/v/dsh-sidenote" alt="npm version"></a>
  <a href="https://github.com/g-yixuan/dsh-sidenote/actions/workflows/ci.yml"><img src="https://github.com/g-yixuan/dsh-sidenote/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/peer-none-informational" alt="no required peer dependencies">
</p>

<p align="center">
  <b>English</b> · <a href="README.md">中文</a>
</p>

![Demo: annotate a selection → dig in the side chat → reflow the answer home](docs/assets/demo.gif)

## Install

```bash
dsh plugin --profile web add dsh-sidenote
```

**One step, no prerequisites.** Then click "Side" in the session header, or just select any reply text.

For local development, mount with `dsh plugin --profile web add link:<repo path>` (client changes hot-reload; host changes need a `dsh web` restart).

## Side chat — side questions never derail the main thread

**Fork** the current session (full history snapshot, no compression) into an independent side session living in the right-hand panel:

- Three entries — the header "Side" button, the right-sidebar guide, and the `/side` slash command;
- **The same rendering material as the main chat**: tool cards, thinking previews, task cards, model/permission switching, `@` references, image attachments;
- Answer approvals and questions **right inside the panel** — no jumping back to the main view; a toast lets you know when a reply lands;
- Inherited history folds into a summary card; fold and scroll state survive reloads; `Alt+J` hops focus between main and side.

![The side chat panel: forked history + native-grade tool cards + a full-capability composer](docs/assets/04-side-chat-panel.png)

## Selection annotations — turn "this bit is off" into model context

- Select text in an assistant reply → popover → note editor, with numbered badges anchored at the right gutter;
- Adding to the main conversation or a side chat saves the same controlled annotation object, with shared chip previews, individual removal and clear-all. Quotes and notes stay complete, with **zero draft pollution**; quote-only messages are supported;
- Click outside a new note editor or press Enter to save; Escape cancels. Main-to-side waits for the chosen tab’s actual child session. Escape cancels that wait; a failed handoff keeps the note open for retry;
- Submissions use the host’s native input, retaining `@` references, image attachments and queue/steer arbitration. Only a durable message or authoritative queue occurrence in the target session marks that batch as sent and produces the annotated trace label;
- Saved annotations are isolated by target session. A storage warning explains memory-only operation when persistence is unavailable. Failures retain quotes and body; additions or edits during admission stay active for the next message.
- Side assistant bodies support local selections, paragraphs, lists and code. Their single action adds to that side chat, including selections in inherited history. Streaming replies, cross-message selections, reasoning and controls are excluded. Badges and highlights stay within the source transcript; folding the source keeps its quotes in the chip.
- Saved annotations survive reload. When the host restores a native tab, it rebinds the original child. If the sidebar is not restored, use **Reopen** in `/side` to recover that child and its annotations. A new fork has its own independent annotation list.

| Selection popover | Annotation editor |
|---|---|
| ![Selection popover](docs/assets/01-selection-popover.png) | ![Annotation editor](docs/assets/02-annotation-editor.png) |

## Reflow — side-lane findings come home

- One click sends a side-chat conclusion back to the main session as a **Q&A pair** (the answer *and* the question it answers) — a controlled chip above the main composer that rides along with your next message; `@`-mentioning a side chat works too;
- "Save as session" promotes a side chat into the session list; recently closed ones reopen from the `/side` popup.

![Reflow chip: a side-chat finding parked above the main composer](docs/assets/06-reflow-chip.png)

<details>
<summary><b>More screenshots</b></summary>

| Collapsed state (inherited-history card + action row) | Side slash menu |
|---|---|
| ![Collapsed state](docs/assets/04a-side-chat-collapsed.png) | ![Slash menu](docs/assets/04b-side-slash-menu.png) |

| Badge + annotation chip | Sent-message trace |
|---|---|
| ![Badge and chip](docs/assets/03-badge-and-chip.png) | ![Sent trace](docs/assets/05-sent-trace.png) |

</details>

## Compatibility

| DSH | dsh-better-sidebar | Behavior |
|---|---|---|
| ≥ 0.1.5-rc.1 | not required | **direct on the DSH native right sidebar** |
| ≤ 0.1.2-rc.x | ≤ 0.18.x (required) | legacy layout hosting |

The plugin degrades by capability when a host face is absent (never crashes the page); it coexists with dsh-better-sidebar natively (independent registrations, no dependency).

**Single-instance semantics (direct leg)**: the host allows one tab of a page-kind per pane — one side chat per session at a time (opening again focuses the live tab; after closing, `/side` reopens the recent one). Multi-instance returns with the host's `multiple` capability (0.1.6).

## Design notes

- **A real fork, not a summary**: the side session is a genuine DSH session (full history snapshot) with the same capabilities as the main one — not a one-shot Q&A.
- **List hygiene**: side sessions are archived out of the session list; your list stays clean.
- **An accumulative annotation workflow**: select repeatedly, stack notes, edit, remove, send them together — not a one-off quote.

## Development

| Command | What it does |
|---|---|
| `pnpm typecheck` | tsc --noEmit |
| `pnpm test` | vitest unit tests (run build first) |
| `pnpm build` | type declarations + tsdown (host ESM + client CJS bundle, purity gates) |
| `pnpm test:mount` | real `dsh web` + seeded session + Playwright mounting and interaction checks (`BS_VERSION`/`DSH_CMD` version matrix) |

## Contributing

Bug reports, feature ideas, reproductions, documentation, and code are welcome. Start with the [issue chooser](https://github.com/g-yixuan/dsh-sidenote/issues/new/choose) or [contributing guide](CONTRIBUTING_EN.md). English and Chinese are both welcome.

Maintainers: see [repository maintenance](docs/maintaining_EN.md) and the [release guide](docs/releasing_EN.md).

## License

MIT
