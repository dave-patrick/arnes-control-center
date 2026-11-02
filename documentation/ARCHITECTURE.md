# Architecture and privacy

The main server binds only to 127.0.0.1:9140 and serves app/dist. Routes under /hub provide health checks, Gemini requests, provider configuration/metrics and Codex bridge operations. app/bridge-server.cjs exposes a separate local bridge on 9141; app/hermes-proxy.cjs proxies the existing Hermes dashboard through 9142. app/codex-bridge.cjs launches the user's Codex CLI when requested.

The frontend is static HTML, CSS and JavaScript. Browser localStorage persists navigation settings and connection addresses. Provider metrics read process environment and conventional local Hermes .env files; Gemini configuration is stored under the user's local HarnessHub directory. Keys are not packaged with source or returned as metrics. Provider requests send credentials to their respective APIs.

Connected services, provider accounts, Codex authentication and Hermes are external dependencies. Example endpoint addresses must be adapted to your environment. External consoles may reject framing and must open separately.

Keep this local/private. The bridge can invoke authenticated local tools. Host/origin allowlists and loopback binding are part of the boundary; the server has no general public-user authentication layer. Do not publish a reverse proxy to this workspace without a separate authenticated private access design.

Public site publication serves site/ only; it does not run these servers or expose local configuration. Screenshot captures are historical and contain example private-network service addresses from the existing setup, not credentials.


## Plugin host

`app/plugin-host.cjs` discovers version-1 manifests in `app/plugins/` and the optional `ARNES_PLUGIN_DIR`, gates actions on persisted permission grants, lazily instantiates enabled plugins, and calls their disposal hook on disable/shutdown. The browser interface is `app/dist/plugins.html`; the main navigation includes it without changing saved tab IDs.

`/hub/plugins` and its action routes are restricted to direct loopback access on port 9140. They enforce origin/CSRF checks independently of the existing dashboard routes. The OAuth callback permits browser navigation from Google but checks one-use state and PKCE. Plugin code is trusted Node code, not a sandbox. Existing service/provider integrations retain their existing routes.

Local shell is a noninteractive process runner with output/time/concurrency limits and process-tree cancellation. Google Workspace implements server-side read-only OAuth actions; `app/secret-store.cjs` uses DPAPI on Windows. State and credential files live outside source by default. See [the plugin guide](PLUGINS.md) for paths, supported actions, trust limits, and authoring.
