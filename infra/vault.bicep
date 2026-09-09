// Key Vault (separate resource group) holding the Entra app id + client secret
// for the LMS simulator's Easy Auth. Upserted by scripts/azd-up.ps1 before azd up.

targetScope = 'resourceGroup'

@description('Azure region for the vault.')
param location string

@description('Globally-unique Key Vault name.')
param keyVaultName string

@description('Entra application (client) ID.')
param entraAppId string

@secure()
@description('Entra client secret.')
param entraClientSecret string

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: tenant().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource appIdSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'entra-app-id'
  properties: {
    value: entraAppId
  }
}

resource clientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'entra-client-secret'
  properties: {
    value: entraClientSecret
  }
}

output vaultName string = vault.name
output vaultUri string = vault.properties.vaultUri
