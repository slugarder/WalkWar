[CmdletBinding()]
param(
  [string]$Serial,
  [switch]$LocalServer
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$adb = Join-Path (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools') 'adb.exe'
$onlineApk = Join-Path $root 'artifacts\WalkWar-online.apk'
$designApk = Join-Path $root 'artifacts\WalkWar-design-integrated.apk'
$apk = if (Test-Path -LiteralPath $onlineApk) { $onlineApk } else { $designApk }

if (-not (Test-Path -LiteralPath $adb)) { throw "adb.exe not found: $adb" }
if (-not (Test-Path -LiteralPath $apk)) { throw "APK not found. Checked: $onlineApk and $designApk" }

$deviceLines = @(& $adb devices)
if ($LASTEXITCODE -ne 0) { throw "adb devices failed with exit code $LASTEXITCODE." }
$devices = @($deviceLines | Select-Object -Skip 1 | ForEach-Object {
  if ($_ -match '^([^\s]+)\s+device\s*$') { $Matches[1] }
})

if ($Serial) {
  if ($devices -notcontains $Serial) { throw "Requested device '$Serial' is not connected and ready." }
} elseif ($devices.Count -eq 1) {
  $Serial = $devices[0]
} elseif ($devices.Count -eq 0) {
  throw 'No Android device or emulator is connected and ready.'
} else {
  throw "Multiple devices are connected. Re-run with -Serial <device-id>."
}

& $adb -s $Serial install -r $apk
if ($LASTEXITCODE -ne 0) { throw "APK install failed with exit code $LASTEXITCODE." }
if ($LocalServer) {
  & $adb -s $Serial reverse tcp:3040 tcp:3040
  if ($LASTEXITCODE -ne 0) { throw "adb reverse failed with exit code $LASTEXITCODE." }
}
& $adb -s $Serial shell am start -n 'com.walkwar.integrated/.MainActivity'
if ($LASTEXITCODE -ne 0) { throw "Activity start failed with exit code $LASTEXITCODE." }
Write-Host "WalkWar launched on $Serial using $(Split-Path $apk -Leaf)."
if (-not $LocalServer) { Write-Host 'Online mode selected; adb reverse was not configured.' }
