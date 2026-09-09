'use strict';

const { Provider: lti } = require('ltijs');

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const port = Number(process.env.PORT) || 3000;
const toolUrl = process.env.TOOL_URL;

// Optional static platform (used by the headless/browser scripts).
const platformPublicKeyRaw = process.env.PLATFORM_PUBLIC_KEY;
const platformPublicKey = platformPublicKeyRaw
  ? (platformPublicKeyRaw.includes('BEGIN')
    ? platformPublicKeyRaw
    : Buffer.from(platformPublicKeyRaw, 'base64').toString('utf8'))
  : null;

const devMode = process.env.LTI_DEV_MODE === 'true';
const setupOptions = {
  appRoute: '/lti/launch',
  loginRoute: '/login',
  keysetRoute: '/keys',
  // Local http needs a non-secure, same-site cookie; cloud uses Secure + SameSite=None.
  cookies: { secure: !devMode, sameSite: devMode ? 'Lax' : 'None' },
  devMode,
};

// Enable LTI Dynamic Registration when the tool knows its own public URL.
if (toolUrl) {
  setupOptions.dynReg = {
    url: toolUrl,
    name: 'LTI POC Tool',
    autoActivate: true,
  };
}

lti.setup(required('LTI_KEY'), { url: required('MONGO_URL') }, setupOptions);

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

lti.onConnect(async (token, request, response) => {
  const context = token.platformContext || {};
  const user = token.userInfo || {};
  const roles = context.roles || [];
  // Display the role the platform asserted; the handshake itself is role-agnostic.
  const roleLabel = roles.length ? roles.map((role) => role.split(/[#/]/).pop()).join(', ') : '(none)';
  const name = user.name || context.name || token.user;
  const courseId = context.context?.id;
  const courseTitle = context.context?.title || courseId;
  const deployment = token.deploymentId || context.deploymentId;

  return response.status(200).send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Study Assistant</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; background: #f2efe9; color: #1f1f1f; }
  .app { max-width: 760px; margin: 0 auto; min-height: 100vh; display: flex; flex-direction: column; background: #fbf9f5; border-left: 1px solid #e6e2da; border-right: 1px solid #e6e2da; }
  .bar { display: flex; align-items: center; justify-content: space-between; padding: .85rem 1.15rem; border-bottom: 1px solid #e6e2da; background: #fff; }
  .brand { display: flex; align-items: center; gap: .6rem; font-weight: 600; }
  .avatar { width: 32px; height: 32px; border-radius: 50%; background: #b11f4b; color: #fff; display: grid; place-items: center; font-size: .8rem; font-weight: 700; }
  .pill { font-size: .72rem; font-weight: 600; color: #16a34a; background: rgba(22,163,74,.12); padding: .2rem .6rem; border-radius: 999px; }
  .chat { flex: 1; padding: 1.5rem 1.15rem; overflow-y: auto; }
  .msg { display: flex; gap: .7rem; max-width: 90%; margin-bottom: 1rem; }
  .msg .avatar { flex: 0 0 auto; }
  .bubble { background: #fff; border: 1px solid #e6e2da; border-radius: 4px 14px 14px 14px; padding: .85rem 1rem; box-shadow: 0 1px 1px rgba(0,0,0,.05); }
  .bubble p { margin: 0 0 .6rem; line-height: 1.5; } .bubble p:last-child { margin-bottom: 0; }
  .ctx { display: grid; grid-template-columns: 7rem 1fr; gap: .3rem .8rem; margin: .75rem 0; padding: .75rem .9rem; background: #f7f4ef; border: 1px solid #ece7de; border-radius: 10px; font-size: .9rem; }
  .ctx dt { color: #6f6f6f; } .ctx dd { margin: 0; font-weight: 600; }
  .fine { color: #6f6f6f; font-size: .88rem; }
  .composer { border-top: 1px solid #e6e2da; padding: .8rem 1.15rem; background: #fff; }
  .composer .row { display: flex; gap: .5rem; }
  .composer input { flex: 1; font: inherit; padding: .6rem .8rem; border: 1px solid #dcd7cd; border-radius: 10px; background: #f7f4ef; color: #9a948a; }
  .composer button { font: inherit; border: 0; border-radius: 10px; padding: .6rem 1.2rem; background: #b11f4b; color: #fff; opacity: .5; cursor: not-allowed; }
  .demo-note { margin: .5rem 0 0; font-size: .75rem; color: #9a948a; text-align: center; }
</style>
</head>
<body>
<div class="app">
  <header class="bar">
    <div class="brand"><span class="avatar">AI</span> Study Assistant</div>
    <span class="pill">LTI 1.3 handshake complete</span>
  </header>
  <main class="chat">
    <div class="msg">
      <div class="avatar">AI</div>
      <div class="bubble">
        <p>Hi ${escapeHtml(name)}, I'm your study assistant for <strong>${escapeHtml(courseTitle)}</strong>.</p>
        <p>You're signed in securely through your LMS as <strong>${escapeHtml(roleLabel)}</strong> — no separate login needed. Here's the context your course sent me:</p>
        <dl class="ctx">
          <dt>User</dt><dd>${escapeHtml(name)}</dd>
          <dt>Course</dt><dd>${escapeHtml(courseId)}</dd>
          <dt>Deployment</dt><dd>${escapeHtml(deployment)}</dd>
          <dt>Role</dt><dd>${escapeHtml(roleLabel)}</dd>
        </dl>
        <p class="fine">Ask me anything about your assignments and I'll tailor help to this course.</p>
      </div>
    </div>
  </main>
  <footer class="composer">
    <div class="row">
      <input disabled placeholder="Ask about your homework…">
      <button disabled>Send</button>
    </div>
    <p class="demo-note">Demo — the assistant is not wired to a model.</p>
  </footer>
</div>
</body>
</html>`);
});

const TOOL_NAME = 'LTI POC Tool';
const DEFAULT_SCOPES = [
  'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
  'https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly',
  'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly',
].join(' ');

// The review screen an LMS admin sees in the registration modal — mirrors the
// tool-controlled step of LTI Dynamic Registration.
const reviewForm = (o) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Register tool</title>
<style>
  body { font-family: "Segoe UI", system-ui, sans-serif; margin: 0; background: #f7f4ef; color: #242424; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 1.25rem 1.4rem; }
  h1 { font-size: 1.15rem; margin: .2rem 0 .15rem; }
  .muted { color: #5c5c5c; font-size: .85rem; margin-top: 0; }
  label { display: block; font-size: .78rem; font-weight: 600; margin: .75rem 0 .2rem; }
  input, textarea { width: 100%; font: inherit; padding: .45rem .55rem; border: 1px solid #dedede; border-radius: 8px; box-sizing: border-box; }
  textarea { min-height: 3.4rem; font-size: .8rem; }
  .ro { background: #f2f2f2; color: #5c5c5c; }
  .btns { margin-top: 1.1rem; display: flex; gap: .5rem; }
  button { font: inherit; border: 0; border-radius: 8px; padding: .55rem 1.1rem; cursor: pointer; }
  .primary { background: #b11f4b; color: #fff; } .ghost { background: #eee; color: #242424; }
</style></head>
<body><div class="wrap">
  <h1>Install &ldquo;${escapeHtml(o.name)}&rdquo;</h1>
  <p class="muted">Registering with <strong>${escapeHtml(o.platformName)}</strong>. Review the configuration the tool will send, then Register.</p>
  <form method="GET" action="/register">
    <input type="hidden" name="openid_configuration" value="${escapeHtml(o.openidConfig)}">
    <input type="hidden" name="registration_token" value="${escapeHtml(o.regToken || '')}">
    <input type="hidden" name="confirm" value="1">
    <label>Tool name</label>
    <input name="client_name" value="${escapeHtml(o.name)}">
    <label>Target link URI (launch)</label>
    <input name="target_link_uri" value="${escapeHtml(o.launchUri)}">
    <label>Requested scopes</label>
    <textarea name="scope">${escapeHtml(o.scopes)}</textarea>
    <label>OIDC login initiation <span class="muted">— fixed</span></label>
    <input class="ro" readonly value="${escapeHtml(o.loginUri)}">
    <label>Public JWKS <span class="muted">— fixed</span></label>
    <input class="ro" readonly value="${escapeHtml(o.jwksUri)}">
    <label>Redirect URI <span class="muted">— fixed</span></label>
    <input class="ro" readonly value="${escapeHtml(o.launchUri)}">
    <div class="btns">
      <button class="primary" type="submit">Register</button>
      <button class="ghost" type="button" onclick="window.close()">Cancel</button>
    </div>
  </form>
</div></body></html>`;

// Custom Dynamic Registration handler: show a review screen (GET), then register (confirm).
if (toolUrl) {
  lti.onDynamicRegistration(async (req, res) => {
    try {
      const openidConfig = req.query.openid_configuration;
      const regToken = req.query.registration_token;
      if (!openidConfig) return res.status(400).send('Missing openid_configuration.');

      if (!req.query.confirm) {
        let platformName = 'the platform';
        try {
          const cfg = await (await fetch(openidConfig)).json();
          platformName = cfg['https://purl.imsglobal.org/spec/lti-platform-configuration']?.product_family_code || cfg.issuer || platformName;
        } catch { /* show the form anyway */ }
        return res.send(reviewForm({
          name: TOOL_NAME,
          platformName,
          openidConfig,
          regToken,
          loginUri: `${toolUrl}/login`,
          jwksUri: `${toolUrl}/keys`,
          launchUri: `${toolUrl}/lti/launch`,
          scopes: DEFAULT_SCOPES,
        }));
      }

      const q = req.query;
      const options = {};
      if (q.client_name) options.client_name = q.client_name;
      if (q.scope) options.scope = q.scope;
      const toolConfig = {};
      if (q.target_link_uri) toolConfig.target_link_uri = q.target_link_uri;
      if (Object.keys(toolConfig).length) options['https://purl.imsglobal.org/spec/lti-tool-configuration'] = toolConfig;

      const message = await lti.DynamicRegistration.register(openidConfig, regToken, options);
      return res.send(message);
    } catch (err) {
      if (err.message === 'PLATFORM_ALREADY_REGISTERED') {
        return res.send('<script>(window.opener||window.parent).postMessage({subject:"org.imsglobal.lti.close"},"*");</script><p>Already registered.</p>');
      }
      return res.status(500).send(`Registration error: ${escapeHtml(err.message)}`);
    }
  });
}

async function main() {
  // App Service terminates TLS and forwards HTTP with X-Forwarded-Proto; trust it
  // so Express marks the request secure and ltijs emits its SameSite=None; Secure cookie.
  lti.app.set('trust proxy', 1);

  lti.app.get('/healthz', (request, response) => response.status(200).json({ status: 'ok' }));
  lti.whitelist('/healthz');

  await lti.deploy({ port });

  // Register the optional static platform (RSA key) for the headless/browser scripts.
  if (platformPublicKey && process.env.PLATFORM_URL && process.env.PLATFORM_CLIENT_ID
    && process.env.PLATFORM_AUTH_ENDPOINT && process.env.PLATFORM_TOKEN_ENDPOINT) {
    await lti.registerPlatform({
      url: process.env.PLATFORM_URL,
      name: 'Local POC Platform',
      clientId: process.env.PLATFORM_CLIENT_ID,
      authenticationEndpoint: process.env.PLATFORM_AUTH_ENDPOINT,
      accesstokenEndpoint: process.env.PLATFORM_TOKEN_ENDPOINT,
      authConfig: { method: 'RSA_KEY', key: platformPublicKey },
    });
    console.log('Registered static platform.');
  }

  if (toolUrl) console.log(`Dynamic Registration enabled at ${toolUrl}/register`);
  console.log(`LTI tool listening on port ${port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});