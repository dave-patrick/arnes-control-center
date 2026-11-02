# arnes-control-center: project context

## Overview
Software project in arnes-control-center. See existing project documentation for its purpose.

## Existing guidance
- Inspect the project documentation and source before making changes.

## Stack evidence
- Determine the stack from the source and build files; do not assume one.

## Conventions
- Preserve existing project instructions, configuration, credentials, and application data.
- Use Graft for code context when available, following the global and project Graft guidance.
- Keep this context accurate as project architecture and conventions are established.
- Herald compiler output replaces vendor files. Preserve and merge existing guidance before compiling.

- app/ is the cleaned local Node workspace; site/ is the public static landing/help site. Never commit private settings or change the running original workspace. See documentation/ARCHITECTURE.md.

- The app publisher is Atomic 22 Industries. Keep publisher.json, package metadata and first-party app/site credits consistent; preserve existing licence and third-party attribution.

- Public landing pages use dark app-specific compositions with real approved brand assets; shared Atomic 22 navigation links to the blue Notes directory. Publish only site/ via GitHub Pages. Never serve or publish private workspace data.

## Plugin capabilities
- The plugin host lives in app/plugin-host.cjs. Built-ins live in app/plugins/<id>/{manifest.json,index.cjs}; the Plugins UI is app/dist/plugins.{html,css,js}.
- Require apiVersion 1, unique IDs, declared permissions, explicit enable/grants, input validation, and lifecycle disposal. Added permissions require renewed grants.
- Plugins are trusted in-process Node code; permission declarations do not sandbox modules. Never imply arbitrary third-party plugins are contained.
- Privileged plugin APIs are loopback-only on the current local port 9140, require exact-origin JSON POST and a session token, and exclude the Tailnet host. OAuth callback state is the explicit navigation exception.
- Google client credentials/tokens belong in the OS-user-protected store outside source. Windows uses DPAPI. Never return secrets in API status, logs, UI results, or tests.
- npm run test:plugins covers grants, local shell termination/output, OAuth, and credential storage without a real Google account. The optional browser smoke script requires PLAYWRIGHT_MODULE pointing to an installed Playwright module and CHROME_PATH when the default installed Chrome path differs.
- Keep documentation/PLUGINS.md current. Existing health/provider/harness routes have not been migrated into plugins.

- Google sign-in is a dedicated one-click popup action. The click grants the built-in read access and enables the plugin; do not reintroduce client-secret/JSON-file fields into the normal account flow. Installation client provisioning is separate. Request select_account consent, keep state/PKCE checks, and test popup completion with google-connected.html plus parent status polling. Google project audience/test restrictions still control allowed accounts.

## Homepage
- Home is the default workspace tab. app/dist/home.{html,css,js} renders eight configurable widgets; home-model.js normalizes browser-local layout settings. Keep personal API data in memory, never browser persistence. See documentation/HOMEPAGE.md.
- Google widgets use existing read-only plugin actions; Keep and Voice are explicitly labeled shortcuts. GitHub is a separately enabled built-in using fixed gh GET arguments without a shell, bounded output, and a timeout. Do not enable new plugins implicitly.
- Workspace iframe creation is lazy. Validate same-origin/source messages from the Home iframe before navigating to a known tab. Preserve existing saved harnesses.

- Calendar and task widgets support multiple selected sources. Keep empty selections intentional and discard stale asynchronous results per widget body. GitHub expansion accepts only validated owner/repo names and invokes fixed read-only endpoints.
- app/service-config.cjs loads local service URLs from AppData/Arnes/services.json (or ARNES_SERVICES_FILE), outside source. Health probes and Control Center links must share those URLs. Respect frame restrictions; Hark and Home Assistant open separately.
