# Распознавание текста на изображении встроенным движком Windows (Windows.Media.Ocr).
# Работает без интернета и без ключей. Вывод: распознанные строки в UTF-8, по одной на строку.
# Коды выхода: 0 — успех; 2 — движок недоступен; 1 — прочие ошибки.
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Lang = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
  [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
  [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

  # WinRT-операции в PowerShell приходится ждать вручную через AsTask
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

  function Await($op, $type) {
    $asTask = $asTaskGeneric.MakeGenericMethod($type)
    $task = $asTask.Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
  }

  $engine = $null
  if ($Lang) {
    $language = New-Object Windows.Globalization.Language $Lang
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
  }
  if (-not $engine) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
  if (-not $engine) {
    [Console]::Error.WriteLine('Распознавание текста на изображении недоступно в этой системе')
    exit 2
  }

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

  foreach ($line in $result.Lines) { [Console]::Out.WriteLine($line.Text) }
  exit 0
}
catch {
  # разворачиваем вложенные исключения: WinRT прячет причину внутри AggregateException
  $e = $_.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  [Console]::Error.WriteLine($e.Message)
  exit 1
}
