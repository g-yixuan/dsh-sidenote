import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentType, ComponentPropsWithRef } from 'react'

/** The supported 0.2.2 hosts expose MenuSurface; the older development types do not. */
export const MenuSurface = (primitives as unknown as {
  MenuSurface?: ComponentType<ComponentPropsWithRef<'div'>>
}).MenuSurface ?? 'div'
