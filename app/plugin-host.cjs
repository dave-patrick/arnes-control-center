const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

class PluginError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
class PluginHost {
  constructor(options = {}) {
    this.dataDir = options.dataDir || process.env.ARNES_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'Arnes', 'plugins');
    this.directories = options.directories || [path.join(__dirname, 'plugins'), ...(process.env.ARNES_PLUGIN_DIR ? [path.resolve(process.env.ARNES_PLUGIN_DIR)] : [])];
    this.plugins = new Map();
    this.instances = new Map();
    this.state = { enabled: [], grants: {} };
    this.activity = [];
    this.token = crypto.randomBytes(32).toString('hex');
    this.writeQueue = Promise.resolve();
    this.ready = this.load();
  }
  async load() {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    try {
      const saved = JSON.parse(await fs.readFile(path.join(this.dataDir, 'state.json'), 'utf8'));
      if (!Array.isArray(saved.enabled) || saved.enabled.some(id => typeof id !== 'string')) throw Error('Invalid plugin state');
      this.state.enabled = saved.enabled;
      this.state.grants = saved.grants && typeof saved.grants === 'object' ? saved.grants : {};
    } catch (error) { if (error.code !== 'ENOENT') throw Error('Plugin state could not be read. Repair state.json before enabling plugins.'); }
    for (const directory of this.directories) {
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const entry of entries.filter(e => e.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
        const folder = path.join(directory, entry.name);
        const manifest = JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8'));
        if (manifest.apiVersion !== 1 || !/^[a-z][a-z0-9-]{1,60}$/.test(manifest.id) ||
          typeof manifest.name !== 'string' || typeof manifest.version !== 'string' ||
          !Array.isArray(manifest.permissions) || manifest.permissions.some(p => typeof p !== 'string') ||
          !Array.isArray(manifest.actions) || manifest.actions.some(a => !/^[a-z][a-z0-9-]*$/.test(a.id) || typeof a.title !== 'string') ||
          new Set(manifest.actions.map(a => a.id)).size !== manifest.actions.length) throw Error('Invalid plugin manifest: ' + folder);
        if (this.plugins.has(manifest.id)) throw Error('Duplicate plugin: ' + manifest.id);
        this.plugins.set(manifest.id, { manifest, folder });
      }
    }
  }
  async save() {
    const pending = this.writeQueue.then(async () => {
      const target = path.join(this.dataDir, 'state.json');
      await fs.writeFile(target + '.tmp', JSON.stringify(this.state, null, 2), { mode: 0o600 });
      await fs.rename(target + '.tmp', target);
    });
    this.writeQueue = pending.catch(() => {});
    return pending;
  }
  granted(id) {
    const granted = this.state.grants[id];
    return this.state.enabled.includes(id) && Array.isArray(granted) && this.plugins.get(id).manifest.permissions.every(p => granted.includes(p));
  }
  async instance(id) {
    if (!this.instances.has(id)) {
      const loading = (async () => {
      const record = this.plugins.get(id);
      const modulePath = await fs.realpath(path.join(record.folder, 'index.cjs'));
      const folder = await fs.realpath(record.folder);
      if (!modulePath.startsWith(folder + path.sep)) throw new PluginError('Plugin entry must stay in its folder.');
      const factory = require(modulePath);
      const instance = await factory({ dataDir: this.dataDir, PluginError });
      if (!instance || typeof instance.actions !== 'object') throw Error('Invalid plugin implementation: ' + id);
      return instance;
      })();
      this.instances.set(id, loading);
    }
    return this.instances.get(id);
  }
  async list() {
    await this.ready;
    return Promise.all([...this.plugins.values()].map(async ({ manifest }) => {
      const enabled = this.granted(manifest.id);
      let status = { state: 'disabled', detail: 'Enable to grant the access listed below.' };
      if (enabled) {
        try { status = await (await this.instance(manifest.id)).status(); }
        catch { status = { state: 'error', detail: 'Plugin failed to start. Check its local configuration.' }; }
      }
      return { ...manifest, enabled, status };
    }));
  }
  async enable(id, enabled, grants) {
    await this.ready;
    const record = this.plugins.get(id);
    if (!record) throw new PluginError('Plugin not found.', 404);
    if (typeof enabled !== 'boolean') throw new PluginError('enabled must be true or false.');
    if (enabled && (!Array.isArray(grants) || record.manifest.permissions.some(p => !grants.includes(p)))) throw new PluginError('Review and grant all declared permissions.', 403);
    if (!enabled && this.instances.has(id)) {
      const instance = await this.instances.get(id).catch(() => null);
      await instance?.dispose?.();
      this.instances.delete(id);
    }
    this.state.enabled = this.state.enabled.filter(value => value !== id);
    if (enabled) {
      this.state.enabled.push(id);
      this.state.grants[id] = [...record.manifest.permissions];
    } else delete this.state.grants[id];
    await this.save();
    await this.record(id, enabled ? 'enable' : 'disable', 'completed');
    return { enabled };
  }
  async record(plugin, action, outcome) {
    const event = { id: crypto.randomUUID(), at: new Date().toISOString(), plugin, action, outcome };
    this.activity.unshift(event);
    this.activity.length = Math.min(this.activity.length, 100);
    // Persist metadata only. No commands, message text, output, or credentials.
    const pending = this.writeQueue.then(async () => {
      const target = path.join(this.dataDir, 'activity.jsonl');
      try { if ((await fs.stat(target)).size > 1024 * 1024) await fs.rename(target, target + '.previous'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.appendFile(target, JSON.stringify(event) + '\n', { mode: 0o600 });
    });
    this.writeQueue = pending.catch(() => {});
    await pending;
  }
  async invoke(id, action, input = {}) {
    await this.ready;
    const record = this.plugins.get(id);
    if (!record) throw new PluginError('Plugin not found.', 404);
    if (!this.granted(id)) throw new PluginError('Enable this plugin and review its current permissions first.', 403);
    const actionDefinition = record.manifest.actions.find(a => a.id === action);
    if (!actionDefinition) throw new PluginError('Action not found.', 404);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PluginError('Action input must be an object.');
    const instance = await this.instance(id);
    if (typeof instance.actions[action] !== 'function') throw new PluginError('Action is unavailable.', 404);
    try {
      if (actionDefinition.audit !== false) await this.record(id, action, 'started');
      const result = await instance.actions[action](input);
      if (actionDefinition.audit !== false) await this.record(id, action, 'completed');
      return result;
    } catch (error) {
      await this.record(id, action, 'failed');
      throw error;
    }
  }
  async route(req, res, url, { json, body }) {
    await this.ready;
    // Privileged APIs deliberately exclude Tailnet/proxy hosts and cross-site reads.
    const expectedOrigin = 'http://' + req.headers.host;
    if (!['127.0.0.1:9140', 'localhost:9140'].includes(req.headers.host) ||
      !['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress) ||
      (req.headers.origin && req.headers.origin !== expectedOrigin) ||
      (req.headers['sec-fetch-site'] === 'cross-site' && url.pathname !== '/hub/plugins/google/callback')) return json(res, 403, { error: 'Open Plugins directly on this PC at http://127.0.0.1:9140/plugins.html.' });
    try {
      if (url.pathname === '/hub/plugins/google/callback' && req.method === 'GET') {
        if (!this.granted('google-workspace')) throw new PluginError('Enable Google Workspace first.', 403);
        const connection = await (await this.instance('google-workspace')).callback(url);
        res.writeHead(303, { Location: connection?.popup ? '/google-connected.html' : '/plugins.html?connected=google', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        return res.end();
      }
      if (url.pathname === '/hub/plugins' && req.method === 'GET') return json(res, 200, { plugins: await this.list(), token: this.token, activity: this.activity });
      if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
      if (req.headers.origin !== expectedOrigin || req.headers['x-arnes-token'] !== this.token ||
        !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new PluginError('Reload Plugins and retry the action.', 403);
      const match = url.pathname.match(/^\/hub\/plugins\/([a-z][a-z0-9-]*)\/(enable|actions\/([a-z][a-z0-9-]*))$/);
      if (!match) throw new PluginError('Route not found.', 404);
      const payload = await body(req);
      const result = match[2] === 'enable' ? await this.enable(match[1], payload.enabled, payload.grants) : await this.invoke(match[1], match[3], payload);
      return json(res, 200, result);
    } catch (error) { return json(res, error instanceof SyntaxError ? 400 : error.status || 500, { error: error.status || error instanceof SyntaxError ? error.message : 'Plugin action failed. Check local setup and retry.' }); }
  }
  async dispose() {
    for (const pending of this.instances.values()) { const instance = await pending.catch(() => null); await instance?.dispose?.(); }
  }
}
module.exports = { PluginHost, PluginError };
