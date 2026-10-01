/**
 * Единственный источник цветов приложения.
 *
 * Раньше палитра жила в четырёх местах и успела разойтись: styles.css держал
 * акцент #4fbf9b, плавающая панель — свой #63c9a6, окно выбора области и
 * оформление установщика повторяли значения дословно, а в одном правиле
 * оставался вовсе давно снятый оттенок. Теперь цвет меняется здесь.
 *
 * Кто как берёт значения:
 * - плавающая панель и окно выбора области собирают свой CSS в TypeScript и
 *   импортируют палитру напрямую;
 * - styles.css и scripts/gen-installer-art.mjs импортировать TypeScript не могут
 *   (обычный CSS и обычный node), поэтому их держит тест tests/palette.test.ts:
 *   он падает, если значения разойдутся.
 */

/** Тёмная тема главного окна — она же основа для всего остального оформления. */
export const DARK = {
  '--bg': '#15181b',
  '--panel': '#1d2126',
  '--panel-soft': '#232830',
  '--ink': '#edeff1',
  '--muted': '#98a2ac',
  '--line': '#2b313a',

  '--accent': '#4fbf9b',
  '--accent-deep': '#6fd3ae',
  '--accent-soft': 'rgba(79, 191, 155, 0.16)',

  '--amber': '#dfb173',
  '--amber-soft': 'rgba(223, 177, 115, 0.16)',
  '--red': '#ef8a7f',
  '--red-soft': 'rgba(239, 138, 127, 0.16)',

  '--on-accent': '#08201b'
} as const

/** Светлая тема главного окна. */
export const LIGHT = {
  '--bg': '#f3f5f7',
  '--panel': '#ffffff',
  '--panel-soft': '#f7f9fb',
  '--ink': '#15191d',
  '--muted': '#5f6873',
  '--line': '#e5e9ee',

  '--accent': '#1a7a66',
  '--accent-deep': '#12604f',
  '--accent-soft': 'rgba(26, 122, 102, 0.12)',

  '--amber': '#8a5f10',
  '--amber-soft': 'rgba(138, 95, 16, 0.12)',
  '--red': '#b4433a',
  '--red-soft': 'rgba(180, 67, 58, 0.12)',

  '--on-accent': '#ffffff'
} as const

/**
 * Плавающая панель — отдельная поверхность: полупрозрачное тёмное стекло поверх
 * ЧУЖИХ окон, а не сплошной фон приложения. Поэтому текст здесь чисто белый, а
 * акцент светлее основного: на пёстрой подложке #4fbf9b читается тускло.
 * Значения выведены от основного акцента и меняются вместе с ним осознанно —
 * это не копия, а вариант «по стеклу».
 */
export const GLASS = {
  '--glass': 'rgba(14, 18, 22, .80)',
  '--glass-strong': 'rgba(14, 18, 22, .88)',
  '--line': 'rgba(255, 255, 255, .12)',
  '--line-soft': 'rgba(255, 255, 255, .07)',
  '--ink': '#ffffff',
  '--dim': '#dbe1e6',
  '--accent': '#63c9a6',
  '--accent-deep': '#2c8c74',
  /* наведение на кнопку в цвете accent-deep */
  '--accent-hover': '#35a287',
  /* подсветка выбранного пункта: тот же accent, но полупрозрачным */
  '--accent-tint': 'rgba(99, 201, 166, .18)',
  '--accent-tint-line': 'rgba(99, 201, 166, .45)',
  /* текст поверх заливки акцентом */
  '--on-accent': '#0e1c19',
  '--danger': '#f0b3ab',
  '--warn': '#d99a2b',
  '--warn-soft': '#e6c78a'
} as const

/** Рамка выделения в окне выбора области экрана. */
export const REGION = {
  '--select': DARK['--accent'],
  '--shade': 'rgba(10, 14, 18, .35)',
  '--tip-bg': 'rgba(14, 18, 22, .88)',
  '--tip-ink': '#ffffff'
} as const

export const PALETTE = { dark: DARK, light: LIGHT, glass: GLASS, region: REGION }

/** Собирает тело блока :root для CSS, который строится строкой в TypeScript. */
export function rootVars(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join('\n')
}
