const crypto = require('node:crypto');
const { secretStore } = require('../../secret-store.cjs');
const redirectUri = 'http://127.0.0.1:9140/hub/plugins/google/callback';
const scopes = ['gmail.readonly', 'calendar.readonly', 'drive.metadata.readonly', 'documents.readonly', 'spreadsheets.readonly', 'tasks.readonly'].map(s => 'https://www.googleapis.com/auth/' + s);
module.exports = ({ dataDir, PluginError, store = secretStore(dataDir), fetcher = fetch }) => {
  let pending = null;
  let authorization = 'idle';
  let refreshPromise;
  let busy = false;
  let activeOperation = Promise.resolve();
  let disposed = false;
  async function exclusive(operation) {
    if (disposed) throw new PluginError('Plugin was disabled. Enable it and retry.', 403);
    if (busy) throw new PluginError('Another Google connection operation is in progress.', 409);
    busy = true;
    try { activeOperation = operation(); return await activeOperation; } finally { busy = false; }
  }
  async function tokenRequest(params) {
    const response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams(params), signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new PluginError('Google authorization failed. Reconnect your account and check the OAuth client configuration.', 409);
    return data;
  }
  async function token() {
    const config = await store.read('google');
    if (!config.refreshToken) throw new PluginError('Connect your Google account first.', 409);
    if (config.accessToken && config.expiresAt > Date.now() + 60000) return config.accessToken;
    if (!refreshPromise) refreshPromise = exclusive(async () => {
      const current = await store.read('google');
      const data = await tokenRequest({ client_id: current.clientId, client_secret: current.clientSecret, refresh_token: current.refreshToken, grant_type: 'refresh_token' });
      await store.write('google', { ...current, accessToken: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 });
      return data.access_token;
    }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }
  async function api(url, accessToken) {
    if (disposed) throw new PluginError('Enable Google Workspace first.', 403);
    const response = await fetcher(url, { headers: { Authorization: 'Bearer ' + (accessToken || await token()) }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new PluginError(response.status === 403 ? 'Google denied access. Enable the required API in your Cloud project and grant its read permission when reconnecting.' : 'Google request failed (HTTP ' + response.status + '). Reconnect or retry.', response.status === 401 ? 409 : 502);
    return response.json();
  }
  function id(value, label) {
    if (typeof value !== 'string' || !/^[\w-]{1,256}$/.test(value)) throw new PluginError('Enter a valid ' + label + '.');
    return encodeURIComponent(value);
  }
  return {
    status: async () => {
      const config = await store.read('google');
      return { state: config.refreshToken ? 'connected' : config.clientId ? 'needs-connection' : 'needs-setup',
        detail: config.refreshToken ? 'Account authorized · read-only access (checked on use)' : config.clientId ? 'Ready to sign in with Google.' : 'Google sign-in is not configured for this Arnés installation yet.',
        redirectUri, scopes, authorization: authorization === 'pending' && pending && Date.now() > pending.expires ? 'expired' : authorization };
    },
    callback: url => exclusive(async () => {
      const state = url.searchParams.get('state');
      if (!pending || Date.now() > pending.expires || !state || state !== pending.state) throw new PluginError('Google connection expired or state did not match. Start Connect again.');
      const flow = pending;
      pending = null;
      if (url.searchParams.has('error')) throw new PluginError('Google consent was declined. Return to Plugins to try again.');
      const code = url.searchParams.get('code');
      if (!code || code.length > 4096) throw new PluginError('Google did not return an authorization code.');
      const config = await store.read('google');
      const data = await tokenRequest({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, code_verifier: flow.verifier, grant_type: 'authorization_code' });
      if (!data.refresh_token) throw new PluginError('Google did not return offline access. Revoke the prior app grant and reconnect.', 409);
      await store.write('google', { ...config, refreshToken: data.refresh_token, accessToken: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 });
      authorization = 'completed';
      return { popup: flow.popup };
    }).catch(error => { if (!pending) authorization = 'failed'; throw error; }),
    actions: {
      configure: input => exclusive(async () => {
        if ((await store.read('google')).refreshToken) throw new PluginError('Disconnect the current account before changing its OAuth client.', 409);
        if (typeof input.clientId !== 'string' || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(input.clientId.trim()) ||
          typeof input.clientSecret !== 'string' || input.clientSecret.length < 8 || input.clientSecret.length > 1024) throw new PluginError('Enter the client ID and secret from a Google OAuth web application.');
        pending = null;
        await store.write('google', { clientId: input.clientId.trim(), clientSecret: input.clientSecret.trim() });
        return { message: 'Client saved. Add the exact redirect URI to this OAuth client, then connect your account.', redirectUri };
      }),
      connect: async ({ popup = false } = {}) => {
        const config = await store.read('google');
        if (!config.clientId) throw new PluginError('Google sign-in is not configured for this Arnés installation yet. Add the app’s OAuth client once to enable account sign-in.', 409);
        pending = { state: crypto.randomBytes(32).toString('hex'), verifier: crypto.randomBytes(48).toString('base64url'), expires: Date.now() + 600000, popup: popup === true };
        authorization = 'pending';
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'select_account consent', state: pending.state,
          code_challenge: crypto.createHash('sha256').update(pending.verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
        return { authorizationUrl: url.href };
      },
      disconnect: () => exclusive(async () => {
        const config = await store.read('google');
        pending = null;
        authorization = 'idle';
        let revoked = true;
        if (config.refreshToken) {
          try { revoked = (await fetcher('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: config.refreshToken }), signal: AbortSignal.timeout(10000) })).ok; }
          catch { revoked = false; }
        }
        await store.write('google', { clientId: config.clientId, clientSecret: config.clientSecret });
        return { message: revoked ? 'Google disconnected; local tokens removed.' : 'Local tokens removed. Google revocation failed; remove this app in your Google account permissions too.' };
      }),
      mail: async () => {
        // Decrypt once per batch rather than spawning a DPAPI helper for every message.
        const accessToken = await token();
        const list = await api('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=is%3Aunread', accessToken);
        const messages = await Promise.all((list.messages || []).map(message => api('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + id(message.id, 'message ID') + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date', accessToken)));
        return { messages: messages.map(message => ({ id: message.id, snippet: message.snippet, headers: message.payload?.headers || [] })), nextPageToken: list.nextPageToken };
      },
      calendars: async () => api('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250&minAccessRole=reader'),
      calendar: async ({calendarId='primary'}={}) => {
        if(typeof calendarId!=='string'||!calendarId.trim()||calendarId.length>1024||/[\x00-\x1f]/.test(calendarId)) throw new PluginError('Choose a valid calendar.');
        return api('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId)+'/events?singleEvents=true&orderBy=startTime&maxResults=20&timeMin=' + encodeURIComponent(new Date().toISOString()));
      },
      drive: async () => api('https://www.googleapis.com/drive/v3/files?pageSize=30&orderBy=modifiedTime%20desc&q=trashed%3Dfalse&fields=files(id,name,mimeType,modifiedTime,webViewLink)'),
      tasklists: async () => api('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100'),
      tasks: async ({ listId }) => api('https://tasks.googleapis.com/tasks/v1/lists/' + id(listId, 'task list ID') + '/tasks?maxResults=100'),
      document: async ({ documentId }) => api('https://docs.googleapis.com/v1/documents/' + id(documentId, 'document ID')),
      spreadsheet: async ({ spreadsheetId, range }) => {
        if (typeof range !== 'string' || !range.trim() || range.length > 200) throw new PluginError('Enter a spreadsheet range under 200 characters.');
        return api('https://sheets.googleapis.com/v4/spreadsheets/' + id(spreadsheetId, 'spreadsheet ID') + '/values/' + encodeURIComponent(range));
      }
    },
    dispose: async () => { pending = null; disposed = true; await activeOperation.catch(() => {}); }
  };
};
