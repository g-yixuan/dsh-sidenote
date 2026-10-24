import { IconNewChatOutline16 } from '../host/icons.ts'
import { useLocaleTick } from '../locale-tick.ts'
import css from './sidechat.module.css'

export function StateScreen(props: { title: string; detail?: string; hint?: string }) {
  useLocaleTick()
  return <div className={css.stateScreen} role="status">
    <div className={css.emptyIcon}><IconNewChatOutline16 size={32} /></div>
    <div className={css.emptyTitle}>{props.title}</div>
    {props.detail && <div className={css.stateDetail} role="alert">{props.detail}</div>}
    {props.hint && <div className={css.emptyText}>{props.hint}</div>}
  </div>
}
