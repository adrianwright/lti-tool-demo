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

# The LMS simulator requires Entra Easy Auth backed by a Key Vault. Fail provisioning
# early (with a clear message) if the deploy script hasn't set these.
foreach ($key in 'ENTRA_APP_ID', 'VAULT_NAME', 'VAULT_RG') {
  $value = (azd env get-value $key 2>$null)
  if (-not $value -or $value -match '^ERROR') {
    throw "Missing $key. Deploy with scripts/azd-up.ps1 (which upserts the vault and sets these), or azd env set them manually."
  }
}

Write-Host 'Synthetic platform identity loaded into the azd environment.'
