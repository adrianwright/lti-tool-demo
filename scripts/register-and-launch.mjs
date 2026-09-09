// End-to-end headless test of the LMS simulator: Dynamic Registration + launch.
// Drives the two deployed services (tool + LMS) exactly as a browser would, but
// without one — proving both the registration protocol and a real OIDC launch.
//
// URLs come from the azd environment (AZURE_TOOL_URL / AZURE_LMS_URL) or from
// TOOL_URL / LMS_URL env vars.

import { execSync } from 'node:child_process';

function azdValue(name) {
  try { return execSync(`azd env get-value ${name}`, { encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

const toolUrl = (process.env.TOOL_URL || azdValue('AZURE_TOOL_URL')).replace(/\/+$/, '');
const lmsUrl = (process.env.LMS_URL || azdValue('AZURE_LMS_URL')).replace(/\/+$/, '');
if (!toolUrl || !lmsUrl) {
  console.error('Missing TOOL/LMS URLs. Set TOOL_URL and LMS_URL, or run `azd env` first.');
  process.exit(2);
}

const jar = new Map();
function absorb(response) {
  const values = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean);
  for (const value of values) {
    const [pair] = value.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function follow(url, options = {}, maxHops = 8) {
  let current = url;
  let method = options.method || 'GET';
  let body = options.body;
  const headers = { ...(options.headers || {}) };
  for (let hop = 0; hop < maxHops; hop += 1) {
    headers.Cookie = cookieHeader();
    const response = await fetch(current, { method, body, headers, redirect: 'manual' });
    absorb(response);
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return response;
    current = new URL(location, current).toString();
    method = 'GET';
    body = undefined;
    delete headers['Content-Type'];
  }
  throw new Error('too many redirects');
}

console.log(`\nLTI 1.3 Dynamic Registration + launch`);
console.log(`  tool : ${toolUrl}`);
console.log(`  lms  : ${lmsUrl}\n`);

// 1) Read the registration config (openid-configuration URL + one-time token) from the LMS UI.
const home = await (await fetch(`${lmsUrl}/`)).text();
const openidConfig = home.match(/const OPENID_CONFIG = "([^"]+)"/)?.[1];
const regToken = home.match(/const REG_TOKEN = "([^"]+)"/)?.[1];
if (!openidConfig || !regToken) throw new Error('Could not read registration config from the LMS home page.');
// confirm=1 skips the tool's interactive review form and registers directly.
const registerUrl = `${toolUrl}/register?openid_configuration=${encodeURIComponent(openidConfig)}&registration_token=${regToken}&confirm=1`;

// 2) Drive Dynamic Registration by hitting the tool's /register (as the popup would).
const regResponse = await fetch(registerUrl);
const regBody = await regResponse.text();
const registered = regResponse.status === 200 && /org\.imsglobal\.lti\.close/.test(regBody);
console.log(`  register : HTTP ${regResponse.status} ${registered ? '(tool self-registered)' : '(FAILED)'}`);

// 3) Confirm the LMS now has the tool registered.
const status = await (await fetch(`${lmsUrl}/status`)).json();
console.log(`  status   : registered=${status.registered} client_id=${status.clientId}`);
if (!registered || !status.registered) {
  console.error('FAIL: dynamic registration did not complete.');
  process.exit(1);
}

// 4) Launch as a student: LMS/launch -> tool/login -> LMS/authorize (form) -> tool/lti/launch.
const launchStart = await follow(`${lmsUrl}/launch?role=student`);
const authForm = await launchStart.text();
const action = authForm.match(/action="([^"]+)"/)?.[1];
const idToken = authForm.match(/name="id_token" value="([^"]+)"/)?.[1];
const state = authForm.match(/name="state" value="([^"]+)"/)?.[1];
if (!action || !idToken || !state) {
  console.error('FAIL: authorize endpoint did not return a signed launch form.');
  console.error(authForm.slice(0, 400));
  process.exit(1);
}

const launch = await follow(action, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ id_token: idToken, state }).toString(),
});
const page = await launch.text();
const expect = ['LTI 1.3 handshake complete', 'Sam Student', 'course-101', 'Learner, Student'];
const missing = expect.filter((value) => !page.includes(value));

if (launch.status !== 200 || missing.length) {
  console.error(`FAIL: launch returned HTTP ${launch.status}. Missing: ${missing.join(', ')}`);
  console.error(page.slice(0, 500));
  process.exit(1);
}

console.log(`  launch   : HTTP 200 — tool rendered the authenticated student page\n`);
console.log('PASS: Dynamic Registration + LTI 1.3 launch validated end-to-end.');
