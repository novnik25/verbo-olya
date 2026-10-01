export const api = (window as unknown as { voxflow: import('../../../preload/index').VoxflowApi })
  .voxflow

/**
 * Наведение на интерактивные элементы отключает проброс кликов сквозь окно.
 * Окно панели прозрачно для мыши (setIgnoreMouseEvents), иначе оно перехватывало
 * бы клики по чужим приложениям под собой.
 */
export const hot = {
  onMouseEnter: () => api.overlayMouse({ interactive: true }),
  onMouseLeave: () => api.overlayMouse({ interactive: false })
}
