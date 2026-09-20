[CmdletBinding()]
param(
  [string]$IntegrationRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$StagingDirectory
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path $IntegrationRoot).Path
if (-not $StagingDirectory) {
  $StagingDirectory = Join-Path $root ('.deployment\railway-' + (Get-Date -Format 'yyyyMMdd-HHmmssfff'))
}
$stage = [System.IO.Path]::GetFullPath($StagingDirectory)
if (Test-Path -LiteralPath $stage) { throw "Staging directory already exists; refusing to overwrite: $stage" }

$required = @(
  'server\package.json', 'server\package-lock.json', 'server\tsconfig.json',
  'server\data\regions.json', 'server\data\boundaries.geojson', 'server\data\region-sources.json', 'server\data\population-balance.json',
  'deploy\railway\Dockerfile', 'deploy\railway\.dockerignore', 'deploy\railway\railway.json'
)
foreach ($relative in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) {
    throw "Required source file is missing: $relative"
  }
}

New-Item -ItemType Directory -Path $stage, "$stage\server\src", "$stage\server\data", "$stage\contracts" | Out-Null
Copy-Item "$root\server\package.json", "$root\server\package-lock.json", "$root\server\tsconfig.json" "$stage\server\"
Copy-Item -Recurse "$root\server\src\*" "$stage\server\src\"
Copy-Item "$root\server\data\regions.json", "$root\server\data\boundaries.geojson", "$root\server\data\region-sources.json", "$root\server\data\population-balance.json" "$stage\server\data\"
Copy-Item -Recurse "$root\contracts\*" "$stage\contracts\"
Copy-Item "$root\deploy\railway\Dockerfile", "$root\deploy\railway\.dockerignore", "$root\deploy\railway\railway.json" $stage

$forbidden = Get-ChildItem -LiteralPath $stage -Recurse -Force | Where-Object {
  $_.FullName -match '\\(node_modules|dist|build|\.gradle|\.cxx|\.expo|distweb|log|logs|cache)(\\|$)' -or
  $_.Name -match '\.(db|sqlite|sqlite3|jks|keystore|p12|pem|key)$'
}
if ($forbidden) { throw "Forbidden deployment content was copied: $($forbidden.FullName -join ', ')" }

Write-Host "Railway staging prepared: $stage"
