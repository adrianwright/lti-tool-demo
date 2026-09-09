// Minimal LTI 1.3 Platform (LMS) simulator: Dynamic Registration + a real OIDC launch.
// Thin UI to (1) register the tool via LTI Dynamic Registration and (2) launch it as a
// student or instructor. State is in-memory (single replica).

import express from 'express';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, calculateJwkThumbprint, SignJWT } from 'jose';

const PORT = Number(process.env.PORT) || 3000;
const LMS_URL = (process.env.LMS_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const TOOL_URL = (process.env.TOOL_URL || 'http://localhost:3001').replace(/\/+$/, '');

// Platform signing key (id_tokens) — generated at boot, exposed via /jwks.
const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = await exportJWK(publicKey);
const kid = await calculateJwkThumbprint(publicJwk, 'sha256');
Object.assign(publicJwk, { kid, alg: 'RS256', use: 'sig' });

const claim = (name) => `https://purl.imsglobal.org/spec/lti/claim/${name}`;

// In-memory state.
let registeredTool = null;           // { clientId, deploymentId, initiateLoginUri, targetLinkUri, jwksUri, name }
const registrationTokens = new Set(); // one-time dynamic-registration tokens

const PERSONAS = {
  student: {
    sub: 'student-1', name: 'Sam Student', given_name: 'Sam', family_name: 'Student', email: 'sam@example.edu',
    roles: [
      'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
      'http://purl.imsglobal.org/vocab/lis/v2/institution/person#Student',
    ],
  },
  instructor: {
    sub: 'instructor-1', name: 'Ada Instructor', given_name: 'Ada', family_name: 'Instructor', email: 'ada@example.edu',
    roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
  },
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// OIDC / LTI platform discovery document.
app.get('/.well-known/openid-configuration', (req, res) => {
  res.json({
    issuer: LMS_URL,
    authorization_endpoint: `${LMS_URL}/authorize`,
    token_endpoint: `${LMS_URL}/token`,
    jwks_uri: `${LMS_URL}/jwks`,
    registration_endpoint: `${LMS_URL}/lti/register`,
    scopes_supported: ['openid'],
    response_types_supported: ['id_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    claims_supported: ['sub', 'iss', 'name', 'given_name', 'family_name', 'email'],
    'https://purl.imsglobal.org/spec/lti-platform-configuration': {
      product_family_code: 'lti-poc-lms',
      version: '1.3',
      messages_supported: [{ type: 'LtiResourceLinkRequest' }],
      variables: [],
    },
  });
});

app.get('/jwks', (req, res) => res.json({ keys: [publicJwk] }));

// Dynamic Registration endpoint — the tool POSTs its client metadata here.
app.post('/lti/register', (req, res) => {
  const auth = req.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!registrationTokens.has(token)) return res.status(401).json({ error: 'invalid_token' });
  registrationTokens.delete(token);

  const body = req.body || {};
  const toolConfig = body['https://purl.imsglobal.org/spec/lti-tool-configuration'] || {};
  const clientId = randomUUID();
  const deploymentId = '1';

  registeredTool = {
    clientId,
    deploymentId,
    initiateLoginUri: body.initiate_login_uri,
    targetLinkUri: toolConfig.target_link_uri,
    jwksUri: body.jwks_uri,
    redirectUris: body.redirect_uris || [],
    scope: body.scope || '',
    name: body.client_name || 'Tool',
  };

  // Echo the registration back with the assigned client_id (OIDC client registration response).
  res.status(201).json({
    ...body,
    client_id: clientId,
    'https://purl.imsglobal.org/spec/lti-tool-configuration': {
      ...toolConfig,
      deployment_id: deploymentId,
    },
  });
});

// Authorization endpoint — the tool redirects the browser here; we return an
// auto-posting form carrying a signed id_token back to the tool's launch URL.
app.get('/authorize', async (req, res) => {
  const { client_id, redirect_uri, login_hint, nonce, state } = req.query;
  if (!registeredTool || client_id !== registeredTool.clientId) {
    return res.status(400).send('Unknown client_id — register the tool first.');
  }
  const persona = PERSONAS[String(login_hint).startsWith('instructor') ? 'instructor' : 'student'];
  const now = Math.floor(Date.now() / 1000);

  const idToken = await new SignJWT({
    nonce,
    name: persona.name,
    given_name: persona.given_name,
    family_name: persona.family_name,
    email: persona.email,
    [claim('message_type')]: 'LtiResourceLinkRequest',
    [claim('version')]: '1.3.0',
    [claim('deployment_id')]: registeredTool.deploymentId,
    [claim('target_link_uri')]: registeredTool.targetLinkUri || redirect_uri,
    [claim('resource_link')]: { id: 'resource-1', title: 'Handshake POC' },
    [claim('roles')]: persona.roles,
    [claim('context')]: {
      id: 'course-101', label: 'LTI-POC-101', title: 'LTI POC Course',
      type: ['http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering'],
    },
    [claim('tool_platform')]: { guid: 'lti-poc-lms', name: 'LTI POC LMS' },
    [claim('launch_presentation')]: { document_target: 'iframe', return_url: LMS_URL },
  })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .setIssuer(LMS_URL)
    .setAudience(String(client_id))
    .setSubject(persona.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);

  res.send(`<!doctype html><html><body onload="document.forms[0].submit()">
    <form method="POST" action="${esc(redirect_uri)}">
      <input type="hidden" name="id_token" value="${esc(idToken)}">
      <input type="hidden" name="state" value="${esc(state)}">
    </form>
    <p>Signing in&hellip;</p>
  </body></html>`);
});

// Token endpoint stub (only needed for LTI Advantage services, not the launch).
app.post('/token', (req, res) => res.status(501).json({ error: 'not_implemented' }));

// Launch initiation — the UI sends the browser here; we kick off the tool's OIDC login.
app.get('/launch', (req, res) => {
  if (!registeredTool) return res.status(400).send('Register the tool first.');
  const role = req.query.role === 'instructor' ? 'instructor' : 'student';
  const params = new URLSearchParams({
    iss: LMS_URL,
    login_hint: `${role}-1`,
    client_id: registeredTool.clientId,
    lti_deployment_id: registeredTool.deploymentId,
    target_link_uri: registeredTool.targetLinkUri,
  });
  res.redirect(`${registeredTool.initiateLoginUri}?${params}`);
});

app.get('/status', (req, res) => res.json({
  registered: Boolean(registeredTool),
  clientId: registeredTool?.clientId || null,
  deploymentId: registeredTool?.deploymentId || null,
  toolName: registeredTool?.name || null,
}));

// Forget the current registration so Dynamic Registration can be run again.
app.post('/reset', (req, res) => { registeredTool = null; res.json({ ok: true }); });
app.get('/reset', (req, res) => { registeredTool = null; res.redirect('/'); });

// Thin UI.
app.get('/', (req, res) => {
  const token = randomUUID();
  registrationTokens.add(token);
  const openidConfigUrl = `${LMS_URL}/.well-known/openid-configuration`;
  const reg = registeredTool;
  const keyRow = reg ? `
    <div class="key">
      <div class="key-head">
        <span class="dot"></span>
        <strong>${esc(reg.name)}</strong>
        <span class="badge on">Enabled</span>
      </div>
      <dl>
        <dt>Client ID</dt><dd><code>${esc(reg.clientId)}</code></dd>
        <dt>Deployment ID</dt><dd><code>${esc(reg.deploymentId)}</code></dd>
        <dt>Redirect URIs</dt><dd><code>${esc((reg.redirectUris || []).join(', '))}</code></dd>
        <dt>Target link URI</dt><dd><code>${esc(reg.targetLinkUri)}</code></dd>
        <dt>Login initiation</dt><dd><code>${esc(reg.initiateLoginUri)}</code></dd>
        <dt>Public JWKS</dt><dd><code>${esc(reg.jwksUri)}</code></dd>
        <dt>Scopes</dt><dd><code>${esc(reg.scope || '(none)')}</code></dd>
      </dl>
      <div class="actions">
        <button class="ghost" onclick="launch('student')">Launch as Student</button>
        <button class="ghost" onclick="launch('instructor')">Launch as Instructor</button>
        <button class="ghost" onclick="forget()">Forget registration</button>
      </div>
    </div>` : `
    <div class="empty">
      <p>No LTI keys yet.</p>
      <button class="primary" onclick="toggleForm()">+ LTI Registration (Dynamic)</button>
      <form id="regForm" class="regform" onsubmit="return startRegister(event)">
        <label>Tool Registration URL</label>
        <input id="regUrl" value="${esc(TOOL_URL)}/register" spellcheck="false">
        <p class="hint">The LMS appends its <code>openid_configuration</code> and a one-time
          <code>registration_token</code>, then opens the tool's registration screen.</p>
        <button class="primary" type="submit">Register</button>
      </form>
    </div>`;

  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>LMS Admin — Developer Keys (LTI 1.3)</title>
<style>
  body { font-family: "Segoe UI", system-ui, sans-serif; margin: 0; background: #f7f4ef; color: #242424; }
  main { max-width: 720px; margin: 2.5rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.35rem; margin-bottom: .1rem; }
  .sub { color: #5c5c5c; margin-top: 0; font-size: .92rem; }
  .panel { background: #fff; border: 1px solid #dedede; border-radius: 14px; box-shadow: 0 1px 2px rgba(0,0,0,.12); overflow: hidden; }
  .panel-head { padding: .9rem 1.25rem; border-bottom: 1px solid #ededed; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
  .panel-head .muted { color: #5c5c5c; font-weight: 400; font-size: .85rem; }
  .empty, .key { padding: 1.25rem; }
  .empty p { color: #5c5c5c; }
  button { font: inherit; border: 0; border-radius: 8px; padding: .55rem 1.1rem; margin: .2rem .4rem .2rem 0; cursor: pointer; }
  .primary { background: #b11f4b; color: #fff; } .ghost { background: #f0f0f0; color: #242424; border: 1px solid #dedede; }
  .regform { display: none; margin-top: 1rem; max-width: 520px; }
  .regform.show { display: block; }
  label { display: block; font-size: .78rem; font-weight: 600; margin: .4rem 0 .2rem; }
  input { width: 100%; font: inherit; padding: .45rem .55rem; border: 1px solid #dedede; border-radius: 8px; box-sizing: border-box; }
  .hint { color: #5c5c5c; font-size: .8rem; margin: .35rem 0 .6rem; }
  .key-head { display: flex; align-items: center; gap: .5rem; font-size: 1.05rem; margin-bottom: .6rem; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #16a34a; display: inline-block; }
  .badge { font-size: .7rem; font-weight: 700; padding: .1rem .5rem; border-radius: 999px; }
  .badge.on { background: rgba(22,163,74,.12); color: #16a34a; }
  dl { display: grid; grid-template-columns: 9.5rem 1fr; gap: .25rem .75rem; margin: .5rem 0 0; font-size: .9rem; }
  dt { color: #5c5c5c; } dd { margin: 0; word-break: break-all; }
  code { font-size: .85em; }
  .actions { margin-top: 1rem; }
  #toast { position: fixed; top: 1rem; left: 50%; transform: translateX(-50%); background: #242424; color: #fff; padding: .5rem 1rem; border-radius: 8px; font-size: .85rem; display: none; }
</style>
</head>
<body>
<div id="toast"></div>
<main>
  <h1>Developer Keys <span class="sub">· LTI 1.3</span></h1>
  <p class="sub">LMS admin view. Register an external tool with <strong>LTI Dynamic Registration</strong>, then launch it.</p>
  <div class="panel">
    <div class="panel-head"><span>LTI Registrations</span><span class="muted">${esc(LMS_URL)}</span></div>
    ${keyRow}
  </div>
</main>
<script>
  const OPENID_CONFIG = ${JSON.stringify(openidConfigUrl)};
  const REG_TOKEN = ${JSON.stringify(token)};
  function toggleForm() { document.getElementById('regForm').classList.toggle('show'); }
  function toast(t) { const el = document.getElementById('toast'); el.textContent = t; el.style.display = 'block'; }
  function finish(w) { try { w && w.close(); } catch (_) {} location.reload(); }
  function startRegister(e) {
    e.preventDefault();
    const base = document.getElementById('regUrl').value.trim();
    const url = base + '?openid_configuration=' + encodeURIComponent(OPENID_CONFIG) + '&registration_token=' + encodeURIComponent(REG_TOKEN);
    const w = window.open(url, 'ltireg', 'width=580,height=620');
    toast('Registration window opened — review and click Register…');
    const onMsg = (ev) => {
      if (ev.data && ev.data.subject === 'org.imsglobal.lti.close') {
        window.removeEventListener('message', onMsg);
        toast('Registered ✓');
        finish(w);
      }
    };
    window.addEventListener('message', onMsg);
    // Fallback: poll status in case the postMessage is missed.
    let tries = 0;
    const iv = setInterval(async () => {
      tries += 1;
      try {
        const s = await (await fetch('/status')).json();
        if (s.registered) { clearInterval(iv); window.removeEventListener('message', onMsg); toast('Registered ✓'); finish(w); }
      } catch (_) {}
      if (tries > 40) clearInterval(iv);
    }, 1500);
    return false;
  }
  function launch(role) { window.open('/launch?role=' + role, '_blank'); }
  async function forget() { await fetch('/reset', { method: 'POST' }); location.reload(); }
</script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`LMS simulator on :${PORT}  (LMS_URL=${LMS_URL}, TOOL_URL=${TOOL_URL})`);
});
