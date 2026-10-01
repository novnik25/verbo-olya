import { useEffect, useState } from 'react'
import type { SettingsPublic, Stats, StatsPayload, UsageSummary } from '../../../shared/types'
import { TRANSLATE_LANGS } from '../../../shared/lang'
import { voiceLabel } from '../../../shared/voices'
import { vox } from '../api'

/** Скорость набора вслепую для оценки сэкономленного времени, слов в минуту. */
const TYPING_WPM = 40

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} ${plural(minutes, 'минута', 'минуты', 'минут')}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ${plural(hours, 'час', 'часа', 'часов')}`
}

/** Общая карточка раздела: крупное число, подпись и распределение по ключам. */
function UsageCard({
  title,
  summary,
  unitOne,
  unitFew,
  unitMany,
  keyLabel,
  extra
}: {
  title: string
  summary: UsageSummary
  unitOne: string
  unitFew: string
  unitMany: string
  keyLabel: (key: string) => string
  extra: string
}): JSX.Element {
  const max = summary.top[0]?.count ?? 1
  return (
    <div className="card">
      <div className="card-head-row">
        <div className="streak-title">
          {summary.total.toLocaleString('ru-RU')} {plural(summary.total, unitOne, unitFew, unitMany)}
        </div>
        <div className="row-mono">{title.toUpperCase()}</div>
      </div>
      <div className="row-mono">
        {summary.last30.toLocaleString('ru-RU')} за 30 дней · {summary.activeDays}{' '}
        {plural(summary.activeDays, 'активный день', 'активных дня', 'активных дней')}
      </div>
      <div className="desc">{extra}</div>
      {summary.top.length > 0 ? (
        <div className="term-section">
          {summary.top.map((t) => (
            <div key={t.key} className="hbar-row">
              <span className="hbar-name">{keyLabel(t.key)}</span>
              <span className="hbar">
                <span className="hbar-fill" style={{ width: `${(t.count / max) * 100}%` }} />
              </span>
              <span className="row-mono">{t.count}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="desc term-section">Данных пока нет</div>
      )}
    </div>
  )
}

// та же палитра, что и лэйбл легенды: 4 ступени от --accent-soft к --accent
const HEAT_COLORS = [
  'var(--accent-soft)',
  'color-mix(in srgb, var(--accent) 35%, transparent)',
  'color-mix(in srgb, var(--accent) 65%, transparent)',
  'var(--accent)'
]

function parseYmd(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 25/50/75-й перцентили (метод ближайшего ранга) — для 4 ступеней теплокарты. */
function quartiles(values: number[]): [number, number, number] {
  if (values.length === 0) return [0, 0, 0]
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  return [at(0.25), at(0.5), at(0.75)]
}

function heatColor(words: number, [q25, q50, q75]: [number, number, number]): string {
  if (words === 0) return 'var(--line)'
  if (words <= q25) return HEAT_COLORS[0]
  if (words <= q50) return HEAT_COLORS[1]
  if (words <= q75) return HEAT_COLORS[2]
  return HEAT_COLORS[3]
}

/** Полудуговой гейдж: серый трек + бирюзовая дуга на долю min(1, wpm/160), плавно растёт при монтировании. */
function WpmGauge({ wpm }: { wpm: number }): JSX.Element {
  const r = 50
  const cx = 64
  const cy = 60
  const length = Math.PI * r
  const fraction = Math.min(1, wpm / 160)
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
  return (
    <div className="stat-gauge-wrap">
      <svg className="stat-gauge" viewBox="0 0 128 70" aria-hidden="true">
        <path d={d} fill="none" stroke="var(--line)" strokeWidth={10} strokeLinecap="round" />
        <path
          d={d}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={grown ? length * (1 - fraction) : length}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      <div className="stat-gauge-value">{Math.round(wpm)}</div>
    </div>
  )
}

function TrendBadge({ words30, wordsPrev30 }: { words30: number; wordsPrev30: number }): JSX.Element | null {
  if (wordsPrev30 > 0) {
    const pct = Math.round(((words30 - wordsPrev30) / wordsPrev30) * 100)
    return pct >= 0 ? (
      <span className="badge-up">↑ +{pct}% за месяц</span>
    ) : (
      <span className="badge-down">↓ −{Math.abs(pct)}% за месяц</span>
    )
  }
  if (words30 > 0) return <span className="badge-up">новый месяц</span>
  return null
}

/** 140 дней = 20 колонок-недель × 7 строк, старые → новые. */
function Heatmap({ byDay }: { byDay: Stats['byDay'] }): JSX.Element {
  const thresholds = quartiles(byDay.map((d) => d.words).filter((w) => w > 0))
  const activeDays = byDay.filter((d) => d.words > 0).length
  return (
    <div>
      <div
        className="heatmap"
        role="img"
        aria-label={`Календарь активности за 140 дней: ${activeDays} дней с диктовками`}
      >
        {byDay.map((d, i) => (
          <div
            key={d.date}
            className="heatmap-cell"
            style={{
              background: heatColor(d.words, thresholds),
              animationDelay: `${Math.floor(i / 7) * 14}ms`
            }}
            title={`${parseYmd(d.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · ${d.words} слов`}
          />
        ))}
      </div>
      <div className="heatmap-legend">
        меньше
        {HEAT_COLORS.map((c) => (
          <span key={c} className="heatmap-legend-swatch" style={{ background: c }} />
        ))}
        больше
      </div>
    </div>
  )
}

export function StatsPage({ settings }: { settings: SettingsPublic }): JSX.Element {
  const [stats, setStats] = useState<StatsPayload | null>(null)
  useEffect(() => {
    void vox.getStats().then(setStats)
    return vox.on('history:changed', () => void vox.getStats().then(setStats))
  }, [])
  if (!stats) return <div className="loading">Загрузка…</div>

  const styleName = (id: string): string => settings.styles.find((st) => st.id === id)?.name ?? id
  const topStyles = stats.styleBreakdown.slice(0, 4)
  const maxStyleCount = topStyles[0]?.count ?? 1

  const avgWords = stats.totalEntries > 0 ? Math.round(stats.totalWords / stats.totalEntries) : 0
  const activeDaysTotal = stats.byDay.filter((d) => d.words > 0).length
  const bestDay = stats.byDay.reduce((m, d) => (d.words > m.words ? d : m), { date: '', words: 0 })
  const perDay30 = Math.round(stats.words30 / 30)
  // сколько времени заняло бы то же количество слов при наборе на клавиатуре
  const savedMs = Math.max(0, (stats.totalWords / TYPING_WPM) * 60_000 - stats.totalDurationMs)

  return (
    <div>
      <div className="page-head">
        <h1>Статистика</h1>
      </div>

      <div className="cards">
        <div className="card">
          <WpmGauge wpm={stats.wpm} />
          <div className="cap">слов в минуту</div>
        </div>

        <div className="card">
          <div className="big">{stats.fixedWords.toLocaleString('ru-RU')}</div>
          <div className="cap">слов поправил выбранный стиль</div>
        </div>

        <div className="card">
          <div className="stat-num-row">
            <div className="big">{stats.totalWords.toLocaleString('ru-RU')}</div>
            <TrendBadge words30={stats.words30} wordsPrev30={stats.wordsPrev30} />
          </div>
          <div className="cap">всего слов</div>
          <div className="row-mono">
            {stats.totalEntries} диктовок · {Math.round(stats.totalDurationMs / 60_000)} мин записи
          </div>
        </div>
      </div>

      <div className="cards-mini">
        <div className="mini-card">
          <div className="mini-value">{avgWords}</div>
          <div className="cap">слов в диктовке в среднем</div>
        </div>
        <div className="mini-card">
          <div className="mini-value">{perDay30}</div>
          <div className="cap">слов в день за месяц</div>
        </div>
        <div className="mini-card">
          <div className="mini-value">{activeDaysTotal}</div>
          <div className="cap">активных дней из 140</div>
        </div>
        <div className="mini-card">
          <div className="mini-value">{formatDuration(savedMs)}</div>
          <div className="cap">сэкономлено против набора вручную</div>
        </div>
        <div className="mini-card">
          <div className="mini-value">{stats.usage.translate.total.toLocaleString('ru-RU')}</div>
          <div className="cap">обращений к переводчику</div>
        </div>
        <div className="mini-card">
          <div className="mini-value">{stats.usage.speak.total.toLocaleString('ru-RU')}</div>
          <div className="cap">запусков озвучивания</div>
        </div>
        <div className="mini-card">
          <div className="mini-value">{stats.usage.speak.minutes.toLocaleString('ru-RU')} мин</div>
          <div className="cap">прочитано вслух</div>
        </div>
        <div className="mini-card">
          <div className="mini-value">
            {bestDay.words > 0
              ? parseYmd(bestDay.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
              : '—'}
          </div>
          <div className="cap">
            {bestDay.words > 0 ? `лучший день · ${bestDay.words} слов` : 'лучший день впереди'}
          </div>
        </div>
      </div>

      <div className="cards-2">
        <div className="card">
          <div className="card-head-row">
            <div className="streak-title">{stats.streakDays} дней подряд</div>
            <div className="row-mono">РЕКОРД · {stats.longestStreak} ДНЕЙ</div>
          </div>
          <Heatmap byDay={stats.byDay} />
        </div>

        <div className="card">
          <div className="cap">языки результата</div>
          {stats.langBreakdown.map((lb) => {
            const maxLang = stats.langBreakdown[0]?.count ?? 1
            const names: Record<string, string> = { none: 'Без перевода', en: 'Английский', zh: 'Китайский' }
            return (
              <div key={lb.lang} className="hbar-row">
                <span className="hbar-name">{names[lb.lang] ?? lb.lang}</span>
                <span className="hbar">
                  <span className="hbar-fill" style={{ width: `${(lb.count / maxLang) * 100}%` }} />
                </span>
                <span className="row-mono">{lb.count}</span>
              </div>
            )
          })}

          <div className="cap term-section">стили</div>
          {topStyles.map((sb) => (
            <div key={sb.styleId} className="hbar-row">
              <span className="hbar-name">{styleName(sb.styleId)}</span>
              <span className="hbar">
                <span className="hbar-fill" style={{ width: `${(sb.count / maxStyleCount) * 100}%` }} />
              </span>
              <span className="row-mono">{sb.count}</span>
            </div>
          ))}

          {stats.topTerms.length > 0 ? (
            <div className="term-section">
              <div className="cap">ваши термины</div>
              <div className="term-chips">
                {stats.topTerms.map((t, i) => (
                  <span key={t} className="term-chip" style={{ animationDelay: `${i * 30}ms` }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="desc term-section">Автословарь пока не собрал термины</div>
          )}
        </div>
      </div>

      <div className="cards-2">
        <UsageCard
          title="Переводчик"
          summary={stats.usage.translate}
          unitOne="перевод"
          unitFew="перевода"
          unitMany="переводов"
          keyLabel={(code) => TRANSLATE_LANGS.find((l) => l.code === code)?.label ?? code}
          extra={`${stats.usage.translate.chars.toLocaleString('ru-RU')} знаков обработано · языки перевода`}
        />
        <UsageCard
          title="Озвучивание"
          summary={stats.usage.speak}
          unitOne="запуск"
          unitFew="запуска"
          unitMany="запусков"
          keyLabel={(id) => voiceLabel(id)}
          extra={`${stats.usage.speak.chars.toLocaleString('ru-RU')} знаков прочитано · около ${stats.usage.speak.minutes} мин звучания`}
        />
      </div>
    </div>
  )
}
