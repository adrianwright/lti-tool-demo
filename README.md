# LTI 1.3 Handshake POC

A self-contained proof of the LTI 1.3 launch contract: an **LTI tool** (built on
[ltijs](https://cvmcosta.me/ltijs/)) that an LMS registers via **Dynamic
Registration** and launches over OpenID Connect. It ships with a **minimal LMS
simulator** so the whole flow — registration *and* a real signed launch — runs
end to end with no external LMS.

It demonstrates:

- **Dynamic Registration** — the tool and platform exchange configuration
  automatically and the platform mints the `client_id`.
- **OIDC launch** — login initiation, state/nonce round-trip, and RS256
  `id_token` validation (signature, issuer, audience, expiry, deployment),
  with role and course-context extraction.
- **Role-aware rendering** — the tool renders whatever role the token asserts
  (student or instructor) as an AI study-assistant chat that surfaces the LTI
  context.

There are two ways to drive the tool:

- **LMS simulator** (`lms/`) — a real LTI 1.3 platform: `openid-configuration`,
  JWKS, a registration endpoint, an authorize endpoint that signs `id_token`s,
  and a thin admin UI to register and launch.
- **Synthetic scripts** — headless/browser drivers that sign a launch directly
  against the tool (no LMS needed), for fast CI-style proofs.

**MongoDB** (local) / **Cosmos DB for MongoDB** (Azure) stores registrations and
launch state.

> [!WARNING]
> This repository is a demonstration only and is not intended for use in
> production systems as-is.

## Components

| Part | Path | Role |
| --- | --- | --- |
| Tool | [server.js](server.js) | ltijs LTI 1.3 tool: `/login`, `/lti/launch`, `/keys`, `/register`, `/healthz` |
| LMS simulator | [lms/server.js](lms/server.js) | LTI 1.3 platform: `openid-configuration`, `/jwks`, `/lti/register`, `/authorize`, `/launch`, admin UI |
| Store | Docker Mongo / Cosmos | ltijs registrations + nonce/state |

## Prerequisites

- Node.js 20 or later
- Docker (for local MongoDB) — or your own MongoDB on `localhost:27017`
- For Azure deployment: [Azure Developer CLI](https://aka.ms/azd) (`azd`) + Azure CLI

## Run locally

One command starts MongoDB (Docker), the tool, and the LMS simulator:

```powershell
npm install
npm run local
```

Then open the **LMS simulator** at <http://localhost:4000>:

1. **Register tool (Dynamic Registration)** — review the tool's *Install* screen, click **Register**.
2. **Launch as Student / Instructor** — the tool opens as an AI study-assistant chat showing the LTI context.

Re-run registration anytime with the LMS **Forget registration** button or
`npm run reset`. Close the two app windows to stop; `docker compose down` stops Mongo.

Headless proofs (no browser):

```powershell
npm test             # signed launch against the tool (synthetic static platform)
npm run test:dynreg  # Dynamic Registration + launch through the LMS simulator
npm run demo         # visual single-service launch in a real browser (Playwright)
```

`npm run local` runs the tool with `LTI_DEV_MODE=true` (relaxed cookies) so the
browser launch works over plain `http://localhost`.

## Run on Azure

`azd` deploys the tool **and** the LMS simulator as two Azure Container Apps,
with Cosmos DB for MongoDB as the store. Images build remotely in Azure
Container Registry, so **no local Docker is required**.

```powershell
./scripts/azd-up.ps1
npm run test:dynreg      # or open the LMS URL and click through
```

- [scripts/azd-up.ps1](scripts/azd-up.ps1) pins the subscription (from `az login`)
  and region so azd runs non-interactively.
- Hooks bridge the synthetic identity:
  [scripts/preprovision.ps1](scripts/preprovision.ps1) loads it into the azd
  environment; [scripts/postprovision.ps1](scripts/postprovision.ps1) points
  `TOOL_URL` at the deployed tool.
- Get the URLs with `azd env get-value AZURE_TOOL_URL` and `AZURE_LMS_URL`.

Tear down with:

```powershell
azd down --purge --force
```

Cosmos is provisioned with public network access and key (connection-string)
auth. Some tenants enforce a policy that re-disables public network on the
account; if a launch hangs, re-enable public network and restart the tool's
container revision. Because Container Apps ingress terminates TLS, the tool sets
Express `trust proxy` so ltijs still emits its `SameSite=None; Secure` cookie.

## npm scripts

| Script | Purpose |
| --- | --- |
| `setup` | Generate a synthetic platform key + `.env` |
| `local` | Run the tool + LMS simulator + Mongo locally |
| `test` | Headless signed launch (static synthetic platform) |
| `test:dynreg` | Headless Dynamic Registration + launch (LMS simulator) |
| `demo` | Visual browser launch (Playwright) |
| `reset` | Clear the LMS simulator's registration |
| `start` | Run the tool alone |
| `check` | Syntax-check the sources |

## Endpoints

| | Tool | LMS simulator |
| --- | --- | --- |
| UI / launch page | `/lti/launch` | `/` (admin), `/launch` |
| OIDC | `/login`, `/keys` | `/.well-known/openid-configuration`, `/authorize`, `/jwks` |
| Registration | `/register` | `/lti/register` |
| Ops | `/healthz` | `/reset`, `/status` |

## Two registration paths

- **Static** — the tool registers a synthetic platform at boot from `PLATFORM_*`
  env (an RSA public key). The synthetic scripts sign launches against it. Fast,
  no LMS required (`npm test`, `npm run demo`).
- **Dynamic** — the LMS simulator drives LTI Dynamic Registration: the tool
  fetches the LMS `openid-configuration` and POSTs its client metadata; the LMS
  mints a `client_id`. This mirrors how a real LMS admin onboards a tool
  (`npm run test:dynreg`, or the LMS admin UI).

## Fidelity vs. a real LMS

The tool side is production-real: `ltijs` enforces the same validation an LMS
requires — JWT signature (via JWKS), `iss`, `aud`, one-time `nonce`, `exp`,
`deployment_id`, and the `state` round-trip. With the **LMS simulator** the
launch is a genuine OIDC browser-redirect flow (login → authorize →
platform-signed `id_token` → JWKS-verified), and registration is real LTI
Dynamic Registration.

It differs from a real LMS in these ways:

- The LMS simulator does not authenticate a real user session — its authorize
  endpoint issues the `id_token` immediately, whereas a real LMS validates the
  signed-in user.
- Launches run **top-level**, so the `state` cookie stays first-party. A real
  LMS renders the tool in an **iframe**, where third-party-cookie blocking
  requires the **LTI Platform Storage** (`lti_storage_target`) `postMessage`
  flow — not reproduced here.
- The synthetic-script mode additionally short-circuits the authorize redirect
  (it signs the token directly) and uses placeholder `iss`/`client_id`.

## Walkthrough

Open [demo.html](demo.html) for an illustrated walkthrough: architecture, the
Dynamic Registration and launch sequence diagrams, a field-by-field glossary,
and the authentication model.
