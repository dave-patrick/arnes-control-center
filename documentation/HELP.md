# arnés help

## Run locally

Install Node.js 22 or later. Extract the source package and run npm start from its root, then open http://127.0.0.1:9130/. Existing services using ports 9130–9132 must be stopped or configured separately before running a second copy. The package does not install or start your connected services.

## Harness tabs

Use Add harness to save an HTTP or HTTPS dashboard address without embedded credentials. Select tabs to switch tools. Configure changes the selected connection; Reload refreshes its view. Open separately launches the service outside the embedded view. Collapse navigation gives more room to the dashboard. Tab settings persist in this browser.

## Control Center

System overview shows service probes and previously reported information. Refresh requests new checks. Add management page creates another dashboard tab; arrange and configure those tabs in the workspace. A failed probe can mean a service is stopped, authentication is required, or its example address needs configuration.

## Provider catalog

Search providers and models and use configured-provider navigation. API management and account consoles open separately when embedding is restricted. A listed model is catalog information, not proof that your account can use it.

## Balances and usage

Supported provider reports use your own environment variables or local Hermes credentials. Reports are scoped according to the provider API. A key spending limit is not necessarily an account balance. Missing credentials, unavailable reports and permission failures are shown as such.

## Gemini

Add your own Gemini API key in the Gemini tab. It is stored locally under your user's HarnessHub configuration, outside this repository. Model discovery uses the provider API. Requests and provider charges belong to your account.

## Codex and Hermes

The optional Codex bridge currently requires Windows and an authenticated npm-global Codex CLI at %APPDATA%/npm/node_modules/@openai/codex/bin/codex.js. Other Codex installation layouts are not discovered automatically. Run npm run bridge for the dedicated local bridge on port 9131. Hermes requires your existing dashboard on localhost:9119; npm run hermes-proxy serves the local proxy on 9132. Those commands provide access to local authenticated tools; keep them private.

## Addresses and privacy

The clean source uses localhost examples and hub.example.invalid as a reserved Tailnet placeholder. Adapt app/local-server.cjs, app/hermes-proxy.cjs and app/dist/app.js and control-center.js for your service layout. Configure matching trusted host and origin allowlists when adding a private host. Do not expose the bridge publicly or put credentials into URLs.

## Backups and troubleshooting

Browser tab settings are browser-local. Record your service addresses separately before clearing browser storage. Back up local Gemini configuration and provider settings privately. Check terminal output, configured addresses, service availability and port conflicts. Included screenshots show the existing workspace, not live health on your machine.

