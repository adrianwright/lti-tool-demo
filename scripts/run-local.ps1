#requires -Version 7
# Run the tool + LMS simulator locally (Node on the host) with MongoDB in Docker.
# Mongo is published on localhost:27017 so the host apps can reach it. The tool
# runs in dev mode (relaxed cookies) so the browser launch works over http://localhost.

[CmdletBinding()]
param(
  [switch]$SkipMongo,   # use your own local MongoDB on localhost:27017
  [int]$ToolPort = 3000,
  [int]$LmsPort = 4000
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $SkipMongo) {
  Write-Host 'Starting MongoDB (Docker) on localhost:27017...'
  docker compose up -d mongo | Out-Null
}

if (-not (Test-Path (Join-Path $root '.env'))) {
  Write-Host 'Generating .env (synthetic platform identity)...'
  npm run setup | Out-Null
}

# Load .env values into this session so the tool inherits LTI_KEY and the static platform.
Get-Content (Join-Path $root '.env') | Where-Object { $_ -match '=' } | ForEach-Object {
  $i = $_.IndexOf('='); Set-Item -Path "env:$($_.Substring(0, $i))" -Value $_.Substring($i + 1)
}

# Ensure dependencies.
if (-not (Test-Path (Join-Path $root 'node_modules'))) { npm install | Out-Null }
if (-not (Test-Path (Join-Path $root 'lms/node_modules'))) { Push-Location lms; npm install | Out-Null; Pop-Location }

$toolUrl = "http://localhost:$ToolPort"
$lmsUrl = "http://localhost:$LmsPort"

# Per-app overrides win over the inherited .env values.
$toolCmd = "`$env:MONGO_URL='mongodb://localhost:27017/ltijs'; `$env:TOOL_URL='$toolUrl'; `$env:PORT='$ToolPort'; `$env:LTI_DEV_MODE='true'; node server.js"
$lmsCmd = "`$env:PORT='$LmsPort'; `$env:LMS_URL='$lmsUrl'; `$env:TOOL_URL='$toolUrl'; node server.js"

Start-Process pwsh -ArgumentList '-NoExit', '-Command', $toolCmd -WorkingDirectory $root
Start-Process pwsh -ArgumentList '-NoExit', '-Command', $lmsCmd -WorkingDirectory (Join-Path $root 'lms')

Write-Host ''
Write-Host 'Local apps starting in two new windows:'
Write-Host "  Tool : $toolUrl"
Write-Host "  LMS  : $lmsUrl   <- open this to register + launch"
Write-Host '  Mongo: mongodb://localhost:27017/ltijs'
Write-Host ''
Write-Host 'Close the two app windows to stop the apps. Run `docker compose down` to stop Mongo.'
