'use strict';

const { Provider: lti } = require('ltijs');

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const port = Number(process.env.PORT) || 3000;
const platformPublicKeyRaw = required('PLATFORM_PUBLIC_KEY');
const platformPublicKey = platformPublicKeyRaw.includes('BEGIN')
  ? platformPublicKeyRaw
  : Buffer.from(platformPublicKeyRaw, 'base64').toString('utf8');

lti.setup(
  required('LTI_KEY'),
  { url: required('MONGO_URL') },
  {
    appRoute: '/lti/launch',
    loginRoute: '/login',
    keysetRoute: '/keys',
    cookies: { secure: true, sameSite: 'None' },
    devMode: false,
  },
);

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

  return response.status(200).send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>LTI Handshake Complete</title></head>
<body>
  <main>
    <h1>LTI 1.3 handshake complete</h1>
    <dl>
      <dt>User</dt><dd>${escapeHtml(user.name || context.name || token.user)}</dd>
      <dt>Course</dt><dd>${escapeHtml(context.context?.id)}</dd>
      <dt>Deployment</dt><dd>${escapeHtml(token.deploymentId || context.deploymentId)}</dd>
      <dt>Role</dt><dd>${escapeHtml(roleLabel)}</dd>
    </dl>
  </main>
</body>
</html>`);
});

async function main() {
  // App Service terminates TLS and forwards HTTP with X-Forwarded-Proto; trust it
  // so Express marks the request secure and ltijs emits its SameSite=None; Secure cookie.
  lti.app.set('trust proxy', 1);

  lti.app.get('/healthz', (request, response) => response.status(200).json({ status: 'ok' }));
  lti.whitelist('/healthz');

  await lti.deploy({ port });
  await lti.registerPlatform({
    url: required('PLATFORM_URL'),
    name: 'Local POC Platform',
    clientId: required('PLATFORM_CLIENT_ID'),
    authenticationEndpoint: required('PLATFORM_AUTH_ENDPOINT'),
    accesstokenEndpoint: required('PLATFORM_TOKEN_ENDPOINT'),
    authConfig: { method: 'RSA_KEY', key: platformPublicKey },
  });
  console.log(`LTI tool listening on port ${port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});