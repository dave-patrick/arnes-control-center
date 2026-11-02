const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { PluginHost, PluginError } = require('../app/plugin-host.cjs');
const googleFactory = require('../app/plugins/google-workspace/index.cjs');
const { secretStore } = require('../app/secret-store.cjs');
async function temporary(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arnes-plugin-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
async function hostFor(t) { const host = new PluginHost({ dataDir: await temporary(t) }); await host.ready; t.after(() => host.dispose()); return host; }
async function finished(host, id) {
  for (let i = 0; i < 150; i++) { const job = (await host.invoke('local-shell', 'jobs')).jobs.find(j => j.id === id); if (!['running', 'stopping'].includes(job.state)) return job; await delay(100); }
  throw Error('Shell did not finish.');
}
test('permissions, action allowlist, persistence, and renewed permission review', async t => {
  const host = await hostFor(t);
  assert.equal((await host.list()).every(p => !p.enabled), true);
  await assert.rejects(host.invoke('local-shell', 'jobs'), { status: 403 });
  await assert.rejects(host.enable('local-shell', true, []), { status: 403 });
  await host.enable('local-shell', true, ['shell.execute']);
  await assert.rejects(host.invoke('local-shell', 'not-an-action'), { status: 404 });
  const restarted = new PluginHost({ dataDir: host.dataDir }); await restarted.ready; t.after(() => restarted.dispose());
  assert.equal((await restarted.list()).find(p => p.id === 'local-shell').enabled, true);
  restarted.plugins.get('local-shell').manifest.permissions.push('files.extra');
  assert.equal((await restarted.list()).find(p => p.id === 'local-shell').enabled, false);
  await assert.rejects(restarted.invoke('local-shell', 'jobs'), { status: 403 });
});
test('shell captures output and exit; metadata omits commands/output', async t => {
  const host = await hostFor(t);
  await host.enable('local-shell', true, ['shell.execute']);
  const command = process.platform === 'win32' ? "Write-Output 'arnes-private-marker'; exit 7" : "printf arnes-private-marker; exit 7";
  const job = await host.invoke('local-shell', 'run', { cwd: process.cwd(), command });
  const result = await finished(host, job.id);
  assert.equal(result.exitCode, 7);
  assert.match(result.stdout, /arnes-private-marker/);
  assert.equal(result.state, 'failed');
  assert.doesNotMatch(await fs.readFile(path.join(host.dataDir, 'activity.jsonl'), 'utf8'), /arnes-private-marker/);
  await assert.rejects(host.invoke('local-shell', 'run', { command: 'echo x', cwd: 'relative' }), { status: 400 });
});
test('shell cancellation, deadline, and disabling terminate jobs', async t => {
  const host = await hostFor(t); await host.enable('local-shell', true, ['shell.execute']);
  const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 60' : 'sleep 60';
  const first = await host.invoke('local-shell', 'run', { cwd: process.cwd(), command });
  await host.invoke('local-shell', 'cancel', { id: first.id });
  assert.equal((await finished(host, first.id)).state, 'cancelled');
  const second = await host.invoke('local-shell', 'run', { cwd: process.cwd(), command, timeout: 1 });
  assert.equal((await finished(host, second.id)).state, 'timed-out');
  const third = await host.invoke('local-shell', 'run', { cwd: process.cwd(), command });
  await host.enable('local-shell', false, []);
  await assert.rejects(host.invoke('local-shell', 'cancel', { id: third.id }), { status: 403 });
});
test('shell output cap stops excessive output', async t => {
  const host = await hostFor(t); await host.enable('local-shell', true, ['shell.execute']);
  const command = process.platform === 'win32' ? "[Console]::Write(('x' * 1100000))" : "head -c 1100000 /dev/zero";
  const job = await host.invoke('local-shell', 'run', { cwd: process.cwd(), command });
  const result = await finished(host, job.id);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.stdout + result.stderr) <= 1024 * 1024);
});
test('API rejects foreign origin, proxy host, cross-site read, and missing CSRF token', async t => {
  const host = await hostFor(t);
  async function route(headers, method = 'GET', payload = {}) {
    let result; const req = { method, headers, socket: { remoteAddress: '127.0.0.1' } };
    await host.route(req, {}, new URL('http://localhost/hub/plugins' + (method === 'POST' ? '/local-shell/enable' : '')), { json: (_, status, data) => { result = { status, data }; }, body: async () => payload });
    return result;
  }
  assert.equal((await route({ host: '127.0.0.1:9140', origin: 'https://evil.example' })).status, 403);
  assert.equal((await route({ host: 'hub.example.invalid' })).status, 403);
  assert.equal((await route({ host: '127.0.0.1:9140', 'sec-fetch-site': 'cross-site' })).status, 403);
  const headers = { host: '127.0.0.1:9140', origin: 'http://127.0.0.1:9140', 'content-type': 'application/json' };
  assert.equal((await route(headers, 'POST')).status, 403);
  assert.equal((await route({ ...headers, 'x-arnes-token': host.token }, 'POST', { enabled: true, grants: ['shell.execute'] })).status, 200);
});
test('secret storage roundtrip protects credentials on Windows', async t => {
  const dir = await temporary(t); const store = secretStore(dir);
  await store.write('test', { token: 'fake-secret-for-roundtrip' });
  assert.deepEqual(await store.read('test'), { token: 'fake-secret-for-roundtrip' });
  if (process.platform === 'win32') assert.doesNotMatch(await fs.readFile(path.join(dir, 'test.secret'), 'utf8'), /fake-secret-for-roundtrip/);
});
test('Google uses state and PKCE, rejects replay, refreshes, never returns tokens, disconnects', async () => {
  let config = {};
  const calls = [];
  const plugin = googleFactory({ dataDir: '', PluginError, store: { read: async () => ({ ...config }), write: async (_, value) => { config = { ...value }; } },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/token')) return { ok: true, json: async () => ({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600 }) };
      if (url.endsWith('/revoke')) return { ok: true };
      return { ok: true, json: async () => ({ files: [] }) };
    } });
  await plugin.actions.configure({ clientId: 'test.apps.googleusercontent.com', clientSecret: 'fake-client-secret' });
  const connection = await plugin.actions.connect();
  const auth = new URL(connection.authorizationUrl);
  assert.equal(auth.origin, 'https://accounts.google.com');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(auth.searchParams.get('scope').split(' ').every(s => s.endsWith('.readonly')));
  await assert.rejects(plugin.callback(new URL('http://localhost/callback?state=wrong&code=x')), { status: 400 });
  const callback = new URL('http://localhost/callback'); callback.searchParams.set('state', auth.searchParams.get('state')); callback.searchParams.set('code', 'fake-code');
  await plugin.callback(callback);
  await assert.rejects(plugin.callback(callback), { status: 400 });
  assert.equal((await plugin.status()).state, 'connected');
  assert.doesNotMatch(JSON.stringify(await plugin.status()), /fake-access|fake-refresh|fake-client-secret/);
  assert.ok(calls[0].options.body.get('code_verifier'));
  config.expiresAt = 0;
  assert.deepEqual(await plugin.actions.drive(), { files: [] });
  assert.equal(calls[1].options.body.get('grant_type'), 'refresh_token');
  await plugin.actions.disconnect();
  assert.equal(config.refreshToken, undefined);
  assert.equal((await plugin.status()).state, 'needs-connection');
});
test('OAuth callback can navigate from Google but still validates state', async t => {
  const host = await hostFor(t); await host.enable('google-workspace', true, ['google.workspace.read', 'credentials.store']);
  let status;
  await host.route({ method: 'GET', headers: { host: '127.0.0.1:9140', 'sec-fetch-site': 'cross-site' }, socket: { remoteAddress: '127.0.0.1' } }, {},
    new URL('http://127.0.0.1:9140/hub/plugins/google/callback?state=invalid'), { json: (_, code) => { status = code; }, body: async () => ({}) });
  assert.equal(status, 400);
});

test('a third-party plugin is discovered and invoked through the same contract', async t => {
  const directory = await temporary(t);
  const folder = path.join(directory, 'example'); await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ apiVersion: 1, id: 'example-plugin', name: 'Example', version: '1.0.0', permissions: [], actions: [{ id: 'greet', title: 'Greet' }] }));
  await fs.writeFile(path.join(folder, 'index.cjs'), "module.exports = () => ({ status: async () => ({state:'ready'}), actions: {greet: async ({name}) => ({greeting:'Hello, '+name})} });");
  const host = new PluginHost({ dataDir: await temporary(t), directories: [directory] }); await host.ready; t.after(() => host.dispose());
  await host.enable('example-plugin', true, []);
  assert.deepEqual(await host.invoke('example-plugin', 'greet', { name: 'Dave' }), { greeting: 'Hello, Dave' });
});
test('a malformed manifest fails closed', async t => {
  const directory = await temporary(t); const folder = path.join(directory, 'invalid'); await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'manifest.json'), '{"id":"invalid"}');
  const host = new PluginHost({ dataDir: await temporary(t), directories: [directory] });
  await assert.rejects(host.ready, /Invalid plugin manifest/);
});

test('disabling shell during directory validation cannot launch a late command', async () => {
  const plugin = require('../app/plugins/local-shell/index.cjs')({ PluginError });
  const pending = plugin.actions.run({ cwd: process.cwd(), command: 'echo should-not-run' });
  await plugin.dispose();
  await assert.rejects(pending, { status: 403 });
});

test('Google popup requests an account chooser and returns popup completion metadata', async () => {
  let config = { clientId: 'popup-test.apps.googleusercontent.com', clientSecret: 'fake-secret' };
  const plugin = googleFactory({ dataDir: '', PluginError,
    store: { read: async () => ({...config}), write: async (_, value) => {config = {...value};} },
    fetcher: async () => ({ok:true, json:async()=>({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600})}) });
  const result = await plugin.actions.connect({popup:true});
  const url = new URL(result.authorizationUrl);
  assert.equal(url.searchParams.get('prompt'), 'select_account consent');
  assert.equal(url.searchParams.has('login_hint'), false);
  assert.equal((await plugin.status()).authorization, 'pending');
  const callback = new URL('http://127.0.0.1:9140/hub/plugins/google/callback');
  callback.searchParams.set('state', url.searchParams.get('state')); callback.searchParams.set('code', 'test-code');
  assert.deepEqual(await plugin.callback(callback), {popup:true});
  assert.equal((await plugin.status()).authorization, 'completed');
});
test('declined Google consent reports failure without discarding a prior account', async () => {
  const config = {clientId:'popup-test.apps.googleusercontent.com',clientSecret:'fake-secret',refreshToken:'existing-account'};
  const plugin = googleFactory({dataDir:'',PluginError,store:{read:async()=>({...config}),write:async()=>{throw Error('must not write');}}});
  const url = new URL((await plugin.actions.connect({popup:true})).authorizationUrl);
  const callback = new URL('http://127.0.0.1:9140/hub/plugins/google/callback');
  callback.searchParams.set('state',url.searchParams.get('state')); callback.searchParams.set('error','access_denied');
  await assert.rejects(plugin.callback(callback),{status:400});
  assert.equal((await plugin.status()).authorization,'failed');
  assert.equal((await plugin.status()).state,'connected');
});
