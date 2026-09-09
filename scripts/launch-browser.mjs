// Visual LTI 1.3 launch: opens a real browser and renders the authenticated
// handshake page. Same flow as scripts/launch.mjs, but driven through a headed
// Chromium so the launch lands TOP-LEVEL (first-party) and the state cookie set
// during /login rides along in the browser's own context -- which is what an LMS
// iframe cannot do (the MISSING_VALIDATION_COOKIE problem). We intercept ltijs's
// redirect to the synthetic platform, mint the platform-signed id_token
// ourselves, then auto-POST it to /lti/launch from the browser.
//
// Usage: node scripts/launch-browser.mjs

import { chromium } from 'playwright';
import { SignJWT } from 'jose';
import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const toolUrl = env.TOOL_URL.replace(/\/+$/, '');
const launchUrl = `${toolUrl}/lti/launch`;
const authEndpoint = env.PLATFORM_AUTH_ENDPOINT;

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function signIdToken(nonce) {
  const now = Math.floor(Date.now() / 1000);
  const claim = (name) => `https://purl.imsglobal.org/spec/lti/claim/${name}`;
  return new SignJWT({
    nonce,
    name: 'Sam Student',
    given_name: 'Sam',
    family_name: 'Student',
    email: 'sam@example.edu',
    [claim('message_type')]: 'LtiResourceLinkRequest',
    [claim('version')]: '1.3.0',
    [claim('deployment_id')]: env.LTI_DEPLOYMENT_ID,
    [claim('target_link_uri')]: launchUrl,
    [claim('resource_link')]: { id: 'resource-1', title: 'Handshake POC' },
    [claim('roles')]: [
      'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
      'http://purl.imsglobal.org/vocab/lis/v2/institution/person#Student',
    ],
    [claim('context')]: {
      id: 'course-101',
      label: 'LTI-POC-101',
      title: 'LTI POC Course',
      type: ['http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering'],
    },
    [claim('tool_platform')]: { guid: 'lti-poc-platform', name: 'LTI POC Platform' },
    [claim('launch_presentation')]: { document_target: 'iframe', return_url: `${env.PLATFORM_URL}/return` },
  })
    .setProtectedHeader({ alg: 'RS256', kid: env.LTI_KID, typ: 'JWT' })
    .setIssuer(env.PLATFORM_URL)
    .setAudience(env.PLATFORM_CLIENT_ID)
    .setSubject('student-1')
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(createPrivateKey(readFileSync(join(root, '.platform-key.pem'))));
}

async function main() {
  console.log(`\nOpening a browser and launching a student LTI resource against ${toolUrl}...`);

  const browser = await chromium.launch({ headless: false, slowMo: 250 });
  const context = await browser.newContext({ viewport: { width: 900, height: 720 } });
  const page = await context.newPage();

  // Intercept ltijs's redirect to the synthetic platform auth endpoint: capture
  // state + nonce and abort (we ARE the platform, so we never actually go there).
  let authUrl = null;
  const isAuth = (url) => url.startsWith(authEndpoint);
  const capture = (url) => { if (!authUrl && isAuth(url)) authUrl = url; };
  context.on('request', (req) => capture(req.url()));
  await context.route((url) => isAuth(url.href), (route) => {
    capture(route.request().url());
    route.abort();
  });

  // Step 1: OIDC login initiation, top-level -> sets the state cookie in-browser.
  const loginParameters = new URLSearchParams({
    iss: env.PLATFORM_URL,
    login_hint: 'student-1',
    target_link_uri: launchUrl,
    client_id: env.PLATFORM_CLIENT_ID,
    lti_deployment_id: env.LTI_DEPLOYMENT_ID,
  });
  const authRequest = context
    .waitForEvent('request', { predicate: (r) => isAuth(r.url()), timeout: 20000 })
    .catch(() => null);
  await page.goto(`${toolUrl}/login?${loginParameters}`, { waitUntil: 'commit' }).catch(() => {});
  const request = await authRequest;
  if (request) capture(request.url());
  if (!authUrl) throw new Error('Did not capture the platform auth redirect from /login.');

  const parsed = new URL(authUrl.replace(/&amp;/g, '&'));
  const state = parsed.searchParams.get('state');
  const nonce = parsed.searchParams.get('nonce');
  const cookies = await context.cookies(toolUrl);
  console.log(`  login: state+nonce captured, ${cookies.length} tool cookie(s) in the browser.`);
  if (!state || !nonce) throw new Error('Missing state/nonce in the auth redirect.');

  // Step 2: mint the platform-signed id_token echoing the nonce.
  const idToken = await signIdToken(nonce);

  // Step 3: auto-POST the launch from the browser (top-level nav, cookie rides along).
  const formHtml = `<!doctype html><html><body style="font-family:system-ui;padding:2rem;color:#334">
    <p>Submitting LTI launch to the tool&hellip;</p>
    <form id="f" method="POST" action="${escapeAttr(launchUrl)}">
      <input type="hidden" name="id_token" value="${escapeAttr(idToken)}">
      <input type="hidden" name="state" value="${escapeAttr(state)}">
    </form>
    <script>document.getElementById('f').submit();</script>
  </body></html>`;
  await page.setContent(formHtml, { waitUntil: 'load' });

  await page.waitForSelector('text=LTI 1.3 handshake complete', { timeout: 30000 });
  console.log('  launched: the authenticated handshake page rendered in the browser.');
  console.log('\nBrowser is open. Review the launch claims, then close the window to end.');
  await page.waitForEvent('close', { timeout: 0 }).catch(() => {});
  await browser.close().catch(() => {});
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(1);
});
