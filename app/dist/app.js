const $ = id => document.getElementById(id);
const key = 'harness-hub-tabs-v1';
const tailnetName = 'hub.example.invalid';
const localHub = (['127.0.0.1', 'localhost'].includes(location.hostname) && location.port === '9130') || location.hostname === tailnetName;
const tailnetHubUrl = `https://${tailnetName}/`;
const loopbackHub = ['127.0.0.1', 'localhost'].includes(location.hostname) && location.port === '9130';
const hermesUrl = loopbackHub ? `http://${location.hostname}:9132/` : `https://${tailnetName}:8443/`;
const builtInTabs = [
  { id: 'codex', name: 'Codex', url: 'http://127.0.0.1:9131/codex.html' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app' },
  { id: 'hark', name: 'Hark', url: 'https://hark.com/chat' },
  { id: 'antigravity', name: 'Antigravity', url: 'https://antigravity.google.com/' },
  { id: 'herdr', name: 'Herdr', url: new URL('herdr.html', location.href).href },
  { id: 'dsh', name: 'DSH', url: 'http://127.0.0.1:3080/' },
  { id: 'providers', name: 'Providers', url: new URL('providers.html', location.href).href },
  { id: 'control-center', name: 'Control Center', url: new URL('control-center.html', location.href).href }
];
let tabs = [{ id: 'hermes', name: 'Hermes', url: hermesUrl }];
let active = 'hermes';
let editing = null;
let geminiHistory = [];
let navStatusTimer = null;

const dark = document.createElement('link');
dark.rel = 'stylesheet';
dark.href = 'dark.css?v=20261013-scrollbars';
document.head.append(dark);
$('notice').querySelector('p').firstChild.textContent = 'Hermes connects over your private Tailnet. For a same-site sign-in, use ';

function valid(raw) {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw Error('Use an HTTP or HTTPS dashboard address without embedded credentials.');
  return u.href;
}

function save() {
  try { localStorage.setItem(key, JSON.stringify(tabs)); }
  catch { $('state').textContent = 'Browser storage unavailable; tabs last for this visit.'; }
}

function addBuiltIns() {
  for (const builtIn of builtInTabs) {
    const found = tabs.find(t => t.id === builtIn.id);
    if (!found) tabs.push({ ...builtIn });
  }
  if (!tabs.some(t => t.id === 'codex' || t.name.toLowerCase() === 'codex')) tabs.push({ ...builtInTabs[0] });
}

try {
  const data = JSON.parse(localStorage.getItem(key));
  if (Array.isArray(data) && data.length && data.length <= 50) {
    tabs = data.filter(t => typeof t.id === 'string' && typeof t.name === 'string' && t.name.trim()).map(t => {
      let url = valid(t.url);
      const savedUrl = new URL(url);
      if (t.id === 'hermes' && (savedUrl.hostname === '127.0.0.1' && savedUrl.port === '9119' || ['127.0.0.1', 'localhost', tailnetName].includes(savedUrl.hostname) && savedUrl.port === '9132')) url = hermesUrl;
      return { ...t, url };
    });
    if (!tabs.length) tabs = [{ id: 'hermes', name: 'Hermes', url: hermesUrl }];
  }
} catch { /* Start with the default tab set when stored data is invalid. */ }
addBuiltIns();
save();

async function checkConnection(t) {
  if (!localHub || t.id !== 'hermes') return;
  try {
    const r = await fetch('http://127.0.0.1:9131/hub/health?url=' + encodeURIComponent('http://127.0.0.1:9119/'));
    const s = await r.json();
    if (active !== t.id || s.error) return;
    if (s.reachable) { $('state').textContent = 'Dashboard responded · HTTP ' + s.status; return; }
    $('state').textContent = 'Dashboard unavailable';
    showNotice('Hermes needs a repair', 'The dashboard is not responding on port 9119. Start the Hermes dashboard, then try again. Your tabs and the running Hermes gateway are unaffected.', 'Try connection again', () => render(), 'Check dashboard address', () => configure(t.id));
  } catch { /* The local health bridge may still be starting. */ }
}

function geminiNode(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function appendGeminiMessage(role, text) {
  const feed = $('gemini-feed');
  if (!feed) return;
  const welcome = feed.querySelector('.gemini-welcome');
  welcome?.remove();
  const message = geminiNode('article', `gemini-message ${role}`);
  message.append(geminiNode('span', 'gemini-role', role === 'user' ? 'YOU' : 'GEMINI'));
  message.append(geminiNode('p', '', text));
  feed.append(message);
  feed.scrollTop = feed.scrollHeight;
}

async function loadGeminiModels() {
  const select = $('gemini-model');
  if (!select) return;
  select.replaceChildren(new Option('Loading models…', ''));
  try {
    const response = await fetch('/hub/gemini/models');
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Could not load models.');
    const models = result.models || [];
    select.replaceChildren(...models.map(model => new Option(model.name, model.id)));
    const preferred = models.find(model => /flash/i.test(model.id) && !/preview/i.test(model.id)) || models[0];
    if (preferred) select.value = preferred.id;
    if (!models.length) select.replaceChildren(new Option('No text models available', ''));
  } catch (error) {
    select.replaceChildren(new Option('Models unavailable', ''));
    $('gemini-status').textContent = error.message;
  }
}

async function initializeGemini() {
  let panel = $('gemini-app');
  if (!panel) {
    panel = geminiNode('section', 'gemini-app');
    panel.id = 'gemini-app';
    const top = geminiNode('div', 'gemini-top');
    const identity = geminiNode('div', 'gemini-identity');
    identity.append(geminiNode('span', 'gemini-mark', '✦'));
    const names = geminiNode('div');
    names.append(geminiNode('strong', '', 'Gemini API'));
    names.append(geminiNode('small', '', 'Private local connection'));
    identity.append(names);
    const model = document.createElement('select'); model.id = 'gemini-model'; model.setAttribute('aria-label', 'Gemini model');
    const keyButton = geminiNode('button', 'gemini-key-button', 'API key'); keyButton.type = 'button'; keyButton.id = 'gemini-key-toggle';
    top.append(identity, model, keyButton);

    const setup = geminiNode('form', 'gemini-setup'); setup.id = 'gemini-setup';
    setup.append(geminiNode('strong', '', 'Connect your Gemini API key'));
    setup.append(geminiNode('p', '', 'The key is sent to this PC’s local service and stored under your Windows profile. It is never saved in the page or sent to the Hub website.'));
    const keyRow = geminiNode('div', 'gemini-key-row');
    const keyInput = document.createElement('input'); keyInput.type = 'password'; keyInput.id = 'gemini-api-key'; keyInput.autocomplete = 'off'; keyInput.placeholder = 'Paste Gemini API key'; keyInput.required = true;
    keyInput.setAttribute('aria-label', 'Gemini API key');
    const saveKey = geminiNode('button', 'primary', 'Save key'); saveKey.type = 'submit';
    keyRow.append(keyInput, saveKey); setup.append(keyRow);
    setup.append(geminiNode('small', 'gemini-status', 'Create a key in Google AI Studio, then enter it here.')); setup.querySelector('small').id = 'gemini-status';

    const feed = geminiNode('div', 'gemini-feed'); feed.id = 'gemini-feed'; feed.setAttribute('role', 'log'); feed.setAttribute('aria-live', 'polite');
    const welcome = geminiNode('div', 'gemini-welcome');
    welcome.append(geminiNode('span', 'gemini-spark', '✦'));
    welcome.append(geminiNode('h2', '', 'What would you like to work on?'));
    welcome.append(geminiNode('p', '', 'This chat uses the Gemini API with the key configured on your PC.'));
    feed.append(welcome);

    const form = geminiNode('form', 'gemini-compose'); form.id = 'gemini-form';
    const prompt = document.createElement('textarea'); prompt.id = 'gemini-prompt'; prompt.rows = 2; prompt.maxLength = 20000; prompt.placeholder = 'Message Gemini…'; prompt.setAttribute('aria-label', 'Message Gemini');
    const send = geminiNode('button', 'primary', 'Send ↑'); send.type = 'submit'; send.id = 'gemini-send';
    form.append(prompt, send);
    const hint = geminiNode('div', 'gemini-hint', 'Enter to send · Shift+Enter for a new line');
    panel.append(top, setup, feed, form, hint);
    $('frames').append(panel);

    setup.onsubmit = async event => {
      event.preventDefault();
      const status = $('gemini-status');
      const button = setup.querySelector('button[type="submit"]');
      button.disabled = true; status.textContent = 'Saving on this PC…';
      try {
        const response = await fetch('/hub/gemini/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: keyInput.value }) });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'Could not save that key.');
        keyInput.value = ''; setup.hidden = true; $('gemini-key-toggle').textContent = 'Change key';
      status.textContent = 'Key saved locally.'; await loadGeminiModels();
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    };
    keyButton.onclick = () => { setup.hidden = !setup.hidden; if (!setup.hidden) keyInput.focus(); };
    form.onsubmit = async event => {
      event.preventDefault();
      const value = prompt.value.trim();
      if (!value || send.disabled) return;
      if (!model.value) { $('gemini-status').textContent = 'Choose a Gemini model after connecting your key.'; setup.hidden = false; return; }
      prompt.value = ''; prompt.style.height = '';
      appendGeminiMessage('user', value);
      const pending = geminiNode('article', 'gemini-message model pending');
      pending.append(geminiNode('span', 'gemini-role', 'GEMINI'));
      pending.append(geminiNode('p', '', 'Thinking…'));
      feed.append(pending); feed.scrollTop = feed.scrollHeight; send.disabled = true;
      try {
        const response = await fetch('/hub/gemini/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.value, prompt: value, history: geminiHistory }) });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'Gemini request failed.');
        pending.classList.remove('pending'); pending.querySelector('p').textContent = result.text || '(Gemini returned an empty response.)';
        geminiHistory.push({ role: 'user', text: value }, { role: 'model', text: result.text || '' });
      } catch (error) { pending.classList.remove('pending'); pending.querySelector('p').textContent = error.message; pending.classList.add('error'); }
      finally { send.disabled = false; prompt.focus(); feed.scrollTop = feed.scrollHeight; }
    };
    prompt.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } };
  }

  panel.hidden = active !== 'gemini';
  if (!localHub) {
    panel.querySelector('.gemini-setup').hidden = true;
    const feed = panel.querySelector('.gemini-feed');
    const welcome = geminiNode('div', 'gemini-welcome');
    welcome.append(geminiNode('h2', '', 'Use Gemini API on your PC'));
    welcome.append(geminiNode('p', '', 'Open the private Tailscale workspace to use your locally stored key and keep API requests on your PC.'));
    const localLink = geminiNode('a', 'primary', 'Open private workspace ↗');
    localLink.href = tailnetHubUrl; localLink.target = '_blank'; localLink.rel = 'noopener noreferrer';
    welcome.append(localLink); feed.replaceChildren(welcome);
    panel.querySelector('.gemini-compose').hidden = true;
    $('state').textContent = 'Open the private Tailscale workspace';
    return;
  }

  try {
    const response = await fetch('/hub/gemini/status');
    const result = await response.json();
    if (result.configured) {
      panel.querySelector('.gemini-setup').hidden = true;
      $('gemini-key-toggle').textContent = 'Change key';
      $('gemini-status').textContent = 'Key saved locally.';
      $('state').textContent = 'Gemini API · private local key';
      if (!$('gemini-model').options.length || $('gemini-model').options[0].textContent === 'Loading models…') await loadGeminiModels();
    } else {
      panel.querySelector('.gemini-setup').hidden = false;
      $('gemini-key-toggle').textContent = 'API key';
      $('gemini-status').textContent = 'Create a key in Google AI Studio, then enter it here.';
      $('state').textContent = 'Gemini API · key needed';
    }
  } catch {
    $('state').textContent = 'Local Gemini service unavailable';
  }
}

const iconPaths = {
  herdr: ['M3 5h18v14H3z', 'M3 9h18', 'm7 12 2.5 2-2.5 2', 'M12.5 16h3'],
  dsh: ['M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M8 10v0', 'M12 10v0', 'M16 10v0'],
  gemini: ['M12 2c.7 5.1 2.9 7.3 10 10-7.1 2.7-9.3 4.9-10 10C11.3 16.9 9.1 14.7 2 12 9.1 9.3 11.3 7.1 12 2Z'],
  antigravity: ['M12 2.5 21 20H3L12 2.5Z', 'M12 9v4', 'M12 16v.1'],
  'control-center': ['M4 6h16', 'M4 12h16', 'M4 18h16', 'M9 4v4', 'M15 10v4', 'M11 16v4'],
  default: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z']
};
const iconFiles = {
  hermes: 'hermes.ico', codex: 'codex.svg', gemini: 'gemini.png', antigravity: 'antigravity.ico',
  herdr: 'herdr.svg', dsh: 'dsh.svg', 'control-center': 'control-center.svg'
};

function harnessIcon(id) {
  const ns = 'http://www.w3.org/2000/svg';
  if (iconFiles[id]) {
    const img = document.createElement('img');
    img.className = 'tab-icon brand-icon';
    img.src = new URL('icons/' + iconFiles[id], location.href).href;
    img.alt = '';
    img.draggable = false;
    return img;
  }
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('tab-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of iconPaths[id] || iconPaths.default) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function showNotice(title, message, actionText, action, secondText, secondAction) {
  $('offline-status')?.remove();
  const card = document.createElement('div');
  card.id = 'offline-status';
  card.className = 'offline';
  const box = document.createElement('div');
  const orb = document.createElement('span');
  orb.className = 'orb';
  orb.textContent = '↯';
  const h = document.createElement('h2');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = message;
  box.append(orb, h, p);
  if (actionText) { const b = document.createElement('button'); b.textContent = actionText; b.onclick = action; box.append(b); }
  if (secondText) { const b = document.createElement('button'); b.textContent = secondText; b.onclick = secondAction; box.append(b); }
  card.append(box);
  $('frames').append(card);
}

async function refreshHarnessNav() {
  let statuses = {};
  if (localHub) {
    try {
      const response = await fetch('/hub/harness/status');
      if (response.ok) statuses = (await response.json()).statuses || {};
    } catch { /* Keep visible statuses neutral if the local service is starting. */ }
  }
  for (const button of $('tabs').querySelectorAll('[data-harness-id]')) {
    const status = statuses[button.dataset.harnessId] || { state: 'unknown', label: localHub ? 'Status unavailable' : 'Open the local or Tailscale workspace for live status' };
    const dot = button.querySelector('.nav-health');
    dot.className = 'nav-health ' + status.state;
    dot.title = status.label;
    button.title = button.dataset.harnessName + ' · ' + status.label;
    button.setAttribute('aria-label', `${button.dataset.harnessName} tab · ${status.label}. Drag to reorder; use Configure to move with the keyboard.`);
  }
}

function render() {
  $('offline-status')?.remove();
  $('external-signin')?.remove();
  const current = tabs.find(t => t.id === active) || tabs[0];
  active = current.id;
  $('tabs').replaceChildren();
  for (const t of tabs) {
    const b = document.createElement('button');
    b.role = 'tab';
    b.setAttribute('aria-selected', String(t.id === active));
    b.dataset.harnessId = t.id;
    b.dataset.harnessName = t.name;
    b.setAttribute('aria-label', `${t.name} tab. Checking live status. Drag to reorder; use Configure to move with the keyboard.`);
    b.title = t.name;
    b.draggable = true;
    b.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
      b.classList.add('dragging');
    });
    b.addEventListener('dragend', () => {
      b.classList.remove('dragging');
      $('tabs').querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before','drop-after'));
    });
    b.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('text/plain')) return;
      e.preventDefault();
      $('tabs').querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before','drop-after'));
      b.classList.add(e.clientY < b.getBoundingClientRect().top + b.offsetHeight / 2 ? 'drop-before' : 'drop-after');
    });
    b.addEventListener('drop', e => {
      e.preventDefault();
      const fromId = e.dataTransfer.getData('text/plain');
      if (!fromId || fromId === t.id) return;
      const from = tabs.findIndex(tab => tab.id === fromId);
      if (from < 0) return;
      const before = e.clientY < b.getBoundingClientRect().top + b.offsetHeight / 2;
      const [moved] = tabs.splice(from, 1);
      let to = tabs.findIndex(tab => tab.id === t.id);
      if (!before) to++;
      tabs.splice(to, 0, moved);
      save(); render();
    });
    const label = document.createElement('span');
    label.className = 'tab-name';
    label.textContent = t.name;
    const grip = document.createElement('span');
    grip.className = 'reorder-grip';
    grip.textContent = '⠿';
    grip.title = 'Drag to reorder';
    grip.setAttribute('aria-hidden', 'true');
    const health = document.createElement('span');
    health.className = 'nav-health unknown';
    health.setAttribute('aria-hidden', 'true');
    health.title = 'Checking live status';
    b.append(harnessIcon(t.id), label, health, grip);
    b.onclick = () => { active = t.id; render(); };
    $('tabs').append(b);

    const localOnly = t.id === 'dsh' && !localHub;
    const externalOnly = t.id === 'antigravity';
    let frame = document.getElementById('frame-' + t.id);
    if (t.id === 'gemini' && frame) { frame.remove(); frame = null; }
    if (!localOnly && !externalOnly && t.id !== 'gemini' && !frame) {
      frame = document.createElement('iframe');
      frame.id = 'frame-' + t.id;
      frame.title = t.name + ' dashboard';
      frame.referrerPolicy = 'no-referrer';
      frame.src = t.url;
      frame.onload = () => { if (active === t.id && !$('offline-status')) $('state').textContent = 'Embedded view · ' + t.name; };
      $('frames').append(frame);
    }
    if (frame) frame.hidden = localOnly || externalOnly || t.id !== active;
  }
  for (const f of [...$('frames').children]) {
    if (f.tagName === 'IFRAME' && !tabs.some(t => 'frame-' + t.id === f.id)) f.remove();
  }

  $('notice').hidden = current.id !== 'hermes';
  const geminiPanel = $('gemini-app');
  if (geminiPanel) geminiPanel.hidden = current.id !== 'gemini';
  if (current.id === 'gemini') {
    $('offline-status')?.remove();
    initializeGemini();
  } else if (current.id === 'antigravity') {
    showNotice('Antigravity Remote Control opens separately', 'Enable Remote Control in the desktop app, then open the dashboard in a browser tab.',
      'Open Antigravity', () => window.open(current.url, '_blank', 'noopener'), null, null);
  } else if (current.id === 'dsh' && !localHub) {
    showNotice('Open DSH on this device', 'DSH runs locally on the computer where it is installed. Open the local workspace to embed it, or open the local DSH address directly.', 'Open local workspace', () => window.open('http://127.0.0.1:9130/', '_blank', 'noopener'), 'Open DSH separately', () => window.open(current.url, '_blank', 'noopener'));
  }

  const heading = $('title');
  heading.className = 'system-wordmark-heading';
  heading.replaceChildren();
  const officialWordmarks = { gemini: 'gemini-wordmark.svg', antigravity: 'antigravity-wordmark.svg', 'control-center': 'control-center-wordmark-thin.png' };
  if (officialWordmarks[current.id]) {
    const wordmark = document.createElement('img');
    wordmark.className = 'system-wordmark system-wordmark-' + current.id;
    wordmark.src = 'icons/' + officialWordmarks[current.id] + '?v=1';
    wordmark.alt = current.name;
    wordmark.onerror = () => { heading.textContent = current.name; };
    heading.append(wordmark);
  } else {
    heading.textContent = current.name;
    if (current.id === 'hermes' || current.id === 'codex') heading.classList.add('system-wordmark-' + current.id);
  }
  $('external').href = current.url;
  $('address').textContent = new URL(current.url).host;
  $('external').textContent = current.id === 'gemini' ? 'Open Gemini ↗' : current.id === 'antigravity' ? 'Open Antigravity ↗' : 'Open separately ↗';
  $('state').textContent = current.id === 'hermes' && !localHub ? 'Hermes via your Tailnet' : current.id === 'dsh' && !localHub ? 'Local dashboard' : current.id === 'antigravity' ? 'Remote Control · separate browser tab' : 'Embedded view · ' + current.name;
  checkConnection(current);
  refreshHarnessNav();
  if (!navStatusTimer) navStatusTimer = setInterval(refreshHarnessNav, 30000);
}

function configure(id = null) {
  editing = id;
  const t = tabs.find(t => t.id === id);
  $('dialog-title').textContent = t ? 'Configure ' + t.name : 'Add a harness';
  $('name').value = t?.name || '';
  $('url').value = t?.url || '';
  $('error').textContent = '';
  for (const controlId of ['remove', 'left', 'right']) $(controlId).hidden = !t;
  $('remove').disabled = tabs.length === 1;
  $('left').disabled = !t || tabs.indexOf(t) === 0;
  $('right').disabled = !t || tabs.indexOf(t) === tabs.length - 1;
  $('config').showModal();
  $('name').focus();
}

$('add').onclick = () => configure();
$('edit').onclick = () => configure(active);
$('cancel').onclick = () => $('config').close();
$('dismiss').onclick = () => $('notice').hidden = true;
$('reload').onclick = () => {
  const f = $('frame-' + active), t = tabs.find(t => t.id === active);
  if (f) { f.src = t.url; $('state').textContent = 'Reloading dashboard'; }
  else if (t?.id === 'gemini') {
    geminiHistory = [];
    const feed = $('gemini-feed');
    if (feed) { feed.replaceChildren(); const welcome = geminiNode('div', 'gemini-welcome'); welcome.append(geminiNode('span', 'gemini-spark', '✦'), geminiNode('h2', '', 'What would you like to work on?'), geminiNode('p', '', 'This chat uses the Gemini API with the key configured on your PC.')); feed.append(welcome); }
    initializeGemini();
  }
  else if (t) { window.open(t.url, '_blank', 'noopener'); $('state').textContent = 'Opened dashboard separately'; }
};
$('local').textContent = localHub ? 'the local workspace' : 'the private Tailscale workspace';
$('local').onclick = () => window.open(localHub ? 'http://127.0.0.1:9130/' : tailnetHubUrl, '_blank', 'noopener');
$('form').onsubmit = e => {
  e.preventDefault();
  try {
    const name = $('name').value.trim(), url = valid($('url').value);
    if (!name) throw Error('Enter a harness name.');
    if (editing) {
      const t = tabs.find(t => t.id === editing);
      t.name = name;
      if (t.url !== url) { t.url = url; $('frame-' + t.id)?.remove(); }
    } else { const id = crypto.randomUUID(); tabs.push({ id, name, url }); active = id; }
    save(); render(); $('config').close();
  } catch (e) { $('error').textContent = e.message; }
};
$('remove').onclick = () => {
  if (tabs.length === 1) return;
  tabs = tabs.filter(t => t.id !== editing);
  if (active === editing) active = tabs[0].id;
  save(); render(); $('config').close();
};
for (const [id, delta] of [['left', -1], ['right', 1]]) $(id).onclick = () => {
  const i = tabs.findIndex(t => t.id === editing), j = i + delta;
  if (j < 0 || j >= tabs.length) return;
  [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
  save(); render(); $('config').close();
};
$('tabs').onkeydown = e => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  let i = tabs.findIndex(t => t.id === active);
  i = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  active = tabs[i].id; render(); $('tabs').children[i].focus();
};
$('tabs').role = 'tablist';
render();

const navigationCollapse = document.getElementById('navigation-collapse');
const workspaceLayout = document.querySelector('.workspace');
function setNavigationCollapsed(collapsed) {
  workspaceLayout.classList.toggle('nav-collapsed', collapsed);
  navigationCollapse.setAttribute('aria-expanded', String(!collapsed));
  navigationCollapse.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
  navigationCollapse.title = collapsed ? 'Expand navigation' : 'Collapse navigation';
  navigationCollapse.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="m14 6-6 6 6 6"/></svg><span>' + (collapsed ? 'Expand sidebar' : 'Collapse sidebar') + '</span>';
}
try { setNavigationCollapsed(localStorage.getItem('arnes_navigation_collapsed') === 'true'); }
catch { setNavigationCollapsed(false); }
navigationCollapse.addEventListener('click', () => {
  const collapsed = !workspaceLayout.classList.contains('nav-collapsed');
  setNavigationCollapsed(collapsed);
  try { localStorage.setItem('arnes_navigation_collapsed', String(collapsed)); } catch { /* Session-only preference. */ }
});