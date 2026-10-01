import { Fragment, useEffect, useState } from 'react'
import { APP_NAME } from '../../shared/app'
import { MARK, markPaths } from '../../shared/mark'
import type { SettingsPublic } from '../../shared/types'
import { vox } from './api'

/**
 * Фирменный знак: «V» из двух штрихов — она же галочка речевой волны.
 * Геометрия берётся из общего канона; здесь знак одноцветный (currentColor),
 * поэтому правый штрих отделён прозрачностью, а не вторым цветом.
 */
export function WaveMark(props: { size?: number }): JSX.Element {
  const s = props.size ?? 18
  const path = markPaths()
  return (
    <svg
      className="wave-mark"
      width={s}
      height={s}
      viewBox={`0 0 ${MARK.box} ${MARK.box}`}
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth={MARK.strokeWidth} strokeLinecap="round" fill="none">
        <path d={path.accent} />
        <path d={path.ink} opacity="0.45" />
      </g>
      <circle cx={MARK.dot.x} cy={MARK.dot.y} r={MARK.dot.r} fill="currentColor" />
    </svg>
  )
}

import { HistoryPage } from './pages/HistoryPage'
import { TranslatePage } from './pages/TranslatePage'
import { StatsPage } from './pages/StatsPage'
import { StylesPage } from './pages/StylesPage'
import { SettingsPage } from './pages/SettingsPage'
import { OnboardingPage } from './pages/OnboardingPage'

const TABS = [
  { id: 'history', label: 'История' },
  { id: 'translate', label: 'Переводчик' },
  { id: 'stats', label: 'Статистика' },
  { id: 'styles', label: 'Стили' },
  { id: 'settings', label: 'Настройки' }
] as const
type TabId = (typeof TABS)[number]['id']

export function App(): JSX.Element {
  const [settings, setSettings] = useState<SettingsPublic | null>(null)
  const [tab, setTab] = useState<TabId>('history')
  const [version, setVersion] = useState('')
  useEffect(() => {
    void vox.appVersion().then(setVersion)
  }, [])

  const reload = (): void => void vox.getSettings().then(setSettings)
  // тема живёт на корне документа: все цвета берутся из CSS-переменных
  useEffect(() => {
    if (settings) document.documentElement.dataset.theme = settings.theme
  }, [settings?.theme])
  useEffect(() => {
    reload()
    // язык вывода могли сменить из трея или кружка на экране — обновляем настройки в UI
    const offHistory = vox.on('history:changed', reload)
    const offLang = vox.on('lang:changed', reload)
    // оверлей открывает окно сразу на нужной вкладке (сейчас — «Переводчик» при пустом выделении)
    const offOpenTab = vox.on('main:open-tab', (data) => setTab(data as TabId))
    return () => {
      offHistory()
      offLang()
      offOpenTab()
    }
  }, [])

  if (!settings) return <div className="loading">Загрузка…</div>
  if (!settings.hasApiKey || !settings.onboardingDone) {
    return (
      <div className="shell">
        <div className="titlebar" aria-hidden="true" />
        <div className="onboard-scroll">
          <OnboardingPage onDone={reload} />
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <div className="titlebar" aria-hidden="true" />
      <div className="app">
      <nav className="sidebar">
        <div className="logo">
          <WaveMark /> {APP_NAME}
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-item ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <div className="sidebar-hint">
          Удерживайте{' '}
          {settings.hotkey.label.split(' + ').map((k, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="kbd-plus">+</span>}
              <kbd>{k}</kbd>
            </Fragment>
          ))}{' '}
          в любом приложении и говорите
        </div>
        <button
          className="theme-toggle"
          title={settings.theme === 'dark' ? 'Светлое оформление' : 'Тёмное оформление'}
          aria-label="Сменить оформление"
          onClick={() =>
            void vox.updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }).then(reload)
          }
        >
          {settings.theme === 'dark' ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="4.5" />
              <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
            </svg>
          )}
          <span>{settings.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>
        </button>
        {version && <div className="version-tag">{APP_NAME} {version}</div>}
      </nav>
      <main className="content">
        {tab === 'history' && <HistoryPage />}
        {tab === 'translate' && <TranslatePage settings={settings} onChanged={reload} />}
        {tab === 'stats' && <StatsPage settings={settings} />}
        {tab === 'styles' && <StylesPage settings={settings} onChanged={reload} />}
        {tab === 'settings' && <SettingsPage settings={settings} onChanged={reload} />}
      </main>
      </div>
    </div>
  )
}
