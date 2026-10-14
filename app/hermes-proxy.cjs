'use strict';

const http = require('node:http');
const net = require('node:net');

const upstream = { hostname: '127.0.0.1', port: 9119, origin: 'http://127.0.0.1:9119' };
const allowedHosts = new Map([
  ['127.0.0.1:9132', 'http'],
  ['localhost:9132', 'http'],
  ['hub.example.invalid:8443', 'https']
]);
const proxyOrigin = host => `http://${host}`;

function forwardedHeaders(req, host) {
  const proxyProtocol = allowedHosts.get(host);
  const headers = { ...req.headers, host: `${upstream.hostname}:${upstream.port}` };
  headers.origin = upstream.origin;
  if (headers.referer) {
    try {
      const ref = new URL(headers.referer);
      ref.host = `${upstream.hostname}:${upstream.port}`;
      ref.protocol = 'http:';
      headers.referer = ref.href;
    } catch { delete headers.referer; }
  }
  headers['x-forwarded-host'] = host;
  headers['x-forwarded-proto'] = proxyProtocol;
  headers['x-forwarded-for'] = req.socket.remoteAddress || '127.0.0.1';
  return headers;
}

function proxiedHeaders(source, host) {
  const headers = { ...source };
  delete headers['x-frame-options'];
  delete headers['content-security-policy-report-only'];
  if (headers['content-security-policy']) {
    const policy = Array.isArray(headers['content-security-policy'])
      ? headers['content-security-policy'].join('; ')
      : headers['content-security-policy'];
    headers['content-security-policy'] = policy.replace(/frame-ancestors\s+[^;]+/gi,
      `frame-ancestors ${proxyOrigin('127.0.0.1:9130')} ${proxyOrigin('localhost:9130')} https://harness-hub.davepatrick.chatgpt.site https://hub.example.invalid`);
  }
  if (headers.location) {
    try {
      const location = new URL(headers.location, upstream.origin);
      if (['127.0.0.1', 'localhost', '127.0.0.1'].includes(location.hostname) &&
          (location.port === '9119' || !location.port)) {
        location.protocol = allowedHosts.get(host) === 'https' ? 'https:' : 'http:';
        location.host = host;
        headers.location = location.href;
      }
    } catch { /* Keep non-URL Location values unchanged. */ }
  }
  return headers;
}

function proxyRequest(req, res) {
  if (!allowedHosts.has(req.headers.host)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Loopback Hermes proxy only.');
    return;
  }
  if (req.url === '/_hub/health') {
    const probe = http.get({ hostname: upstream.hostname, port: upstream.port, path: '/', timeout: 2000 }, response => {
      response.resume();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ reachable: response.statusCode < 500, status: response.statusCode }));
    });
    probe.on('timeout', () => probe.destroy(new Error('timeout')));
    probe.on('error', () => {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ reachable: false }));
    });
    return;
  }
  const headers = forwardedHeaders(req, req.headers.host);
  const proxy = http.request({ hostname: upstream.hostname, port: upstream.port,
    path: req.url, method: req.method, headers }, response => {
    res.writeHead(response.statusCode || 502, proxiedHeaders(response.headers, req.headers.host));
    response.pipe(res);
  });
  proxy.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Hermes dashboard is unavailable. Start Hermes and reload this tab.');
  });
  req.pipe(proxy);
}

const servers = [];
for (const host of ['127.0.0.1', '::1']) {
  const server = http.createServer(proxyRequest);
  server.on('upgrade', (req, socket, head) => {
    if (!allowedHosts.has(req.headers.host)) return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    const peer = net.connect(upstream.port, upstream.hostname, () => {
      const headers = forwardedHeaders(req, req.headers.host);
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`,
        ...Object.entries(headers).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`), '', ''];
      peer.write(lines.join('\r\n'));
      if (head.length) peer.write(head);
      socket.pipe(peer).pipe(socket);
    });
    peer.on('error', () => socket.destroy());
    socket.on('error', () => peer.destroy());
  });
  server.listen({ host, port: 9132, ipv6Only: host.includes(':') }, () => {
    console.log(`Hermes loopback proxy: http://${host}:9132/`);
  });
  servers.push(server);
}

process.on('SIGTERM', () => servers.forEach(server => server.close()));
