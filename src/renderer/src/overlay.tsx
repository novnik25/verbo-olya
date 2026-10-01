import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { OverlayState, SettingsPublic } from '../../shared/types'
import type { OutputLang } from '../../shared/lang'
import { IconGlobe, IconMic, IconSpeaker, IconTranslate, IconSliders } from './overlay/icons'
import { OVERLAY_CSS } from './overlay/styles'
import { api, hot } from './overlay/api'
import { CopiedCard } from './overlay/CopiedCard'
import { TranslatePanel } from './overlay/TranslatePanel'
import { SpeakingPanel } from './overlay/SpeakingPanel'
import { CompactCapsule } from './overlay/CompactCapsule'
import { LangMenu, LANG_BADGE, langLabel } from './overlay/LangMenu'
import { VoiceMenu } from './overlay/VoiceMenu'
import { TranslateMenu } from './overlay/TranslateMenu'

type Panel = 'none' | 'lang' | 'voice' | 'translate'

function Overlay(): JSX.Element | null {
  const [state, setState] = useState<OverlayState>({ phase: 'hidden' })
  const [lang, setLang] = useState<OutputLang>('none')
  const [panel, setPanel] = useState<Panel>('none')
  // раскрытая плашка живёт в состоянии, а не на :hover — иначе она схлопывалась,
  // едва курсор уходил с овала к кружкам быстрых действий
  const [expanded, setExpanded] = useState(false)
  // перетаскивание кружков: id тянущегося, сдвиг курсора и признак «уже тянем»
  // drag !== null — кружок зажат (режим перестановки); moved — его уже потащили
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; moved: boolean } | null>(null)
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const [online, setOnline] = useState(true)
  const [settings, setSettings] = useState<SettingsPublic | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const loadSettings = (): void => {
    void (api.getSettings() as Promise<SettingsPublic>).then(setSettings)
  }

  useEffect(() => {
    const offState = api.on('overlay:state', (s) => {
      const st = s as OverlayState
      setState(st)
      if (st.phase === 'idle') setLang(st.lang)
      else setPanel('none')
    })
    const offLang = api.on('lang:changed', (l) => setLang(l as OutputLang))
    const offNet = api.on('net:changed', (v) => setOnline(v as boolean))
    // Esc приходит из главного хука: окно плашки не получает фокус и клавиш не видит
    const offDismiss = api.on('overlay:dismiss', () => setPanel('none'))
    loadSettings()
    return () => {
      ;(offState as () => void)()
      ;(offLang as () => void)()
      ;(offNet as () => void)()
      ;(offDismiss as () => void)()
    }
  }, [])

  // панели закрываются по Esc; окно оверлея не получает фокус (focusable: false),
  // поэтому Esc дублируется глобальным хуком в main (см. hotkeys.ts onEsc)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (state.phase === 'translate') {
        api.overlayMouse({ interactive: false })
        void api.translateClose()
      } else if (state.phase === 'speaking') {
        api.overlayMouse({ interactive: false })
        void api.speakControl('stop')
      } else {
        setPanel('none')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state])

  const flash = (text: string): void => {
    setToast(text)
    setTimeout(() => setToast(null), 1300)
  }

  const closePanel = (): void => {
    setPanel('none')
    api.overlayMouse({ interactive: false })
  }

  // курсор ушёл с панели — закрываем меню с небольшой задержкой (случайный «промах»
  // мимо кнопки не должен закрывать его мгновенно). Кликнуть «мимо» нельзя: окно
  // прозрачно для мыши, поэтому уход курсора — основной способ закрытия.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClose = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const armClose = (): void => {
    cancelClose()
    closeTimer.current = setTimeout(() => {
      setPanel('none')
      setExpanded(false)
    }, 420)
  }
  const hover = {
    onMouseEnter: () => {
      cancelClose()
      setExpanded(true)
      api.overlayMouse({ interactive: true })
    },
    onMouseLeave: () => {
      armClose()
      api.overlayMouse({ interactive: false })
    }
  }

  const pickLang = (l: OutputLang): void => {
    closePanel()
    void api.updateSettings({ outputLang: l })
    flash(langLabel(l))
  }

  const patch = (p: Partial<SettingsPublic>): void => {
    setSettings((s) => (s ? { ...s, ...p } : s))
    void api.updateSettings(p)
  }

  /** Куда упадёт кружок: сторона от капсулы и место среди соседей. */
  const dropTarget = (x: number): { side: 'left' | 'right'; index: number } | null => {
    const row = rowRef.current
    if (!row) return null
    const bar = row.querySelector('.bar')?.getBoundingClientRect()
    if (!bar) return null
    const side: 'left' | 'right' = x < bar.left + bar.width / 2 ? 'left' : 'right'
    const others = Array.from(
      row.querySelectorAll(`.${side === 'left' ? 'quick' : 'side'} .quick-btn:not(.dragging)`)
    )
    const index = others.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.left + r.width / 2 < x
    }).length
    return { side, index }
  }

  const startDrag = (id: string, e: React.MouseEvent): void => {
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, moved: false }
    // дрожание начинается сразу по нажатию: сразу видно, что кружки можно двигать
    setDrag({ id, dx: 0, dy: 0, moved: false })
    const move = (ev: MouseEvent): void => {
      const d = dragRef.current
      if (!d) return
      const dx = ev.clientX - d.startX
      const dy = ev.clientY - d.startY
      // небольшой порог: обычный клик не должен превращаться в перетаскивание
      if (!d.moved && Math.hypot(dx, dy) < 5) return
      d.moved = true
      setDrag({ id, dx, dy, moved: true })
    }
    const up = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d?.moved || !settings) return
      const target = dropTarget(ev.clientX)
      if (!target) return
      const left = settings.dockLeft.filter((a) => a !== id)
      const right = settings.dockRight.filter((a) => a !== id)
      if (target.side === 'left') left.splice(target.index, 0, id)
      else right.splice(target.index, 0, id)
      patch({ dockLeft: left, dockRight: right })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (state.phase === 'hidden') return null

  // ── плашка покоя: быстрые действия, язык вывода, микрофон ────────────────────
  if (state.phase === 'idle') {

    const ACTIONS: Record<string, { title: string; icon: JSX.Element; onClick: () => void }> = {
      translate: {
        title: 'Перевод выделенного текста',
        icon: <IconTranslate />,
        onClick: () => {
          loadSettings()
          setPanel((p) => (p === 'translate' ? 'none' : 'translate'))
        }
      },
      speak: {
        title: 'Озвучивание выделенного текста',
        icon: <IconSpeaker />,
        onClick: () => {
          loadSettings()
          setPanel((p) => (p === 'voice' ? 'none' : 'voice'))
        }
      },
      app: {
        title: 'Открыть приложение',
        icon: <IconSliders />,
        onClick: () => {
          closePanel()
          void api.openMain()
        }
      },
      lang: {
        title: online ? 'Язык результата' : 'Нет соединения с сервером распознавания',
        icon: (
          <>
            <IconGlobe />
            {lang !== 'none' && <span className="bar-badge">{LANG_BADGE[lang]}</span>}
            {!online && <span className="net-dot" aria-label="Нет соединения" />}
          </>
        ),
        onClick: () => setPanel((p) => (p === 'lang' ? 'none' : 'lang'))
      }
    }

    const activePanel: Record<string, Panel> = { translate: 'translate', speak: 'voice', lang: 'lang' }

    /** Кружок быстрого действия: и кнопка, и объект перетаскивания. */
    const renderAction = (id: string): JSX.Element | null => {
      const a = ACTIONS[id]
      if (!a) return null
      const dragging = drag?.id === id && drag.moved
      return (
        <button
          key={id}
          className={`quick-btn ${panel === activePanel[id] ? 'on' : ''} ${dragging ? 'dragging' : ''}`}
          title={a.title}
          aria-label={a.title}
          style={dragging ? { transform: `translate(${drag.dx}px, ${drag.dy}px)`, zIndex: 4 } : undefined}
          onMouseDown={(e) => startDrag(id, e)}
          onClick={() => {
            // после перетаскивания клик не должен открывать меню
            if (drag?.moved) return
            a.onClick()
          }}
        >
          {a.icon}
        </button>
      )
    }

    return (
      <div className="dock">
        {panel === 'lang' && (
          <LangMenu
            lang={lang}
            hover={hover}
            onPick={pickLang}
            onOpenSettings={() => {
              closePanel()
              void api.openMain('settings')
            }}
          />
        )}

        {panel === 'voice' && settings && (
          <VoiceMenu
            settings={settings}
            hover={hover}
            onPatch={patch}
            onSpeakSelection={() => {
              closePanel()
              void api.speakSelection()
            }}
          />
        )}

        {panel === 'translate' && settings && (
          <TranslateMenu
            settings={settings}
            hover={hover}
            onPatch={patch}
            onTranslateSelection={() => {
              closePanel()
              void api.translateSelection()
            }}
            onTranslateRegion={() => {
              closePanel()
              void api.ocrRegion()
            }}
            onOpenTranslator={() => {
              closePanel()
              void api.openMain('translate')
            }}
          />
        )}

        {toast && (
          <div className="pill">
            <span className="label">{toast}</span>
          </div>
        )}

        <div
          ref={rowRef}
          className={`dock-row ${expanded || panel !== 'none' ? 'open' : ''} ${drag ? 'editing' : ''}`}
          {...hover}
        >
          <div className="quick">
            {(settings?.dockLeft ?? ['translate', 'speak', 'app']).map((id) => renderAction(id))}
          </div>

          <button
            className="bar"
            title="Начать диктовку"
            aria-label="Начать диктовку"
            onClick={() => {
              closePanel()
              void api.dictateToggle()
            }}
          >
            <IconMic />
          </button>

          <div className="side">
            {(settings?.dockRight ?? ['lang']).map((id) => renderAction(id))}
          </div>
        </div>
      </div>
    )
  }

  if (state.phase === 'copied') {
    const текст = state.text
    return (
      <CopiedCard
        text={текст}
        toast={toast}
        onClose={() => {
          api.overlayMouse({ interactive: false })
          setState({ phase: 'idle', lang })
        }}
        onCopy={() => {
          void api.copyText(текст)
          flash('Скопировано')
        }}
      />
    )
  }

  if (state.phase === 'translate') {
    const результат = state.result
    return (
      <TranslatePanel
        target={state.target}
        result={результат}
        loading={state.loading}
        error={state.error}
        toast={toast}
        onClose={() => {
          api.overlayMouse({ interactive: false })
          void api.translateClose()
        }}
        onCopy={() => {
          void api.copyText(результат)
          flash('Скопировано')
        }}
      />
    )
  }

  if (state.phase === 'speaking') {
    return (
      <SpeakingPanel
        lang={state.lang}
        voiceId={state.voiceId}
        rate={state.rate}
        paused={state.paused}
        hover={hover}
        onStop={() => {
          api.overlayMouse({ interactive: false })
          void api.speakControl('stop')
        }}
      />
    )
  }

  return (
    <CompactCapsule
      state={state}
      onStopRecording={() => {
        api.overlayMouse({ interactive: false })
        void api.dictateToggle()
      }}
    />
  )
}

const style = document.createElement('style')
style.textContent = OVERLAY_CSS
document.head.appendChild(style)
createRoot(document.getElementById("root")!).render(<Overlay />)

