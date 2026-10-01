import { useEffect, useRef, useState } from 'react'
import type { HistoryEntry } from '../../../shared/types'
import { vox } from '../api'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Ожидает интернета',
  processing: 'Распознаю…',
  failed: 'Ошибка'
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

function IconCopy(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="2" {...stroke} />
      <path d="M10.5 3.5h-5a2 2 0 0 0-2 2v5" {...stroke} />
    </svg>
  )
}
function IconCheck(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" {...stroke} strokeWidth={1.8} />
    </svg>
  )
}
function IconRetry(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.8v2.7h-2.7" {...stroke} />
    </svg>
  )
}
function IconTrash(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.2V3.4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v.8M5 4.7l.45 7.4a1.5 1.5 0 0 0 1.5 1.4h2.1a1.5 1.5 0 0 0 1.5-1.4l.45-7.4" {...stroke} strokeWidth={1.3} />
    </svg>
  )
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return today ? time : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' + time
}

function fmtDur(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Длина «ленты» пропорциональна длительности записи; 90 секунд заполняют дорожку целиком. */
function tapePct(ms: number): number {
  return Math.min(100, Math.max(5, (ms / 90_000) * 100))
}

export function HistoryPage(): JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  // актуальный текст поиска для слушателя history:changed
  // (замыкание эффекта создаётся один раз на всю жизнь компонента)
  const searchRef = useRef('')

  const reload = (): void => void vox.listHistory(searchRef.current).then(setEntries)
  useEffect(() => {
    reload()
    return vox.on('history:changed', () => reload())
  }, [])

  const copy = async (e: HistoryEntry): Promise<void> => {
    await vox.copyText(e.styledText ?? e.rawText ?? '')
    setCopied(e.id)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div>
      <div className="page-head">
        <h1>История</h1>
        <input
          className="search"
          aria-label="Поиск по тексту диктовок"
          placeholder="Поиск по тексту…"
          value={search}
          onChange={(ev) => {
            setSearch(ev.target.value)
            searchRef.current = ev.target.value
            reload()
          }}
        />
      </div>
      {entries.length === 0 && (
        <div className="empty">
          Записей пока нет. Удерживайте горячую клавишу в любом приложении и продиктуйте текст.
        </div>
      )}
      <div className="list">
        {entries.map((e) => (
          <div key={e.id} className="row">
            <div className="row-time">{fmtTime(e.createdAt)}</div>
            <div className="row-body">
              {e.status !== 'done' && (
                <span className={`chip ${e.status}`}>{STATUS_LABEL[e.status]}</span>
              )}
              <div className="row-text">{e.styledText ?? e.rawText ?? '—'}</div>
              <div className="row-meta">
                <span className="row-mono">
                  {fmtDur(e.durationMs)} · {e.wordCount} сл.
                </span>
                <span className="tape-track">
                  <span
                    className={`tape tape-${e.status}`}
                    style={{ width: `${tapePct(e.durationMs)}%` }}
                  />
                </span>
              </div>
              {e.error && e.status === 'failed' && <div className="row-error">{e.error}</div>}
            </div>
            <div className="row-actions">
              {(e.styledText || e.rawText) && (
                <button
                  title="Копировать"
                  aria-label="Копировать текст диктовки"
                  className={copied === e.id ? 'ok-icon' : ''}
                  onClick={() => void copy(e)}
                >
                  {copied === e.id ? <IconCheck /> : <IconCopy />}
                </button>
              )}
              {(e.status === 'pending' || e.status === 'failed') && e.audioFile && (
                <button
                  title="Распознать заново"
                  aria-label="Распознать заново"
                  onClick={() => void vox.retryHistory(e.id)}
                >
                  <IconRetry />
                </button>
              )}
              <button
                title="Удалить"
                aria-label="Удалить диктовку"
                onClick={() => void vox.deleteHistory(e.id).then(() => reload())}
              >
                <IconTrash />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
