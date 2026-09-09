// Grants a managed identity read access to the Key Vault's secrets. Deployed as a
// module scoped to the vault's (separate) resource group.

targetScope = 'resourceGroup'

@description('Key Vault name in this resource group.')
param keyVaultName string

@description('Principal (managed identity) to grant Key Vault Secrets User.')
param principalId string

// Key Vault Secrets User: read secret contents (data plane) via RBAC.
var secretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, principalId, secretsUserRoleId)
  properties: {
    roleDefinitionId: secretsUserRoleId
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
