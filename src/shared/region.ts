export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Пересчитывает выделенную область под масштаб снимка экрана. Выделение приходит
 * в логических пикселях окна, а снимок — в физических: при масштабе Windows
 * больше 100% это разные величины, и без пересчёта обрезка уезжает.
 *
 * Ширина и высота не опускаются ниже одного пикселя: обрезка нулевого размера
 * не проходит вовсе, а пользователь легко делает случайный клик без протяжки.
 * Чистая функция.
 */
export function scaleRect(rect: Rect, scale: number): Rect {
  return {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale))
  }
}

/** Прямоугольник по двум углам — при протяжке мышью в любую сторону. Чистая функция. */
export function rectFrom(
  a: { x: number; y: number },
  b: { x: number; y: number }
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    width: Math.round(Math.abs(a.x - b.x)),
    height: Math.round(Math.abs(a.y - b.y))
  }
}
