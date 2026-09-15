'use strict';

// Escala mundo TTS -> píxeles. TTS: X derecha, Z hacia arriba (vista cenital).
const UNIT = 30;
const CARD_W = 2.25, CARD_H = 3.15; // tamaño carta a scale=1 (unidades TTS)
const BOARD_H = 10;                 // alto de Custom_Board a scale=1
const TILE = 1;                     // lado de Custom_Tile a scale=1
const SAVE_KEY = 'lea-web-state-v1';

const $ = s => document.querySelector(s);
const world = $('#world'), viewport = $('#viewport');

let initial = null;      // objetos originales del mod
let state = null;        // { objects: [...], hand: [...], nextId }
let view = { x: 0, y: 0, zoom: 0.5 };
let undoStack = [];
let hoverId = null;
let hoveredHandCard = null;
let mousePosition = null;
let zTop = 1;
let activeZone = 'playmat';
let placement = null;
let statusTimer;
let inspectorPointerStarted = false;
let inspectorTarget = null;
const DOUBLE_TAP_MS = 400;
let lastStackTap = null;
let cardZoom = null;
let online = null;
let individualState = null, individualUndo = null, pendingRemote = null;
let cancelHandGesture = null;

const els = new Map();   // id -> elemento DOM
function counterIcon(resource) {
  const img = document.createElement('img');
  img.className = 'counter-icon';
  img.dataset.symbol = resource === 'stars' ? 'star' : 'attack';
  img.src = `assets/icons/${img.dataset.symbol}.png`;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.draggable = false;
  return img;
}

// ---------- Utilidades ----------
const clone = o => JSON.parse(JSON.stringify(o));
const byId = id => state.objects.find(o => o.id === id);
const toPx = o => ({ left: o.x * UNIT, top: -o.z * UNIT });

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function pushUndo() {
  undoStack.push(clone(state));
  if (undoStack.length > 100) undoStack.shift();
}

function save() {
  if (online?.active) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* sin almacenamiento */ }
}

function status(msg) {
  $('#status').textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { $('#status').textContent = ''; }, 3500);
}

// ---------- Salas ----------
function roomError(message) {
  $('#room-error').textContent = message;
  $('#room-error').hidden = !message;
}

function updateRoomUI() {
  const room = online?.active && online.room;
  $('#room-entry').hidden = Boolean(room);
  $('#room-current').hidden = !room;
  $('#room-title').textContent = room ? `Sala ${room.code}` : 'Jugar con amigos';
  $('#btn-room').classList.toggle('connected', Boolean(room && online.connected));
  $('#btn-room').classList.toggle('disconnected', Boolean(room && !online.connected));
  $('#btn-room').title = room ? `Sala ${room.code} · ${online.connected ? 'Conectada' : 'Reconectando'}` : 'Jugar multijugador';
  $('#btn-setup').disabled = Boolean(room && !room.host);
  $('#btn-reset').disabled = Boolean(room && !room.host);
  $('#btn-undo').disabled = Boolean(room && (!room.canUndo || !online.connected));
  if (!room) return;
  $('#room-connection').textContent = online.connected
    ? `Conectados · Tu zona es Jugador ${room.seat}${room.host ? ' · Eres el anfitrión' : ''}`
    : 'Sin conexión. Reconectando… Tu partida está guardada.';
  const link = new URL(location.href); link.hash = `room=${room.code}`;
  $('#room-link').value = link.href;
  const list = $('#room-players');
  const signature = JSON.stringify(room.players);
  if (list.dataset.players === signature) return;
  list.dataset.players = signature;
  list.replaceChildren();
  for (const person of room.players) {
    const li = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('small');
    title.textContent = `${person.name}${person.id === room.me ? ' (tú)' : ''}`;
    detail.textContent = `Jugador ${person.seat} · ${person.online ? 'En línea' : 'Desconectado'} · ${person.handCount} cartas en mano`;
    li.append(title, detail); list.append(li);
  }
}

function applyRemote(data) {
  const previous = new Map(state.objects.map(o => [o.id, o]));
  const next = data.state;
  const inspectorChanged = inspectorTarget?.kind === 'object'
    ? !next.objects.some(o => o.id === inspectorTarget.id && o.v === inspectorTarget.version)
    : inspectorTarget?.kind === 'hand' && !next.hand.some(c => c.uid === inspectorTarget.uid);
  const inspected = inspectorTarget?.kind === 'object' && next.objects.find(o => o.id === inspectorTarget.id);
  const keepInspector = inspectorChanged && inspectorTarget?.keepOpen && inspected?.type === 'stack'
    && inspected.cards.length === previous.get(inspected.id)?.cards?.length;
  const selected = placement?.kind === 'stack' && previous.get(placement.id);
  if (selected && !next.objects.some(o => o.id === selected.id && o.v === selected.v)) cancelPlacement();
  if (placement?.kind === 'hand' && !next.hand.some(c => c.uid === placement.card.uid)) cancelPlacement();
  const handChanged = JSON.stringify(state.hand) !== JSON.stringify(next.hand);
  next.objects = next.objects.map(o => previous.get(o.id)?.v === o.v ? previous.get(o.id) : o);
  if (!handChanged) next.hand = state.hand;
  state = next;
  const ids = new Set(next.objects.map(o => o.id));
  for (const [id, el] of els) if (!ids.has(id)) { el.remove(); els.delete(id); }
  for (const o of next.objects) if (previous.get(o.id) !== o) renderObj(o);
  zTop = Math.max(1, ...next.objects.map(o => o.z_ || 0));
  if (handChanged) renderHand();
  if (keepInspector) refreshStackInspector(inspected);
  else if (inspectorChanged) closeInspector();
  $('#menu').hidden = true;
}

function flushRemote() {
  if (!pendingRemote || drag?.changed || suppressHandClick || cancelHandGesture) return;
  const data = pendingRemote; pendingRemote = null;
  if (online?.active) applyRemote(data);
}

async function onlineAction(action) {
  try {
    const result = await online.action(action);
    if (result) { roomError(''); status(result.message || 'Mesa actualizada'); }
    return result;
  } catch (error) { status(error.message); roomError(error.message); return null; }
}

function initializeRooms() {
  online = new AlienRooms(window.ALIEN_ROOM_API, {
    joining() {
      individualState = clone(state); individualUndo = undoStack;
      undoStack = []; pendingRemote = null;
      cancelPlacement(); clearDrag(); closeInspector(); closeModal(); closeCardZoom();
      $('#setup').hidden = true; $('#help').hidden = true;
      // Room object versions start at zero; do not reuse local objects with the same IDs.
      state = { objects: [], hand: [], nextId: 1 };
      world.replaceChildren(); els.clear();
    },
    snapshot(data) {
      updateRoomUI();
      if (!data.state) return;
      pendingRemote = data;
      flushRemote();
    },
    connection() { updateRoomUI(); },
    error: roomError,
  });
  try { $('#room-name').value = localStorage.getItem('lea-room-name') || ''; } catch {}
  $('#btn-room').onclick = () => {
    updateRoomUI(); $('#room-dialog').hidden = false;
    $(online.active ? '#room-copy' : '#room-name').focus();
  };
  $('#room-close').onclick = () => { $('#room-dialog').hidden = true; $('#btn-room').focus(); };
  let connecting = false;
  async function connect(create) {
    if (connecting || online.active) return;
    const name = $('#room-name').value.trim();
    if (!name) { roomError('Escribe tu nombre para entrar.'); $('#room-name').focus(); return; }
    connecting = true; roomError('');
    $('#room-create').disabled = true; $('#room-join').disabled = true;
    try {
      await (create ? online.create(name) : online.join($('#room-code').value, name));
      updateRoomUI(); focusZone('playmat');
      status(create ? 'Sala creada. Comparte el enlace y prepara la partida.' : 'Ya estás en la sala.');
    } catch (error) {
      roomError(error.status || !['TypeError', 'AbortError'].includes(error.name) ? error.message : 'No se pudo conectar al servidor de salas. Vuelve a intentarlo.');
      $('#room-dialog').hidden = false;
    } finally {
      connecting = false; $('#room-create').disabled = false; $('#room-join').disabled = false;
    }
  }
  $('#room-create').onclick = () => connect(true);
  $('#room-join').onclick = () => connect(false);
  $('#room-code').onkeydown = e => { if (e.key === 'Enter') connect(false); };
  $('#room-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#room-link').value); $('#room-copy').textContent = 'Enlace copiado'; }
    catch { $('#room-link').focus(); $('#room-link').select(); roomError('Selecciona y copia el enlace para compartirlo.'); }
    setTimeout(() => { $('#room-copy').textContent = 'Copiar enlace'; }, 2500);
  };
  $('#room-leave').onclick = async () => {
    $('#room-leave').disabled = true;
    await online.queue;
    online.leave(); pendingRemote = null;
    cancelPlacement(); clearDrag(); closeInspector(); closeModal(); closeCardZoom();
    state = individualState; undoStack = individualUndo;
    individualState = null; individualUndo = null;
    renderAll(); updateRoomUI(); focusZone('playmat');
    $('#room-dialog').hidden = true; $('#room-leave').disabled = false;
    status('Has vuelto a tu partida individual. La sala sigue guardada.');
  };
  function openInvitation() {
    const code = new URLSearchParams(location.hash.slice(1)).get('room');
    if (!code || online.active) return;
    $('#room-code').value = code.toUpperCase();
    const saved = online.saved(code.toUpperCase());
    if (saved) { $('#room-name').value = saved.name; connect(false); }
    else { $('#room-dialog').hidden = false; $('#room-name').focus(); }
  }
  addEventListener('hashchange', openInvitation);
  openInvitation();
}

// ---------- Carga ----------
async function load() {
  const data = await fetch('data.json?v=7').then(r => {
    if (!r.ok) throw new Error('No se han podido cargar las cartas.');
    return r.json();
  });
  initial = data.objects.map((o, i) => ({ ...o, id: i + 1, z_: i }));
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { /* ignorar */ }
  state = saved || freshState();
  // Keep the old save key and object IDs so existing hands and decks survive.
  if (!state.schemaVersion) {
    const mat = initial.find(o => o.type === 'playmat');
    if (mat) {
      const old = state.objects.findIndex(o => o.id === mat.id && o.type === 'token');
      if (old >= 0) state.objects[old] = clone(mat);
      else if (!state.objects.some(o => o.type === 'playmat')) state.objects.push({ ...clone(mat), id: state.nextId++ });
    }
    state.schemaVersion = 2;
  }
  if (state.schemaVersion < 3) migratePlayerZones();
  if (state.schemaVersion < 4) migratePlayerCounters();
  renderAll();
  focusZone('playmat');
  updateSetupSummary();
}

function freshState() {
  return { objects: clone(initial), hand: [], nextId: initial.length + 1, schemaVersion: 4 };
}

function migratePlayerZones() {
  const zones = initial.filter(o => o.type === 'player-zone');
  const ids = new Set(zones.map(o => o.sourceId));
  const faces = new Set(zones.map(o => o.img));
  const isCard = card => !ids.has(card.sourceId) && !faces.has(card.face);
  // Legacy saves can contain these markers inside a real deck or in the hand.
  // Remove only the marker images; retain every real card and its saved position.
  state.hand = state.hand.filter(isCard);
  state.objects = state.objects.filter(o => {
    if (o.type !== 'stack') return true;
    o.cards = o.cards.filter(isCard);
    return o.cards.length > 0;
  });
  state.nextId = Math.max(state.nextId, ...state.objects.map(o => o.id + 1));
  const usedIds = new Set(state.objects.map(o => o.id));
  for (const zone of zones) {
    if (state.objects.some(o => o.type === 'player-zone' && o.sourceId === zone.sourceId)) continue;
    const id = usedIds.has(zone.id) ? state.nextId++ : zone.id;
    state.objects.push({ ...clone(zone), id });
    usedIds.add(id);
  }
  state.schemaVersion = 3;
}

function migratePlayerCounters() {
  state.nextId = Math.max(state.nextId, ...state.objects.map(o => o.id + 1));
  const usedIds = new Set(state.objects.map(o => o.id));
  for (const counter of initial.filter(o => o.type === 'counter')) {
    const current = state.objects.find(o => o.type === 'counter'
      && (o.sourceId === counter.sourceId || (!o.sourceId && o.id === counter.id)));
    if (current) {
      Object.assign(current, { name: counter.name, resource: counter.resource, playerId: counter.playerId, sourceId: counter.sourceId });
      continue;
    }
    const id = usedIds.has(counter.id) ? state.nextId++ : counter.id;
    state.objects.push({ ...clone(counter), id });
    usedIds.add(id);
  }
  state.schemaVersion = 4;
}

// ---------- Render ----------
function renderAll() {
  world.innerHTML = '';
  els.clear();
  zTop = Math.max(1, ...state.objects.map(o => o.z_ || 0));
  const order = { playmat: -1, board: 0, tile: 1, 'player-zone': 1, text: 2, stack: 3, counter: 4, token: 5, bag: 5 };
  state.objects
    .slice()
    .sort((a, b) => (order[a.type] - order[b.type]) || (a.z_ || 0) - (b.z_ || 0))
    .forEach(o => { renderObj(o); });
  renderHand();
  save();
}

function sizeOf(o) {
  switch (o.type) {
    case 'playmat': return { w: o.width, h: o.height };
    case 'stack': case 'player-zone': return { w: CARD_W * o.scale, h: CARD_H * o.scale };
    case 'board': return { w: BOARD_H * o.scale * o.widthScale, h: BOARD_H * o.scale };
    case 'tile': return { w: TILE * o.scale * 2.14, h: TILE * o.scale };
    case 'token': case 'bag': return { w: 2, h: 2 };
    case 'counter': return { w: 3.4, h: 2.4 };
    default: return { w: 0, h: 0 };
  }
}

function renderObj(o) {
  let el = els.get(o.id);
  if (!el) {
    el = document.createElement('div');
    el.dataset.id = o.id;
    world.appendChild(el);
    els.set(o.id, el);
  }
  const { w, h } = sizeOf(o);
  const { left, top } = toPx(o);
  el.className = 'obj ' + o.type;
  el.classList.toggle('selected', placement?.kind === 'stack' && placement.id === o.id);
  el.style.width = w * UNIT + 'px';
  el.style.height = h * UNIT + 'px';
  el.style.left = left - (w * UNIT) / 2 + 'px';
  el.style.top = top - (h * UNIT) / 2 + 'px';
  el.style.zIndex = o.type === 'stack' || o.type === 'token' || o.type === 'bag' || o.type === 'counter'
    ? 1000 + (o.z_ || 0) : (o.type === 'text' ? 500 : o.type === 'player-zone' ? 100 : 0);
  el.innerHTML = '';

  if (o.type === 'stack') {
    if (!o.cards.length) { removeObj(o.id); return; }
    const top = o.cards[0];
    el.style.backgroundImage = `url("${o.faceUp ? top.face : top.back}")`;
    el.style.transform = `rotate(${o.rot - 180}deg)`;
    el.classList.toggle('deck', o.cards.length > 1);
    if (o.cards.length > 1) {
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = o.cards.length;
      el.appendChild(c);
    }
  } else if (o.type === 'board' || o.type === 'tile' || o.type === 'playmat' || o.type === 'player-zone') {
    el.style.backgroundImage = `url("${o.img}")`;
    el.style.transform = `rotate(${o.rot - 180}deg)`;
    if (o.type === 'player-zone') {
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', `Zona de jugador: ${o.name}`);
      el.title = `${o.name} · Coloca tus cartas aquí`;
    }
    if (o.textureBounds) {
      const [x1, y1, x2, y2] = o.textureBounds;
      const w = x2 - x1, h = y2 - y1;
      el.style.backgroundSize = `${100 / w}% ${100 / h}%`;
      el.style.backgroundPosition = `${100 * x1 / (1 - w)}% ${100 * y1 / (1 - h)}%`;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Tapete original de Legendary Encounters: Alien');
    }
  } else if (o.type === 'text') {
    el.className = 'obj text3d';
    el.textContent = o.text;
    el.style.fontSize = o.fontSize * 0.012 * UNIT + 'px';
    el.style.width = 'auto'; el.style.height = 'auto';
    el.style.left = left + 'px'; el.style.top = top + 'px';
    el.style.transform = `translate(-50%, -50%) rotate(${o.rot}deg)`;
  } else if (o.type === 'token' || o.type === 'bag') {
    const [r, g, b] = o.color;
    el.className = 'obj token';
    el.style.background = `rgb(${r * 255},${g * 255},${b * 255})`;
    if (r + g + b < 0.6) el.style.color = '#fff';
    el.textContent = o.type === 'bag' ? '∞ ' + o.name : o.name;
    el.title = o.type === 'bag' ? 'Clic: sacar ficha' : o.name;
  } else if (o.type === 'counter') {
    el.className = 'obj counter';
    el.dataset.resource = o.resource || 'strikes';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', o.name || 'Contador');
    const label = document.createElement('small'); label.className = 'counter-label';
    label.append(counterIcon(o.resource), document.createTextNode(o.name || 'Contador'));
    const row = document.createElement('div'); row.className = 'counter-controls';
    const minus = document.createElement('button'); minus.textContent = '−';
    const val = document.createElement('span'); val.textContent = o.value;
    const plus = document.createElement('button'); plus.textContent = '+';
    minus.setAttribute('aria-label', `Restar ${o.name || 'punto'}`);
    plus.setAttribute('aria-label', `Sumar ${o.name || 'punto'}`);
    minus.onpointerdown = plus.onpointerdown = e => e.stopPropagation();
    minus.onclick = () => { if (!matchMedia('(pointer: coarse)').matches) changeCounter(o, -1); };
    plus.onclick = () => { if (!matchMedia('(pointer: coarse)').matches) changeCounter(o, 1); };
    el.onclick = () => { if (matchMedia('(pointer: coarse)').matches) inspectObject(o); };
    row.append(minus, val, plus);
    el.append(label, row);
  }
}

function removeObj(id) {
  state.objects = state.objects.filter(o => o.id !== id);
  const el = els.get(id);
  if (el) el.remove();
  els.delete(id);
  if (hoverId === id) hoverId = null;
}

function raise(o) { o.z_ = ++zTop; }

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
}

function fitBounds(minX, maxX, minZ, maxZ) {
  const vw = viewport.clientWidth, vh = viewport.clientHeight;
  const verticalPadding = vh < 350 ? 24 : 100;
  view.zoom = Math.min((vw - 32) / ((maxX - minX) * UNIT), (vh - verticalPadding) / ((maxZ - minZ) * UNIT), 4);
  view.zoom = Math.max(0.04, view.zoom);
  view.x = vw / 2 - ((minX + maxX) / 2) * UNIT * view.zoom;
  view.y = vh / 2 + ((minZ + maxZ) / 2) * UNIT * view.zoom;
  applyView();
}

function fitView() {
  const bounds = state.objects.map(o => {
    const { w, h } = sizeOf(o), a = (o.rot || 0) * Math.PI / 180;
    const dx = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
    const dz = (Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))) / 2;
    return [o.x - dx, o.x + dx, o.z - dz, o.z + dz];
  });
  fitBounds(Math.min(...bounds.map(b => b[0])), Math.max(...bounds.map(b => b[1])),
    Math.min(...bounds.map(b => b[2])), Math.max(...bounds.map(b => b[3])));
}

function focusZone(zone) {
  if (!state) return;
  hidePreview();
  activeZone = zone;
  document.querySelectorAll('[data-zone]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.zone === zone)));
  const mat = state.objects.find(o => o.type === 'playmat');
  if (zone === 'playmat' && mat) fitBounds(mat.x - mat.width / 2, mat.x + mat.width / 2, mat.z - mat.height / 2, mat.z + mat.height / 2);
  else if (zone === 'complex') fitBounds(-17, 5, 4.5, 13);
  else if (zone === 'hq') fitBounds(-22, 11, -8, 0);
  else if (zone === 'player') {
    const bounds = [[-12, 12, -30, -13], [-43, -18, -31, -13], [18, 43, -31, -13], [30, 45, -18, 18], [-47, -33, -14, 23]];
    fitBounds(...bounds[(online?.room?.seat || 1) - 1]);
  }
  else if (zone === 'reserve') fitBounds(-52, 47, 35, 66);
  else fitView();
}

function manualView() {
  activeZone = null;
  document.querySelectorAll('[data-zone]').forEach(b => b.setAttribute('aria-pressed', 'false'));
}

function screenToWorld(cx, cy) {
  const r = viewport.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.zoom / UNIT, z: -(cy - r.top - view.y) / view.zoom / UNIT };
}

// ---------- Mano ----------
function renderHand() {
  hoveredHandCard = null;
  const box = $('#hand-cards');
  box.innerHTML = '';
  $('#hand-count').textContent = state.hand.length;
  if (!state.hand.length) {
    const hint = document.createElement('p');
    hint.textContent = 'Toca un mazo y elige «Robar» para llevar cartas a tu mano.';
    box.appendChild(hint);
  }
  state.hand.forEach((card, i) => {
    const img = document.createElement('img');
    img.src = card.face;
    img.alt = card.name || `Carta ${i + 1}`;
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.dataset.handIndex = i;
    img.draggable = false;
    img.onpointerenter = e => { if (e.pointerType === 'mouse') hoveredHandCard = card; };
    img.onpointerleave = () => { if (hoveredHandCard === card) hoveredHandCard = null; hidePreview(); };
    img.onpointerdown = e => startHandDrag(e, i);
    img.onclick = e => { if (!suppressHandClick) inspectHand(card); };
    img.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); inspectHand(card); } };
    box.appendChild(img);
  });
}

function addStack(cards, x, z, faceUp, scale, rot) {
  const o = { type: 'stack', id: state.nextId++, x, z, rot, scale, faceUp, name: '', cards };
  raise(o);
  state.objects.push(o);
  return o;
}

function drawToHand(o, n) {
  if (!o || o.type !== 'stack') return;
  if (online?.active) return onlineAction({ type: 'draw', id: o.id, count: n }).then(result => {
    if (result) { $('#hand').classList.remove('collapsed'); updateHandToggle(); }
  });
  pushUndo();
  const taken = o.cards.splice(0, Math.min(n, o.cards.length));
  state.hand.push(...taken);
  if (!o.cards.length) removeObj(o.id); else renderObj(o);
  renderHand();
  $('#hand').classList.remove('collapsed');
  updateHandToggle();
  save();
  status(`Robadas ${taken.length}`);
}

// ---------- Acciones ----------
function flip(o) {
  if (online?.active) return onlineAction({ type: 'flip', id: o.id });
  pushUndo();
  o.faceUp = !o.faceUp;
  o.cards.reverse();
  renderObj(o); save();
}

function doShuffle(o) {
  if (o.cards.length < 2) return;
  if (online?.active) return onlineAction({ type: 'shuffle', id: o.id });
  pushUndo();
  shuffle(o.cards);
  renderObj(o); save();
  status('Barajado');
  if (inspectorTarget?.id === o.id) refreshStackInspector(o);
}

function rotate(o, d) {
  if (online?.active) return onlineAction({ type: 'rotate', id: o.id, angle: d });
  pushUndo();
  o.rot = (o.rot + d + 360) % 360;
  renderObj(o); save();
}

function dealRow(o, n) {
  if (online?.active) return onlineAction({ type: 'deal', id: o.id, count: n });
  pushUndo();
  const { w } = sizeOf(o);
  for (let i = 0; i < n && o.cards.length; i++) {
    const c = o.cards.shift();
    addStack([c], o.x + (w + 0.3) * (i + 1), o.z, true, o.scale, o.rot);
  }
  renderAll();
}

function openSearch(o, revealed = null) {
  if (!o) return;
  if (online?.active && !revealed) {
    return online.search(o.id).then(result => { if (online.active) openSearch(byId(o.id), result.cards); }).catch(error => status(error.message));
  }
  $('#modal-title').textContent = `${o.name || 'Mazo'} · ${o.cards.length} cartas · Toca para robar`;
  const body = $('#modal-body');
  body.innerHTML = '';
  (revealed || o.cards).forEach((card, i) => {
    const img = document.createElement('img');
    img.src = card.face;
    img.alt = card.name || `Carta ${i + 1}`;
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); img.click(); } };
    img.onclick = e => {
      if (online?.active) {
        onlineAction({ type: 'searchTake', id: o.id, uid: card.uid, toTable: e.shiftKey }).then(result => {
          if (result && byId(o.id)) openSearch(byId(o.id));
        });
        return;
      }
      pushUndo();
      const [c] = o.cards.splice(i, 1);
      if (e.shiftKey) addStack([c], o.x + sizeOf(o).w + 0.3, o.z, true, o.scale, o.rot);
      else state.hand.push(c);
      if (!o.cards.length) { removeObj(o.id); closeModal(); }
      renderAll();
      if (o.cards.length) openSearch(o);
    };
    body.appendChild(img);
  });
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; }

function spawnFromBag(o) {
  if (online?.active) return onlineAction({ type: 'spawn', id: o.id });
  pushUndo();
  const t = { type: 'token', id: state.nextId++, x: o.x + 2.5 + Math.random(), z: o.z + Math.random(),
    rot: 0, scale: 1, name: o.name, color: o.color };
  raise(t);
  state.objects.push(t);
  renderObj(t); save();
}

function deleteObj(o) {
  if (o.type === 'player-zone') return;
  if (online?.active) return onlineAction({ type: 'delete', id: o.id });
  pushUndo(); removeObj(o.id); save();
}

function undo() {
  if (online?.active) return onlineAction({ type: 'undo', revision: online.revision });
  if (!undoStack.length) return;
  cancelPlacement();
  closeInspector();
  closeModal();
  state = undoStack.pop();
  renderAll();
  status('Deshecho');
}

// ---------- Vista previa ----------
function showPreview(src) { $('#preview img').src = src; $('#preview').hidden = false; }
function hidePreview() { $('#preview').hidden = true; }

function closeInspector() { $('#inspector').hidden = true; inspectorTarget = null; }

function fitCardZoom() {
  if (!cardZoom) return;
  const img = $('#card-zoom-image'), box = $('#card-zoom-body');
  if (!img.naturalWidth || !img.naturalHeight) return;
  const angle = cardZoom.rotation * Math.PI / 180;
  const width = Math.abs(img.naturalWidth * Math.cos(angle)) + Math.abs(img.naturalHeight * Math.sin(angle));
  const height = Math.abs(img.naturalWidth * Math.sin(angle)) + Math.abs(img.naturalHeight * Math.cos(angle));
  const scale = Math.min((box.clientWidth - 32) / width, (box.clientHeight - 32) / height);
  img.style.width = `${img.naturalWidth * scale}px`;
  img.style.height = `${img.naturalHeight * scale}px`;
}

function openCardZoom(card, faceUp = true, rotation = 0, holdKey = false) {
  hidePreview();
  cardZoom = { rotation, focus: document.activeElement, holdKey };
  const img = $('#card-zoom-image');
  $('#card-zoom-title').textContent = faceUp ? (card.name || 'Carta ampliada') : 'Carta boca abajo';
  img.alt = faceUp ? (card.name || 'Carta ampliada') : 'Reverso de la carta';
  img.onload = fitCardZoom;
  img.style.transform = `rotate(${rotation}deg)`;
  img.src = faceUp ? card.face : card.back;
  $('#card-zoom').hidden = false;
  $('#card-zoom-close').hidden = holdKey;
  fitCardZoom();
  $(holdKey ? '#card-zoom' : '#card-zoom-close').focus({ preventScroll: true });
}

function closeCardZoom() {
  const target = cardZoom?.focus;
  const held = cardZoom?.holdKey;
  cardZoom = null;
  $('#card-zoom').hidden = true;
  if (held && mousePosition) {
    const el = document.elementFromPoint(mousePosition.x, mousePosition.y);
    const o = el && objAt(el);
    hoverId = o?.type === 'stack' ? o.id : null;
    if (hoverId) els.get(hoverId)?.classList.add('hover');
    const handImage = el?.closest?.('#hand-cards img');
    hoveredHandCard = handImage ? state.hand[Number(handImage.dataset.handIndex)] : null;
  }
  if (target?.isConnected) target.focus({ preventScroll: true });
}

function changeCounter(o, amount) {
  if (online?.active) return onlineAction({ type: 'counter', id: o.id, amount });
  pushUndo(); o.value += amount; renderObj(o); save();
}

function inspect(title, src, actions) {
  inspectorPointerStarted = false;
  hidePreview();
  $('#menu').hidden = true;
  $('#inspector-title').textContent = title;
  $('#inspector').removeAttribute('data-resource');
  const img = $('#inspector-image');
  img.hidden = !src;
  if (src) img.src = src;
  const box = $('#inspector-actions');
  box.innerHTML = '';
  actions.forEach(([label, fn, keepOpen]) => {
    const button = document.createElement('button');
    button.textContent = label;
    button.onclick = () => {
      if (keepOpen && inspectorTarget) inspectorTarget.keepOpen = true;
      else closeInspector();
      fn();
    };
    box.appendChild(button);
  });
  $('#inspector').hidden = false;
  $('#inspector-close').focus({ preventScroll: true });
}

function refreshStackInspector(o) {
  const count = o.cards.length;
  $('#inspector-title').textContent = `${o.name || (count > 1 ? 'Mazo' : 'Carta')} · ${count} ${count === 1 ? 'carta' : 'cartas'}`;
  $('#inspector-image').src = o.faceUp ? o.cards[0].face : o.cards[0].back;
  if (inspectorTarget) inspectorTarget.version = o.v;
}

function inspectObject(o) {
  if (!o) return;
  inspectorTarget = { kind: 'object', id: o.id, version: o.v };
  if (o.type === 'stack') {
    const count = o.cards.length;
    const current = () => byId(o.id);
    inspect(`${o.name || (count > 1 ? 'Mazo' : 'Carta')} · ${count} ${count === 1 ? 'carta' : 'cartas'}`,
      o.faceUp ? o.cards[0].face : o.cards[0].back, [
        ['Ampliar', () => { const latest = current(); if (latest) openCardZoom(latest.cards[0], latest.faceUp, latest.rot - 180); }],
        ['Robar 1', () => drawToHand(current(), 1)],
        ...(count > 1 ? [['Robar 6', () => drawToHand(current(), 6)]] : []),
        ['Voltear', async () => { await flip(current()); inspectObject(current()); }],
        ['Colocar en mesa', () => beginPlacement({ kind: 'stack', id: o.id, one: count > 1 })],
        ...(count > 1 ? [
          ['Mover mazo', () => beginPlacement({ kind: 'stack', id: o.id })],
          ['Barajar', () => doShuffle(current()), true],
          ['Ver cartas', () => openSearch(current())]
        ] : []),
        ['Girar', () => rotate(current(), 90)]
      ]);
  } else if (o.type === 'bag') {
    inspect(o.name, null, [['Sacar ficha', () => spawnFromBag(o)], ['Mover', () => beginPlacement({ kind: 'stack', id: o.id })]]);
  } else if (o.type === 'token') {
    inspect(o.name, null, [['Mover', () => beginPlacement({ kind: 'stack', id: o.id })], ['Eliminar ficha', () => deleteObj(o)]]);
  } else if (o.type === 'counter') {
    inspect(`${o.name || 'Contador'} · ${o.value}`, null, [
      ['Sumar 1', async () => { await changeCounter(o, 1); inspectObject(byId(o.id)); }],
      ['Restar 1', async () => { await changeCounter(o, -1); inspectObject(byId(o.id)); }]
    ]);
    $('#inspector').dataset.resource = o.resource || 'strikes';
    $('#inspector-title').prepend(counterIcon(o.resource));
  }
}

function inspectHand(card) {
  inspectorTarget = { kind: 'hand', uid: card.uid };
  inspect(card.name || 'Carta de tu mano', card.face, [
    ['Ampliar', () => openCardZoom(card)],
    ['Jugar al centro', () => {
      const r = viewport.getBoundingClientRect();
      beginPlacement({ kind: 'hand', card });
      placeAt(screenToWorld(r.left + r.width / 2, r.top + r.height / 2));
    }],
    ['Colocar en mesa', () => beginPlacement({ kind: 'hand', card })]
  ]);
}

function beginPlacement(next) {
  cancelPlacement();
  placement = next;
  const o = next.kind === 'stack' ? byId(next.id) : null;
  const wholeDeck = o?.type === 'stack' && o.cards.length > 1 && !next.one;
  $('#placement-label').textContent = wholeDeck
    ? `Mazo entero · ${o.cards.length} cartas. Toca el destino.`
    : o && o.type !== 'stack' ? 'Ficha seleccionada. Toca el destino.'
    : '1 carta seleccionada. Toca el destino.';
  $('#placement-actions').hidden = !o;
  $('#placement-preview').hidden = o?.type !== 'stack';
  if (o) els.get(o.id)?.classList.add('selected');
  $('#placement').hidden = false;
  // Keep the next tap on the same deck reachable, even in short landscape views.
  const panel = $('#placement');
  panel.style.top = '';
  panel.style.bottom = '';
  const sourceRect = o && els.get(o.id)?.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  if (sourceRect && sourceRect.bottom > panelRect.top && sourceRect.top < panelRect.bottom) {
    panel.style.top = `${viewport.getBoundingClientRect().top + 8}px`;
    panel.style.bottom = 'auto';
  }
  viewport.classList.add('placing');
}

function cancelPlacement() {
  if (placement?.kind === 'stack') els.get(placement.id)?.classList.remove('selected');
  lastStackTap = null;
  placement = null;
  $('#placement').hidden = true;
  viewport.classList.remove('placing');
}

function mergeStack(o) {
  if (o.type !== 'stack') return;
  const zone = findPlayerZone(o);
  if (zone) { o.x = zone.x; o.z = zone.z; o.rot = zone.rot; }
  const t = findDropTarget(o);
  if (!t) return;
  const incoming = o.faceUp === t.faceUp ? o.cards : o.cards.slice().reverse();
  t.cards = incoming.concat(t.cards);
  removeObj(o.id);
}

function placeAt(p) {
  if (!placement) return;
  if (online?.active) {
    const selected = placement;
    const object = selected.kind === 'stack' && byId(selected.id);
    cancelPlacement();
    if (selected.kind === 'hand') return onlineAction({ type: 'handPlace', uid: selected.card.uid, position: p });
    if (object) return onlineAction({ type: 'move', id: object.id, version: object.v || 0, one: Boolean(selected.one), position: p });
    return;
  }
  let o;
  if (placement.kind === 'hand') {
    const i = state.hand.indexOf(placement.card);
    if (i < 0) { cancelPlacement(); return; }
    pushUndo();
    const [card] = state.hand.splice(i, 1);
    o = addStack([card], p.x, p.z, true, 1.47, 180);
  } else {
    o = byId(placement.id);
    if (!o) { cancelPlacement(); return; }
    pushUndo();
    if (placement.one && o.cards.length > 1) o = addStack([o.cards.shift()], p.x, p.z, o.faceUp, o.scale, o.rot);
    else { o.x = p.x; o.z = p.z; raise(o); }
  }
  mergeStack(o);
  cancelPlacement();
  renderAll();
  status('Colocada en la mesa');
}

// ---------- Menú contextual ----------
function openMenu(o, cx, cy) {
  if (o.type === 'player-zone') return;
  const m = $('#menu');
  m.innerHTML = '';
  const add = (label, fn) => {
    const d = document.createElement('div');
    d.textContent = label;
    d.onclick = () => { m.hidden = true; fn(); };
    m.appendChild(d);
  };
  const sep = () => { const d = document.createElement('div'); d.className = 'sep'; m.appendChild(d); };
  if (o.type === 'stack') {
    add('Ampliar carta', () => openCardZoom(o.cards[0], o.faceUp, o.rot - 180));
    add('Voltear (F)', () => flip(o));
    add('Girar 90° (E)', () => rotate(o, 90));
    if (o.cards.length > 1) {
      add('Barajar (R)', () => doShuffle(o));
      add('Buscar / ver cartas (S)', () => openSearch(o));
      sep();
      add('Robar 1 a la mano (D)', () => drawToHand(o, 1));
      add('Robar 5 a la mano', () => drawToHand(o, 5));
      add('Repartir 5 en fila boca arriba', () => dealRow(o, 5));
      add('Repartir 1 boca arriba al lado', () => dealRow(o, 1));
    } else {
      add('Coger a la mano (D)', () => drawToHand(o, 1));
    }
    sep();
    add('Eliminar', () => deleteObj(o));
  } else if (o.type === 'bag') {
    add('Sacar ficha', () => spawnFromBag(o));
  } else {
    add('Eliminar', () => deleteObj(o));
  }
  m.hidden = false;
  m.style.left = Math.min(cx, innerWidth - 200) + 'px';
  m.style.top = Math.min(cy, innerHeight - m.offsetHeight - 8) + 'px';
}

// ---------- Interacción ----------
function objAt(el) {
  const t = el.closest && el.closest('.obj');
  return t ? byId(+t.dataset.id) : null;
}

function findDropTarget(o) {
  let best = null, bestD = Infinity;
  for (const t of state.objects) {
    if (t === o || t.type !== 'stack') continue;
    const d = Math.hypot(t.x - o.x, t.z - o.z);
    if (d < CARD_W * Math.min(t.scale, o.scale) * 0.55 && d < bestD) { best = t; bestD = d; }
  }
  return best;
}

function findPlayerZone(o) {
  if (o.type !== 'stack') return null;
  return state.objects.find(zone => {
    if (zone.type !== 'player-zone') return false;
    const { w, h } = sizeOf(zone), angle = (zone.rot - 180) * Math.PI / 180;
    const dx = o.x - zone.x, dy = zone.z - o.z;
    const x = dx * Math.cos(angle) + dy * Math.sin(angle);
    const y = -dx * Math.sin(angle) + dy * Math.cos(angle);
    return Math.abs(x) <= w / 2 && Math.abs(y) <= h / 2;
  }) || null;
}

let drag = null;
const touches = new Map();
let pinch = null;
let suppressHandClick = false;

function zoomAt(mx, my, nz) {
  manualView();
  nz = Math.min(4, Math.max(0.04, nz));
  view.x = mx - ((mx - view.x) * nz) / view.zoom;
  view.y = my - ((my - view.y) * nz) / view.zoom;
  view.zoom = nz;
  applyView();
}

function clearDrag() {
  viewport.classList.remove('panning');
  document.querySelectorAll('.drop').forEach(el => el.classList.remove('drop'));
  drag?.ghost?.remove();
  drag = null;
}

function cancelDrag() {
  if (drag?.changed && !online?.active) {
    state = undoStack.pop();
    renderAll();
  }
  clearDrag();
  flushRemote();
}

viewport.addEventListener('pointerdown', e => {
  if (!state || e.button === 2 || e.target.closest('button')) return;
  $('#menu').hidden = true;
  hidePreview();
  viewport.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size > 1) {
      lastStackTap = null;
      cancelDrag();
      const [a, b] = [...touches.values()];
      pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        zoom: view.zoom, x: view.x, y: view.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (pinch) return;
  }
  const o = objAt(e.target);
  const movable = o && ['stack', 'token', 'bag'].includes(o.type);
  const selectedSource = placement?.kind === 'stack' && placement.id === o?.id;
  const doubleTap = o?.type === 'stack' && lastStackTap?.id === o.id
    && lastStackTap.pointerType === e.pointerType && performance.now() - lastStackTap.time < DOUBLE_TAP_MS
    && Math.hypot(e.clientX - lastStackTap.x, e.clientY - lastStackTap.y) < 32;
  const p = screenToWorld(e.clientX, e.clientY);
  drag = { kind: movable && (!placement || selectedSource) ? 'obj' : 'pan', id: movable ? o.id : null,
    pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y,
    dx: movable ? o.x - p.x : 0, dz: movable ? o.z - p.z : 0,
    split: !e.shiftKey && !doubleTap && !(selectedSource && !placement.one),
    doubleTap, alt: e.altKey, moved: false, changed: false };
});

viewport.addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch) {
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      const r = viewport.getBoundingClientRect();
      const nz = Math.min(4, Math.max(0.04, pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance));
      view.x = (a.x + b.x) / 2 - r.left - (pinch.mx - r.left - pinch.x) * nz / pinch.zoom;
      view.y = (a.y + b.y) / 2 - r.top - (pinch.my - r.top - pinch.y) * nz / pinch.zoom;
      view.zoom = nz;
      manualView();
      applyView();
    }
    return;
  }
  if (!drag) {
    if (e.pointerType === 'touch') return;
    const o = objAt(e.target);
    const id = o && o.type === 'stack' ? o.id : null;
    if (id !== hoverId) {
      if (hoverId && els.get(hoverId)) els.get(hoverId).classList.remove('hover');
      hoverId = id;
      if (id) els.get(id).classList.add('hover');
    }
    return;
  }
  if (drag.pointerId !== e.pointerId) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 8) return;
  drag.moved = true;
  if (drag.kind === 'pan') {
    manualView();
    viewport.classList.add('panning');
    view.x = drag.vx + e.clientX - drag.sx;
    view.y = drag.vy + e.clientY - drag.sy;
    applyView();
  } else {
    if (online?.active) {
      if (!drag.changed) {
        const source = byId(drag.id);
        if (!source) { clearDrag(); return; }
        cancelPlacement();
        drag.changed = true;
        drag.o = clone(source);
        drag.ghost = els.get(source.id).cloneNode(true);
        drag.ghost.removeAttribute('data-id');
        drag.ghost.classList.add('multiplayer-ghost');
        drag.ghost.style.zIndex = '100000';
        if (drag.split && source.type === 'stack') drag.ghost.querySelector('.count')?.remove();
        world.appendChild(drag.ghost);
      }
      const p = screenToWorld(e.clientX, e.clientY), size = sizeOf(drag.o);
      drag.o.x = p.x + drag.dx; drag.o.z = p.z + drag.dz;
      drag.ghost.style.left = (drag.o.x - size.w / 2) * UNIT + 'px';
      drag.ghost.style.top = (-drag.o.z - size.h / 2) * UNIT + 'px';
      return;
    }
    if (!drag.changed) {
      cancelPlacement();
      pushUndo();
      drag.changed = true;
      let o = byId(drag.id);
      if (drag.split && o.type === 'stack' && o.cards.length > 1) {
        const original = o;
        o = addStack([o.cards.shift()], o.x, o.z, o.faceUp, o.scale, o.rot);
        renderObj(original);
      }
      drag.o = o;
      raise(o);
    }
    const p = screenToWorld(e.clientX, e.clientY);
    drag.o.x = p.x + drag.dx;
    drag.o.z = p.z + drag.dz;
    renderObj(drag.o);
    document.querySelectorAll('.drop').forEach(n => n.classList.remove('drop'));
    $('#hand').classList.toggle('drop', drag.o.type === 'stack' && e.clientY > $('#hand').getBoundingClientRect().top);
    const t = drag.o.type === 'stack' && (findDropTarget(drag.o) || findPlayerZone(drag.o));
    if (t) els.get(t.id).classList.add('drop');
  }
});

viewport.addEventListener('pointerleave', () => {
  if (hoverId) els.get(hoverId)?.classList.remove('hover');
  hoverId = null;
});

viewport.addEventListener('pointerup', e => {
  touches.delete(e.pointerId);
  if (pinch) {
    if (!touches.size) pinch = null;
    return;
  }
  if (!drag || drag.pointerId !== e.pointerId) return;
  const completed = drag;
  clearDrag();
  if (!completed.moved) {
    const o = completed.id && byId(completed.id);
    const selectedSource = placement?.kind === 'stack' && placement.id === o?.id;
    if (o?.type === 'stack' && (!placement || selectedSource)) {
      beginPlacement({ kind: 'stack', id: o.id, one: !completed.doubleTap });
      if (!completed.doubleTap) lastStackTap = { id: o.id, time: performance.now(), pointerType: e.pointerType, x: e.clientX, y: e.clientY };
    } else if (placement) placeAt(screenToWorld(e.clientX, e.clientY));
    else if (o) {
      if (e.pointerType === 'touch') inspectObject(o);
      else if (o.type === 'bag' && !completed.alt) spawnFromBag(o);
    }
    return;
  }
  if (completed.kind === 'obj') {
    const o = completed.o;
    if (online?.active) {
      flushRemote();
      onlineAction({ type: 'move', id: completed.id, version: o.v || 0, one: completed.split,
        position: { x: o.x, z: o.z }, toHand: o.type === 'stack' && e.clientY > $('#hand').getBoundingClientRect().top });
      return;
    }
    if (o.type === 'stack' && e.clientY > $('#hand').getBoundingClientRect().top) {
      state.hand.push(...(o.faceUp ? o.cards : o.cards.slice().reverse()));
      removeObj(o.id);
    } else mergeStack(o);
    renderAll();
  }
});

viewport.addEventListener('pointercancel', e => {
  touches.delete(e.pointerId);
  if (!touches.size) pinch = null;
  cancelDrag();
});

viewport.addEventListener('contextmenu', e => {
  e.preventDefault();
  cancelPlacement();
  const o = objAt(e.target);
  if (o) openMenu(o, e.clientX, e.clientY);
});

viewport.addEventListener('wheel', e => {
  e.preventDefault();
  const r = viewport.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, view.zoom * Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

// Arrastrar desde la mano a la mesa
function startHandDrag(e, i) {
  if (e.button !== 0 || !e.isPrimary || cancelHandGesture || drag || pinch) return;
  const card = state.hand[i];
  if (!card) return;
  const source = e.currentTarget, rect = source.getBoundingClientRect(), pointerId = e.pointerId;
  const offsetX = e.clientX - rect.left, offsetY = e.clientY - rect.top;
  let ghost = null, ended = false;
  source.setPointerCapture(pointerId);
  const clearDrop = () => document.querySelectorAll('.drop').forEach(el => el.classList.remove('drop'));
  const onTable = ev => {
    const r = viewport.getBoundingClientRect();
    return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY < r.bottom
      && viewport.contains(document.elementFromPoint(ev.clientX, ev.clientY));
  };
  const move = ev => {
    if (ev.pointerId !== pointerId) return;
    const dx = ev.clientX - e.clientX, dy = ev.clientY - e.clientY;
    if (!ghost && (Math.hypot(dx, dy) < 8 || (e.pointerType === 'touch' && Math.abs(dy) <= Math.abs(dx)))) return;
    if (!ghost) {
      cancelPlacement(); closeInspector(); $('#menu').hidden = true;
      ghost = document.createElement('img');
      ghost.id = 'drag-ghost';
      ghost.src = card.face;
      ghost.alt = '';
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      document.body.appendChild(ghost);
      source.classList.add('hand-dragging');
      suppressHandClick = true;
      hidePreview();
    }
    ev.preventDefault();
    ghost.style.left = ev.clientX - offsetX + 'px';
    ghost.style.top = ev.clientY - offsetY + 'px';
    clearDrop();
    if (onTable(ev)) {
      const target = { type: 'stack', scale: 1.47, ...screenToWorld(ev.clientX, ev.clientY) };
      const zone = findPlayerZone(target);
      if (zone) Object.assign(target, { x: zone.x, z: zone.z });
      const drop = findDropTarget(target) || zone;
      if (drop) els.get(drop.id)?.classList.add('drop');
    }
  };
  const cleanup = () => {
    if (ended) return;
    ended = true;
    cancelHandGesture = null;
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', canceled);
    removeEventListener('pointerdown', secondPointer, true);
    removeEventListener('blur', cleanup);
    source.removeEventListener('lostpointercapture', cleanup);
    if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
    source.classList.remove('hand-dragging');
    ghost?.remove();
    clearDrop();
    setTimeout(() => { suppressHandClick = false; flushRemote(); }, 0);
  };
  const up = ev => {
    if (ev.pointerId !== pointerId) return;
    const place = ghost && onTable(ev);
    cleanup();
    if (place) {
      beginPlacement({ kind: 'hand', card });
      placeAt(screenToWorld(ev.clientX, ev.clientY));
    }
  };
  const canceled = ev => { if (ev.pointerId === pointerId) cleanup(); };
  const secondPointer = ev => { if (ev.pointerId !== pointerId) cleanup(); };
  cancelHandGesture = cleanup;
  addEventListener('pointermove', move, { passive: false });
  addEventListener('pointerup', up);
  addEventListener('pointercancel', canceled);
  addEventListener('pointerdown', secondPointer, true);
  addEventListener('blur', cleanup);
  source.addEventListener('lostpointercapture', cleanup);
}

// Teclado
addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') mousePosition = { x: e.clientX, y: e.clientY };
});
addEventListener('keydown', e => {
  const space = e.code === 'Space' || e.key === ' ';
  if (!$('#card-zoom').hidden) {
    if (space && cardZoom?.holdKey) e.preventDefault();
    if (e.key === 'Escape') { e.preventDefault(); closeCardZoom(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.key === 'Escape') { cancelHandGesture?.(); closeModal(); closeInspector(); cancelPlacement(); $('#help').hidden = true; $('#setup').hidden = true; $('#room-dialog').hidden = true; $('#menu').hidden = true; return; }
  if (!$('#inspector').hidden || !$('#modal').hidden || !$('#help').hidden || !$('#setup').hidden || !$('#room-dialog').hidden) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (space) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || drag || pinch || suppressHandClick) return;
    const hoveredObject = hoverId && byId(hoverId);
    const handImage = document.activeElement?.closest?.('#hand-cards img');
    const handCard = hoveredHandCard || (hoveredObject?.type !== 'stack' && handImage && state.hand[Number(handImage.dataset.handIndex)]);
    const o = hoveredObject?.type === 'stack' ? hoveredObject : (placement?.kind === 'stack' && byId(placement.id));
    if (handCard) {
      e.preventDefault();
      openCardZoom(handCard, true, 0, true);
    } else if (o?.type === 'stack') {
      e.preventDefault();
      openCardZoom(o.cards[0], o.faceUp, o.rot - 180, true);
    }
    return;
  }
  const o = hoverId && byId(hoverId);
  if (!o) return;
  const k = e.key.toLowerCase();
  if (k === 'f') flip(o);
  else if (k === 'r') doShuffle(o);
  else if (k === 'q') rotate(o, -90);
  else if (k === 'e') rotate(o, 90);
  else if (k === 'd') drawToHand(o, 1);
  else if (k === 's') openSearch(o);
  else if (/^[1-9]$/.test(k)) drawToHand(o, +k);
});
addEventListener('keyup', e => {
  if ((e.code === 'Space' || e.key === ' ') && cardZoom?.holdKey) {
    e.preventDefault();
    closeCardZoom();
  }
});
// Keyup can be lost when the user switches windows while holding Space.
function releaseHeldZoom() { if (cardZoom?.holdKey) closeCardZoom(); }
addEventListener('blur', releaseHeldZoom);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseHeldZoom(); });

// Botones
$('#btn-undo').onclick = undo;
document.querySelectorAll('[data-zone]').forEach(b => { b.onclick = () => focusZone(b.dataset.zone); });
$('#zoom-in').onclick = () => zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, view.zoom * 1.4);
$('#zoom-out').onclick = () => zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, view.zoom / 1.4);
$('#inspector-close').onclick = closeInspector;
// A touch release on the table can generate a click over the newly opened
// inspector. Only accept pointer clicks whose gesture started inside it.
$('#inspector').addEventListener('pointerdown', () => { inspectorPointerStarted = true; }, true);
$('#inspector').addEventListener('click', e => {
  if (e.detail > 0 && !inspectorPointerStarted) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  inspectorPointerStarted = false;
}, true);
$('#cancel-placement').onclick = cancelPlacement;
$('#placement-preview').onclick = () => {
  const o = placement?.kind === 'stack' && byId(placement.id);
  if (o?.type === 'stack') openCardZoom(o.cards[0], o.faceUp, o.rot - 180);
};
$('#card-zoom-close').onclick = closeCardZoom;
new ResizeObserver(fitCardZoom).observe($('#card-zoom-body'));
$('#placement-actions').onclick = () => {
  const o = placement?.kind === 'stack' && byId(placement.id);
  cancelPlacement();
  if (o) inspectObject(o);
};
function updateHandToggle() {
  const expanded = !$('#hand').classList.contains('collapsed');
  $('#hand-toggle').setAttribute('aria-expanded', String(expanded));
  $('#hand-toggle-label').textContent = expanded ? 'Ocultar ↓' : 'Mostrar ↑';
}
$('#hand-toggle').onclick = () => { $('#hand').classList.toggle('collapsed'); updateHandToggle(); };
document.querySelectorAll('.overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target !== overlay) return;
    if (overlay.id === 'card-zoom') closeCardZoom();
    else overlay.hidden = true;
  });
  overlay.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const buttons = [...overlay.querySelectorAll('button, select, input, [tabindex="0"]')].filter(el => el.getClientRects().length);
    if (!buttons.length) { e.preventDefault(); return; }
    const first = buttons[0], last = buttons.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
});
$('#btn-reset').onclick = () => {
  if (!confirm('¿Reiniciar la mesa al estado original del mod?')) return;
  if (online?.active) { onlineAction({ type: 'reset' }); return; }
  pushUndo();
  cancelPlacement();
  closeInspector();
  closeModal();
  $('#help').hidden = true;
  state = freshState();
  renderAll();
  focusZone('playmat');
};
$('#btn-help').onclick = () => { $('#help').hidden = false; };
$('#help-close').onclick = () => { $('#help').hidden = true; };
$('#modal-close').onclick = closeModal;

AlienSetup.scenarios.forEach(scenario => {
  const option = document.createElement('option');
  option.value = scenario.id;
  option.textContent = scenario.title;
  $('#setup-scenario').appendChild(option);
});
function updateSetupSummary() {
  if (!initial) return;
  const scenario = AlienSetup.scenarios.find(s => s.id === $('#setup-scenario').value);
  const baseSize = scenario.stages.reduce((n, id) => n + initial.find(o => o.sourceId === id).cards.length, 0);
  const droneCount = AlienSetup.dronesByPlayers[Number($('#setup-players').value) - 1].reduce((a, b) => a + b, 0);
  $('#setup-summary').textContent = `${scenario.crewLabel}. Colmena: ${baseSize + droneCount} cartas (${droneCount} drones).`;
}
$('#btn-setup').onclick = () => {
  if (!state) return;
  if (state.setup) {
    $('#setup-scenario').value = state.setup.scenario;
    $('#setup-players').value = state.setup.players;
    $('#setup-drones').checked = state.setup.expansionDrones;
  }
  updateSetupSummary();
  $('#setup-error').hidden = true;
  $('#setup').hidden = false;
  $('#setup-scenario').focus();
};
$('#setup-close').onclick = () => { $('#setup').hidden = true; };
$('#setup-scenario').onchange = $('#setup-players').onchange = updateSetupSummary;
$('#setup-form').onsubmit = async e => {
  e.preventDefault();
  if (online?.active) {
    const result = await onlineAction({ type: 'setup', options: {
      scenario: $('#setup-scenario').value, players: Number($('#setup-players').value), expansionDrones: $('#setup-drones').checked
    } });
    if (result) { $('#setup').hidden = true; focusZone('playmat'); }
    return;
  }
  try {
    const prepared = AlienSetup.create(initial, {
      scenario: $('#setup-scenario').value, players: Number($('#setup-players').value), expansionDrones: $('#setup-drones').checked
    });
    pushUndo();
    cancelPlacement();
    closeInspector();
    closeModal();
    state = prepared;
    renderAll();
    focusZone('playmat');
    $('#setup').hidden = true;
    status(`${state.setup.title} · Mesa preparada para ${state.setup.players} ${state.setup.players === 1 ? 'jugador' : 'jugadores'}`);
  } catch (error) {
    $('#setup-error').textContent = error.message;
    $('#setup-error').hidden = false;
  }
};
let viewportSize = { w: viewport.clientWidth, h: viewport.clientHeight };
new ResizeObserver(() => {
  if (state) {
    if (activeZone) focusZone(activeZone);
    else {
      view.x += (viewport.clientWidth - viewportSize.w) / 2;
      view.y += (viewport.clientHeight - viewportSize.h) / 2;
      applyView();
    }
  }
  viewportSize = { w: viewport.clientWidth, h: viewport.clientHeight };
}).observe(viewport);

window.AlienAccess.ready.then(load).then(initializeRooms).catch(error => {
  $('#status').textContent = `${error.message} Recarga la página para volver a intentarlo.`;
});
