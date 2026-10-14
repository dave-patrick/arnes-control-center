const pageKey = 'harness-hub-management-pages-v1';
const $ = id => document.getElementById(id);
if (window.self !== window.top) document.body.classList.add('embedded');
const tailnetName = 'hub.example.invalid';
const localHub = (['127.0.0.1', 'localhost'].includes(location.hostname) && location.port === '9130') || location.hostname === tailnetName;
const historyBySystem = new Map();
const systemIcons = { openviking: 'OV', perseus: 'PV', 'home-assistant': 'HA', 'lm-studio': 'LM', 'hermes-gateway': 'HG', 'hermes-dashboard': 'HD', dockhand: 'DK', searxng: 'SX', audiobookshelf: 'AB', traefik: 'TR', 'shockwave-api': 'SW', 'shockwave-updater': 'UP' };
const overviewOnlySystems = new Set(['lm-studio', 'hermes-gateway', 'hermes-dashboard', 'shockwave-api', 'shockwave-updater', 'traefik']);
const systemUi = {
  openviking: { frameUrl: 'http://127.0.0.1:1933/studio/home', openUrl: 'http://127.0.0.1:1933/studio/home', message: 'OpenViking Studio · search and memory management.' },
  perseus: { message: 'Perseus Vault is available as a local MCP service. It has no browser dashboard; this tab shows its latest reported memory status.' },
  'home-assistant': { frameUrl: 'http://127.0.0.1:8123/', openUrl: 'http://127.0.0.1:8123/', message: 'Home Assistant dashboard.' },
  'lm-studio': { openUrl: 'http://127.0.0.1:1234/v1/models', openLabel: 'Open model API', message: 'LM Studio exposes its local model API on this endpoint. Use the LM Studio desktop app for model and server management.' },
  'hermes-gateway': { message: 'Hermes Gateway runs on this PC and exposes a local health endpoint only. Use the Hermes Dashboard tab for chat and session management.' },
  'hermes-dashboard': { frameUrl: location.protocol === 'https:' ? 'https://hub.example.invalid:8443/' : 'http://127.0.0.1:9132/', openUrl: 'http://127.0.0.1:9119/', message: 'Hermes Dashboard · local authenticated proxy.' },
  dockhand: { frameUrl: 'http://127.0.0.1:3000/containers', openUrl: 'http://127.0.0.1:3000/containers', message: 'Dockhand container management.' },
  searxng: { frameUrl: 'http://127.0.0.1:8080/', openUrl: 'http://127.0.0.1:8080/', message: 'SearXNG search interface.' },
  audiobookshelf: { frameUrl: '/audiobookshelf/', openUrl: 'http://127.0.0.1:8000/', openLabel: 'Open Audiobookshelf separately', message: 'Audiobookshelf is available through the private same-origin proxy in the Tailscale workspace.' },
  traefik: { message: 'Traefik’s TLS entrypoint is reachable. No dashboard URL is recorded for this service.' },
  'shockwave-api': { message: 'The Shockwave API is mapped to T580 localhost only, so that endpoint is not reachable from this browser. Status is from the latest Docker report.' },
  'shockwave-updater': { message: 'The updater has no browser interface. Status is from the latest Docker report.' }
};
const tabAppIcons = {
  openviking: 'openviking.ico', perseus: 'perseus.svg',
  'home-assistant': 'home-assistant.ico', dockhand: 'dockhand.png',
  searxng: 'searxng.png', audiobookshelf: 'audiobookshelf.ico',
  'hermes-dashboard': 'hermes.ico'
};
let managementStatus = {};
function appTabIcon(id, url) {
  const name = url && new URL(url).hostname === 'tubemanager.onrender.com'
    ? 'motus-leap.png' : tabAppIcons[id];
  const icon = document.createElement(name ? 'img' : 'span');
  icon.className = 'cc-app-icon';
  if (name) {
    icon.src = 'icons/' + name; icon.alt = ''; icon.setAttribute('aria-hidden', 'true');
    icon.onerror = () => { icon.style.visibility = 'hidden'; };
  } else {
    icon.textContent = systemIcons[id] || '↗'; icon.setAttribute('aria-hidden', 'true');
  }
  return icon;
}
let pages = [];
let systems = [];
let active = 'overview';
let editing = null;
let checking = false;

try {
  const saved = JSON.parse(localStorage.getItem(pageKey));
  if (Array.isArray(saved)) pages = saved.filter(p => p && typeof p.name === 'string' && typeof p.url === 'string').map((p, i) => ({ ...p, id: p.id || 'management-' + i }));
} catch { /* Keep an empty management page list if saved browser data is invalid. */ }

const motusPageMigrationKey = 'harness-hub-motus-leap-page-v1';
try {
  if (!localStorage.getItem(motusPageMigrationKey)) {
    const existing = pages.find(page => {
      try { return new URL(page.url).hostname === 'tubemanager.onrender.com'; }
      catch { return false; }
    });
    if (existing) existing.name = 'motus.leap';
    else pages.push({ id: 'motus-leap', name: 'motus.leap', url: 'https://tubemanager.onrender.com/' });
    save();
    localStorage.setItem(motusPageMigrationKey, '1');
  }
} catch {
  if (!pages.some(page => page.id === 'motus-leap')) {
    pages.push({ id: 'motus-leap', name: 'motus.leap', url: 'https://tubemanager.onrender.com/' });
  }
}
function save() {
  try { localStorage.setItem(pageKey, JSON.stringify(pages)); }
  catch { $('overall-status').lastChild.textContent = ' Browser storage unavailable'; }
}

const tabOrderKey = 'harness-hub-control-tab-order-v1';
let tabOrder = [];
try {
  const savedOrder = JSON.parse(localStorage.getItem(tabOrderKey));
  if (Array.isArray(savedOrder)) tabOrder = [...new Set(savedOrder.filter(id => typeof id === 'string'))];
} catch { /* Use the default order when storage is unavailable. */ }
function orderedTabIds() {
  const ids = [...systems.filter(item => !overviewOnlySystems.has(item.id)).map(item => item.id), ...pages.map(page => page.id)];
  return [...tabOrder.filter(id => ids.includes(id)), ...ids.filter(id => !tabOrder.includes(id))];
}
function moveTab(delta) {
  const ids = orderedTabIds();
  const index = ids.indexOf(active), next = index + delta;
  if (index < 0 || next < 0 || next >= ids.length) return;
  [ids[index], ids[next]] = [ids[next], ids[index]];
  tabOrder = ids;
  try { localStorage.setItem(tabOrderKey, JSON.stringify(tabOrder)); }
  catch { /* Keep the order for this session when storage is unavailable. */ }
  render();
}
let draggedTabId = null;
function wireTabDrag(tab) {
  const id = tab.dataset.tabId;
  tab.draggable = true;
  tab.setAttribute('aria-label', tab.textContent.trim() + '. Drag to reorder, or press Alt and an arrow key.');
  tab.addEventListener('dragstart', event => {
    draggedTabId = id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
    tab.classList.add('dragging');
  });
  tab.addEventListener('dragover', event => {
    if (!draggedTabId || draggedTabId === id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const after = event.clientX > tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2;
    tab.classList.toggle('drop-after', after);
    tab.classList.toggle('drop-before', !after);
  });
  tab.addEventListener('dragleave', () => tab.classList.remove('drop-before', 'drop-after'));
  tab.addEventListener('drop', event => {
    event.preventDefault();
    if (!draggedTabId || draggedTabId === id) return;
    const ids = orderedTabIds().filter(item => item !== draggedTabId);
    const targetIndex = ids.indexOf(id);
    if (targetIndex < 0) return;
    const after = event.clientX > tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2;
    ids.splice(targetIndex + (after ? 1 : 0), 0, draggedTabId);
    tabOrder = ids;
    draggedTabId = null;
    try { localStorage.setItem(tabOrderKey, JSON.stringify(tabOrder)); } catch { /* Session-only order. */ }
    render();
  });
  tab.addEventListener('dragend', () => {
    draggedTabId = null;
    for (const node of $('tabs').children) node.classList.remove('dragging', 'drop-before', 'drop-after');
  });
  tab.addEventListener('keydown', event => {
    if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    active = id;
    moveTab(event.key === 'ArrowLeft' ? -1 : 1);
    [...$('tabs').children].find(node => node.dataset.tabId === id)?.focus();
  });
}
function select(id) {
  active = id;
  render();
}

function render() {
  const nav = $('tabs');
  nav.replaceChildren();
  const overviewTab = document.createElement('button');
  overviewTab.type = 'button'; overviewTab.role = 'tab'; overviewTab.textContent = 'System overview';
  overviewTab.setAttribute('aria-selected', String(active === 'overview'));
  overviewTab.onclick = () => select('overview'); nav.append(overviewTab);

  for (const system of systems.filter(item => !overviewOnlySystems.has(item.id))) {
    const tab = document.createElement('button');
    tab.type = 'button'; tab.role = 'tab'; tab.title = `${system.name} · ${statusInfo(system).label}`;
    tab.setAttribute('aria-selected', String(system.id === active));
    const dot = document.createElement('i'); dot.className = 'cc-tab-dot ' + (system.reachable ? (system.status === 'reported' ? 'reported' : 'up') : system.live ? 'down' : 'reported');
    const label = document.createElement('span'); label.textContent = system.name;
    tab.append(appTabIcon(system.id), label, dot); tab.dataset.tabId = system.id; tab.onclick = () => select(system.id); nav.append(tab);
  }

  for (const page of pages) {
    const tab = document.createElement('button');
    tab.type = 'button'; tab.role = 'tab';
    const pageHost = new URL(page.url).hostname;
    const health = managementStatus[pageHost];
    const dot = document.createElement('i');
    dot.className = 'cc-tab-dot ' + (!health ? 'unknown' : health.reachable ? 'up' : 'down');
    dot.title = !health ? 'Status not checked' : health.reachable ? 'Online · HTTP ' + health.status : 'Health check failed';
    const label = document.createElement('span'); label.textContent = page.name;
    tab.append(appTabIcon(page.id, page.url), label, dot);
    tab.title = page.name + ' · ' + dot.title;
    tab.setAttribute('aria-selected', String(page.id === active));
    tab.dataset.tabId = page.id; tab.onclick = () => select(page.id); nav.append(tab);
  }

  const orderedIds = orderedTabIds();
  const tabNodes = new Map([...nav.children].filter(tab => tab.dataset.tabId).map(tab => [tab.dataset.tabId, tab]));
  for (const id of orderedIds) if (tabNodes.has(id)) nav.append(tabNodes.get(id));




  for (const tab of tabNodes.values()) wireTabDrag(tab);
  const onOverview = active === 'overview';
  const currentSystem = systems.find(system => system.id === active);
  const onPerseus = currentSystem?.id === 'perseus';
  const currentPage = pages.find(page => page.id === active);
  $('overview').hidden = !onOverview;
  $('system-view').hidden = !currentSystem;
  $('management').hidden = onOverview || Boolean(currentSystem);
  $('empty').hidden = pages.length > 0;
  $('views').hidden = pages.length === 0;
  $('refresh-status').hidden = Boolean(currentPage);
  $('edit').hidden = !currentPage;
  $('external').hidden = !currentPage && !currentSystem?.openUrl;

  if (onOverview) {
    $('control-title').textContent = 'System overview';
    $('overall-status').className = 'overall-status';
    $('overall-status').lastChild.textContent = ' All live endpoints responding';
    $('external').removeAttribute('href');
    $('address').textContent = 'Live status checks originate from this PC';
    return;
  }

  if (currentSystem) {
    const ui = systemUi[currentSystem.id] || {};
    const status = statusInfo(currentSystem);
    const embedUrl = ui.frameUrl && (currentSystem.id !== 'audiobookshelf' || localHub) ? ui.frameUrl : '';
    $('control-title').textContent = currentSystem.name;
    $('overall-status').className = 'overall-status ' + (status.cls === 'up' ? '' : status.cls === 'reported' ? 'warning' : 'error');
    $('overall-status').lastChild.textContent = ' ' + status.label;
    $('external').hidden = !ui.openUrl;
    $('external').href = ui.openUrl || '#';
    $('external').textContent = ui.openLabel || 'Open separately ↗';
    $('system-icon').textContent = systemIcons[currentSystem.id] || '•';
    $('system-title').textContent = currentSystem.name;
    $('system-endpoint').textContent = currentSystem.endpoint;
    $('system-description').textContent = currentSystem.detail;
    $('system-description').hidden = onPerseus;
    $('system-status').className = 'status-pill ' + status.cls;
    $('system-status').replaceChildren(document.createElement('i'), document.createTextNode(status.label));
    $('frame-label').textContent = embedUrl ? `${currentSystem.name} management view` : 'Management view';
    $('system-message').textContent = currentSystem.id === 'audiobookshelf' && !localHub
      ? 'Audiobookshelf is available inside the private Tailscale workspace. Open it separately from here.'
      : ui.message || 'No browser management interface is configured for this system.';
    $('perseus-view').hidden = !onPerseus;
    $('system-message').hidden = Boolean(embedUrl) || onPerseus;
    $('system-frame-wrap').hidden = !embedUrl;
    if (onPerseus) {
      const memoryCount = currentSystem.detail.match(/(\d+)\s+memories?/i)?.[1] || '—';
      $('perseus-count').textContent = memoryCount;
      $('perseus-embedding').textContent = /embedded/i.test(currentSystem.detail) ? 'Ready' : 'Unreported';
      $('perseus-recall').textContent = /semantic recall available/i.test(currentSystem.detail) ? 'Available' : 'Unreported';
      $('perseus-connection').textContent = currentSystem.endpoint || 'Local MCP';
    }
    const frame = $('system-frame');
    frame.title = currentSystem.name + ' management UI';
    if (embedUrl && frame.dataset.system !== currentSystem.id) {
      frame.src = embedUrl;
      frame.dataset.system = currentSystem.id;
    }
    $('address').textContent = currentSystem.endpoint;
    return;
  }

  const current = currentPage;
  $('control-title').textContent = current.name;
  $('overall-status').className = 'overall-status';
  $('overall-status').lastChild.textContent = ' Embedded view · ' + current.name;
  $('external').hidden = false;
  $('external').href = current.url;
  $('external').textContent = 'Open separately ↗';

  $('address').textContent = new URL(current.url).host;
  for (const page of pages) {

    let frame = document.getElementById('view-' + CSS.escape(page.id));
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'view-' + page.id; frame.title = page.name + ' management UI'; frame.referrerPolicy = 'no-referrer'; frame.loading = 'lazy'; frame.src = page.url;
      frame.onload = () => { if (active === page.id) $('overall-status').lastChild.textContent = ' Embedded view · ' + page.name; };
      $('views').append(frame);
    }
    frame.hidden = page.id !== active;
  }
  for (const frame of [...$('views').children]) if (!pages.some(p => 'view-' + p.id === frame.id)) frame.remove();
  $('overall-status').lastChild.textContent = ' Embedded view · ' + current.name;
}

function statusInfo(system) {
  if (!system.live) return { label: system.statusText || 'Status · last reported', cls: 'reported' };
  if (!localHub) return { label: 'Use private workspace', cls: 'reported' };
  if (!system.reachable) return { label: 'No response', cls: 'down' };
  if (system.id === 'home-assistant' && system.status === 401) return { label: 'Reachable · auth required', cls: 'attention' };
  if (system.id === 'traefik' && system.status === 'tcp') return { label: 'TLS listener open', cls: 'up' };
  if (system.status >= 300 && system.status < 400) return { label: 'Redirect · HTTP ' + system.status, cls: 'attention' };
  return { label: 'Online · HTTP ' + system.status, cls: 'up' };
}

function renderHealth(payload) {
  const rows = $('system-rows');
  rows.replaceChildren();
  systems = payload.systems || [];
  managementStatus = payload.managementStatus || {};
  let online = 0;

  for (const system of systems) {
    const status = statusInfo(system);
    if (system.reachable) online++;
    const history = historyBySystem.get(system.id) || [];
    if (system.live) { history.push(Boolean(system.reachable)); historyBySystem.set(system.id, history.slice(-8)); }
    const row = document.createElement('tr');
    const name = document.createElement('td');
    const nameLine = document.createElement('div'); nameLine.className = 'cc-system-name';
    const icon = document.createElement('span'); icon.className = 'cc-system-icon'; icon.textContent = systemIcons[system.id] || '•';
    const label = document.createElement('span'); label.textContent = system.name;
    nameLine.append(icon, label); name.append(nameLine);

    const endpoint = document.createElement('td'); endpoint.className = 'cc-endpoint';
    if (systemUi[system.id]?.openUrl) { const open = document.createElement('a'); open.href = systemUi[system.id].openUrl; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = system.endpoint + ' ↗'; open.setAttribute('aria-label', 'Open ' + system.name + ' separately'); endpoint.append(open); }
    else endpoint.textContent = system.endpoint;
    const statusCell = document.createElement('td');
    const pill = document.createElement('span'); pill.className = 'status-pill ' + status.cls;
    pill.append(document.createElement('i'), document.createTextNode(status.label)); statusCell.append(pill);

    const details = document.createElement('td'); details.className = 'cc-details'; details.textContent = system.detail;
    const bars = document.createElement('span'); bars.className = 'cc-sparkline'; bars.setAttribute('aria-label', 'Recent check history');
    for (const ok of system.live ? historyBySystem.get(system.id) : []) {
      const bar = document.createElement('i'); bar.className = ok ? 'ok' : 'failed'; bars.append(bar);
    }
    details.append(bars);
    row.append(name, endpoint, statusCell, details); rows.append(row);
  }

  const live = systems.filter(s => s.live);
  const liveOnline = live.filter(s => s.reachable).length;
  $('reachable-count').textContent = localHub ? `${liveOnline}/${live.length || 9}` : `—/${live.length || 9}`;
  $('check-caption').textContent = !localHub ? 'Open the Tailscale workspace for probes' : liveOnline === live.length ? 'All probed services responding' : `${live.length - liveOnline} service${live.length - liveOnline === 1 ? '' : 's'} need attention`;
  $('last-check').textContent = new Date(payload.checkedAt || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  $('last-check-label').textContent = `${live.length} live checks · ${systems.length - live.length} reported states`;
  $('overall-status').className = 'overall-status ' + (liveOnline === live.length ? '' : liveOnline ? 'warning' : 'error');
  $('overall-status').lastChild.textContent = liveOnline === live.length ? ' All live endpoints responding' : `${live.length - liveOnline} service${live.length - liveOnline === 1 ? '' : 's'} need attention`;
  $('probe-summary').textContent = `${liveOnline}/${live.length} live endpoints · ${systems.length - live.length} reported states`;
  $('address').textContent = 'Live status checks originate from this PC';
  render();
}

async function refreshStatus() {
  if (checking || draggedTabId) return;
  checking = true;
  $('refresh-status').disabled = true;
  $('refresh-status').textContent = '↻ Checking…';
  if (!localHub) {
    $('tailnet-hint').hidden = false;
    renderHealth({ systems: [
      { id: 'openviking', name: 'OpenViking', endpoint: '127.0.0.1:1933', live: true, reachable: false, detail: 'Open the private Tailscale workspace for live probes' },
      { id: 'perseus', name: 'Perseus Vault', endpoint: 'Local MCP', live: false, reachable: true, statusText: 'MCP ready · last reported', detail: '680 memories embedded · semantic recall available (last reported)' },
      { id: 'home-assistant', name: 'Home Assistant', endpoint: '127.0.0.1:8123', live: true, reachable: false, detail: 'Open the private Tailscale workspace for live probes' },
      { id: 'lm-studio', name: 'LM Studio', endpoint: '127.0.0.1:1234', live: true, reachable: false, detail: 'Open the private Tailscale workspace for live probes' },
      { id: 'hermes-gateway', name: 'Hermes Gateway', endpoint: '127.0.0.1:8642', live: true, reachable: false, detail: 'Open the private Tailscale workspace for live probes' },
      { id: 'hermes-dashboard', name: 'Hermes Dashboard', endpoint: '127.0.0.1:9119', live: true, reachable: false, detail: 'Open the private Tailscale workspace for live probes' },
      { id: 'dockhand', name: 'Dockhand', endpoint: '127.0.0.1:3000', live: true, reachable: false, detail: 'Open the private Tailscale workspace for live probes' },
      { id: 'searxng', name: 'SearXNG', endpoint: '127.0.0.1:8080', live: true, reachable: false, detail: 'Open the private Tailscale workspace for live probes' },
      { id: 'audiobookshelf', name: 'Audiobookshelf', endpoint: 't580 (Tailscale):8000', live: true, reachable: false, detail: 'Open the private Tailscale workspace for live probes' },
      { id: 'traefik', name: 'Traefik', endpoint: '127.0.0.1:8443', live: true, reachable: false, detail: 'Open the private Tailscale workspace for live probes' },
      { id: 'shockwave-api', name: 'Shockwave API', endpoint: 'T580 localhost:18081', live: false, reachable: true, statusText: 'Healthy · Docker reported Up 4 days', detail: 'Loopback-only mapping · shockwave-companion-t580-api-1' },
      { id: 'shockwave-updater', name: 'Shockwave Updater', endpoint: 'T580 Docker', live: false, reachable: true, statusText: 'Up 4 days · Docker reported', detail: 'Crash loop resolved · shockwave-companion-t580-updater-1' }
    ] });
    $('overall-status').className = 'overall-status warning'; $('overall-status').lastChild.textContent = ' Live checks require your private workspace';
    checking = false; $('refresh-status').disabled = false; $('refresh-status').textContent = '↻ Refresh'; return;
  }
  $('tailnet-hint').hidden = true;
  try {
    const response = await fetch('/hub/control-center/status', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw Error(payload.error || 'Status service did not respond.');
    renderHealth(payload);
  } catch {
    $('overall-status').className = 'overall-status error'; $('overall-status').lastChild.textContent = ' Status service unavailable';
    $('check-caption').textContent = 'Local health endpoint could not be reached';
  } finally {
    checking = false; $('refresh-status').disabled = false; $('refresh-status').textContent = '↻ Refresh';
  }
}

function configure(index = null) {
  editing = index;
  const page = index === null ? null : pages[index];
  $('dialog-title').textContent = page ? 'Configure ' + page.name : 'Add management UI';
  $('name').value = page?.name || ''; $('url').value = page?.url || ''; $('error').textContent = '';
  for (const id of ['remove', 'left', 'right']) $(id).hidden = !page;
  $('left').disabled = !page || orderedTabIds().indexOf(page.id) <= 0; $('right').disabled = !page || orderedTabIds().indexOf(page.id) >= orderedTabIds().length - 1;
  $('dialog').showModal(); $('name').focus();
}

$('add').onclick = () => configure();

$('edit').onclick = () => configure(pages.findIndex(p => p.id === active));
$('close').onclick = () => $('dialog').close();
$('refresh-status').onclick = refreshStatus;
$('form').onsubmit = event => {
  event.preventDefault();
  try {
    const name = $('name').value.trim(), url = new URL($('url').value);
    if (!name) throw Error('Enter a tool name.');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Use an HTTP or HTTPS URL without embedded credentials.');
    const page = { id: editing === null ? crypto.randomUUID() : pages[editing].id, name, url: url.href };
    if (editing === null) { pages.push(page); active = page.id; }
    else { const old = pages[editing]; pages[editing] = page; if (old.url !== page.url) $('view-' + old.id)?.remove(); }
    save(); render(); $('dialog').close();
  } catch (error) { $('error').textContent = error.message; }
};
$('remove').onclick = () => {
  if (editing === null) return;
  const removed = pages.splice(editing, 1)[0]; if (active === removed.id) active = 'overview';
  save(); render(); $('dialog').close();
};
for (const [id, delta] of [['left', -1], ['right', 1]]) $(id).onclick = () => { moveTab(delta); $('dialog').close(); };



render();
refreshStatus();
setInterval(refreshStatus, 30000);
