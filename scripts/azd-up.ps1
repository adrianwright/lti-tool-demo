#requires -Version 7
# Deploy the POC. The LMS simulator requires Entra Easy Auth, whose client secret
# is stored in a Key Vault in a SEPARATE resource group (upserted here) and read by
# the LMS app's managed identity. Pins subscription + region so azd never prompts.

[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$EntraAppId,
  [Parameter(Mandatory)][securestring]$EntraClientSecret,
  [Parameter(Mandatory)][string]$VaultResourceGroup,
  [string]$VaultName,
  [string]$SubscriptionId = (az account show --query id -o tsv),
  [string]$Location
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $SubscriptionId) { throw 'No active subscription. Run: az login' }

# Azure login has no region; use the az CLI default if one is configured, else eastus.
if (-not $Location) {
  $Location = (az config get defaults.location --query value -o tsv 2>$null)
  if (-not $Location) { $Location = 'eastus' }
}

# Deterministic vault name (stable per subscription + RG) so re-runs upsert the same vault.
if (-not $VaultName) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = [System.BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes("$SubscriptionId|$VaultResourceGroup"))).Replace('-', '').Substring(0, 18).ToLower()
  $VaultName = "kvlti$hash"
}

$secretPlain = [System.Net.NetworkCredential]::new('', $EntraClientSecret).Password

Write-Host "Upserting Key Vault '$VaultName' in resource group '$VaultResourceGroup'..."
az group create --name $VaultResourceGroup --location $Location | Out-Null
az deployment group create `
  --resource-group $VaultResourceGroup `
  --template-file (Join-Path $root 'infra\vault.bicep') `
  --parameters location=$Location keyVaultName=$VaultName entraAppId=$EntraAppId entraClientSecret=$secretPlain `
  --output none

# Feed non-secret references to azd (the secret itself stays only in the vault).
azd env set AZURE_SUBSCRIPTION_ID $SubscriptionId | Out-Null
azd env set AZURE_LOCATION $Location | Out-Null
azd env set ENTRA_APP_ID $EntraAppId | Out-Null
azd env set VAULT_NAME $VaultName | Out-Null
azd env set VAULT_RG $VaultResourceGroup | Out-Null

# Populate the platform parameters before `azd up` so provisioning validation
# passes on a fresh environment (the preprovision hook runs too late for that).
& (Join-Path $PSScriptRoot 'preprovision.ps1')

azd up --no-prompt
