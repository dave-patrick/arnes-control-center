const $ = id => document.getElementById(id);
let plugins = [];
let selected = null;
let token = '';
let busy = false;
let pollTimer = null;
let googleTimer = null;
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; }
async function request(route, input) {
  const response = await fetch('/hub/plugins' + route, input === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Arnes-Token': token }, body: JSON.stringify(input)
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Request failed. Refresh and try again.');
  return data;
}
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }
function renderActivity(events) {
  $('activity').replaceChildren();
  if (!events.length) $('activity').append(node('li', 'No actions in this server session yet.'));
  for (const event of events.slice(0, 12)) {
    const row = node('li');
    const time = node('time', new Date(event.at).toLocaleString());
    time.dateTime = event.at;
    row.append(time, node('span', event.plugin + ' / ' + event.action), node('span', event.outcome, 'outcome'));
    $('activity').append(row);
  }
}
async function refresh(render = true) {
  const data = await request('');
  plugins = data.plugins;
  token = data.token;
  if (!plugins.some(p => p.id === selected)) selected = plugins[0]?.id;
  $('plugins').replaceChildren();
  for (const plugin of plugins) {
    const button = node('button');
    button.type = 'button';
    button.setAttribute('aria-current', String(plugin.id === selected));
    button.append(node('strong', plugin.name), node('small', plugin.enabled ? plugin.status.state.replaceAll('-', ' ') : 'Disabled'));
    button.onclick = () => { if (busy) return; stopPolling(); selected = plugin.id; refresh().catch(showError); };
    $('plugins').append(button);
  }
  renderActivity(data.activity);
  if (render) renderDetail();
  else {
    const status = $('detail').querySelector('.status');
    const plugin = plugins.find(p => p.id === selected);
    if (status && plugin) status.textContent = plugin.status.detail;
  }
}
function showError(error) { message(error.message || 'Something went wrong. Refresh and retry.', true); }
function googleSetupForm(plugin) {
  const form = node('form', undefined, 'google-setup');
  const clientId = node('input');
  const clientSecret = node('input');
  clientId.type = 'text'; clientId.name = 'clientId'; clientId.id = 'google-client-id'; clientId.required = true; clientId.autocomplete = 'off';
  clientSecret.type = 'password'; clientSecret.name = 'clientSecret'; clientSecret.id = 'google-client-secret'; clientSecret.required = true; clientSecret.autocomplete = 'new-password';
  const idLabel = node('label', 'OAuth client ID');
  idLabel.htmlFor = clientId.id;
  const secretLabel = node('label', 'OAuth client secret');
  secretLabel.htmlFor = clientSecret.id;
  const save = node('button', 'Save Google client');
  save.type = 'submit';
  form.append(node('h3', 'One-time application setup'),
    node('p', 'In Google Cloud, create an OAuth web client for Arnés and add this exact redirect URI: ' + plugin.status.redirectUri, 'connection-note'),
    idLabel, clientId, secretLabel, clientSecret, save);
  form.onsubmit = event => {
    event.preventDefault();
    if (busy) return;
    perform(async () => {
      if (!plugin.enabled) await request('/google-workspace/enable', { enabled: true, grants: plugin.permissions });
      const data = await request('/google-workspace/actions/configure', Object.fromEntries(new FormData(form)));
      message(data.message);
      await refresh();
    });
  };
  return form;
}
function renderGoogleAccount(plugin, detail) {
  const connected = plugin.enabled && plugin.status.state === 'connected';
  detail.append(node('h2', plugin.name), node('p', 'Connect your Google account to read Gmail, Calendar, Drive, Docs, Sheets, and Tasks.'),
    node('p', connected ? plugin.status.detail : 'Choose an account in Google’s sign-in window.', 'status'));
  const signIn = node('button', connected ? 'Switch Google account' : 'Sign in with Google', 'google-signin');
  signIn.type = 'button';
  signIn.onclick = () => {
    if (busy) return;
    // Open synchronously inside the click gesture, before any network awaits.
    const popup = window.open('about:blank', '_blank', 'popup=yes,width=520,height=720');
    if (!popup) { message('Allow popups for Arnés, then click Sign in with Google again.', true); return; }
    popup.opener = null;
    perform(async () => {
      try {
        if (!plugin.enabled) await request('/google-workspace/enable', { enabled: true, grants: plugin.permissions });
        const data = await request('/google-workspace/actions/connect', { popup: true });
        const url = new URL(data.authorizationUrl);
        if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') throw Error('Unexpected Google sign-in address.');
        popup.location.replace(url.href);
        message('Finish signing in and approving access in the Google window.');
        await refresh(false);
        watchGoogleSignIn();
      } catch (error) {
        popup.close();
        await refresh();
        throw error;
      }
    });
  };
  if (plugin.status.state === 'needs-setup') detail.append(googleSetupForm(plugin));
  else detail.append(signIn, node('p', 'Signing in enables this plugin’s read-only access. Google asks you which permissions to allow.', 'connection-note'));
  if (plugin.enabled) {
    const disconnect = node('button', connected ? 'Disconnect Google account' : 'Disable Google Workspace');
    disconnect.type = 'button';
    disconnect.onclick = () => perform(async () => {
      clearTimeout(googleTimer);
      if (connected) {
        const result = await request('/google-workspace/actions/disconnect', {});
        message(result.message);
      } else message('Google Workspace disabled.');
      await request('/google-workspace/enable', { enabled: false, grants: [] });
      await refresh();
    });
    detail.append(disconnect);
  }
}
function watchGoogleSignIn() {
  clearTimeout(googleTimer);
  googleTimer = setTimeout(async () => {
    try {
      const data = await request('');
      const google = data.plugins.find(p => p.id === 'google-workspace');
      if (!google?.enabled) return;
      if (google.status.authorization === 'completed' && google.status.state === 'connected') {
        await refresh(selected === 'google-workspace');
        message('Google account connected. Choose an action to begin.');
      } else if (['failed', 'expired'].includes(google.status.authorization)) {
        await refresh(selected === 'google-workspace');
        message('Google sign-in wasn’t completed. Click Sign in with Google to try again.', true);
      } else watchGoogleSignIn();
    } catch (error) { showError(error); }
  }, 2500);
}

function renderDetail() {
  stopPolling();
  const detail = $('detail');
  detail.replaceChildren();
  detail.setAttribute('aria-busy', 'false');
  const plugin = plugins.find(p => p.id === selected);
  if (!plugin) { detail.append(node('p', 'No plugins found. Add a plugin folder and restart Arnés.')); return; }
  if (plugin.id === 'google-workspace') {
    renderGoogleAccount(plugin, detail);
    if (!plugin.enabled || plugin.status.state !== 'connected') return;
  } else {
  detail.append(node('h2', plugin.name), node('p', plugin.description), node('p', plugin.status.detail, 'status'), node('h3', 'Required access'));
  const permissions = node('ul', undefined, 'permissions');
  for (const permission of plugin.permissions) permissions.append(node('li', permission));
  detail.append(permissions);
  const toggle = node('button', plugin.enabled ? 'Disable plugin' : 'Enable plugin');
  toggle.type = 'button';
  if (!plugin.enabled) {
    const label = node('label', undefined, 'grant');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.onchange = () => { toggle.disabled = !checkbox.checked; };
    label.append(checkbox, node('span', 'I trust this plugin and grant the access listed above.'));
    detail.append(label);
    toggle.disabled = true;
  }
  toggle.onclick = () => perform(async () => {
    await request('/' + plugin.id + '/enable', { enabled: !plugin.enabled, grants: plugin.permissions });
    message(plugin.name + (plugin.enabled ? ' disabled.' : ' enabled.'));
    await refresh();
  });
  detail.append(toggle);
  if (!plugin.enabled) return;
  }
  const availableActions = plugin.actions.filter(action => plugin.id !== 'google-workspace' || !['configure', 'connect', 'disconnect'].includes(action.id));
  const label = node('label', 'Action'); label.htmlFor = 'action';
  const select = node('select'); select.id = 'action';
  for (const action of availableActions) select.append(new Option(action.title, action.id));
  detail.append(label, select);
  const form = node('form'); form.id = 'action-form';
  const result = node('section'); result.id = 'result'; result.setAttribute('aria-label', 'Action result');
  detail.append(form, result);
  function actionForm() {
    stopPolling();
    result.replaceChildren();
    form.replaceChildren();
    const action = availableActions.find(a => a.id === select.value);
    for (const field of action.fields || []) {
      const label = node('label', field.label); label.htmlFor = 'field-' + field.name;
      const input = node(field.type === 'textarea' ? 'textarea' : 'input');
      if (field.type !== 'textarea') input.type = ['password', 'number'].includes(field.type) ? field.type : 'text';
      input.id = label.htmlFor; input.name = field.name; input.required = Boolean(field.required);
      input.placeholder = field.placeholder || ''; input.value = field.value || '';
      input.autocomplete = 'off';
      if (input.type === 'password') input.autocomplete = 'new-password';
      if (input.type === 'number') { input.min = '1'; input.max = '120'; }
      form.append(label, input);
    }
    const submit = node('button', action.title, 'primary'); submit.type = 'submit'; form.append(submit);
  }
  select.onchange = actionForm;
  form.onsubmit = event => {
    event.preventDefault();
    const action = select.value;
    const input = Object.fromEntries(new FormData(form));
    perform(async () => {
      const data = await request('/' + plugin.id + '/actions/' + action, input);
      for (const password of form.querySelectorAll('input[type=password]')) password.value = '';
      showResult(plugin, data);
      message(plugin.name + ': action completed.');
      await refresh(false);
      if (plugin.id === 'local-shell' && (action === 'run' || action === 'jobs')) pollJobs(plugin);
    });
  };
  actionForm();
}
function showResult(plugin, data) {
  const result = $('result');
  if (!result) return;
  result.replaceChildren(node('h3', 'Result'));
  if (data.authorizationUrl) {
    const url = new URL(data.authorizationUrl);
    if (url.origin !== 'https://accounts.google.com') throw Error('Unexpected authorization address.');
    const link = node('a', 'Continue to Google to choose an account and grant access');
    link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; result.append(link);
    return;
  }
  const jobs = data.jobs || (plugin.id === 'local-shell' && data.id ? [data] : null);
  if (jobs) {
    if (!jobs.length) result.append(node('p', 'No shell jobs in this server session.'));
    for (const job of jobs) {
      result.append(node('h3', job.state + ' · ' + job.id), node('p', job.cwd + (job.exitCode === null ? '' : ' · exit ' + job.exitCode)));
      result.append(node('pre', (job.stdout || '') + (job.stderr ? '\n' + job.stderr : '') || 'No output yet.'));
      if (['running', 'stopping'].includes(job.state)) {
        const cancel = node('button', job.state === 'stopping' ? 'Cancelling…' : 'Cancel job');
        cancel.disabled = job.state === 'stopping';
        cancel.onclick = () => perform(async () => { showResult(plugin, await request('/' + plugin.id + '/actions/cancel', { id: job.id })); pollJobs(plugin); });
        result.append(cancel);
      }
    }
  } else result.append(node('pre', JSON.stringify(data, null, 2)));
}
function pollJobs(plugin) {
  stopPolling();
  pollTimer = setTimeout(async () => {
    if (selected !== plugin.id || document.hidden) return;
    try {
      const data = await request('/' + plugin.id + '/actions/jobs', {});
      showResult(plugin, data);
      if (data.jobs.some(j => ['running', 'stopping'].includes(j.state))) pollJobs(plugin);
      else { message('Shell jobs finished.'); await refresh(false); }
    } catch (error) { showError(error); }
  }, 1000);
}
async function perform(operation) {
  if (busy) return;
  busy = true;
  document.body.setAttribute('aria-busy', 'true');
  const controls = [...document.querySelectorAll('button,input,textarea,select')].map(element => ({ element, disabled: element.disabled }));
  for (const { element } of controls) element.disabled = true;
  try { await operation(); } catch (error) { showError(error); }
  finally {
    busy = false;
    for (const { element, disabled } of controls) if (element.isConnected) element.disabled = disabled;
    document.body.setAttribute('aria-busy', 'false');
  }
}
$('refresh').onclick = () => perform(async () => { await refresh(); message('Plugin status refreshed.'); });
window.addEventListener('pagehide', () => { stopPolling(); clearTimeout(googleTimer); });
refresh().then(() => message(new URLSearchParams(location.search).has('connected') ? 'Google account connected. Choose an action to begin.' : 'Plugins are managed locally on this PC.')).catch(showError);
