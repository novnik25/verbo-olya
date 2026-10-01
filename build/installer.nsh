; Дополнительная страница установщика: выбор ярлыков (рабочий стол / меню «Пуск»).
; Подключается electron-builder'ом через nsis.include.

!include "nsDialogs.nsh"

; Оформление мастера задаётся картинками шапки и боковой панели (electron-builder.yml).
; Переопределять цвета MUI отсюда нельзя: макрос подключается уже после MUI2.nsh.


; Перед установкой закрываем работающую Verbo сами: иначе установщик
; спотыкается на «Не удалось закрыть Verbo» и ставит старую версию поверх.
!macro customInit
  nsExec::Exec 'taskkill /F /IM Verbo.exe /T'
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
    !insertmacro MUI_HEADER_TEXT "Ярлыки программы" "Укажите, где разместить ярлыки Verbo"
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
    CreateShortCut "$DESKTOP\Verbo.lnk" "$INSTDIR\Verbo.exe"
  ${EndIf}
  ${If} $StartMenuChecked = 1
    CreateShortCut "$SMPROGRAMS\Verbo.lnk" "$INSTDIR\Verbo.exe"
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Verbo.lnk"
  Delete "$SMPROGRAMS\Verbo.lnk"
!macroend
