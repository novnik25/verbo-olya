import { GLASS, rootVars } from '../../../shared/palette'

/**
 * Оформление плавающей панели. Жило внутри overlay.tsx рядом с разметкой —
 * 267 строк CSS посреди файла с логикой мешали читать и то, и другое.
 */
export const OVERLAY_CSS = `
  /* ── UI-kit плавающей панели ───────────────────────────────────────────────
     Один материал для всего: тёмное полупрозрачное стекло, светлый текст,
     бирюзовый акцент. Тень — filter: drop-shadow, она повторяет скруглённую
     форму панели; box-shadow в прозрачном окне давал прямоугольный ореол.     */
  :root {
${rootVars(GLASS)}
    --drop-s: drop-shadow(0 2px 6px rgba(6, 10, 14, .34));
    --drop-m: drop-shadow(0 5px 14px rgba(6, 10, 14, .36));
    --drop-l: drop-shadow(0 8px 20px rgba(6, 10, 14, .40));
    --r-s: 10px; --r-m: 14px; --r-l: 18px;
    --dur: .18s;
  }
  html, body { margin: 0; background: transparent; overflow: hidden; }
  * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; }
  #root { height: 100vh; }
  button { font: inherit; }
  .dock {
    height: 100%;
    display: flex; flex-direction: column;
    align-items: center; justify-content: flex-end;
    /* запас снизу — чтобы тень не срезалась нижней границей окна */
    padding-bottom: 24px; gap: 9px;
  }

  /* ── нижний овал: в покое — тонкая полоска, при наведении раскрывается ───── */
  /* сам ряд «прозрачен» для мыши: перехватывает только видимое — овал и появившиеся
     кружки, чтобы клики рядом с ними попадали в окно под плашкой */
  .dock-row { position: relative; display: flex; align-items: center; pointer-events: none; }
  /* раскрытая плашка ловит мышь целиком, включая промежутки между кнопками:
     курсор можно спокойно вести от овала к кружкам, ничего не схлопывается */
  .dock-row.open { pointer-events: auto; padding: 5px 8px; margin: -5px -8px; }
  .bar {
    pointer-events: auto;
    display: grid; place-items: center;
    width: 74px; height: 7px; padding: 0;
    border: 0; border-radius: 999px; overflow: hidden;
    background: rgba(18, 22, 26, .52); color: var(--ink); cursor: pointer;
    border: 1px solid rgba(255, 255, 255, .28);
    filter: var(--drop-s);
    transition: height .2s cubic-bezier(.2, .9, .3, 1.2), background-color var(--dur) ease,
                color var(--dur) ease, transform .1s ease;
  }
  .dock-row.open .bar {
    height: 32px; background: var(--glass-strong);
    border-color: var(--line); filter: var(--drop-m);
  }
  .dock-row.open .bar:hover { color: var(--accent); }
  .bar:active { transform: scale(.96); }
  .bar svg {
    opacity: 0;
    transition: opacity .16s ease .04s;
  }
  .dock-row.open .bar svg { opacity: 1; }
  .bar:focus-visible, .quick-btn:focus-visible,
  .menu-item:focus-visible, .btn:focus-visible, .chip:focus-visible, .seg-btn:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }
  .bar-badge {
    position: absolute; top: -2px; right: -3px;
    font-size: 8px; font-weight: 700; letter-spacing: .02em;
    color: var(--on-accent); background: var(--accent);
    border-radius: 999px; padding: 0 3px 1px; pointer-events: none;
  }
  .net-dot {
    position: absolute; bottom: 0; left: 0;
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--warn); pointer-events: none;
  }

  /* кружки быстрых функций: всплывают при наведении на овал. Вынесены из потока —
     иначе их невидимая ширина смещала бы сам овал вправо от центра экрана */
  .quick, .side {
    position: absolute; top: 50%; transform: translateY(-50%);
    display: flex; align-items: center; gap: 5px;
    pointer-events: none;
  }
  .quick { right: 100%; padding-right: 7px; }
  .side { left: 100%; padding-left: 7px; }
  .quick-btn {
    display: grid; place-items: center;
    width: 28px; height: 28px; padding: 0;
    border: 0; border-radius: 50%;
    background: var(--glass-strong); color: var(--ink); cursor: pointer;
    filter: var(--drop-s);
    opacity: 0; transform: translateX(16px) scale(.6); pointer-events: none;
    transition: opacity var(--dur) ease, transform .22s cubic-bezier(.2, .9, .3, 1.35),
                color var(--dur) ease;
  }
  .dock-row.open .quick-btn {
    opacity: 1; transform: none; pointer-events: auto;
  }
  /* кружок языка выезжает вправо, остальные — влево */
  .side .quick-btn { transform: translateX(-16px) scale(.6); }
  .quick-btn.lang { position: relative; }
  .quick-btn:nth-child(2) { transition-delay: .04s; }
  .quick-btn:nth-child(3) { transition-delay: .08s; }
  .quick-btn:hover { color: var(--accent); }
  .quick-btn:active { transform: scale(.92); }
  .quick-btn.on { color: var(--accent); }
  /* режим перестановки: зажали кружок — соседи дрожат, показывая, что их можно
     двигать. Дрожит и сам зажатый, пока его не потащили (класс .dragging) */
  @keyframes wobble {
    0%, 100% { transform: rotate(-3deg); }
    50%      { transform: rotate(3deg); }
  }
  .dock-row.editing .quick-btn:not(.dragging) {
    animation: wobble .28s ease-in-out infinite;
  }

  /* ── меню быстрого доступа: тот же материал, что у карточек ──────────────── */
  .menu {
    min-width: 232px; max-width: 330px;
    display: flex; flex-direction: column;
    padding: 7px; border-radius: var(--r-l);
    background: var(--glass); color: var(--ink);
    border: 1px solid var(--line-soft);
    filter: var(--drop-l);
    animation: rise .2s cubic-bezier(.2, .9, .3, 1.15) both;
  }
  .menu.wide { min-width: 286px; }
  .menu-title {
    font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
    color: var(--dim); padding: 6px 10px 7px;
  }
  .menu-group { font-size: 11.5px; font-weight: 500; color: var(--dim); padding: 5px 10px 4px; }
  .menu-item {
    display: flex; align-items: center; gap: 10px; justify-content: space-between;
    border: 0; border-radius: var(--r-s); background: none;
    padding: 8px 10px; font-size: 13px; color: var(--ink);
    cursor: pointer; text-align: left; width: 100%;
    transition: background-color var(--dur) ease;
  }
  .menu-item:hover { background: rgba(255, 255, 255, .08); }
  .menu-item:active { background: rgba(255, 255, 255, .13); }
  .menu-item.compact { color: var(--dim); font-size: 12.5px; justify-content: flex-start; }
  .menu-item.compact:hover { color: var(--ink); }
  .menu-item.on .menu-item-label { font-weight: 600; }
  .menu-item svg { flex-shrink: 0; color: var(--accent); }
  .menu-item-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .menu-item-label { line-height: 1.25; }
  .menu-item-note { font-size: 11px; color: var(--dim); opacity: .85; }
  .menu-sep { height: 1px; margin: 5px 8px; background: var(--line-soft); }
  .menu-action {
    display: flex; align-items: center; gap: 9px; justify-content: center;
    margin: 8px 3px 3px; padding: 9px 12px;
    border: 0; border-radius: var(--r-s);
    background: var(--accent-deep); color: #fff;
    font-size: 12.5px; font-weight: 600; cursor: pointer;
    transition: background-color var(--dur) ease, transform .1s ease;
  }
  .menu-action svg { color: #fff; }
  .menu-action:hover { background: var(--accent-hover); }
  .menu-action:active { transform: scale(.985); }

  .seg { display: flex; gap: 4px; padding: 2px 3px 8px; }
  .seg-btn {
    flex: 1; border: 1px solid var(--line); border-radius: 8px;
    background: none; padding: 6px 4px; font-size: 11.5px; color: var(--dim);
    cursor: pointer; white-space: nowrap;
    transition: background-color var(--dur) ease, color var(--dur) ease, border-color var(--dur) ease;
  }
  .seg-btn:hover { background: rgba(255, 255, 255, .08); color: var(--ink); }
  .seg-btn.on {
    background: var(--accent-tint); border-color: var(--accent-tint-line);
    color: var(--accent); font-weight: 600;
  }
  /* свой выпадающий список: системный всегда белый и выпадает из стиля */
  .picker { position: relative; margin: 0 3px 2px; flex: 1; min-width: 0; }
  .picker-value {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    width: 100%; padding: 7px 10px;
    border: 1px solid var(--line); border-radius: var(--r-s);
    background: rgba(255, 255, 255, .07); color: var(--ink);
    font-size: 12.5px; cursor: pointer; text-align: left;
    transition: background-color var(--dur) ease, border-color var(--dur) ease;
  }
  .picker-value:hover { background: rgba(255, 255, 255, .12); }
  .picker-value svg { flex-shrink: 0; color: var(--dim); }
  .picker-list {
    position: absolute; left: 0; right: 0; bottom: calc(100% + 5px);
    max-height: 260px; overflow-y: auto;
    display: flex; flex-direction: column;
    padding: 5px; border-radius: var(--r-m);
    background: var(--glass-strong); border: 1px solid var(--line);
    filter: var(--drop-m); z-index: 3;
  }
  .picker-list::-webkit-scrollbar { width: 8px; }
  .picker-list::-webkit-scrollbar-thumb {
    border: 2px solid transparent; border-radius: 999px;
    background-clip: content-box; background-color: rgba(255, 255, 255, .22);
  }
  .picker-list .menu-item { font-size: 12.5px; padding: 7px 9px; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; padding: 2px 3px 4px; }
  .chip {
    border: 1px solid var(--line); border-radius: 999px;
    background: none; padding: 5px 11px; font-size: 12px; color: var(--ink);
    cursor: pointer;
    transition: background-color var(--dur) ease, border-color var(--dur) ease;
  }
  .chip:hover { background: rgba(255, 255, 255, .08); }
  .chip.on {
    background: var(--accent-tint); border-color: var(--accent-tint-line);
    color: var(--accent); font-weight: 600;
  }

  /* ── карточки: перевод, озвучивание, «курсор вне поля ввода» ─────────────── */
  .card {
    width: 404px; border-radius: var(--r-l); padding: 12px 14px;
    background: var(--glass); color: var(--ink);
    border: 1px solid var(--line-soft);
    filter: var(--drop-l);
    animation: rise .24s cubic-bezier(.2, .9, .3, 1.15) both;
  }
  .card.narrow { width: 306px; }
  .card-head, .card-foot {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
  }
  .card-head { margin-bottom: 9px; }
  .card-title { font-size: 12px; font-weight: 600; }
  .card-hint { font-size: 10.5px; color: var(--dim); white-space: nowrap; }
  .icon-btn {
    display: grid; place-items: center;
    width: 24px; height: 24px; padding: 0;
    border: 0; border-radius: 7px; background: none; color: var(--dim); cursor: pointer;
    transition: background-color var(--dur) ease, color var(--dur) ease;
  }
  .icon-btn:hover { background: rgba(255, 255, 255, .1); color: var(--ink); }
  .card-text {
    font-size: 12px; line-height: 1.5; margin: 2px 0 10px;
    max-height: 88px; overflow: hidden; word-break: break-word; white-space: pre-wrap;
  }
  /* выше, чем в основном Verbo: под словами стоит транскрипция, и текст
     с ней вдвое выше — в 180px умещалась бы пара строк */
  .card-body {
    font-size: 13px; line-height: 1.55; margin-bottom: 10px;
    max-height: 270px; overflow-y: auto; word-break: break-word; white-space: pre-wrap;
  }
  .skeleton { color: var(--dim); }

  /* ── транскрипция: произношение под каждым словом ─────────────────────────── */
  .phon-source {
    margin-bottom: 9px; padding-bottom: 9px; border-bottom: 1px solid var(--line-soft);
  }
  .phon-head {
    display: flex; align-items: center; justify-content: space-between; gap: 6px;
    min-height: 20px; margin-bottom: 3px;
    font-size: 10.5px; color: var(--dim); white-space: normal;
  }
  .phon-head .icon-btn { width: 22px; height: 22px; }
  .phon-text { line-height: 1.3; white-space: pre-wrap; }
  /* слово и его произношение — столбиком; базовая линия у слова, поэтому
     запятые и точки между словами встают ровно по тексту */
  .phon-word {
    display: inline-flex; flex-direction: column; align-items: center;
    margin-bottom: 7px;
  }
  .phon-ipa {
    font-size: 11.5px; line-height: 1.3; color: var(--accent); white-space: nowrap;
  }
  .phon-ru { font-size: 11px; line-height: 1.3; color: var(--dim); white-space: nowrap; }
  .phon-stress { color: var(--ink); font-weight: 700; }
  .phon-wait { margin-top: 6px; font-size: 11px; color: var(--dim); white-space: normal; }
  /* прокрутка внутри панелей — в цвет панели, а не системная белая */
  .card-body::-webkit-scrollbar, .menu::-webkit-scrollbar { width: 9px; }
  .card-body::-webkit-scrollbar-track, .menu::-webkit-scrollbar-track { background: transparent; }
  .card-body::-webkit-scrollbar-thumb, .menu::-webkit-scrollbar-thumb {
    border: 3px solid transparent; border-radius: 999px;
    background-clip: content-box; background-color: rgba(255, 255, 255, .26);
  }
  .card-body::-webkit-scrollbar-thumb:hover, .menu::-webkit-scrollbar-thumb:hover {
    background-color: rgba(255, 255, 255, .42);
  }
  .card-error { color: var(--danger); font-size: 12px; }
  .select {
    flex: 1; min-width: 0;
    background: rgba(255, 255, 255, .09); color: var(--ink);
    border: 1px solid var(--line); border-radius: 8px; padding: 5px 8px;
    font-size: 12px; cursor: pointer;
  }
  .actions { display: flex; gap: 6px; margin-left: auto; }
  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    border: 0; border-radius: 8px; padding: 6px 12px;
    background: var(--accent-deep); color: #fff; font-size: 11.5px; font-weight: 600;
    cursor: pointer; white-space: nowrap;
    transition: background-color var(--dur) ease, transform .1s ease, opacity var(--dur) ease;
  }
  .btn:hover { background: var(--accent-hover); }
  .btn:active { transform: scale(.96); }
  .btn:disabled { opacity: .45; cursor: default; }
  .btn.ghost { background: rgba(255, 255, 255, .12); }
  .btn.ghost:hover { background: rgba(255, 255, 255, .2); }
  .voice-name {
    display: flex; align-items: center; gap: 8px;
    font-size: 12.5px; min-width: 0;
  }
  .voice-name svg { flex-shrink: 0; color: var(--accent); }
  .voice-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ── компактная пилюля состояний ──────────────────────────────────────────── */
  .pill {
    display: flex; align-items: center; justify-content: center;
    width: fit-content; min-width: 76px; max-width: 240px;
    padding: 5px 16px; border-radius: 999px;
    background: var(--glass); color: var(--ink);
    border: 1px solid var(--line-soft); filter: var(--drop-m);
    animation: rise .24s cubic-bezier(.2, .9, .3, 1.15) both;
  }
  .pill.recording { cursor: pointer; }
  .bars { display: flex; align-items: center; gap: 2.5px; height: 16px; }
  .bars span { width: 2.5px; border-radius: 2px; background: var(--accent);
               transition: height .1s linear; min-height: 3px; }
  .bars.warming span { animation: warm .9s ease-in-out infinite; }
  .bars.warming span:nth-child(2) { animation-delay: .1s; }
  .bars.warming span:nth-child(3) { animation-delay: .2s; }
  .bars.warming span:nth-child(4) { animation-delay: .3s; }
  .bars.warming span:nth-child(5) { animation-delay: .4s; }
  .bars.warming span:nth-child(6) { animation-delay: .5s; }
  .bars.warming span:nth-child(7) { animation-delay: .6s; }
  @keyframes warm { 0%, 100% { height: 3px; } 50% { height: 11px; } }
  .label { font-size: 12px; }
  .pill.error .label { color: var(--danger); }
  .pill.queued .label { color: var(--warn-soft); }

  @keyframes rise {
    from { opacity: 0; transform: translateY(12px) scale(.94); }
    to   { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pill, .menu, .card { animation: none; }
    .bars span, .bar, .bar-btn, .bar-sep, .quick-btn, .menu-item, .btn, .chip, .seg-btn {
      transition: none;
    }
    .quick-btn { transform: none; }
    /* wobble намеренно НЕ гасим: это единственный признак режима перестановки,
       а не декоративная анимация. Правило анимации выигрывает у transform: none
       выше по каскаду, поэтому переобъявлять его здесь не нужно */
  }
`
