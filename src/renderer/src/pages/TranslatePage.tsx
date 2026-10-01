import { useEffect, useRef, useState } from 'react'
import type { SettingsPublic, TranslationEntry } from '../../../shared/types'
import { cyrShare, TRANSLATE_LANGS } from '../../../shared/lang'
import { vox } from '../api'
import { truncate } from './translateHelpers'

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
function IconTrash(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 4.5h10M6.5 4.2V3.4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v.8M5 4.7l.45 7.4a1.5 1.5 0 0 0 1.5 1.4h2.1a1.5 1.5 0 0 0 1.5-1.4l.45-7.4"
        {...stroke}
        strokeWidth={1.3}
      />
    </svg>
  )
}
function IconSpeaker(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 6.2h2.3L7.7 3v10L4.3 9.8H2z" {...stroke} strokeLinejoin="round" />
      <path d="M10.3 5.6a3.3 3.3 0 0 1 0 4.8" {...stroke} />
    </svg>
  )
}
function IconSwap(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 5.3h9.3M9.7 2.3l2.6 3-2.6 3" {...stroke} />
      <path d="M13 10.7H3.7M6.3 13.7l-2.6-3 2.6-3" {...stroke} />
    </svg>
  )
}
function IconUse(): JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.3v7.4M5.2 7.1 8 9.9l2.8-2.8" {...stroke} />
      <path d="M3 12.7h10" {...stroke} />
    </svg>
  )
}

const SOURCE_LANGS: Array<{ code: string; label: string }> = [
  { code: 'auto', label: 'Определить автоматически' },
  ...TRANSLATE_LANGS
]

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return today ? time : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' + time
}

function langBadge(code: string): string {
  return TRANSLATE_LANGS.find((l) => l.code === code)?.label ?? code
}

export function TranslatePage(props: { settings: SettingsPublic; onChanged: () => void }): JSX.Element {
  const [sourceLang, setSourceLang] = useState('auto')
  const [targetLang, setTargetLang] = useState(props.settings.translateTargetLang)
  const [sourceText, setSourceText] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [entries, setEntries] = useState<TranslationEntry[]>([])
  const [search, setSearch] = useState('')
  const [rowCopied, setRowCopied] = useState<string | null>(null)
  // актуальный текст поиска для слушателя translations:changed
  const searchRef = useRef('')

  const reload = (): void => void vox.listTranslations(searchRef.current).then(setEntries)
  useEffect(() => {
    reload()
    return vox.on('translations:changed', () => reload())
  }, [])

  // номер последнего запущенного перевода: ответы приходят не в том порядке,
  // в каком уходили, и опоздавший отказ затирал уже показанный свежий перевод —
  // выглядело как ошибка на ровном месте при работающем интернете
  const runIdRef = useRef(0)

  const runTranslate = async (text = sourceText, target = targetLang): Promise<void> => {
    if (!text.trim()) return
    const runId = ++runIdRef.current
    setLoading(true)
    setError(null)
    const res = await vox.translateRun(text, target)
    if (runId !== runIdRef.current) return // нас обогнал более свежий запрос
    setLoading(false)
    if (!res.ok) {
      setError(res.message ?? 'Не удалось перевести')
      setResult('')
      return
    }
    setResult(res.result ?? '')
  }

  // Язык оригинала определяется по тексту: без этого кнопка обмена языками
  // не работала (режим «определить автоматически» менять местами нечего).
  useEffect(() => {
    if (sourceLang !== 'auto') return
    const text = sourceText.trim()
    if (text.length < 12) return
    const share = cyrShare(text)
    const guess = share > 0.6 ? 'ru' : share < 0.2 && /[A-Za-z]/.test(text) ? 'en' : ''
    if (guess && guess !== targetLang) setSourceLang(guess)
  }, [sourceText])

  // Перевод идёт сам: запрос уходит через паузу после последнего нажатия клавиши,
  // поэтому кнопка «Перевести» не нужна. Пауза бережёт лимиты сервиса.
  const autoRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (autoRef.current) clearTimeout(autoRef.current)
    const text = sourceText.trim()
    if (!text) {
      runIdRef.current++ // поле очистили: ответ на прежний текст показывать уже некуда
      setResult('')
      setError(null)
      setLoading(false)
      return
    }
    autoRef.current = setTimeout(() => void runTranslate(sourceText, targetLang), 650)
    return () => {
      if (autoRef.current) clearTimeout(autoRef.current)
    }
  }, [sourceText, targetLang])

  // распознавание текста на изображении: вставка, перетаскивание или выбор файла
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrEngineMissing, setOcrEngineMissing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const recognize = async (file: File | null | undefined): Promise<void> => {
    if (!file || !file.type.startsWith('image/')) return
    setOcrBusy(true)
    setError(null)
    setOcrEngineMissing(false)
    const res = await vox.ocrImage(await file.arrayBuffer())
    setOcrBusy(false)
    if (!res.ok) {
      setError(res.message ?? 'Не удалось распознать изображение')
      // системе не хватает языкового пакета — отказ поправимый, покажем куда идти
      setOcrEngineMissing(Boolean(res.engineMissing))
      return
    }
    // распознанный текст попадает в поле — перевод запустится сам
    setSourceText(res.text)
  }

  const swap = (): void => {
    if (sourceLang === 'auto') return
    const nextSourceLang = targetLang
    const nextTargetLang = sourceLang
    setSourceLang(nextSourceLang)
    setTargetLang(nextTargetLang)
    setSourceText(result)
    setResult(sourceText)
    setError(null)
  }

  const useEntry = (e: TranslationEntry): void => {
    setSourceText(e.source)
    setResult(e.result)
    setTargetLang(e.targetLang)
    setError(null)
  }

  const copyResult = async (): Promise<void> => {
    if (!result) return
    await vox.copyText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const copyRow = async (e: TranslationEntry): Promise<void> => {
    await vox.copyText(e.result)
    setRowCopied(e.id)
    setTimeout(() => setRowCopied(null), 1500)
  }

  const clearHistory = (): void => {
    if (!window.confirm('Удалить всю историю переводов? Это действие нельзя отменить.')) return
    void vox.clearTranslations().then(() => reload())
  }

  return (
    <div>
      <div className="page-head">
        <h1>Переводчик</h1>
      </div>

      <div className="translate-grid">
        <button
          className="translate-swap"
          aria-label="Поменять языки местами"
          disabled={sourceLang === 'auto'}
          title={
            sourceLang === 'auto'
              ? 'Выберите конкретный язык слева, чтобы поменять местами'
              : 'Поменять языки местами'
          }
          onClick={swap}
        >
          <IconSwap />
        </button>
        <div className="translate-pane">
          <select
            className="translate-lang-select"
            aria-label="Язык исходного текста"
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
          >
            {SOURCE_LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <textarea
            className={`translate-io ${dragOver ? 'drag-over' : ''}`}
            placeholder="Введите текст, вставьте скриншот или перетащите изображение…"
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void runTranslate(sourceText, targetLang)
            }}
            onPaste={(e) => {
              const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'))
              if (file) {
                e.preventDefault()
                void recognize(file)
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              void recognize(e.dataTransfer.files[0])
            }}
          />
          <div className="translate-counter">
            <span>{sourceText.length} симв.</span>
            <button
              className="link-btn"
              disabled={ocrBusy}
              onClick={() => fileRef.current?.click()}
            >
              {ocrBusy ? 'Распознавание…' : 'Текст с изображения'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void recognize(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        </div>

        <div className="translate-pane">
          <select
            className="translate-lang-select"
            aria-label="Язык перевода"
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
          >
            {TRANSLATE_LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <div className="translate-io translate-result">
            {error && (
              <span className="err">
                {error}
                {ocrEngineMissing && (
                  <>
                    {' '}
                    <button className="link-btn link-inline" onClick={() => void vox.openOcrSettings()}>
                      Открыть параметры Windows
                    </button>
                  </>
                )}
              </span>
            )}
            {!error && result && result}
            {!error && !result && <span className="translate-placeholder">Здесь появится перевод</span>}
          </div>
          <div className="translate-result-actions">
            <button className="btn secondary" disabled={!result} onClick={() => void copyResult()}>
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
            <button className="btn secondary" disabled={!result} onClick={() => void vox.speakText(result)}>
              <IconSpeaker /> Слушать
            </button>

          </div>
        </div>
      </div>

      <div className="translate-status">{loading ? 'Перевод…' : ''}</div>

      <div className="page-head translate-history-head">
        <h2 className="section-title">История переводов</h2>
        <input
          className="search"
          aria-label="Поиск по истории переводов"
          placeholder="Поиск по переводам…"
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
          История переводов пуста. Выделите текст в любом приложении и дважды нажмите Ctrl + V либо
          выполните перевод на этой вкладке.
        </div>
      )}

      {entries.length > 0 && (
        <div className="list">
          {entries.map((e) => (
            <div key={e.id} className="row tr-history-row">
              <div className="row-time">{fmtTime(e.createdAt)}</div>
              <div className="row-body">
                <div className="tr-row-texts">
                  <span className="tr-row-source">{truncate(e.source, 120)}</span>
                  <span className="tr-row-arrow">→</span>
                  <span className="tr-row-result">{truncate(e.result, 120)}</span>
                </div>
                <span className="tr-lang-chip">{langBadge(e.targetLang)}</span>
              </div>
              <div className="row-actions">
                <button
                  title="Копировать перевод"
                  aria-label="Копировать перевод"
                  className={rowCopied === e.id ? 'ok-icon' : ''}
                  onClick={() => void copyRow(e)}
                >
                  {rowCopied === e.id ? <IconCheck /> : <IconCopy />}
                </button>
                <button title="Слушать" aria-label="Озвучить перевод" onClick={() => void vox.speakText(e.result)}>
                  <IconSpeaker />
                </button>
                <button
                  title="Подставить в поля"
                  aria-label="Подставить перевод в поля редактора"
                  onClick={() => useEntry(e)}
                >
                  <IconUse />
                </button>
                <button
                  title="Удалить"
                  aria-label="Удалить запись из истории"
                  onClick={() => void vox.deleteTranslation(e.id).then(() => reload())}
                >
                  <IconTrash />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {entries.length > 0 && (
        <div className="translate-clear-wrap">
          <button className="link-btn danger" onClick={clearHistory}>
            Очистить историю
          </button>
        </div>
      )}
    </div>
  )
}
