[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$serverRoot = Join-Path $root 'server'
$node = 'C:\Program Files\nodejs\node.exe'
$npm = 'C:\Program Files\nodejs\npm.cmd'
$healthUri = 'http://127.0.0.1:3040/health'
$distEntry = Join-Path $serverRoot 'dist\server\src\server.js'
$logs = Join-Path $root 'logs'
$pidFile = Join-Path $logs 'walkwar-server.pid'

function Test-Health {
  try {
    $response = Invoke-WebRequest -Uri $healthUri -Method Get -TimeoutSec 2 -UseBasicParsing
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-Path -LiteralPath $node)) { throw "Node 24 executable not found: $node" }
if (-not (Test-Path -LiteralPath $npm)) { throw "npm executable not found: $npm" }

if (Test-Health) {
  Write-Host 'WalkWar server is already healthy at http://127.0.0.1:3040.'
  exit 0
}

New-Item -ItemType Directory -Path $logs -Force | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $serverRoot 'node_modules'))) {
  Write-Host 'Installing server dependencies with npm ci...'
  & $npm ci --prefix $serverRoot
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
}

if (-not (Test-Path -LiteralPath $distEntry)) {
  Write-Host 'Building the server...'
  & $npm run build --prefix $serverRoot
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE." }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdout = Join-Path $logs "server-$stamp.out.log"
$stderr = Join-Path $logs "server-$stamp.err.log"
$process = Start-Process -FilePath $node -WorkingDirectory $serverRoot -ArgumentList @('--experimental-sqlite', 'dist/server/src/server.js') -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidFile -Value ([string]$process.Id) -Encoding ascii

$deadline = (Get-Date).AddSeconds(15)
do {
  Start-Sleep -Milliseconds 250
  if ($process.HasExited) { throw "Server exited during startup (code $($process.ExitCode)). See $stderr." }
  if (Test-Health) {
    Write-Host "WalkWar server started at http://127.0.0.1:3040 (PID $($process.Id))."
    exit 0
  }
} while ((Get-Date) -lt $deadline)

throw "Server did not become healthy within 15 seconds. See $stdout and $stderr."
