# Architecture and privacy

The main server binds only to 127.0.0.1:9130 and serves app/dist. Routes under /hub provide health checks, Gemini requests, provider configuration/metrics and Codex bridge operations. app/bridge-server.cjs exposes a separate local bridge on 9131; app/hermes-proxy.cjs proxies the existing Hermes dashboard through 9132. app/codex-bridge.cjs launches the user's Codex CLI when requested.

The frontend is static HTML, CSS and JavaScript. Browser localStorage persists navigation settings and connection addresses. Provider metrics read process environment and conventional local Hermes .env files; Gemini configuration is stored under the user's local HarnessHub directory. Keys are not packaged with source or returned as metrics. Provider requests send credentials to their respective APIs.

Connected services, provider accounts, Codex authentication and Hermes are external dependencies. Example endpoint addresses must be adapted to your environment. External consoles may reject framing and must open separately.

Keep this local/private. The bridge can invoke authenticated local tools. Host/origin allowlists and loopback binding are part of the boundary; the server has no general public-user authentication layer. Do not publish a reverse proxy to this workspace without a separate authenticated private access design.

Public site publication serves site/ only; it does not run these servers or expose local configuration. Screenshot captures are historical and contain example private-network service addresses from the existing setup, not credentials.

