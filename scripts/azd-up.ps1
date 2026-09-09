#requires -Version 7
# Non-interactive `azd up`: pins subscription + region so azd never prompts in
# environments where interactive input is disabled, then provisions and deploys.
# The synthetic platform identity is loaded by the preprovision hook.

[CmdletBinding()]
param(
  [string]$SubscriptionId = (az account show --query id -o tsv),
  [string]$Location
)

$ErrorActionPreference = 'Stop'
if (-not $SubscriptionId) { throw 'No active subscription. Run: az login' }

# Azure login has no region; use the az CLI default if one is configured, else eastus.
if (-not $Location) {
  $Location = (az config get defaults.location --query value -o tsv 2>$null)
  if (-not $Location) { $Location = 'eastus' }
}

azd env set AZURE_SUBSCRIPTION_ID $SubscriptionId | Out-Null
azd env set AZURE_LOCATION $Location | Out-Null

# Populate the platform parameters before `azd up` so provisioning validation
# passes on a fresh environment (the preprovision hook runs too late for that).
& (Join-Path $PSScriptRoot 'preprovision.ps1')

azd up --no-prompt
