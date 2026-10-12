import { Component, type ReactNode } from 'react'

/** Crash guard: a render failure must never take the host page down. */
export class AnnotationBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override componentDidCatch(error: unknown): void {
    console.error('[dsh-sidenote] annotate overlay crashed:', error)
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
