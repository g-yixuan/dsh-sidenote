import { createElement, useCallback, useMemo, useSyncExternalStore, type ComponentType } from 'react'
import type { Context } from './contracts.ts'
import { visibleSessionList, type SessionVisibility } from './sessionVisibility.ts'

const SLOT = 'sidebar.workspaces'
interface WorkspaceProps {
  useSessions?: <T>(selector: (state: unknown) => T) => T
  [key: string]: unknown
}
interface WorkspaceEntry {
  component: unknown
  children?: Record<string, unknown>
}

/**
 * Runtime seam: the host exposes mutable slot entries, but no per-session hide API.
 * Preserve the native entry's store, injection, children and locale. Unknown shapes
 * retain the original list; disposal restores only components we still own.
 */
export function registerSessionListFilter(ctx: Context, visibility: SessionVisibility): void {
  const slots = ctx.slots as Context['slots'] & {
    entries?: (name: string) => readonly WorkspaceEntry[]
    subscribe?: (name: string, listener: () => void) => () => void
  }
  if (typeof slots.entries !== 'function' || typeof slots.subscribe !== 'function') return
  const entries = slots.entries.bind(slots)
  const subscribe = slots.subscribe.bind(slots)
  slots.inject(SLOT, () => {
    const originals = new Map<WorkspaceEntry, { original: ComponentType<WorkspaceProps>; wrapped: ComponentType<WorkspaceProps> }>()
    function patch(): void {
      for (const entry of entries(SLOT)) {
        if (originals.has(entry) || typeof entry.component !== 'function') continue
        // directoryFlow is shared by the historical and current native entries.
        if (!entry.children?.['sidebar.workspaces.directoryFlow']) continue
        const Original = entry.component as ComponentType<WorkspaceProps>
        function Projection({ props, useSessions }: { props: WorkspaceProps; useSessions: NonNullable<WorkspaceProps['useSessions']> }) {
          const all = useSessions(value => value)
          const snapshot = useSyncExternalStore(visibility.subscribe, visibility.getSnapshot)
          const visible = useMemo(() => visibleSessionList(all, snapshot), [all, snapshot])
          const projected = useCallback(<T,>(selector: (state: unknown) => T): T => selector(visible), [visible])
          return createElement(Original, { ...props, useSessions: projected })
        }
        function FilteredWorkspace(props: WorkspaceProps) {
          return typeof props.useSessions === 'function'
            ? <Projection props={props} useSessions={props.useSessions} />
            : createElement(Original, props)
        }
        try {
          entry.component = FilteredWorkspace
          originals.set(entry, { original: Original, wrapped: FilteredWorkspace })
        } catch { /* Frozen/changed registries keep their native list. */ }
      }
    }
    patch()
    const off = subscribe(SLOT, patch)
    // Invalidate a previously rendered outlet after installation and restoration.
    const wake = slots.register({ name: SLOT, priority: 10000, id: 'dsh-sidenote-list-filter-wake' }, () => null)
    return () => {
      off()
      for (const [entry, { original, wrapped }] of originals) {
        if (entry.component === wrapped) entry.component = original
      }
      wake()
    }
  })
}
