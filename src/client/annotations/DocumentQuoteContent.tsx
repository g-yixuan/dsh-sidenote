import { documentSourceLabel, type DocumentSource } from './document.ts'
import css from './annotations.module.css'

export function DocumentQuoteContent({ source, text }: { source: DocumentSource; text: string }) {
  return <div className={css.contextContent}>
    <div className={`${css.contextSource} ${css.documentSource}`} title={source.path}>{documentSourceLabel(source)}</div>
    <div className={css.documentPath}>{source.path}</div>
    <div className={css.contextText}>{text}</div>
  </div>
}
