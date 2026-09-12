# 上游 issue 草稿（omdsh-dev/DSH-better-sidebar）

> 状态：待用户确认后再发。参考实现已推送：<https://github.com/g-yixuan/DSH-better-sidebar/tree/fix/native-surface-activate>（commit d298602）。

---

**Title:** native surface: `activate()` never focuses plugin tabs; `onClose` loses `meta`

## Problem

Since 0.19 routes plugin tabs to DSH's native right sidebar, two lifecycle faces break for external plugin tabs:

### 1. `SidebarSurface.activate()` is a no-op

`src/client/native/surface.ts`:

```ts
activate(tabId) {
  // The native surface has no cross-pane activation face the plugin needs:
  // a tab is focused by opening its (kind, address) again …
  return records.has(tabId)
}
```

The documented alternative — re-opening the tab's `(kind, address)` — cannot work for plugin page tabs: `service.openTab` mints a fresh id per open for descriptors with `createTab` (`revealIfOpened = descriptor.createTab === undefined`), so there is no stable identity to re-open against.

Concrete breakage (dsh-sidenote): "ask in side chat" with an existing side-chat tab seeds the draft into the tab and calls `activateTab` — which lands here and does nothing. The draft sits in a background tab while the caller reports success. The same applies to any external plugin managing multi-instance native tabs.

`ISidebarRight.focus(tabId)` exists on dsh ≥ 0.1.5 and focuses the tab and its pane ("Focus a tab and the pane holding it, raising a floating one"). The surface's `controller()` already exposes everything else it needs.

### 2. `onClose` never receives `meta` on the native path

- User-initiated close (clicking × on a native tab) never reaches `descriptor.onClose` at all: `tab-adapter.tsx` only drops the record on unmount.
- Programmatic `service.closeTab` does call `onClose`, but reconstructs the tab as `{ id, type, title }` — dropping `meta`, which the record holds (`records.ensure` stored it from navigation params).

Plugins that persist lifecycle state in `tab.meta` (sidenote's recently-closed record needs `meta.childId`) are silently starved on native hosts.

The user-× path admittedly needs a semantics decision (unmount vs close when sessions switch) — this issue doesn't propose one; the programmatic path is a pure fix.

## Proposal

- `activate()`: focus through the controller — `if (!records.has(tabId)) return false; controller()?.focus?.(tabId); return true`
- `close()`: return the record's `meta` so `service.closeTab` can pass it to `onClose`.

Reference implementation (tested against dsh 0.1.5-rc.2 + better-sidebar 0.19.1): https://github.com/g-yixuan/DSH-better-sidebar/commit/d298602 — happy to open a PR if you agree with the direction.
