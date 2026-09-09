#requires -Version 7
# azd preprovision hook: ensure the synthetic platform identity exists locally and
# feed it into the azd environment so Bicep parameters resolve.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'

if (-not (Test-Path $envPath)) {
  Write-Host 'No .env found; generating a synthetic platform identity...'
  Push-Location $root
  npm run setup
  Pop-Location
}

$envMap = @{}
Get-Content $envPath | Where-Object { $_ -match '=' } | ForEach-Object {
  $i = $_.IndexOf('=')
  $envMap[$_.Substring(0, $i)] = $_.Substring($i + 1)
}

$required = 'LTI_KEY', 'PLATFORM_URL', 'PLATFORM_CLIENT_ID', 'PLATFORM_AUTH_ENDPOINT', 'PLATFORM_TOKEN_ENDPOINT', 'PLATFORM_PUBLIC_KEY'
foreach ($key in $required) {
  if (-not $envMap.ContainsKey($key)) { throw "Missing $key in .env (run: npm run setup)" }
  azd env set $key $envMap[$key] | Out-Null
}

Write-Host 'Synthetic platform identity loaded into the azd environment.'
