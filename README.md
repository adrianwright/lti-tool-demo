# LTI 1.3 Handshake POC

A minimal, self-contained proof that an LTI 1.3 tool can complete an OpenID
Connect launch and validate a platform-signed resource-link token. It proves:

- OIDC login initiation through `/login`
- state and nonce round-trip validation
- RS256 launch-token signature, issuer, audience, expiry, and deployment checks
- instructor role and course-context extraction
- routing to an authenticated tool page

The platform is synthetic and runs as the test script. The tool uses
[ltijs](https://cvmcosta.me/ltijs/), and MongoDB stores launch state and platform
registration data.

## Prerequisites

- Node.js 20 or later
- Docker with Docker Compose

## Run the POC

```sh
npm install
npm run setup
docker compose up --build -d
npm test
```

Expected result:

```text
PASS: complete LTI 1.3 OIDC launch handshake validated.
  state and nonce round-trip: yes
  platform JWT signature:    verified
  audience and deployment:   verified
  role and course context:    routed
```

Stop the local services with:

```sh
docker compose down
```

Run `npm run setup` again whenever you want a fresh platform identity and tool
encryption key. Generated keys and `.env` are intentionally ignored by Git.

## Run the POC on Azure

The same headless handshake can run against the tool hosted on Azure
Container Apps with Cosmos DB for MongoDB as the ltijs datastore. Deployment
uses [Azure Developer CLI](https://aka.ms/azd) (`azd`); the container image is
built remotely in Azure Container Registry, so **no local Docker is required**.
Cosmos is provisioned with public network access and key (connection-string)
auth so ltijs connects without a private endpoint. The synthetic platform
still runs locally as the test script and signs launches with the key from
`npm run setup`.

Prerequisites: `azd` and Azure CLI logged in to a subscription where public
network + local auth on Cosmos are permitted.

```powershell
./scripts/azd-up.ps1
npm test
```

`azd up` provisions [infra/main.bicep](infra/main.bicep), builds and pushes the
image via ACR remote build, and deploys the tool. Hooks bridge the synthetic
platform: [scripts/preprovision.ps1](scripts/preprovision.ps1) loads the
generated `.env` identity into the azd environment, and
[scripts/postprovision.ps1](scripts/postprovision.ps1) rewrites `TOOL_URL` in
`.env` to the Container App URL — so `npm test` exercises the full OIDC launch
against the cloud endpoint instead of `localhost`.

[scripts/azd-up.ps1](scripts/azd-up.ps1) pins the subscription (from `az
login`) and region so azd runs non-interactively.

Tear down with:

```powershell
azd down --purge --force
```

Because Container Apps ingress terminates TLS and forwards HTTP, the tool sets
Express `trust proxy` so ltijs still emits its `SameSite=None; Secure` state
cookie.

## Endpoints

| Purpose | URL |
| --- | --- |
| OIDC login initiation | `http://localhost:3000/login` |
| LTI launch | `http://localhost:3000/lti/launch` |
| Tool JWKS | `http://localhost:3000/keys` |
| Health check | `http://localhost:3000/healthz` |

## Scope

This repository intentionally stops at the handshake. It does not include an
LMS UI, iframe embedding, dynamic registration, LTI Advantage services, or a
learner experience. Those are separate integration steps and are not needed to
validate the core LTI 1.3 launch contract. Optional Azure infrastructure
(Container Apps + Cosmos DB for MongoDB) is included to prove the same
handshake against a hosted tool over HTTPS.

For a real LMS registration, expose the tool over stable HTTPS, replace the
synthetic platform settings with the LMS issuer/client/endpoints/JWKS, and set
an appropriate `Content-Security-Policy: frame-ancestors` policy.

## Fidelity vs. a real LMS

The handshake mirrors an LMS's LTI 1.3 launch (the standard four-step OIDC
flow) and the tool side is production-real: `ltijs` performs the same
validation an LMS requires — JWT signature, `iss`, `aud`, one-time `nonce`,
`exp`, `deployment_id`, and the `state` round-trip. The student launch token
carries LMS-shaped claims (`LtiResourceLinkRequest`, `roles` including
`membership#Learner`, `context`, `tool_platform`, `launch_presentation`).

It differs from a real LMS launch in these ways:

- The **platform is synthetic**: the test script signs the `id_token` with a
  local key registered directly on the tool (ltijs `RSA_KEY`), rather than
  the LMS signing it and publishing a JWKS. `iss` and `client_id` are
  placeholders, not a real LMS issuer and client registration.
- The LMS's **Step 2** authenticates the user's LMS session at its
  `authorize_redirect` endpoint; the simulation short-circuits that redirect
  because there is no real session to validate.
- The launch runs **top-level**, so the `state` cookie stays first-party. A
  real LMS launch renders in an **iframe**, where the third-party `state`
  cookie is blocked and the **LTI Platform Storage** `postMessage` flow
  (`lti_storage_target`) is required. That cookieless iframe path is not
  simulated here.