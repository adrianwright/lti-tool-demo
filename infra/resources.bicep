// LTI 1.3 handshake POC resources: ACR + Azure Container Apps + Cosmos (Mongo API).

@description('Azure region for all resources.')
param location string

@description('Unique token used to name globally-unique resources.')
param resourceToken string

@description('Tags applied to all resources.')
param tags object

@secure()
param ltiKey string
param platformUrl string
param platformClientId string
param platformAuthEndpoint string
param platformTokenEndpoint string
param platformPublicKey string

var databaseName = 'ltijs'
var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  #disable-next-line BCP334
  name: 'acr${resourceToken}'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: 'cosmos-${resourceToken}'
  location: location
  tags: tags
  kind: 'MongoDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    apiProperties: {
      serverVersion: '4.2'
    }
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
    capabilities: [
      {
        name: 'EnableMongo'
      }
    ]
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
  }
}

resource mongoDatabase 'Microsoft.DocumentDB/databaseAccounts/mongodbDatabases@2024-05-15' = {
  parent: cosmos
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

// Cosmos hands back a driver-ready string (ssl=true, retrywrites=false); inject the db name.
var cosmosConnectionString = cosmos.listConnectionStrings().connectionStrings[0].connectionString
var mongoUrl = replace(cosmosConnectionString, ':10255/?', ':10255/${databaseName}?')

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${resourceToken}'
  location: location
  tags: tags
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'log-${resourceToken}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${resourceToken}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// Placeholder public image; azd replaces it with the ACR build on deploy.
var placeholderImage = 'mcr.microsoft.com/k8se/quickstart:latest'

// Compute both app FQDNs from the environment domain to avoid a dependency cycle
// (each app needs to know the other's URL at provision time).
var toolAppName = 'ca-${resourceToken}'
var lmsAppName = 'lms-${resourceToken}'
var toolFqdn = 'https://${toolAppName}.${containerEnv.properties.defaultDomain}'
var lmsFqdn = 'https://${lmsAppName}.${containerEnv.properties.defaultDomain}'

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: toolAppName
  location: location
  tags: union(tags, {
    'azd-service-name': 'tool'
  })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: [
        {
          name: 'lti-key'
          value: ltiKey
        }
        {
          name: 'mongo-url'
          value: mongoUrl
        }
        {
          name: 'platform-public-key'
          value: platformPublicKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'tool'
          image: placeholderImage
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: [
            {
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'LTI_KEY'
              secretRef: 'lti-key'
            }
            {
              name: 'MONGO_URL'
              secretRef: 'mongo-url'
            }
            {
              name: 'PLATFORM_PUBLIC_KEY'
              secretRef: 'platform-public-key'
            }
            {
              name: 'PLATFORM_URL'
              value: platformUrl
            }
            {
              name: 'PLATFORM_CLIENT_ID'
              value: platformClientId
            }
            {
              name: 'PLATFORM_AUTH_ENDPOINT'
              value: platformAuthEndpoint
            }
            {
              name: 'PLATFORM_TOKEN_ENDPOINT'
              value: platformTokenEndpoint
            }
            {
              name: 'TOOL_URL'
              value: toolFqdn
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [
    mongoDatabase
  ]
}

// Let the container app pull images from ACR with its user-assigned identity.
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, identity.id, acrPullRoleId)
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// LMS simulator: LTI 1.3 platform (Dynamic Registration + launch UI).
resource lmsApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: lmsAppName
  location: location
  tags: union(tags, {
    'azd-service-name': 'lms'
  })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'lms'
          image: placeholderImage
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: [
            {
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'LMS_URL'
              value: lmsFqdn
            }
            {
              name: 'TOOL_URL'
              value: toolFqdn
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.properties.loginServer
output toolUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output lmsUrl string = 'https://${lmsApp.properties.configuration.ingress.fqdn}'
output webAppName string = containerApp.name
