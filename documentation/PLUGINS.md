# Arnés plugins

The Plugins tab adds local capabilities alongside the existing dashboards. Run `npm start` and open http://127.0.0.1:9140/plugins.html on this PC. Plugins start disabled. Review required access and enable each plugin before using its actions.

## Included capabilities

- **Local shell:** noninteractive PowerShell on Windows, or /bin/sh on POSIX. Choose an absolute working directory and run a command. Output is bounded to 1 MiB per job; time limits are 1–120 seconds. Up to three jobs run concurrently. Cancel terminates the process tree; disabling the plugin cancels active jobs. Each command starts a fresh shell, so directory/environment changes do not carry to the next command. This is not a terminal emulator. Shell access has the same authority as the user running Arnés.
- **Google Workspace:** read unread mail metadata/snippets, upcoming primary-calendar events, recent Drive file metadata, task lists/tasks, a Doc by ID, and a spreadsheet range. Results are currently presented as structured data. List actions return a bounded first page. Google can return pagination tokens, but this UI does not yet browse subsequent pages. No email sending or account-data editing actions are included.

## Sign in to Google

Click **Sign in with Google** in the Google Workspace plugin. This enables its read-only access and opens a popup immediately, so the browser can allow it from your click. Choose an existing Google account or add another account, approve access, and return to Arnés. The popup closes automatically after the server validates the OAuth callback; the workspace refreshes the connection status. If your browser blocks popups, allow them for the local Arnés origin and click again.

No OAuth client IDs, secrets, or JSON files are requested in the normal sign-in screen. Use **Switch Google account** to open the chooser again, or **Disconnect Google account** to remove the active connection. This version keeps one active account per Arnés installation, rather than simultaneous connections to multiple accounts.

### One-time application configuration

The installation still needs a registered OAuth client **for Arnés**, configured behind the sign-in button. This is application configuration, separate from each account holder signing in. When no client is saved, the Google Workspace panel shows a one-time setup form for the client ID and secret, and enables the plugin when you save. Existing installations keep a previously saved client. Credential fields and configure/connect/disconnect stay excluded from the generic action picker. Do not use another application's credentials without authorization.

The web client must authorize this exact redirect URI: `http://127.0.0.1:9140/hub/plugins/google/callback`. Enable Gmail, Calendar, Drive, Docs, Sheets, and Tasks APIs as needed. Keep client credentials in the protected server-side store. An unconfigured installation reports that Google sign-in needs application configuration; it never substitutes a fake client.

The account chooser has no fixed account or login hint and requests `prompt=select_account consent`. Which accounts Google permits still depends on the OAuth project's audience, publishing/test status, verification, and organization policies. External testing apps requesting Workspace scopes generally require accounts to be added as test users; an internal app is limited to its organization. See [Google's OAuth app state guide](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) and [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).

OAuth uses a one-use, ten-minute state and PKCE challenge, server-side code exchange, and refresh tokens. The callback selects a dedicated popup-completion page; no credentials enter the browser response. The parent polls local status, so completion works even when Google severs the opener relationship or the workspace uses localhost while the callback uses 127.0.0.1. Partial consent or a disabled API produces an access error. A connected status means saved authorization exists; it is not a live API health check.

Disconnect removes local account tokens and attempts to revoke the Google grant. If revocation fails, the result tells you to remove the grant in your Google account. Disable stops access inside Arnés but retains the saved connection; use Disconnect first to remove it.

## Local state and access

Default data lives outside the repository at `%LOCALAPPDATA%/Arnes/plugins` on Windows, or `~/.local/share/Arnes/plugins` on POSIX. `ARNES_DATA_DIR` overrides the directory, useful for isolated development/tests.

- `state.json` stores enabled plugin IDs and granted permission names.
- `google.secret` stores OAuth client credentials and account tokens. On Windows, DPAPI protects it for the current OS user. On POSIX it is a plaintext file with requested mode 0600 inside a mode-0700 directory; use an appropriately protected account/filesystem.
- `activity.jsonl` stores only action metadata: time, plugin, action, outcome. It rotates at 1 MiB and retains one previous file. The UI shows up to 100 events from the current server session; polling shell jobs does not generate activity. Commands, output, and Google responses are excluded. Shell job output stays in memory (up to 50 jobs, pruned on new runs).
- Adding declared permissions to an updated plugin requires renewed enable/grant approval. Disabling/restarting clears its in-memory shell jobs.

Plugin APIs require the direct loopback host on port 9140, reject other origins/cross-site reads, and require a per-server token plus same-origin JSON POST for actions. OAuth callback navigation is the one cross-site exception and validates its one-use state. These routes are unavailable through the Tailnet host; use the direct local URL.

**Trusted code only:** plugins run as Node modules inside the Arnés process, with the full access of that process. Permission declarations gate activation through the host; they do not sandbox plugin code or contain malicious code. This release does not include marketplace downloads, package installation, process isolation, or remote access to privileged actions. Do not expose this app publicly.

## Create another plugin

Keep first-party plugins in `app/plugins/<id>/`. For your own plugins, set `ARNES_PLUGIN_DIR` to a directory containing plugin folders, then restart Arnés. Do not reuse a built-in ID. Each folder contains `manifest.json` and `index.cjs`. Discovery does not execute disabled plugins. A malformed/duplicate manifest fails the plugin host closed with an error; the existing app remains available.

Example manifest:

```json
{
  "apiVersion": 1,
  "id": "hello-world",
  "name": "Hello world",
  "version": "1.0.0",
  "description": "A small local capability.",
  "permissions": [],
  "actions": [
    {
      "id": "greet",
      "title": "Greet",
      "fields": [{"name": "name", "label": "Your name", "required": true}]
    }
  ]
}
```

```js
module.exports = ({ PluginError }) => ({
  status: async () => ({ state: 'ready', detail: 'Available locally.' }),
  actions: {
    greet: async ({ name }) => {
      if (typeof name !== 'string' || name.length > 100) {
        throw new PluginError('Enter a name under 100 characters.');
      }
      return { greeting: 'Hello, ' + name };
    }
  },
  dispose: async () => { /* stop background work here */ }
});
```

The factory receives `{ dataDir, PluginError }`. The host lazily creates one instance per enabled plugin. Implement `status()`, `actions`, and optional `dispose()`. Actions accept a JSON object and return JSON-serializable results. Validate inputs in the implementation. Supported form fields: text (default), password, number, textarea; `name`, `label`, `required`, `placeholder`, `value`. Set an action's `audit: false` only for frequent read-only polling. Host errors use `new PluginError(message, httpStatus)`; other errors return a generic client message.

API:

- `GET /hub/plugins`: manifests, enable/connection status, session action token, current-session activity.
- `POST /hub/plugins/:id/enable`: `{ "enabled": true, "grants": ["permission.name"] }`.
- `POST /hub/plugins/:id/actions/:action`: action input.
- POST headers: `Content-Type: application/json`, exact local `Origin`, `X-Arnes-Token`.

Existing Gemini, Codex, provider metrics and service health routes remain in their original implementations. They have not been migrated to plugins. Future work can migrate these adapters, add richer Google views, then introduce cross-plugin workflows over the common action API.

## Verification

`npm run check`, `npm run check:site`, and `npm run test:plugins` verify source/assets and regression tests. Tests use temporary data and fake Google responses; a real Google account still needs the OAuth setup and consent above.

## GitHub

The GitHub built-in reads recently updated repositories using this PC’s existing GitHub CLI authentication. Its declared permissions are `github.read` and `process.execute.gh`. It is disabled until explicitly enabled in Plugins or the Home widget. Only a fixed GET endpoint is invoked; arbitrary commands, endpoints, and writes are not supported. Responses omit authentication data.
