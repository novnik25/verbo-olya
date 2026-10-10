import { APP_NAME } from '../../../shared/app'

export function KeyAccessError(props: { reason: 'blocked' | 'forbidden' }): JSX.Element {
  return (
    <p className="err">
      {props.reason === 'blocked'
        ? `Сервис не обслуживает страну, из которой пришёл запрос. Включите VPN для всей системы и повторите проверку: ${APP_NAME} использует подключение Windows.`
        : 'Сервис запретил доступ. Это не означает, что ключ неверный. Проверьте ограничения аккаунта и подключение через VPN, затем повторите проверку.'}
    </p>
  )
}
