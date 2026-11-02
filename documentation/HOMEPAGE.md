# Homepage widgets

The workspace opens Home by default. Existing harness tabs stay in the sidebar and load when selected. The brand returns to Home; the Plugins page also has Back to home.

## Customize

Click Customize to show/hide widgets, drag them into order or use Move earlier/later, change titles, choose one/two column widths, and set item limits. Google Tasks supports choosing a task list. Keep and Voice support a browser Google account index (account 1 is /u/0). Automatic refresh can be off, one minute, five minutes (default), or fifteen minutes. Restore default layout only resets homepage preferences.

Preferences use `arnes-home-widgets-v1` in this browser. The model normalizes invalid saved settings, deduplicates widgets, and adds newly introduced widgets. Existing harness preferences retain their original storage key. Message, event, task, and repository contents are kept in memory only and are never written to localStorage. API requests remain subject to the plugin host permissions and loopback restrictions.

## Data sources

- Gmail: up to 20 unread message headers, displayed to the configured limit.
- Calendar: up to 20 upcoming events from the connected account’s primary calendar.
- Google Tasks: up to 100 task lists and 100 tasks in the selected list; show incomplete tasks only.
- GitHub: up to 20 recently updated repositories, using this PC’s `gh` account. Click Enable GitHub to grant `github.read` and `process.execute.gh`. The built-in adapter invokes a fixed `gh api --method GET` endpoint without a shell, with a timeout and bounded output. No CLI tokens are returned.
- My harnesses: saved workspace tabs with existing live status checks and links into the workspace.
- Control Center: live service probes, excluding historical reports; use Manage for the full view.
- Google Keep: shortcut to the selected browser account. The enterprise Keep API does not support personal Google accounts; notes are not synchronized into this widget.
- Google Voice: shortcuts to messages, calls, and voicemail in the selected browser account. No message contents or unread counts are fetched. Messaging and calls happen on Google Voice.

Google authorization happens through the existing Plugins sign-in popup. Returning to Home refreshes connection status. Each widget has an independent loading, error, and empty state. Errors provide a connection link or Retry.

## Verification

`npm run test:home` covers saved-state migration, reorder persistence, and the GitHub adapter’s fixed read endpoint/error handling. `node scripts/home-browser-smoke.cjs` uses fixture data and installed Chrome/Playwright to verify configuration, persistence, navigation, connection states, and mobile overflow; captures go to ignored artifacts/. `npm run test:plugins` covers the shared permission/OAuth boundary.

## Activity and source selection

Customize now offers calendar and task-list checkboxes. Select multiple sources to combine them; clearing every checkbox intentionally clears that widget. Legacy task-list preferences migrate automatically. Entries include their calendar or list name. Stale requests cannot overwrite a newer selection. Calendar lists are read with the existing calendar.readonly grant.

GitHub rows show the latest available repository event (or last-push fallback). Expand Repository details for recent activity, commits, and open pull requests. Event feeds may be delayed by GitHub. No GitHub writes are performed.

## Machine service addresses

The local server reads `%LOCALAPPDATA%/Arnes/services.json` (or ARNES_SERVICES_FILE) once at startup. Its services map overrides known service IDs with HTTP(S) URLs; credentials and arbitrary IDs are rejected/ignored. Keep this machine configuration outside source. Control Center receives these addresses and uses the same targets as its health probes. Home Assistant opens separately because its frame policy blocks embedding. Hark also opens separately for sign-in.
