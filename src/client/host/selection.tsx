import { createElement, useSyncExternalStore, type ComponentType } from 'react'
import type { Context } from './contracts.ts'
import type { SidenotePreferences } from '../preferences.ts'

interface NativeQuoteProps {
  useSession<T>(select: (state: { sessionId: string }) => T): T
}

/** Coordinate the native surface with Sidenote's existing selection toolbar. */
export function registerNativeQuoteVisibility(ctx: Context, preferences: SidenotePreferences, ownsSelection: (sessionId: string) => boolean): void {
  type Entry = { options: { key?: string }; component: ComponentType<NativeQuoteProps> }
  const slots = ctx.slots as Context['slots'] & {
    entries(name: string): readonly Entry[]
    subscribe(name: string, listener: () => void): () => void
  }
  ctx.slots.inject('conversation.chat.text-interaction', () => {
    const patched = new Map<Entry, { original: Entry['component']; wrapped: Entry['component'] }>()
    const patch = (): void => {
      for (const entry of slots.entries('conversation.chat.text-interaction')) {
        if (entry.options.key !== 'quote' || patched.has(entry)) continue
        const Original = entry.component
        const Wrapped = (props: NativeQuoteProps) => {
          const state = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot)
          const sessionId = props.useSession(session => session.sessionId)
          if (state.hidden || ownsSelection(sessionId)) return null
          return createElement(Original, props)
        }
        entry.component = Wrapped
        patched.set(entry, { original: Original, wrapped: Wrapped })
      }
    }
    patch()
    const unsubscribe = slots.subscribe('conversation.chat.text-interaction', patch)
    return () => {
      unsubscribe()
      for (const [entry, value] of patched) if (entry.component === value.wrapped) entry.component = value.original
    }
  })
}
