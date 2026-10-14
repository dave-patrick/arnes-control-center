const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const bridge = require('./codex-bridge.cjs');
const tailnetName = 'hub.example.invalid';
const audiobookShelf = { hostname: '127.0.0.1', port: 8000 };

const root = path.join(__dirname, 'dist');
const trustedHosts = new Set([
  '127.0.0.1:9130',
  'localhost:9130',
  'hub.example.invalid'
]);
const origins = new Set([
  'http://127.0.0.1:9130',
  'http://localhost:9130',
  'https://hub.example.invalid'
]);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};
const isTrustedHost = host => trustedHosts.has(host) || host === 'hub.example.invalid:443';
const geminiConfigFile = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'HarnessHub',
  'gemini.json'
);

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

async function body(req) {
  let text = '';
  for await (const part of req) {
    text += part;
    if (text.length > 200000) throw Error('Request too large.');
  }
  return JSON.parse(text);
}

async function geminiKey() {
  try {
    const config = JSON.parse(await fs.promises.readFile(geminiConfigFile, 'utf8'));
    return typeof config.apiKey === 'string' ? config.apiKey : '';
  } catch { return ''; }
}

async function geminiRequest(route, options = {}) {
  const key = await geminiKey();
  if (!key) return { status: 409, data: { error: 'Add your Gemini API key in the Gemini tab first.' } };
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${route}`, {
    ...options,
    headers: { 'x-goog-api-key': key, ...(options.headers || {}) },
    signal: AbortSignal.timeout(60000)
  });
  let data;
  try { data = await response.json(); }
  catch { data = {}; }
  return { status: response.status, data };
}

async function routeGemini(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/hub/gemini/status') {
    return json(res, 200, { configured: Boolean(await geminiKey()) });
  }

  if (req.method === 'POST' && pathname === '/hub/gemini/config') {
    const payload = await body(req);
    const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
    if (apiKey.length < 20 || apiKey.length > 512 || /\s/.test(apiKey)) {
      return json(res, 400, { error: 'That key does not look valid. Check it and try again.' });
    }
    await fs.promises.mkdir(path.dirname(geminiConfigFile), { recursive: true });
    await fs.promises.writeFile(geminiConfigFile, JSON.stringify({ apiKey }), { encoding: 'utf8', mode: 0o600 });
    return json(res, 200, { configured: true });
  }

  if (req.method === 'GET' && pathname === '/hub/gemini/models') {
    const result = await geminiRequest('models?pageSize=1000');
    if (result.status < 200 || result.status >= 300) {
      const message = typeof result.data?.error === 'string' ? result.data.error : result.data?.error?.message;
      return json(res, result.status, { error: message || 'Could not load Gemini models.' });
    }
    const models = (result.data.models || [])
      .filter(model => (model.supportedGenerationMethods || []).includes('generateContent'))
      .map(model => ({ id: String(model.name || '').replace(/^models\//, ''), name: model.displayName || model.name }))
      .filter(model => model.id && !model.id.includes('embedding'));
    return json(res, 200, { models });
  }

  if (req.method === 'POST' && pathname === '/hub/gemini/chat') {
    const payload = await body(req);
    const model = typeof payload.model === 'string' ? payload.model.replace(/^models\//, '') : '';
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
    const history = Array.isArray(payload.history) ? payload.history.slice(-40) : [];
    if (!/^[\w.-]{1,120}$/.test(model)) return json(res, 400, { error: 'Choose a valid Gemini model.' });
    if (!prompt || prompt.length > 20000) return json(res, 400, { error: 'Enter a message under 20,000 characters.' });
    const contents = history
      .filter(item => item && ['user', 'model'].includes(item.role) && typeof item.text === 'string')
      .map(item => ({ role: item.role, parts: [{ text: item.text.slice(0, 20000) }] }));
    contents.push({ role: 'user', parts: [{ text: prompt }] });
    const result = await geminiRequest(`models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });
    if (result.status < 200 || result.status >= 300) {
      const message = typeof result.data?.error === 'string' ? result.data.error : result.data?.error?.message;
      return json(res, result.status, { error: message || 'Gemini could not complete that request.' });
    }
    const text = (result.data.candidates?.[0]?.content?.parts || [])
      .map(part => typeof part.text === 'string' ? part.text : '').join('');
    return json(res, 200, { text, usage: result.data.usageMetadata || null });
  }

  return json(res, 404, { error: 'Not found.' });
}

async function probeService(url, timeout = 3500) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: 'manual' });
    return { status: response.status, reachable: response.status >= 200 && response.status < 500 };
  } catch { return { status: null, reachable: false }; }
}

function probeTcp(host, port, timeout = 1800) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const done = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(timeout, () => done({ reachable: false, status: null }));
    socket.once('connect', () => done({ reachable: true, status: 'tcp' }));
    socket.once('error', () => done({ reachable: false, status: null }));
  });
}

async function controlCenterStatus() {
  const [openviking, homeAssistant, lmStudio, hermesGateway, hermesDashboard, dockhand, searxng, audiobookShelf, traefik, motusLeap] = await Promise.all([
    probeService('http://127.0.0.1:1933/health'),
    probeService('http://127.0.0.1:8123/api/'),
    probeService('http://127.0.0.1:1234/v1/models'),
    probeService('http://127.0.0.1:8642/health'),
    probeService('http://127.0.0.1:9119/'),
    probeService('http://127.0.0.1:3000/containers'),
    probeService('http://127.0.0.1:8080/'),
    probeService('http://127.0.0.1:8000/'),
    probeTcp('127.0.0.1', 8443),
    probeService('https://tubemanager.onrender.com/health', 6000)
  ]);
  motusLeap.reachable = motusLeap.status === 200;
  if (lmStudio.reachable && lmStudio.status === 200) {
    try {
      const response = await fetch('http://127.0.0.1:1234/v1/models', { signal: AbortSignal.timeout(3500) });
      const payload = await response.json();
      lmStudio.modelCount = Array.isArray(payload.data) ? payload.data.length : null;
    } catch { lmStudio.modelCount = null; }
  }
  return {
    checkedAt: new Date().toISOString(),
    managementStatus: { 'tubemanager.onrender.com': motusLeap },
    systems: [
      { id: 'openviking', name: 'OpenViking', endpoint: '127.0.0.1:1933', live: true, ...openviking, detail: 'Health endpoint · search last reported returning live results' },
      { id: 'perseus', name: 'Perseus Vault', endpoint: 'Local MCP', live: false, reachable: true, status: 'reported', statusText: 'MCP ready · last reported', detail: '680 memories embedded · semantic recall available (last reported)' },
      { id: 'home-assistant', name: 'Home Assistant', endpoint: '127.0.0.1:8123', live: true, ...homeAssistant, detail: homeAssistant.status === 401 ? 'Service responds; API probe requires authorization · entity query last reported working' : 'Entity query last reported working · health endpoint checked live' },
      { id: 'lm-studio', name: 'LM Studio', endpoint: '127.0.0.1:1234', live: true, ...lmStudio, detail: lmStudio.modelCount == null ? 'Models endpoint checked live' : `${lmStudio.modelCount} local models available` },
      { id: 'hermes-gateway', name: 'Hermes Gateway', endpoint: '127.0.0.1:8642', live: true, ...hermesGateway, detail: 'GET /health' },
      { id: 'hermes-dashboard', name: 'Hermes Dashboard', endpoint: '127.0.0.1:9119', live: true, ...hermesDashboard, detail: 'Local dashboard · Tailscale redirect is expected' },
      { id: 'dockhand', name: 'Dockhand', endpoint: '127.0.0.1:3000', live: true, ...dockhand, detail: 'Containers view · LAN and Tailscale' },
      { id: 'searxng', name: 'SearXNG', endpoint: '127.0.0.1:8080', live: true, ...searxng, detail: 'Search UI · 2 containers' },
      { id: 'audiobookshelf', name: 'Audiobookshelf', endpoint: 't580 (Tailscale):8000', openUrl: 'http://127.0.0.1:8000/', live: true, ...audiobookShelf, detail: 'Library responds · private same-origin proxy available in the Tailscale workspace' },
      { id: 'traefik', name: 'Traefik', endpoint: '127.0.0.1:8443', live: true, ...traefik, detail: 'TLS entrypoint · shockwave-companion-t580-traefik-1' },
      { id: 'shockwave-api', name: 'Shockwave API', endpoint: 'T580 localhost:18081', live: false, reachable: true, status: 'reported', statusText: 'Healthy · Docker reported Up 4 days', detail: 'Loopback-only mapping · shockwave-companion-t580-api-1' },
      { id: 'shockwave-updater', name: 'Shockwave Updater', endpoint: 'T580 Docker', live: false, reachable: true, status: 'reported', statusText: 'Up 4 days · Docker reported', detail: 'Crash loop resolved · shockwave-companion-t580-updater-1' }
    ]
  };
}

function proxyAudiobookshelf(req, res) {
  const scheme = req.headers.host === tailnetName || req.headers.host === `${tailnetName}:443` ? 'https' : 'http';
  const headers = {
    ...req.headers,
    'x-forwarded-for': req.socket.remoteAddress || '127.0.0.1',
    'x-forwarded-host': req.headers.host,
    'x-forwarded-proto': scheme
  };
  const upstream = http.request({ hostname: audiobookShelf.hostname, port: audiobookShelf.port,
    path: req.url, method: req.method, headers }, response => {
    const responseHeaders = { ...response.headers };
    for (const header of ['connection', 'keep-alive', 'transfer-encoding', 'upgrade']) delete responseHeaders[header];
    if (responseHeaders.location) {
      try {
        const location = new URL(responseHeaders.location, `http://${audiobookShelf.hostname}:${audiobookShelf.port}`);
        if (location.hostname === audiobookShelf.hostname && location.port === String(audiobookShelf.port)) {
          location.protocol = scheme + ':';
          location.host = req.headers.host;
          responseHeaders.location = location.href;
        }
      } catch { /* Keep non-URL Location values unchanged. */ }
    }
    res.writeHead(response.statusCode || 502, responseHeaders);
    response.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Audiobookshelf is unavailable from this workspace.');
  });
  req.pipe(upstream);
}

async function harnessStatus() {
  const [hermes, codex, dsh, antigravity] = await Promise.all([
    probeService('http://127.0.0.1:9119/'),
    probeService('http://127.0.0.1:9131/hub/events'),
    probeService('http://127.0.0.1:3080/'),
    probeService('https://antigravity.google.com/', 4500)
  ]);
  const geminiConfigured = Boolean(await geminiKey());
  const rows = {
    hermes: { state: hermes.reachable ? 'up' : 'down', label: hermes.reachable ? 'Dashboard online' : 'Dashboard offline' },
    codex: { state: codex.reachable ? 'up' : 'down', label: codex.reachable ? 'Local bridge online' : 'Bridge offline' },
    gemini: { state: geminiConfigured ? 'ready' : 'setup', label: geminiConfigured ? 'API key saved locally' : 'API key needed' },
    antigravity: { state: antigravity.reachable ? 'external' : 'down', label: antigravity.reachable ? 'Remote Control opens separately' : 'Remote Control unavailable' },
    herdr: { state: 'external', label: 'Managed from Herdr terminal' },
    dsh: { state: dsh.reachable ? 'up' : 'down', label: dsh.reachable ? 'Local service online' : 'Local service offline' },
    'control-center': { state: 'up', label: 'Management workspace online' }
  };
  return { checkedAt: new Date().toISOString(), statuses: rows };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!isTrustedHost(req.headers.host)) return json(res, 403, { error: 'Untrusted host' });
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return json(res, 400, { error: 'Invalid address' }); }
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/audiobookshelf' || pathname.startsWith('/audiobookshelf/')) return proxyAudiobookshelf(req, res);

    if (pathname === '/hub/providers/metrics' && req.method === 'GET') {
      const allowed = !req.headers.origin || origins.has(req.headers.origin) || req.headers.origin === 'https://hub.example.invalid';
      if (!allowed) return json(res, 403, { error: 'Untrusted origin' });
      if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin'); }
      return json(res, 200, await require('./provider-metrics.cjs')());
    }
    if (pathname.startsWith('/hub/')) {
      if (req.headers.origin && !origins.has(req.headers.origin)) return json(res, 403, { error: 'Untrusted origin' });
      if (req.method === 'POST' && !origins.has(req.headers.origin)) return json(res, 403, { error: 'Origin required' });
      if (pathname.startsWith('/hub/gemini/')) return await routeGemini(req, res, pathname);
      if (pathname === '/hub/providers/configuration' && req.method === 'GET') {
        const catalog = JSON.parse(await fs.promises.readFile(path.join(root, 'providers-catalog.json'), 'utf8'));
        const env = { ...process.env };
        for (const file of [path.join(process.env.HERMES_HOME || path.join(os.homedir(), 'AppData', 'Local', 'hermes'), '.env'), path.join(os.homedir(), '.hermes', '.env'), path.join(os.homedir(), '.config', 'hermes', '.env')]) {
          try { const text = await fs.promises.readFile(file, 'utf8'); for (const line of text.split(/\r?\n/)) { const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/); if (match && !env[match[1]]) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim(); } } catch {}
        }
        const configured = catalog.providers.filter(p => p.env.some(name => /(?:KEY|TOKEN)$/.test(name) && env[name] && !/^(?:your[_ -]|replace|changeme)/i.test(env[name]))).map(p => p.id);
        if (await geminiKey()) configured.push('google');
        return json(res, 200, { configured: [...new Set(configured)], checkedAt: new Date().toISOString() });
      }
      if (pathname === '/hub/control-center/status' && req.method === 'GET') return json(res, 200, await controlCenterStatus());
      if (pathname === '/hub/harness/status' && req.method === 'GET') return json(res, 200, await harnessStatus());
      if (pathname === '/hub/events' && req.method === 'GET') return json(res, 200, bridge.events(Number(url.searchParams.get('after')) || 0));
      if (pathname === '/hub/rpc' && req.method === 'POST') {
        const payload = await body(req);
        return json(res, 200, await bridge.rpc(payload.method, payload.params || {}));
      }
      if (pathname === '/hub/answer' && req.method === 'POST') {
        const payload = await body(req);
        return json(res, 200, bridge.answer(payload.id, payload.result));
      }
      if (pathname === '/hub/health' && req.method === 'GET') {
        let target;
        try { target = new URL(url.searchParams.get('url')); }
        catch { return json(res, 400, { error: 'Invalid dashboard address.' }); }
        if (!['127.0.0.1', 'localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '9119' || target.protocol !== 'http:') {
          return json(res, 400, { error: 'Health check supports the configured Hermes dashboard only.' });
        }
        const probe = http.get(target, { timeout: 2000 }, response => {
          response.resume();
          json(res, 200, { reachable: true, status: response.statusCode });
        });
        probe.on('timeout', () => probe.destroy(Error('Timeout')));
        probe.on('error', () => json(res, 200, { reachable: false, message: 'Hermes dashboard is not responding on port 9119. Its installation needs repair.' }));
        return;
      }
      return json(res, 404, { error: 'Not found' });
    }

    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    let name = pathname;
    if (name === '/') name = '/index.html';
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep)) return json(res, 403, { error: 'Invalid path' });
    fs.readFile(file, (error, data) => {
      if (error) return res.writeHead(404).end('Not found');
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.on('upgrade', (req, socket, head) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { return socket.destroy(); }
  if (!isTrustedHost(req.headers.host) || !url.pathname.startsWith('/audiobookshelf/')) return socket.destroy();
  const scheme = req.headers.host === tailnetName || req.headers.host === `${tailnetName}:443` ? 'https' : 'http';
  const headers = {
    ...req.headers,
    'x-forwarded-for': req.socket.remoteAddress || '127.0.0.1',
    'x-forwarded-host': req.headers.host,
    'x-forwarded-proto': scheme
  };
  const upstream = net.connect(audiobookShelf.port, audiobookShelf.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`,
      ...Object.entries(headers).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`), '', ''];
    upstream.write(lines.join('\r\n'));
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
});

server.listen(9130, '127.0.0.1', () => console.log('Harness Hub: http://127.0.0.1:9130/'));

process.on('SIGTERM', () => {
  bridge.stop();
  server.close(() => process.exit());
});
