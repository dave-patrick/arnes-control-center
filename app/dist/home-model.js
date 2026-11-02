(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HomeModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const key = 'arnes-home-widgets-v1';
  const catalog = [
    { id: 'gmail', title: 'Gmail', subtitle: 'Unread mail', width: 'wide' },
    { id: 'calendar', title: 'Calendar', subtitle: 'Coming up', width: 'normal' },
    { id: 'tasks', title: 'Google Tasks', subtitle: 'Your next steps', width: 'normal' },
    { id: 'github', title: 'GitHub', subtitle: 'Recently updated repositories', width: 'normal' },
    { id: 'harnesses', title: 'My harnesses', subtitle: 'Pick up where you work', width: 'normal' },
    { id: 'control-center', title: 'Control Center', subtitle: 'Live service checks', width: 'wide' },
    { id: 'keep', title: 'Google Keep', subtitle: 'Notes & lists', width: 'normal' },
    { id: 'voice', title: 'Google Voice', subtitle: 'Messages, calls & voicemail', width: 'normal' }
  ];
  function normalize(raw) {
    const saved = Array.isArray(raw?.widgets) ? raw.widgets : [];
    const order = [...new Set(saved.map(w => w?.id).filter(id => catalog.some(c => c.id === id)))];
    for (const c of catalog) if (!order.includes(c.id)) order.push(c.id);
    return { version: 1, refresh: [0,60,300,900].includes(raw?.refresh) ? raw.refresh : 300,
      widgets: order.map(id => {
        const defaults = catalog.find(c => c.id === id), s = saved.find(w => w?.id === id) || {};
        return { id, title: typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0,60) : defaults.title,
          visible: s.visible !== false, width: ['normal','wide'].includes(s.width) ? s.width : defaults.width,
          limit: Number.isInteger(s.limit) && s.limit >= 1 && s.limit <= 10 ? s.limit : 5,
          calendarIds: Array.isArray(s.calendarIds) ? [...new Set(s.calendarIds.filter(v=>typeof v==='string'&&v.length>0&&v.length<=1024))].slice(0,25) : ['primary'],
          listIds: Array.isArray(s.listIds) ? [...new Set(s.listIds.filter(v=>typeof v==='string'&&/^[\w-]{1,256}$/.test(v)))].slice(0,25) : (s.listId ? [s.listId] : null),
          listId: typeof s.listId === 'string' && /^[\w-]{1,256}$/.test(s.listId) ? s.listId : '',
          account: Number.isInteger(s.account) && s.account >= 0 && s.account <= 9 ? s.account : 0 };
      }) };
  }
  function move(state, id, target) {
    const from = state.widgets.findIndex(w => w.id === id), to = state.widgets.findIndex(w => w.id === target);
    if (from >= 0 && to >= 0 && from !== to) state.widgets.splice(to, 0, state.widgets.splice(from,1)[0]);
    return state;
  }
  return { key, catalog, normalize, move };
});
