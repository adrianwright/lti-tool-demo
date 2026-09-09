// LTI 1.3 handshake POC — azd entry point (subscription scope).
// Creates the resource group, then provisions App Service + ACR + Cosmos (Mongo API).

targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment; names the resource group and tags resources.')
param environmentName string

@minLength(1)
@description('Azure region for all resources.')
param location string

@secure()
@description('ltijs cookie/state encryption key.')
param ltiKey string

@description('Platform issuer (iss) the launch token is signed with.')
param platformUrl string

@description('The tool client_id at the platform (launch aud).')
param platformClientId string

@description('Platform OIDC authorization endpoint (placeholder for RSA_KEY auth).')
param platformAuthEndpoint string

@description('Platform OAuth2 token endpoint (placeholder for RSA_KEY auth).')
param platformTokenEndpoint string

@description('Base64-encoded platform public key (PEM) used to verify launches.')
param platformPublicKey string

@description('Entra application (client) ID that gates the LMS simulator with built-in auth (Easy Auth).')
param entraAppId string

@description('Name of the Key Vault (in secretsResourceGroup) holding the Entra client secret.')
param keyVaultName string

@description('Resource group of the Key Vault holding the Entra client secret.')
param vaultResourceGroup string

var tags = {
  'azd-env-name': environmentName
}
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: environmentName
  location: location
  tags: union(tags, {
    SecurityControl: 'ignore'
  })
}

module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    resourceToken: resourceToken
    tags: tags
    ltiKey: ltiKey
    platformUrl: platformUrl
    platformClientId: platformClientId
    platformAuthEndpoint: platformAuthEndpoint
    platformTokenEndpoint: platformTokenEndpoint
    platformPublicKey: platformPublicKey
    entraAppId: entraAppId
    keyVaultName: keyVaultName
    vaultResourceGroup: vaultResourceGroup
  }
}

output AZURE_LOCATION string = location
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT
output AZURE_TOOL_URL string = resources.outputs.toolUrl
output AZURE_LMS_URL string = resources.outputs.lmsUrl
output SERVICE_TOOL_NAME string = resources.outputs.webAppName
