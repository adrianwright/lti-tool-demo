#requires -Version 7
# azd postprovision hook: point the handshake scripts at the deployed tool URL.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root '.env'

$toolUrl = (azd env get-value AZURE_TOOL_URL).Trim()
if (-not $toolUrl) { throw 'AZURE_TOOL_URL was not set by provisioning.' }

$lines = @(Get-Content $envPath)
if ($lines | Where-Object { $_ -match '^TOOL_URL=' }) {
  $lines = $lines -replace '^TOOL_URL=.*', "TOOL_URL=$toolUrl"
} else {
  $lines += "TOOL_URL=$toolUrl"
}
Set-Content -Path $envPath -Value $lines

Write-Host "Handshake scripts now target $toolUrl (run: npm test)"
