const $ = id => document.getElementById(id);
const M = HomeModel;
let state;
try { state = M.normalize(JSON.parse(localStorage.getItem(M.key))); } catch { state = M.normalize(); }
let editing = false, token = '', plugins = [], tasklists = [], calendars = [], refreshTimer, loading = false;
const cache = new Map();
const expandedRepos=new Set();
const icons = {
  gmail: ['M3 5h18v14H3z','m3 6 9 7 9-7'], calendar: ['M4 5h16v16H4z','M4 10h16','M8 3v4','M16 3v4'],
  tasks: ['m3 6 2 2 4-4','M12 6h9','m3 16 2 2 4-4','M12 16h9'], github: ['M9 19c-5 1-5-3-7-3','M9 22v-4c-5-1-6-7-3-10-1-2 0-4 0-4s3 0 5 2h4c2-2 5-2 5-2s1 2 0 4c3 3 2 9-3 10v4'],
  harnesses: ['M3 4h18v16H3z','M3 8h18','m7 12 3 2-3 2','M13 16h4'],
  'control-center': ['M3 6h18','M3 12h18','M3 18h18','M8 3v6','M16 9v6','M10 15v6'],
  keep: ['M5 3h14v13l-5 5H5z','M14 21v-5h5','M8 8h8','M8 12h6'], voice: ['M4 4h5l2 5-3 2c2 3 3 4 5 5l2-3 5 2v5c-8 2-18-8-16-16Z']
};
function node(tag, text, cls) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; }
function icon(id) { const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true'); for (const d of icons[id] || []) { const p = document.createElementNS(svg.namespaceURI,'path'); p.setAttribute('d',d); svg.append(p); } return svg; }
function announce(text) { $('announcement').textContent = text; }
function save() { try { localStorage.setItem(M.key,JSON.stringify(state)); } catch { announce('Browser storage is unavailable. Changes will last for this visit.'); } }
function navigate(id) { if (window.parent !== window) window.parent.postMessage({type:'arnes:navigate',id},location.origin); else location.href = '/?view=' + encodeURIComponent(id); }
function safeUrl(raw, fallback) { try { const u = new URL(raw); return ['http:','https:'].includes(u.protocol) && !u.username && !u.password ? u.href : fallback; } catch { return fallback; } }
function link(text, url) { const a = node('a',text); a.href = safeUrl(url,'#'); a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
function workspaceLink(text,id) { const a = node('a',text); a.href = '/?view=' + encodeURIComponent(id); a.onclick = e => { e.preventDefault(); navigate(id); }; return a; }
function button(text,action,cls) { const b = node('button',text,cls); b.type='button'; b.onclick=action; return b; }
async function request(url, input) {
  const response = await fetch(url, input === undefined ? {cache:'no-store',signal:AbortSignal.timeout(30000)} : {method:'POST',headers:{'Content-Type':'application/json','X-Arnes-Token':token},body:JSON.stringify(input),signal:AbortSignal.timeout(30000)});
  const data = await response.json(); if (!response.ok) throw Error(data.error || 'Could not load this widget. Retry in a moment.'); return data;
}
function action(id,name,input={}) { return request('/hub/plugins/'+id+'/actions/'+name,input); }
function memo(name,fn) { if (!cache.has(name)) cache.set(name,Promise.resolve().then(fn)); return cache.get(name); }
function requireGoogle() { const g = plugins.find(p=>p.id==='google-workspace'); if (!g?.enabled || g.status.state !== 'connected') throw Object.assign(Error('Sign in with Google to see your mail, calendar, and tasks here.'),{connect:true}); }
function rows(body, items, empty, build) { if (!items.length) { body.append(node('p',empty)); return; } const ul=node('ul',undefined,'rows'); for (const item of items) { const li=node('li',undefined,'row'); build(li,item); ul.append(li); } body.append(ul); }
function date(raw, allDay=false) { if (!raw) return ''; const d = new Date(allDay ? raw+'T12:00:00' : raw); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined,{month:'short',day:'numeric',...(allDay?{}:{hour:'numeric',minute:'2-digit'})}); }
function settings(w) {
  const box=node('div',undefined,'widget-settings');
  function field(title,input,update) { const label=node('label',title); label.append(input); input.onchange=()=>{update(input.value);save();const section=box.closest('[data-widget]');section.classList.toggle('wide',w.width==='wide');section.classList.toggle('normal',w.width==='normal');section.querySelector('h2').textContent=w.title;loadWidget(w,section.querySelector('.content'));}; box.append(label); }
  const title=node('input'); title.value=w.title; title.maxLength=60; title.setAttribute('aria-label',w.id+' widget title'); field('Title',title,v=>w.title=v.trim()||M.catalog.find(c=>c.id===w.id).title);
  const width=node('select'); width.append(new Option('One column','normal'),new Option('Two columns','wide')); width.value=w.width; field('Width',width,v=>w.width=v);
  if (!['keep','voice'].includes(w.id)) { const limit=node('select'); for(const n of [1,3,5,8,10]) limit.append(new Option(String(n),String(n))); if (![1,3,5,8,10].includes(w.limit)) limit.append(new Option(String(w.limit),String(w.limit))); limit.value=w.limit; field('Items',limit,v=>w.limit=Number(v)); }
  if(['calendar','tasks'].includes(w.id)) {
    const isCalendar=w.id==='calendar', choices=isCalendar?calendars:tasklists;
    const fieldset=node('fieldset',undefined,'source-choices');fieldset.append(node('legend',isCalendar?'Calendars':'Task lists'));
    if(!choices.length) fieldset.append(node('p','Connect Google and refresh to load available '+(isCalendar?'calendars.':'task lists.'),'hint'));
    const selected=isCalendar?w.calendarIds:(w.listIds===null?[tasklists[0]?.id]:w.listIds);
    for(const item of choices){const label=node('label'),check=node('input');check.type='checkbox';check.value=item.id;
      check.checked=selected.includes(item.id)||(isCalendar&&item.primary&&selected.includes('primary'));
      label.append(check,document.createTextNode(item.summaryOverride||item.summary||item.title));
      check.onchange=()=>{const values=[...fieldset.querySelectorAll('input:checked')].map(n=>n.value);if(isCalendar)w.calendarIds=values;else w.listIds=values;save();loadWidget(w,box.closest('[data-widget]').querySelector('.content'));};fieldset.append(label);
    } box.append(fieldset);
  }
  if (['keep','voice'].includes(w.id)) { const account=node('select'); for(let i=0;i<10;i++) account.append(new Option('Google account '+(i+1),String(i))); account.value=w.account; field('Account',account,v=>w.account=Number(v)); }
  const controls=node('div',undefined,'move-controls'), index=state.widgets.indexOf(w);
  const up=button('Move earlier',()=>move(w.id,-1)), down=button('Move later',()=>move(w.id,1)); up.disabled=index===0; down.disabled=index===state.widgets.length-1;
  controls.append(up,down,button('Hide',()=>{w.visible=false;save();render();announce(w.title+' hidden. Add it again in Customize.');})); box.append(controls); return box;
}
function move(id,delta) { const i=state.widgets.findIndex(w=>w.id===id), target=state.widgets[i+delta]; if(target){M.move(state,id,target.id);save();render();document.querySelector('[data-widget="'+id+'"] .move-controls button:not(:disabled)')?.focus();announce('Widget moved.');} }
function renderChoices() {
  $('widget-choices').replaceChildren();
  for(const w of state.widgets) { const label=node('label'), input=node('input'); input.type='checkbox'; input.checked=w.visible; input.onchange=()=>{w.visible=input.checked;save();render();}; label.append(input,document.createTextNode(M.catalog.find(c=>c.id===w.id).title)); $('widget-choices').append(label); }
  $('refresh-period').value=state.refresh;
}
function setEditing(value) { editing=value; $('customization').hidden=!value; $('customize').setAttribute('aria-expanded',String(value)); $('customize').textContent=value?'Close customization':'Customize'; render(); if(value) $('customization').scrollIntoView({block:'start'}); }
function render() {
  // Rebuilding settings must retain the keyboard user's exact control.
  const focused = document.activeElement;
  const widgetId = focused?.closest('[data-widget]')?.dataset.widget;
  const settingIndex = widgetId ? [...focused.closest('[data-widget]').querySelectorAll('.widget-settings input,.widget-settings select,.widget-settings button')].indexOf(focused) : -1;
  const choiceIndex = [...$('widget-choices').querySelectorAll('input')].indexOf(focused);
  const selection = focused?.tagName === 'INPUT' && focused.type === 'text' ? [focused.selectionStart,focused.selectionEnd] : null;
  renderChoices(); const grid=$('widgets'); grid.replaceChildren();
  for(const w of state.widgets.filter(w=>w.visible)) {
    const definition=M.catalog.find(c=>c.id===w.id), section=node('section',undefined,'widget '+w.width+(['keep','voice'].includes(w.id)?' shortcut':'')); section.dataset.widget=w.id; section.setAttribute('aria-labelledby','heading-'+w.id);
    if(editing) section.append(settings(w));
    const top=node('div',undefined,'widget-top'), identity=node('div',undefined,'widget-title'), heading=node('h2',w.title); heading.id='heading-'+w.id; identity.append(icon(w.id),heading); top.append(identity);
    const urls={gmail:'https://mail.google.com/',calendar:'https://calendar.google.com/',tasks:'https://tasks.google.com/',github:'https://github.com/'};
    if(urls[w.id]) top.append(link('Open ↗',urls[w.id])); else if(w.id==='control-center') top.append(workspaceLink('Manage →','control-center'));
    section.append(top,node('p',definition.subtitle,'widget-subtitle')); const body=node('div',undefined,'content'); body.textContent='Loading…'; section.append(body); grid.append(section);
    section.draggable=editing;
    section.ondragstart=e=>{if(e.target.closest('input,select,button,a')){e.preventDefault();return;}e.dataTransfer.setData('text/arnes-widget',w.id);section.classList.add('dragging');};
    section.ondragover=e=>{if(editing && e.dataTransfer.types.includes('text/arnes-widget')){e.preventDefault();section.classList.add('drag-over');}};
    section.ondragleave=()=>section.classList.remove('drag-over'); section.ondragend=()=>section.classList.remove('dragging');
    section.ondrop=e=>{e.preventDefault();if(!editing)return;M.move(state,e.dataTransfer.getData('text/arnes-widget'),w.id);save();render();};
    loadWidget(w,body);
  }
  if (choiceIndex >= 0) $('widget-choices').querySelectorAll('input')[choiceIndex]?.focus();
  if (widgetId && settingIndex >= 0) {
    const widget = [...grid.children].find(n=>n.dataset.widget===widgetId);
    const next = widget?.querySelectorAll('.widget-settings input,.widget-settings select,.widget-settings button')[settingIndex];
    if (next && !next.disabled) { next.focus(); if(selection) next.setSelectionRange(...selection); }
    else { const choice = [...$('widget-choices').querySelectorAll('input')].find(n=>n.parentElement.textContent===M.catalog.find(c=>c.id===widgetId)?.title); choice?.focus(); }
  }
  if(!state.widgets.some(w=>w.visible)) { const empty=node('div',undefined,'empty'); empty.append(node('p','Your homepage is clear.'),button('Choose widgets',()=>setEditing(true)));grid.append(empty); }
}
async function loadWidget(w,target) {
  const generation=(target.loadGeneration||0)+1;target.loadGeneration=generation;
  const body=node('div');
  target.replaceChildren(node('p','Loading…','hint'));
  try {
    const entries=[];
    if(['gmail','calendar','tasks'].includes(w.id)) requireGoogle();
    if(w.id==='gmail') {
      const data=await memo('mail',()=>action('google-workspace','mail')); body.replaceChildren();
      rows(body,(data.messages||[]).slice(0,w.limit),'You’re caught up. No unread mail.',(li,m)=>{const header=name=>m.headers?.find(h=>h.name.toLowerCase()===name)?.value || '';li.append(link(header('subject')||'(No subject)','https://mail.google.com/mail/u/0/#all/'+encodeURIComponent(m.id)),node('small',header('from')));});
    } else if(w.id==='calendar') {
      const selected=w.calendarIds;body.replaceChildren();
      if(!selected.length){body.append(node('p','Choose at least one calendar in Customize.'));return;}
      const results=await Promise.allSettled(selected.map(id=>memo('calendar:'+id,()=>action('google-workspace','calendar',{calendarId:id}))));
      const items=[];results.forEach((result,i)=>{if(result.status==='fulfilled')for(const e of result.value.items||[])items.push({...e,calendarName:calendars.find(c=>c.id===selected[i]||(c.primary&&selected[i]==='primary'))?.summary||'Calendar'});});
      body.replaceChildren();rows(body,items.filter(e=>e.status!=='cancelled').sort((a,b)=>new Date(a.start?.dateTime||a.start?.date)-new Date(b.start?.dateTime||b.start?.date)).slice(0,w.limit),'No upcoming events in the selected calendars.',(li,e)=>{li.append(node('time',date(e.start?.dateTime||e.start?.date,Boolean(e.start?.date))+(e.start?.date?' · All day':'')),link(e.summary||'(Untitled event)',safeUrl(e.htmlLink,'https://calendar.google.com/')),node('small',e.calendarName+(e.location?' · '+e.location:'')));});
      if(results.some(r=>r.status==='rejected'))body.append(node('p','Some calendars could not be loaded. Check your selection or retry.','error'));
    } else if(w.id==='tasks') {
      const selected=w.listIds===null?(tasklists[0]?[tasklists[0].id]:[]):w.listIds;
      if(!selected.length){body.replaceChildren(node('p','Choose at least one task list in Customize.'));return;}
      const results=await Promise.allSettled(selected.map(id=>memo('tasks:'+id,()=>action('google-workspace','tasks',{listId:id}))));
      const tasks=[];results.forEach((result,i)=>{if(result.status==='fulfilled')for(const task of result.value.items||[])tasks.push({...task,listName:tasklists.find(l=>l.id===selected[i])?.title||'Task list'});});
      body.replaceChildren();rows(body,tasks.filter(t=>t.status!=='completed'&&!t.deleted&&!t.hidden).slice(0,w.limit),'No open tasks in the selected lists.',(li,t)=>{li.append(link(t.title||'(Untitled task)',safeUrl(t.webViewLink,'https://tasks.google.com/')),node('small',t.listName+(t.due?' · Due '+date(t.due.slice(0,10),true):'')));});
      if(results.some(r=>r.status==='rejected'))body.append(node('p','Some task lists could not be loaded. Check your selection or retry.','error'));
    } else if(w.id==='github') {
      const plugin=plugins.find(p=>p.id==='github');
      if(!plugin?.enabled) { body.replaceChildren(node('p','Use this PC’s GitHub CLI sign-in to show recent repositories. Enabling grants read access through the local gh process.'));
        const enable=button('Enable GitHub',async()=>{enable.disabled=true;try{await request('/hub/plugins/github/enable',{enabled:true,grants:plugin?.permissions||[]});await refresh();}catch(e){if(target.loadGeneration===generation)target.append(node('p',e.message,'error'));enable.disabled=false;}}); body.append(enable);return; }
      const data=await memo('github:'+w.limit,()=>action('github','repositories',{limit:w.limit})); body.replaceChildren();
      rows(body,(data.repositories||[]).slice(0,w.limit),'No repositories found for this GitHub account.',(li,r)=>{
        li.append(link(r.name,safeUrl(r.url,'https://github.com/')));
        const activity=r.lastActivity;
        li.append(node('small',activity?'Last activity: '+activity.title+' · '+date(activity.at):r.pushedAt?'Last push: '+date(r.pushedAt):'Updated '+date(r.updatedAt)));
        if(activity?.detail)li.append(node('small',activity.detail));
        const details=node('details',undefined,'repo-details'),summary=node('summary','Repository details');details.append(summary);
        const content=node('div');details.append(content);details.open=expandedRepos.has(r.name);let loaded=false;
        async function load(){if(loaded)return;loaded=true;content.replaceChildren(node('p','Loading repository activity…','hint'));
          try{const result=await memo('repo:'+r.name,()=>action('github','repository',{repo:r.name}));content.replaceChildren();if(result.description)content.append(node('p',result.description));content.append(node('p',[result.language,result.defaultBranch?'Branch: '+result.defaultBranch:'',Number.isFinite(result.openIssues)?result.openIssues+' open issues / pull requests':''].filter(Boolean).join(' · '),'hint'));
            for(const [title,items] of [['Recent activity',result.events||[]],['Recent commits',result.commits||[]],['Open pull requests',result.pulls||[]]]){content.append(node('h3',title));rows(content,items,'None available.',(row,item)=>{row.append(link(item.title+(item.detail?' · '+item.detail:''),safeUrl(item.url,r.url)),node('small',(item.actor?item.actor+' · ':'')+date(item.at)));});}
          }catch(error){loaded=false;content.replaceChildren(node('p',error.message,'error'),button('Retry details',load,'retry'));}}
        details.ontoggle=()=>{if(details.open){expandedRepos.add(r.name);load();}else expandedRepos.delete(r.name);};li.append(details);if(details.open)load();
      });
    } else if(w.id==='harnesses') {
      let tabs=[];try{tabs=JSON.parse(localStorage.getItem('harness-hub-tabs-v1'))||[];}catch{}
      const data=await memo('harnesses',()=>request('/hub/harness/status'));body.replaceChildren();
      rows(body,(Array.isArray(tabs)?tabs:[]).filter(t=>!['home','plugins','providers','control-center'].includes(t.id)).slice(0,w.limit),'Add a harness from the workspace sidebar.',(li,t)=>{li.classList.add('service');const status=data.statuses?.[t.id];li.append(node('span',undefined,'dot '+(status?.state||'unknown'))); const text=node('span');text.append(workspaceLink(t.name,t.id),node('small',status?.label||'Status not checked'));li.append(text);});
    } else if(w.id==='control-center') {
      const data=await memo('control-center',()=>request('/hub/control-center/status'));body.replaceChildren();
      rows(body,(data.systems||[]).filter(s=>s.live===true).slice(0,w.limit),'No live service checks available.',(li,s)=>{li.classList.add('service');li.append(node('span',undefined,'dot '+(s.reachable?'up':'down')));const text=node('span');text.append(workspaceLink(s.name,'control-center'),node('small',s.reachable?'Responding'+(s.status?' · HTTP '+s.status:''):'Unavailable · open Control Center for details'));li.append(text);});
      body.append(node('p','Checked '+new Date(data.checkedAt).toLocaleTimeString(),'hint'));
    } else if(w.id==='keep') {
      body.replaceChildren(link('Open Google Keep ↗','https://keep.google.com/u/'+w.account+'/'),node('p','Capture a note or find a list in Google Keep.','hint'),node('p','Shortcut only. Personal Google Keep notes aren’t available through Google’s enterprise Keep API.','hint'));
    } else if(w.id==='voice') {
      const base='https://voice.google.com/u/'+w.account+'/';body.replaceChildren(link('Open Google Voice ↗',base));const links=node('div',undefined,'shortcut-links');links.append(link('Messages',base+'messages'),link('Calls',base+'calls'),link('Voicemail',base+'voicemail'));body.append(links,node('p','Shortcut only. Read and send messages, make calls, and listen to voicemail in Google Voice.','hint'));
    }
  } catch(error) { body.replaceChildren(node('p',error.message||'This widget could not be loaded.','error'));if(error.connect) body.append(workspaceLink('Connect Google in Plugins →','plugins')); else body.append(button('Retry',()=>refresh(),'retry')); }
  finally { if(target.isConnected&&target.loadGeneration===generation)target.replaceChildren(...body.childNodes); }
}
async function refresh() {
  if(loading)return;loading=true;$('refresh').disabled=true;cache.clear();
  try { const data=await request('/hub/plugins');token=data.token;plugins=data.plugins||[];announce('');
    if(plugins.some(p=>p.id==='google-workspace'&&p.enabled&&p.status.state==='connected')){const sources=await Promise.allSettled([action('google-workspace','calendars'),action('google-workspace','tasklists')]);calendars=sources[0].status==='fulfilled'?sources[0].value.items||[]:[];tasklists=sources[1].status==='fulfilled'?sources[1].value.items||[]:[];} }
  catch(error) { plugins=[];announce('Connections could not be checked. Open the local Arnés homepage on this PC and retry.'); }
  if(!editing) render(); await Promise.allSettled([...cache.values()]);
  $('updated').textContent='Refresh requested '+new Date().toLocaleTimeString()+'. Each widget reports its own connection state.';
  loading=false;$('refresh').disabled=false;
}
function schedule() { clearInterval(refreshTimer);if(state.refresh)refreshTimer=setInterval(()=>{if(!document.hidden && !editing)refresh();},state.refresh*1000); }
$('today').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
$('customize').onclick=()=>setEditing(!editing);$('done').onclick=()=>{setEditing(false);$('customize').focus();};$('refresh').onclick=()=>{if(editing)setEditing(false);refresh();};
$('refresh-period').onchange=e=>{state.refresh=Number(e.target.value);save();schedule();};
$('reset').onclick=()=>{state=M.normalize();save();schedule();render();announce('Default layout restored.');};
window.addEventListener('storage',e=>{if(e.key==='harness-hub-tabs-v1'&&!editing)refresh();});
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===parent&&e.data?.type==='arnes:home-visible'&&!editing)refresh();});
refresh();schedule();
