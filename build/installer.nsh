; Дополнительная страница установщика: выбор ярлыков (рабочий стол / меню «Пуск»).
; Подключается electron-builder'ом через nsis.include.

!include "nsDialogs.nsh"

; Оформление мастера задаётся картинками шапки и боковой панели (electron-builder.yml).
; Переопределять цвета MUI отсюда нельзя: макрос подключается уже после MUI2.nsh.


; Перед установкой закрываем работающую версию для Оли сами: иначе установщик
; спотыкается на «Не удалось закрыть» и ставит старую версию поверх.
; Закрываем ТОЛЬКО VerboOlya.exe: основной Verbo (Verbo.exe) на том же
; компьютере трогать нельзя — установка не должна обрывать чужую работу.
!macro customInit
  nsExec::Exec 'taskkill /F /IM VerboOlya.exe /T'
  Pop $0
  Sleep 700
!macroend

!macro customPageAfterChangeDir
  ; переменные объявлены здесь, чтобы не попадать в скрипт деинсталлятора
  Var /GLOBAL DesktopCheckbox
  Var /GLOBAL StartMenuCheckbox
  Var /GLOBAL DesktopChecked
  Var /GLOBAL StartMenuChecked

  Page custom ShortcutsPageCreate ShortcutsPageLeave

  Function ShortcutsPageCreate
    !insertmacro MUI_HEADER_TEXT "Ярлыки программы" "Укажите, где разместить ярлыки Verbo для Оли"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateCheckbox} 0 12u 100% 12u "Разместить ярлык на рабочем столе"
    Pop $DesktopCheckbox
    ${NSD_Check} $DesktopCheckbox
    ${NSD_CreateCheckbox} 0 30u 100% 12u "Разместить ярлык в меню «Пуск»"
    Pop $StartMenuCheckbox
    ${NSD_Check} $StartMenuCheckbox
    nsDialogs::Show
  FunctionEnd

  Function ShortcutsPageLeave
    ${NSD_GetState} $DesktopCheckbox $DesktopChecked
    ${NSD_GetState} $StartMenuCheckbox $StartMenuChecked
  FunctionEnd
!macroend

!macro customInstall
  ${If} $DesktopChecked = 1
    CreateShortCut "$DESKTOP\Verbo для Оли.lnk" "$INSTDIR\VerboOlya.exe"
  ${EndIf}
  ${If} $StartMenuChecked = 1
    CreateShortCut "$SMPROGRAMS\Verbo для Оли.lnk" "$INSTDIR\VerboOlya.exe"
  ${EndIf}
!macroend

; удаляем только свои ярлыки: ярлыки основного Verbo называются иначе и остаются
!macro customUnInstall
  Delete "$DESKTOP\Verbo для Оли.lnk"
  Delete "$SMPROGRAMS\Verbo для Оли.lnk"
!macroend
