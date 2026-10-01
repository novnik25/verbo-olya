import { useState } from 'react'
import type { SettingsPublic, Style } from '../../../shared/types'
import { BUILTIN_STYLES } from '../../../shared/styles-presets'
import { vox } from '../api'

const STYLE_HINTS: Record<string, string> = {
  raw: 'Дословная запись без обработки — мгновенная вставка.',
  verbatim: 'Слово в слово, но со знаками препинания, абзацами и заглавными. Рекомендуем.',
  clean: 'Пунктуация и орфография + чистка «эээ» и слов-паразитов (текст может меняться).',
  business: 'Сдержанные деловые формулировки — для писем и документов.',
  prompt: 'Превращает мысли вслух в структурированный запрос для нейросети.'
}

function IconCheck(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function StylesPage(props: {
  settings: SettingsPublic
  onChanged: () => void
}): JSX.Element {
  const { settings } = props
  const [editing, setEditing] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const save = (styles: Style[], defaultStyleId?: string): void => {
    void vox
      .updateSettings(defaultStyleId ? { styles, defaultStyleId } : { styles })
      .then(props.onChanged)
  }

  const setPrompt = (id: string, prompt: string): void => {
    save(settings.styles.map((s) => (s.id === id ? { ...s, prompt } : s)))
    setDrafts((d) => ({ ...d, [id]: undefined as unknown as string }))
    setEditing(null)
  }

  const addStyle = (): void => {
    const id = 'custom-' + Date.now()
    save([...settings.styles, { id, name: 'Мой стиль', prompt: '', builtin: false }])
    setEditing(id)
  }

  return (
    <div>
      <div className="page-head">
        <h1>Стили</h1>
        <button className="btn secondary" onClick={addStyle}>
          Добавить стиль
        </button>
      </div>
      <p className="page-sub">
        Как оформлять распознанный текст. Выбранный стиль применяется ко всем диктовкам.
      </p>
      <div className="style-grid" role="radiogroup" aria-label="Стиль по умолчанию">
        {settings.styles.map((s) => {
          const selected = settings.defaultStyleId === s.id
          const builtinPrompt = BUILTIN_STYLES.find((b) => b.id === s.id)?.prompt
          return (
            <div
              key={s.id}
              className={`style-tile ${selected ? 'selected' : ''}`}
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              onClick={() => !selected && save(settings.styles, s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  if (!selected) save(settings.styles, s.id)
                }
              }}
            >
              <div className="style-tile-head">
                {s.builtin ? (
                  <span className="name">{s.name}</span>
                ) : (
                  <input
                    className="name name-edit"
                    type="text"
                    defaultValue={s.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) =>
                      save(
                        settings.styles.map((x) =>
                          x.id === s.id ? { ...x, name: e.target.value || 'Стиль' } : x
                        )
                      )
                    }
                  />
                )}
                {selected && (
                  <span className="style-check" title="Выбран">
                    <IconCheck />
                  </span>
                )}
              </div>
              <div className="style-hint">
                {STYLE_HINTS[s.id] ?? 'Свой стиль с собственной инструкцией.'}
              </div>
              {s.id !== 'raw' && (
                <div className="style-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="link-btn" onClick={() => setEditing(editing === s.id ? null : s.id)}>
                    {editing === s.id ? 'Скрыть' : 'Изменить'}
                  </button>
                  {s.builtin && builtinPrompt !== s.prompt && (
                    <button className="link-btn" onClick={() => setPrompt(s.id, builtinPrompt!)}>
                      Сбросить
                    </button>
                  )}
                  {!s.builtin && (
                    <button
                      className="link-btn danger"
                      onClick={() =>
                        save(
                          settings.styles.filter((x) => x.id !== s.id),
                          settings.defaultStyleId === s.id ? 'raw' : undefined
                        )
                      }
                    >
                      Удалить
                    </button>
                  )}
                </div>
              )}
              {editing === s.id && (
                <div className="style-editor" onClick={(e) => e.stopPropagation()}>
                  <textarea
                    value={drafts[s.id] ?? s.prompt}
                    placeholder="Инструкция для обработки текста…"
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                  />
                  {drafts[s.id] !== undefined && drafts[s.id] !== s.prompt && (
                    <button className="btn" onClick={() => setPrompt(s.id, drafts[s.id])}>
                      Сохранить
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
