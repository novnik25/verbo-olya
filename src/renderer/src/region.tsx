import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { rectFrom } from '../../shared/region'
import { REGION, rootVars } from '../../shared/palette'

const api = (window as unknown as { voxflow: import('../../preload/index').VoxflowApi }).voxflow

interface Point {
  x: number
  y: number
}

function Region(): JSX.Element {
  const [start, setStart] = useState<Point | null>(null)
  const [now, setNow] = useState<Point | null>(null)
  const doneRef = useRef(false)

  const finish = (rect: { x: number; y: number; width: number; height: number } | null): void => {
    if (doneRef.current) return
    doneRef.current = true
    void api.regionPicked(rect)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rect = start && now ? rectFrom(start, now) : null

  return (
    <div
      className="shade"
      onMouseDown={(e) => {
        setStart({ x: e.clientX, y: e.clientY })
        setNow({ x: e.clientX, y: e.clientY })
      }}
      onMouseMove={(e) => start && setNow({ x: e.clientX, y: e.clientY })}
      onMouseUp={() => {
        // случайный клик без протяжки — не область, а отмена
        if (!rect || rect.width < 8 || rect.height < 8) return finish(null)
        finish(rect)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        finish(null)
      }}
    >
      {rect && (
        <div
          className="sel"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <span className="size">
            {rect.width} × {rect.height}
          </span>
        </div>
      )}
      {!start && <div className="hint">Выделите область с текстом · Esc — отмена</div>}
    </div>
  )
}

const style = document.createElement('style')
style.textContent = `
  :root {
${rootVars(REGION)}
  }
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; user-select: none; }
  #root { height: 100vh; }
  .shade { position: fixed; inset: 0; cursor: crosshair; background: var(--shade); }
  /* выделенная область остаётся светлой: вырезаем затемнение огромной тенью */
  .sel {
    position: absolute; border: 1.5px solid var(--select); background: transparent;
    box-shadow: 0 0 0 100vmax var(--shade);
  }
  .size {
    position: absolute; left: 0; top: -24px;
    padding: 2px 8px; border-radius: 6px;
    background: var(--tip-bg); color: var(--tip-ink); font-size: 11.5px; white-space: nowrap;
  }
  .hint {
    position: absolute; left: 50%; top: 24px; transform: translateX(-50%);
    padding: 9px 16px; border-radius: 999px;
    background: var(--tip-bg); color: var(--tip-ink); font-size: 13px;
  }
`
document.head.appendChild(style)
createRoot(document.getElementById('root')!).render(<Region />)
