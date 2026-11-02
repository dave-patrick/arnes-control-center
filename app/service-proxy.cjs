const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const net = require('node:net');

// Services that run on another machine (for example T580) and are embedded in the
// Control Center. Each gets its own loopback origin so root-relative assets work.
const embedded = ['openviking', 'dockhand', 'searxng', 'bookorbit'];

function frameable(headers) {
  const next = { ...headers };
  delete next['x-frame-options'];
  for (const name of ['connection', 'keep-alive', 'transfer-encoding', 'upgrade']) delete next[name];
  if (next['content-security-policy']) {
    const policy = [next['content-security-policy']].flat().join(';')
      .split(';').map(part => part.trim()).filter(part => part && !/^frame-ancestors\b/i.test(part)).join('; ');
    if (policy) next['content-security-policy'] = policy;
    else delete next['content-security-policy'];
  }
  return next;
}

// Starts one loopback listener per embedded service and returns its frame URL.
function start(services, firstPort) {
  const frames = {};
  let port = firstPort;
  for (const id of embedded) {
    const raw = services[id];
    if (!raw) continue;
    const target = new URL(raw);
    const secure = target.protocol === 'https:';
    const transport = secure ? https : http;
    const upstreamPort = Number(target.port || (secure ? 443 : 80));
    const origin = `http://127.0.0.1:${port}`;
    const rewriteLocation = location => location.startsWith(target.origin) ? origin + location.slice(target.origin.length) : location;

    const server = http.createServer((req, res) => {
      const headers = { ...req.headers, host: target.host };
      delete headers.origin;
      if (headers.referer) headers.referer = target.origin + '/';
      const upstream = transport.request({ hostname: target.hostname, port: upstreamPort, path: req.url, method: req.method, headers }, response => {
        const responseHeaders = frameable(response.headers);
        if (responseHeaders.location) responseHeaders.location = rewriteLocation(responseHeaders.location);
        res.writeHead(response.statusCode || 502, responseHeaders);
        response.pipe(res);
      });
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`${id} is unavailable from this workspace.`);
      });
      req.pipe(upstream);
    });

    server.on('upgrade', (req, socket, head) => {
      const connect = secure
        ? done => tls.connect({ host: target.hostname, port: upstreamPort, servername: target.hostname }, done)
        : done => net.connect(upstreamPort, target.hostname, done);
      const upstream = connect(() => {
        const headers = { ...req.headers, host: target.host };
        delete headers.origin;
        const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`,
          ...Object.entries(headers).map(([name, value]) => `${name}: ${[value].flat().join(', ')}`), '', ''];
        upstream.write(lines.join('\r\n'));
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
    });

    server.on('error', error => console.error(`Service proxy for ${id} failed: ${error.message}`));
    server.listen(port, '127.0.0.1');
    frames[id] = origin + target.pathname + target.search;
    port += 1;
  }
  return frames;
}

module.exports = { start, embedded };
