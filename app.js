'use strict';

// Escala mundo TTS -> píxeles. TTS: X derecha, Z hacia arriba (vista cenital).
const UNIT = 30;
const CARD_W = 2.25, CARD_H = 3.15; // tamaño carta a scale=1 (unidades TTS)
const BOARD_H = 10;                 // alto de Custom_Board a scale=1
const TILE = 1;                     // lado de Custom_Tile a scale=1
const GAME = window.AlienGame || { id: 'alien', title: 'ALIEN', data: 'data.json?v=7', saveKey: 'lea-web-state-v1', previousKey: 'lea-web-before-import-v1' };
const IS_XFILES = GAME.id === 'xfiles';
const IS_COLLECTION = Boolean(GAME.collection);
const IS_MODERN = ['marvel2','dc'].includes(GAME.id);
const IS_MARVEL = ['marvel','marvel2'].includes(GAME.id);
const IS_COMPACT = IS_XFILES || IS_COLLECTION;
const GameSetup = IS_COLLECTION ? LegendarySetup.forGame(GAME.id) : IS_XFILES ? XFilesSetup : AlienSetup;
const SAVE_KEY = GAME.saveKey;
const PRE_IMPORT_KEY = GAME.previousKey;
// Shared illustrated bases. Keep these visual so existing saves and room
// coordinates still use the same card-sized drop areas.
const PLAYER_ZONE_ART = {
  draw: 'cards/230_12.jpg', discard: 'cards/231_7.jpg',
  avatar: 'cards/229_2.jpg', strikes: 'cards/232_2.jpg',
};

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
const inspectedCards = new WeakMap();
let online = null;
let individualState = null, individualUndo = null, pendingRemote = null;
let cancelHandGesture = null;
let syncingDevice = false;
let displayedPrivateCode = null;
const compactedRooms = new Set();

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

// ---------- Copias y cambio de dispositivo ----------
function backupMessage(message, error = false) {
  $('#backup-message').textContent = message;
  $('#backup-message').classList.toggle('error', error);
}

function updateBackupUI() {
  $('#backup-note').textContent = online?.active
    ? 'Esta copia permite recuperar tu jugador y tu mano en otro dispositivo. Es personal: úsala solo tú. La sala sigue guardada en línea.'
    : 'Guarda una copia y ábrela en el otro dispositivo. La partida del móvil se conserva; las dos copias individuales evolucionarán por separado.';
  let previous = false;
  try { previous = Boolean(localStorage.getItem(PRE_IMPORT_KEY)); } catch {}
  $('#backup-previous').hidden = !previous;
  $('#backup-previous').disabled = Boolean(online?.active);
  let privateCode = '';
  if (online?.active) {
    if (displayedPrivateCode?.room === online.code) privateCode = displayedPrivateCode.code;
    try { privateCode ||= localStorage.getItem(`lea-resume-code-v1:${online.code}`) || ''; } catch {}
  }
  $('#sync-current').hidden = !privateCode;
  $('#sync-private-code').value = privateCode;
  $('#sync-generate').textContent = online?.active ? 'Mostrar mi código privado' : 'Sincronizar y generar código';
}

function syncMessage(message, error = false) {
  $('#sync-message').textContent = message;
  $('#sync-message').classList.toggle('error', error);
}

function rememberPrivateCode(code) {
  displayedPrivateCode = { room: online.code, code };
  try { localStorage.setItem(`lea-resume-code-v1:${online.code}`, code); } catch {}
}

async function deviceOperation(task) {
  if (syncingDevice || importingBackup) return;
  syncingDevice = true;
  const buttons = [...$('#help').querySelectorAll('button')].map(button => [button, button.disabled]);
  for (const [button] of buttons) button.disabled = true;
  syncMessage('Guardando y conectando… Tu partida actual se conserva.');
  try { await task(); }
  catch (error) { syncMessage(['TypeError', 'AbortError'].includes(error.name) ? 'No se pudo conectar. Tu partida actual sigue guardada; vuelve a intentarlo.' : error.message, true); }
  finally {
    syncingDevice = false;
    for (const [button, disabled] of buttons) button.disabled = disabled;
    updateBackupUI(); updateRoomUI();
  }
}

async function generatePrivateCode() {
  await online.queue;
  let result;
  if (online.active) result = await online.continuation();
  else {
    // Require a durable local backup before creating the synchronized copy.
    const snapshot = clone(state);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot)); }
    catch { throw new Error('No se ha podido guardar el respaldo local. Tu mesa sigue intacta; no se ha iniciado la sincronización.'); }
    result = await online.promote($('#room-name').value.trim() || 'Jugador', snapshot);
    focusZone('playmat');
  }
  rememberPrivateCode(result.privateCode);
  $('#help').hidden = false;
  syncMessage('Partida sincronizada. Introduce este código privado en el otro dispositivo para continuar con tu mismo jugador y tu mano.');
}

async function resumePrivateCode() {
  if (online?.active) throw new Error('Primero pulsa Sala → Volver a mi partida individual. Tu sala quedará guardada.');
  const result = await online.recover($('#sync-code').value.trim());
  await importBackup(AlienBackup.create(null, { code: result.room.code, sessionToken: result.sessionToken }));
  rememberPrivateCode(result.privateCode);
  $('#sync-code').value = '';
  syncMessage('Ya estás en la misma partida, con tu jugador y tu mano. Los avances se sincronizan entre dispositivos.');
}

function downloadBackup() {
  try {
    const backup = AlienBackup.create(state, online?.active ? online : null);
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${GAME.id}-${backup.kind === 'room' ? backup.room.code : 'solitario'}-${backup.createdAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    backupMessage('Copia preparada para descargar. Envíate el archivo y, en el otro dispositivo, pulsa ? → Abrir copia.');
  } catch (error) { backupMessage(error.message, true); }
}

async function importBackup(backup) {
  // Validate everything before changing either the game or its persistent save.
  backup = AlienBackup.parse(JSON.stringify(backup));
  if (backup.kind === 'solo' && (backup.state.gameId || 'alien') !== GAME.id) throw new Error('Esta copia es de otro juego. Selecciónalo desde Juegos para abrirla; tus partidas se conservan.');
  if (online?.active) throw new Error('Primero pulsa Sala → Volver a mi partida individual. La sala quedará guardada.');
  if (backup.kind === 'room') {
    const { code, token } = backup.room;
    const existing = online.saved(code);
    if (existing && existing.token !== token) throw new Error('Este navegador ya tiene otro jugador en esa sala. Abre la copia en otro perfil del navegador para conservar ambos jugadores.');
    // Resume an existing player by reading their snapshot; never create a new seat.
    const data = await online.request(`/rooms/${code}`, token);
    if (online.active) throw new Error('Ya has entrado en una sala. Sal de ella antes de abrir la copia.');
    const person = data.room.players.find(player => player.id === data.room.me);
    if (!person || data.room.code !== code) throw new Error('No se ha podido recuperar tu jugador. Tu partida no se ha cambiado.');
    // Check storage before start() switches away from the individual game.
    localStorage.setItem(online.storageKey(code), JSON.stringify({ token, name: person.name }));
    localStorage.setItem('lea-room-name', person.name);
    online.start(data, token, person.name);
    updateRoomUI(); focusZone('playmat');
    $('#room-dialog').hidden = true;
    $('#help').hidden = false;
    backupMessage(`Sala recuperada: sigues siendo ${person.name}, Jugador ${data.room.seat}, con tu misma mano.`);
  } else {
    const previous = JSON.stringify(AlienBackup.create(state));
    compactLocalPlayers(backup.state);
    const restored = JSON.stringify(backup.state);
    try {
      localStorage.setItem(PRE_IMPORT_KEY, previous);
      localStorage.setItem(SAVE_KEY, restored);
    } catch { throw new Error('No hay espacio para guardar la copia y conservar tu partida anterior. Tu partida actual sigue intacta.'); }
    pushUndo(); cancelHandGesture?.(); cancelPlacement(); clearDrag(); closeInspector(); closeModal(); closeCardZoom();
    state = backup.state;
    renderAll(); focusZone('playmat');
    backupMessage('Copia abierta. La partida anterior de este navegador se conserva en «Recuperar partida anterior».');
  }
  updateBackupUI();
}

// ---------- Salas ----------
function roomError(message) {
  $('#room-error').textContent = message;
  $('#room-error').hidden = !message;
}

function updateRoomUI() {
  updateTurnUI();
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
  const keepInspector = inspectorChanged && inspectorTarget?.keepOpen
    && (inspected?.type === 'stack' || (!inspected && (inspectorTarget.draw?.pending || inspectorTarget.empty)));
  const selected = placement?.kind === 'stack' && previous.get(placement.id);
  if (selected && !next.objects.some(o => o.id === selected.id && o.v === selected.v)) cancelPlacement();
  if (placement?.kind === 'hand' && !next.hand.some(c => c.uid === placement.card.uid)) cancelPlacement();
  const handChanged = JSON.stringify(state.hand) !== JSON.stringify(next.hand);
  next.objects = next.objects.map(o => previous.get(o.id)?.v === o.v ? previous.get(o.id) : o);
  if (!handChanged) next.hand = state.hand;
  state = next;
  const ids = new Set(next.objects.map(o => o.id));
  for (const [id, el] of els) if (!ids.has(id)) { reserveArtObserver?.unobserve(el); el.remove(); els.delete(id); }
  for (const o of next.objects) if (previous.get(o.id) !== o) renderObj(o);
  zTop = Math.max(1, ...next.objects.map(o => o.z_ || 0));
  if (handChanged) renderHand();
  if (keepInspector) refreshStackInspector(inspected);
  else if (inspectorChanged) closeInspector();
  $('#menu').hidden = true;
  updateTurnUI();
  refreshReserve();
  if (IS_XFILES && online?.active && data.room?.host && (state.playerLayout || 0) < GameSetup.playerLayout && !compactedRooms.has(online.code)) {
    compactedRooms.add(online.code);
    onlineAction({ type: 'xfilesLayout' }).then(result => {
      if (result && activeZone === 'player') focusZone('player');
    });
  }
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
  const data = await fetch(GAME.data).then(r => {
    if (!r.ok) throw new Error('No se han podido cargar las cartas.');
    return r.json();
  });
  GameSetup.configure?.(data);
  if(GAME.id==='marvel')populateMarvelSetup();
  if(IS_MODERN)populateModernSetup();
  if(GameSetup.encounters)populateEncountersSetup();
  if (IS_COLLECTION) {
    const links = $('#collection-rules'); links.innerHTML = '';
    for (const rule of GameSetup.rules) {
      const link=document.createElement('a'); link.href=rule.url; link.textContent=rule.name;
      link.target='_blank'; link.rel='noopener'; links.appendChild(link);
    }
  }
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
  compactLocalPlayers(state);
  renderAll();
  focusZone('playmat');
  updateSetupSummary();
}

function freshState() {
  if (IS_COLLECTION) return GameSetup.newGame();
  const game = { gameId: GAME.id, objects: clone(initial), hand: [], nextId: initial.length + 1, schemaVersion: 4 };
  if (IS_XFILES) GameSetup.compactPlayers(game);
  return game;
}

function compactLocalPlayers(game) {
  if (!IS_XFILES || game.playerLayout >= GameSetup.playerLayout) return;
  try { localStorage.setItem('lex-web-before-player-layout-v' + GameSetup.playerLayout, JSON.stringify(game)); }
  catch { status('No se ha podido guardar una copia de la disposición anterior. La mesa se conserva.'); return; }
  GameSetup.compactPlayers(game);
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
let visibleReserveArt = new WeakSet();
const reserveArtObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
  for (const {target, isIntersecting} of entries) {
    if (!target.dataset.reserveArt) continue;
    if (isIntersecting) visibleReserveArt.add(target); else visibleReserveArt.delete(target);
    target.style.backgroundImage = isIntersecting ? target.dataset.reserveArt : '';
  }
}, {root:viewport, rootMargin:'200px'});

function renderAll() {
  reserveArtObserver?.disconnect();
  visibleReserveArt = new WeakSet();
  world.innerHTML = '';
  els.clear();
  zTop = Math.max(1, ...state.objects.map(o => o.z_ || 0));
  const order = { playmat: -1, board: 0, tile: 1, 'player-zone': 1, text: 2, stack: 3, counter: 4, token: 5, bag: 5 };
  state.objects
    .slice()
    .sort((a, b) => (order[a.type] - order[b.type]) || (a.z_ || 0) - (b.z_ || 0))
    .forEach(o => { renderObj(o); });
  renderHand();
  updateTurnUI();
  refreshReserve();
  save();
}

function sizeOf(o) {
  switch (o.type) {
    case 'playmat': return { w: o.width, h: o.height };
    case 'stack': case 'player-zone': return { w: o.width || CARD_W * o.scale, h: o.height || CARD_H * o.scale };
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
    const art = `url("${o.faceUp ? top.face : top.back}")`;
    if (reserveArtObserver && o.libraryReserve && isReserveStack(o)) {
      el.dataset.reserveArt = art;
      el.style.backgroundImage = visibleReserveArt.has(el) ? art : '';
      reserveArtObserver.observe(el);
    } else {
      reserveArtObserver?.unobserve(el);
      delete el.dataset.reserveArt;
      el.style.backgroundImage = art;
    }
    el.style.transform = `rotate(${o.rot - 180}deg)`;
    el.classList.toggle('deck', o.cards.length > 1);
    if (o.cards.length > 1) {
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = o.cards.length;
      el.appendChild(c);
    }
    if (isReserveStack(o)) {
      const label = document.createElement('span');
      label.className = 'reserve-label';
      label.textContent = reserveInfo(o).name;
      el.appendChild(label);
    }
  } else if (o.type === 'board' || o.type === 'tile' || o.type === 'playmat' || o.type === 'player-zone') {
    // Refresh the replacement texture even for existing saves and rooms.
    const img = o.img === 'xfiles/assets/playmat.jpg' ? `${o.img}?v=2` : o.img;
    el.style.backgroundImage = img ? `url("${img}")` : '';
    el.style.transform = `rotate(${o.rot - 180}deg)`;
    if (o.type === 'player-zone') {
      // Reuse the same drop area in existing saves without moving its cards.
      const victory = ['marvel', 'marvel2'].includes(GAME.id) && o.zone === 'avatar';
      const zone = victory ? 'victory' : o.zone;
      const name = victory ? 'Victory Pile' : o.name;
      if (o.labelOnly) el.dataset.zone = zone;
      const zoneArt = IS_COMPACT && o.labelOnly && PLAYER_ZONE_ART[zone];
      if (zoneArt) {
        const art = document.createElement('div');
        art.className = 'player-zone-art';
        art.style.backgroundImage = `url("${zoneArt}")`;
        art.setAttribute('aria-hidden', 'true');
        el.appendChild(art);
      } else if (o.labelOnly) {
        el.classList.add('labeled-zone');
        const label = document.createElement('span'); label.textContent = name; el.appendChild(label);
      }
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', `Zona de jugador: ${name}`);
      el.title = victory ? 'Pila de victoria · Villanos derrotados y Bystanders rescatados' : `${name} · Coloca tus cartas aquí`;
    }
    if (o.textureBounds) {
      const [x1, y1, x2, y2] = o.textureBounds;
      const w = x2 - x1, h = y2 - y1;
      el.style.backgroundSize = `${100 / w}% ${100 / h}%`;
      el.style.backgroundPosition = `${100 * x1 / (1 - w)}% ${100 * y1 / (1 - h)}%`;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Tapete original de Legendary Encounters: ' + GAME.title);
    }
    if(o.type==='playmat'&&o.textureProjection) {
      // Display the user's unchanged photograph flat; all pixels stay in the original asset.
      const [a,b,c,d,e,f,g,perspectiveY]=o.textureProjection,W=w*UNIT,H=h*UNIT;
      const photo=document.createElement('img');photo.src=img;photo.alt='Tapete de '+GAME.title;
      photo.className='playmat-photo';photo.draggable=false;
      photo.style.transform=`matrix3d(${[a,d*H/W,0,g/W,b*W/H,e,0,perspectiveY/H,0,0,1,0,c*W,f*H,0,1].join(',')})`;
      el.style.backgroundImage='';el.appendChild(photo);
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
    minus.onclick = () => changeCounter(o, -1);
    plus.onclick = () => changeCounter(o, 1);
    row.append(minus, val, plus);
    el.append(label, row);
  }
}

function removeObj(id) {
  state.objects = state.objects.filter(o => o.id !== id);
  const el = els.get(id);
  if (el) reserveArtObserver?.unobserve(el);
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

function fitObjects(objects, padding = 0) {
  const visible = objects.filter(o => !(o.type === 'player-zone' && o.zone === 'play'));
  if (!visible.length) return;
  const bounds = visible.map(o => {
    const size = sizeOf(o), a = (o.rot || 0) * Math.PI / 180;
    const frame = IS_COMPACT && o.type === 'player-zone' && o.labelOnly ? 1.42 : 1;
    const w = size.w * frame, h = size.h * frame;
    const dx = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
    const dz = (Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))) / 2;
    return [o.x - dx, o.x + dx, o.z - dz, o.z + dz];
  });
  fitBounds(Math.min(...bounds.map(b => b[0]))-padding, Math.max(...bounds.map(b => b[1]))+padding,
    Math.min(...bounds.map(b => b[2]))-padding, Math.max(...bounds.map(b => b[3]))+padding);
}

function fitView() { fitObjects(state.objects); }

function focusZone(zone) {
  if (!state) return;
  hidePreview();
  activeZone = zone;
  document.querySelectorAll('[data-zone]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.zone === zone)));
  const mat = state.objects.find(o => o.type === 'playmat');
  if (IS_COLLECTION && !['playmat','all'].includes(zone)) {
    if (zone==='player') {
      const seat=online?.room?.seat||1, area=GameSetup.seatZone(state,seat,'play');
      fitObjects(state.objects.filter(o=>o.playerId===seat||GameSetup.inPlayArea(o,area)),.6);
    } else if(zone==='reserve') {
      const reserves=state.objects.filter(o=>o.type==='stack'&&o.z>=19);
      if(reserves.length)fitObjects(reserves,1);else status('Abre Reserva para añadir mazos de la colección.');
    } else if(mat) fitBounds(mat.x-mat.width/2,mat.x+mat.width/2,zone==='hq'?-3:4,zone==='hq'?5:17);
    return;
  }
  if (IS_XFILES && zone !== 'playmat' && zone !== 'all') {
    if (zone === 'complex') fitBounds(-7, 13, 10, 16.5);
    else if (zone === 'hq') fitBounds(-12, 18, -2, 4);
    else if (zone === 'reserve') fitBounds(-44, 44, 19, 34);
    else if (zone === 'player') {
      const seat = online?.room?.seat || 1;
      const area = GameSetup.seatZone(state, seat, 'play');
      fitObjects(state.objects.filter(o => o.playerId === seat || GameSetup.inPlayArea(o, area)), .6);
    }
    return;
  }
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

// The reserve index uses public stack names only, never hidden card faces.
const RESERVE_GROUPS = IS_COLLECTION ? ['En la mesa','Actos','Personajes','Héroes','Villanos','Henchmen','Masterminds','Episodios','Avatares y roles','Mazos iniciales','Reservas','Transformaciones','Horrores y ambiciones','Fichas','Otros']
  : ['Apoyos y enemigos', 'Temporadas', 'Evidencias', 'Personajes de la Academia', 'Agentes', 'Mazos iniciales', 'Otros'];
let reserveLimit=80;
const RESERVE_NAMES = {
  SyndaciteEnemy: ['Syndicate Enemy', 'Enemigos del Sindicato'],
  Informant: ['Informant', 'Informantes'], Lead: ['Lead', 'Pistas'],
  Cliffhanger: ['Cliffhanger', 'Cliffhangers'], EndGame: ['End Game', 'Finales'],
};
function isReserveStack(o) {
  return IS_COMPACT && o.type === 'stack' && o.cards.length > 0 && o.z >= 19;
}
function reserveInfo(o) {
  if(IS_COLLECTION) return {name:o.name||'Mazo',translation:'',group:Math.max(0,RESERVE_GROUPS.indexOf(o.group||'Otros'))};
  const key = o.key || '';
  const [name, translation = ''] = RESERVE_NAMES[key] || [o.name || 'Mazo'];
  const group = RESERVE_NAMES[key] ? 0 : /^Season\d$/.test(key) ? 1
    : /^Evidence\dDeck$/.test(key) ? 2 : /^Market\d$/.test(key) ? 3
    : GameSetup.avatars?.some(a => a.id === key) ? 4 : /StartingDeck$/.test(key) ? 5 : 6;
  return { name, translation, group };
}
function reserveEntries(query = '') {
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = normalize(query).trim().split(/\s+/);
  const entries=IS_COLLECTION ? [
    ...state.objects.filter(o=>o.type==='stack').map(o=>({id:o.id,name:o.name||'Mazo',translation:isReserveStack(o)&&o.libraryReserve?'Fuera de partida':'',group:isReserveStack(o)?reserveInfo(o).group:0,count:o.cards.length})),
    ...GameSetup.catalog().filter(o=>!state.libraryTaken?.includes(o.key)).map(o=>({key:o.key,count:o.cards.length,...reserveInfo(o)})),
  ] : state.objects.filter(isReserveStack).map(o => ({ id: o.id, count: o.cards.length, ...reserveInfo(o) }));
  return entries
    .filter(entry => words.every(word => normalize(`${entry.name} ${entry.translation} ${RESERVE_GROUPS[entry.group]}`).includes(word)))
    .sort((a, b) => a.group - b.group || (a.name === 'Syndicate Enemy' ? -1 : b.name === 'Syndicate Enemy' ? 1 : a.name.localeCompare(b.name, 'es', { numeric: true })));
}
function refreshReserve() {
  if (!IS_COMPACT || $('#reserve-dialog').hidden) return;
  const body = $('#reserve-list');
  const focused = document.activeElement?.dataset.reserveAction;
  body.innerHTML = '';
  const entries = reserveEntries($('#reserve-search').value);
  let group = -1;
  for (const entry of entries.slice(0,reserveLimit)) {
    if (entry.group !== group) {
      group = entry.group;
      const heading = document.createElement('h3'); heading.textContent = RESERVE_GROUPS[group]; body.appendChild(heading);
    }
    const row = document.createElement('div'); row.className = 'reserve-row';
    const open = document.createElement('button'); open.className = 'reserve-deck';
    const name = document.createElement('strong'); name.textContent = entry.name;
    const detail = document.createElement('span');
    detail.textContent = [entry.translation, `${entry.count} ${entry.count === 1 ? 'carta' : 'cartas'}`, entry.key ? 'Añadir a la mesa' : 'Acciones'].filter(Boolean).join(' · ');
    open.append(name, detail);
    open.setAttribute('aria-label', `${entry.name} · ${entry.count} cartas · ${entry.key?'Añadir a la mesa':'Abrir acciones'}`);
    const locate = document.createElement('button'); locate.textContent = entry.key?'Añadir':'Localizar';
    locate.setAttribute('aria-label', `${entry.key?'Añadir':'Localizar'} ${entry.name} en la mesa`);
    for (const [button, action] of [[open, 'inspect'], [locate, 'locate']]) {
      button.dataset.reserveAction = `${entry.key || entry.id}:${action}`;
      button.onclick = () => {
        if(entry.key) return addLibraryDeck(entry.key);
        const current = byId(entry.id);
        if (!current || (!IS_COLLECTION&&!isReserveStack(current))) { refreshReserve(); return; }
        closeReserve(); manualView(); fitObjects([current], 2);
        if (action === 'inspect') { cancelPlacement(); inspectObject(current); }
        else status(entry.name);
      };
    }
    row.append(open, locate); body.appendChild(row);
    for (const button of [open, locate]) if (button.dataset.reserveAction === focused) button.focus({ preventScroll: true });
  }
  if (!entries.length) {
    const empty = document.createElement('p'); empty.textContent = 'No hay mazos de reserva que coincidan.'; body.appendChild(empty);
  }
  if(entries.length>reserveLimit) {
    const more=document.createElement('button'); more.textContent=`Mostrar más (${entries.length-reserveLimit})`;
    more.onclick=()=>{reserveLimit+=80;refreshReserve();}; body.appendChild(more);
  }
}
let libraryPending=false;
async function addLibraryDeck(key) {
  if(libraryPending) return;
  libraryPending=true;
  try {
    if(online?.active) {
      if(!await onlineAction({type:'legendary',command:'library',key}))return;
    } else {
      const next=clone(state); GameSetup.bring(next,key); pushUndo(); state=next; renderAll();
    }
    const added=state.objects.find(o=>o.key===key);
    closeReserve(); cancelPlacement(); manualView();
    if(added){fitObjects([added],2);inspectObject(added);}
  } catch(error){status(error.message);}
  finally{libraryPending=false;}
}
function openReserve() {
  if (!state || !IS_COMPACT) return;
  closeInspector(); hidePreview(); $('#menu').hidden = true;
  $('#reserve-search').value = '';
  reserveLimit=80;
  $('#reserve-dialog').hidden = false;
  $('#reserve-add-all').hidden = GAME.id!=='marvel' || state.marvelReservesVersion===1;
  refreshReserve();
  $('#reserve-close').focus({ preventScroll: true });
}
function closeReserve() {
  $('#reserve-dialog').hidden = true;
  $('#zones [data-zone="reserve"]').focus({ preventScroll: true });
}

function screenToWorld(cx, cy) {
  const r = viewport.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.zoom / UNIT, z: -(cy - r.top - view.y) / view.zoom / UNIT };
}

// ---------- Mano ----------
let discardingHand=false;
function updateHandActions() {
  $('#hand-discard').disabled=discardingHand||xfilesPending||!state?.hand.length||!LegendarySetup.discardZone(state,online?.room?.seat||1)||Boolean(online?.active&&!online.connected);
  $('#hand-discard').textContent=discardingHand?'Descartando…':'Descartar toda la mano';
}
async function discardEntireHand() {
  updateHandActions();
  if($('#hand-discard').disabled)return;
  discardingHand=true;updateTurnUI();
  $('#turn-feedback').textContent='Descartando…';$('#turn-feedback').classList.remove('error');
  try {
    if(online?.active) {
      const result=await onlineAction({type:'discardHand'});
      if(!result){$('#turn-feedback').textContent=$('#room-error').textContent;$('#turn-feedback').classList.add('error');return;}
      $('#turn-feedback').textContent=result.message||'Mano descartada';
    } else {
      const next=clone(state);
      const message=LegendarySetup.discardHand(next,next.hand,1);
      pushUndo();state=next;renderAll();status(message);$('#turn-feedback').textContent=message;
    }
    cancelHandGesture?.();
    if(placement?.kind==='hand')cancelPlacement();
    closeInspector();hidePreview();
    $('#turn-feedback').classList.remove('error');
  } catch(error){status(error.message);$('#turn-feedback').textContent=error.message;$('#turn-feedback').classList.add('error');}
  finally {discardingHand=false;updateTurnUI();}
}
$('#hand-discard').onclick=discardEntireHand;
function renderHand() {
  hoveredHandCard = null;
  const box = $('#hand-cards');
  box.innerHTML = '';
  $('#hand-count').textContent = state.hand.length;
  updateHandActions();
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
    img.onclick = () => { if (!suppressHandClick) selectHandCard(card); };
    img.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); selectHandCard(card); } };
    img.oncontextmenu = e => { e.preventDefault(); cancelPlacement(); inspectHand(card); };
    box.appendChild(img);
  });
  updateHandSelection();
}

function selectHandCard(card) {
  const current = state.hand.find(c => c.uid === card.uid);
  if (!current) return;
  closeInspector(); hidePreview(); $('#menu').hidden = true;
  beginPlacement({ kind: 'hand', card: current });
}

function updateHandSelection() {
  for (const img of $('#hand-cards').children) {
    if (img.dataset.handIndex === undefined) continue;
    const selected = placement?.kind === 'hand' && state.hand[Number(img.dataset.handIndex)]?.uid === placement.card.uid;
    img.classList.toggle('selected', Boolean(selected));
    img.setAttribute('aria-pressed', String(Boolean(selected)));
  }
}

function addStack(cards, x, z, faceUp, scale, rot) {
  const o = { type: 'stack', id: state.nextId++, x, z, rot, scale, faceUp, name: '', cards };
  raise(o);
  state.objects.push(o);
  return o;
}

async function drawToHand(o, n) {
  if (!o || o.type !== 'stack' || !o.cards.length) return;
  const target = n === 1 && inspectorTarget?.id === o.id ? inspectorTarget : null;
  const feedback = target?.draw;
  if (feedback) {
    if (online?.active && feedback.pending >= o.cards.length) return;
    target.keepOpen = true;
    feedback.pending++; feedback.failed = false;
    updateActionFeedback(target, 'draw');
    refreshStackInspector(o);
  }
  let result;
  if (online?.active) {
    result = await onlineAction({ type: 'draw', id: o.id, count: n });
  } else {
    pushUndo();
    const taken = o.cards.splice(0, Math.min(n, o.cards.length));
    state.hand.push(...taken);
    if (!o.cards.length) removeObj(o.id); else renderObj(o);
    renderHand(); save();
    status(`Robadas ${taken.length}`);
    result = true;
  }
  if (result) { $('#hand').classList.remove('collapsed'); updateHandToggle(); }
  if (feedback) {
    feedback.pending--;
    if (result) feedback.count++;
    else feedback.failed = true;
    updateActionFeedback(target, 'draw');
    if (inspectorTarget === target) refreshStackInspector(byId(o.id));
  }
  return result;
}

// ---------- Acciones ----------
function flip(o) {
  if (!o) return;
  if (online?.active) return onlineAction({ type: 'flip', id: o.id });
  pushUndo();
  o.faceUp = !o.faceUp;
  o.cards.reverse();
  renderObj(o); save();
}

function flipSelected() {
  const selected = placement;
  const o = selected?.kind === 'stack' && byId(selected.id);
  if (o?.type !== 'stack' || !o.cards.length) return;
  cancelPlacement();
  if (online?.active) return onlineAction({ type: 'flip', id: o.id, one: Boolean(selected.one), version: o.v || 0 });
  if (selected.one && o.cards.length > 1) {
    pushUndo();
    // A single selected card is revealed beside its deck, never merged into it.
    addStack([o.cards.shift()], o.x + Math.max(sizeOf(o).w, sizeOf(o).h) + 0.3, o.z, !o.faceUp, o.scale, o.rot);
    renderAll();
  } else flip(o);
  status('Volteada');
}

function updateActionFeedback(target, action) {
  if (inspectorTarget !== target || !target?.[action]) return;
  const { count, pending, failed } = target[action];
  const [done, waiting, error] = action === 'draw'
    ? ['Robadas', 'Robando…', 'Error al robar']
    : action === 'rotate' ? ['Girado', 'Girando…', 'Error al girar']
    : ['Barajado', 'Barajando…', 'Error al barajar'];
  const feedback = $(`#${action}-feedback`);
  feedback.textContent = [
    count ? `${done} ×${count}` : '',
    failed ? error : pending ? (count ? '…' : waiting) : ''
  ].filter(Boolean).join(' · ');
  feedback.classList.toggle('error', failed);
}

async function doShuffle(o) {
  if (!o || o.cards.length < 2) return;
  // Feedback belongs to this open panel, never to the saved game or a later panel.
  const target = inspectorTarget?.id === o.id ? inspectorTarget : null;
  const feedback = target?.shuffle;
  if (feedback) {
    target.keepOpen = true;
    feedback.pending++; feedback.failed = false;
    updateActionFeedback(target, 'shuffle');
  }
  let result;
  let succeeded = true;
  if (online?.active) {
    result = await onlineAction({ type: 'shuffle', id: o.id });
    succeeded = Boolean(result);
  } else {
    pushUndo();
    shuffle(o.cards);
    renderObj(o); save();
    status('Barajado');
    if (inspectorTarget?.id === o.id) refreshStackInspector(o);
  }
  if (feedback) {
    feedback.pending--;
    if (succeeded) feedback.count++;
    else feedback.failed = true;
    updateActionFeedback(target, 'shuffle');
  }
  return result;
}

async function rotate(o, d) {
  if (!o || o.type !== 'stack' || !o.cards.length) return;
  const target = inspectorTarget?.id === o.id ? inspectorTarget : null;
  const feedback = target?.rotate;
  if (feedback) {
    target.keepOpen = true;
    feedback.pending++; feedback.failed = false;
    updateActionFeedback(target, 'rotate');
  }
  let succeeded = true;
  if (online?.active) succeeded = Boolean(await onlineAction({ type: 'rotate', id: o.id, angle: d }));
  else {
    pushUndo();
    o.rot = (o.rot + d + 360) % 360;
    renderObj(o); save();
  }
  if (feedback) {
    feedback.pending--;
    if (succeeded) feedback.count++;
    else feedback.failed = true;
    updateActionFeedback(target, 'rotate');
  }
  return succeeded;
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
    const item = document.createElement('div');
    item.className = 'deck-card';
    inspectedCards.set(item, card);
    const img = document.createElement('img');
    img.src = card.face;
    img.alt = card.name || `Carta ${i + 1}`;
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-label', `Robar ${img.alt}`);
    img.onkeydown = e => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) img.onclick(e); }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) openCardZoom(card, true, 0, true);
      }
    };
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
    const zoom = document.createElement('button');
    zoom.textContent = 'Ampliar';
    zoom.setAttribute('aria-label', `Ampliar ${img.alt}`);
    zoom.onclick = () => openCardZoom(card);
    item.append(img, zoom);
    body.appendChild(item);
  });
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; }
function inspectedCardAt(element) {
  const item = element?.closest?.('#modal-body .deck-card');
  return item && inspectedCards.get(item);
}

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
  actions.forEach(([label, fn, keepOpen, feedbackId]) => {
    const button = document.createElement('button');
    button.textContent = label;
    if (feedbackId) {
      const feedback = document.createElement('span');
      feedback.id = feedbackId;
      feedback.className = 'action-feedback';
      feedback.setAttribute('role', 'status');
      feedback.setAttribute('aria-live', 'polite');
      feedback.setAttribute('aria-atomic', 'true');
      button.setAttribute('aria-label', label);
      button.dataset.feedback = feedbackId;
      button.appendChild(feedback);
    }
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
  const count = o?.cards?.length || 0;
  const name = o?.name || inspectorTarget?.name || (count > 1 ? 'Mazo' : 'Carta');
  $('#inspector-title').textContent = `${name} · ${count ? `${count} ${count === 1 ? 'carta' : 'cartas'}` : 'Mazo agotado'}`;
  $('#inspector-image').hidden = !count;
  if (count) $('#inspector-image').src = o.faceUp ? o.cards[0].face : o.cards[0].back;
  if (inspectorTarget) { inspectorTarget.version = o?.v; inspectorTarget.empty = !count; }
  for (const button of $('#inspector-actions').children) {
    button.disabled = count < (button.dataset.feedback === 'shuffle-feedback' ? 2 : 1)
      || (button.dataset.feedback === 'draw-feedback' && (inspectorTarget?.draw?.pending || 0) >= count);
  }
}

function inspectObject(o) {
  if (!o || o.type === 'counter') return;
  inspectorTarget = { kind: 'object', id: o.id, version: o.v, name: o.name };
  if (o.type === 'stack') {
    const count = o.cards.length;
    inspectorTarget.draw = { count: 0, pending: 0, failed: false };
    inspectorTarget.rotate = { count: 0, pending: 0, failed: false };
    if (count > 1) inspectorTarget.shuffle = { count: 0, pending: 0, failed: false };
    const current = () => byId(o.id);
    inspect(`${o.name || (count > 1 ? 'Mazo' : 'Carta')} · ${count} ${count === 1 ? 'carta' : 'cartas'}`,
      o.faceUp ? o.cards[0].face : o.cards[0].back, [
        ['Ampliar', () => { const latest = current(); if (latest) openCardZoom(latest.cards[0], latest.faceUp, latest.rot - 180); }],
        ...xfilesCardActions(o),
        ['Robar 1', () => drawToHand(current(), 1), true, 'draw-feedback'],
        ...(count > 1 ? [['Robar 6', () => drawToHand(current(), 6)]] : []),
        ['Voltear', async () => { await flip(current()); inspectObject(current()); }],
        ['Colocar en mesa', () => beginPlacement({ kind: 'stack', id: o.id, one: count > 1 })],
        ...(count > 1 ? [
          ['Mover mazo', () => beginPlacement({ kind: 'stack', id: o.id })],
          ['Barajar', () => doShuffle(current()), true, 'shuffle-feedback'],
          ['Ver cartas', () => openSearch(current())]
        ] : []),
        ['Girar', () => rotate(current(), 90), true, 'rotate-feedback']
      ]);
  } else if (o.type === 'bag') {
    inspect(o.name, null, [['Sacar ficha', () => spawnFromBag(o)], ['Mover', () => beginPlacement({ kind: 'stack', id: o.id })]]);
  } else if (o.type === 'token') {
    inspect(o.name, null, [['Mover', () => beginPlacement({ kind: 'stack', id: o.id })], ['Eliminar ficha', () => deleteObj(o)]]);
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
  $('#placement-actions').hidden = !o && next.kind !== 'hand';
  $('#placement-preview').hidden = o?.type !== 'stack' && next.kind !== 'hand';
  $('#placement-flip').hidden = o?.type !== 'stack';
  $('#placement-flip').setAttribute('aria-label', wholeDeck ? 'Voltear el mazo entero' : 'Voltear una carta');
  if (o) els.get(o.id)?.classList.add('selected');
  updateHandSelection();
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
  updateHandSelection();
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
    o = addStack([card], p.x, p.z, true, IS_COMPACT ? 1.12 : 1.47, 180);
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
  if (o.type === 'player-zone' || o.type === 'counter') return;
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
    if (zone.type !== 'player-zone' || zone.zone === 'play') return false;
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
      const target = { type: 'stack', scale: IS_COMPACT ? 1.12 : 1.47, ...screenToWorld(ev.clientX, ev.clientY) };
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
  if (syncingDevice) { e.preventDefault(); return; }
  const space = e.code === 'Space' || e.key === ' ';
  if (!$('#card-zoom').hidden) {
    if (space && cardZoom?.holdKey) e.preventDefault();
    if (e.key === 'Escape') { e.preventDefault(); closeCardZoom(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target.closest?.('input, textarea, [contenteditable="true"]')) { e.preventDefault(); undo(); return; }
  if (e.key === 'Escape') { cancelHandGesture?.(); closeModal(); closeInspector(); cancelPlacement(); if (!$('#reserve-dialog').hidden) closeReserve(); $('#help').hidden = true; $('#setup').hidden = true; $('#room-dialog').hidden = true; $('#games-dialog').hidden = true; $('#turn-dialog').hidden = true; $('#enemies-dialog').hidden = true; $('#menu').hidden = true; return; }
  if (!$('#inspector').hidden || !$('#help').hidden || !$('#setup').hidden || !$('#room-dialog').hidden || !$('#games-dialog').hidden || !$('#turn-dialog').hidden || !$('#enemies-dialog').hidden || !$('#reserve-dialog').hidden) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (!$('#modal').hidden) {
    if (space && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
      const hovered = mousePosition && document.elementFromPoint(mousePosition.x, mousePosition.y);
      const card = inspectedCardAt(hovered) || inspectedCardAt(document.activeElement);
      if (card) { e.preventDefault(); openCardZoom(card, true, 0, true); }
    }
    return;
  }
  if (space) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || drag || pinch || suppressHandClick) return;
    const hoveredObject = hoverId && byId(hoverId);
    const handImage = document.activeElement?.closest?.('#hand-cards img');
    const handCard = hoveredHandCard || (hoveredObject?.type !== 'stack' && handImage && state.hand[Number(handImage.dataset.handIndex)])
      || (hoveredObject?.type !== 'stack' && placement?.kind === 'hand' && placement.card);
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
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const hoveredObject = hoverId && byId(hoverId);
  const o = hoveredObject?.type === 'stack' ? hoveredObject : (placement?.kind === 'stack' && byId(placement.id));
  if (o?.type !== 'stack') return;
  const k = e.key.toLowerCase();
  if (!['f','r','q','e','d','s'].includes(k) && !/^[1-9]$/.test(k)) return;
  e.preventDefault();
  if (e.repeat) return;
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
document.querySelectorAll('#zones [data-zone]').forEach(b => { b.onclick = () => IS_COMPACT && b.dataset.zone === 'reserve' ? openReserve() : focusZone(b.dataset.zone); });
$('#reserve-close').onclick = closeReserve;
$('#reserve-search').oninput = () => {reserveLimit=80;refreshReserve();};
$('#reserve-table').onclick = () => { closeReserve(); focusZone('reserve'); };
$('#reserve-add-all').onclick = async () => {
  if(libraryPending) return;
  libraryPending=true;
  $('#reserve-add-all').disabled=true;
  try {
    if(online?.active) {
      if(!await onlineAction({type:'legendary',command:'reserves'}))return;
    } else {
      const next=clone(state);
      const message=GameSetup.act(next,next.hand,1,{command:'reserves'});
      pushUndo();state=next;renderAll();status(message);
    }
    closeReserve();focusZone('reserve');
  } catch(error) {status(error.message);}
  finally {libraryPending=false;$('#reserve-add-all').disabled=false;}
};
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
$('#placement-flip').onclick = flipSelected;
$('#placement-preview').onclick = () => {
  const o = placement?.kind === 'stack' && byId(placement.id);
  if (o?.type === 'stack') openCardZoom(o.cards[0], o.faceUp, o.rot - 180);
  else if (placement?.kind === 'hand') openCardZoom(placement.card);
};
$('#card-zoom-close').onclick = closeCardZoom;
new ResizeObserver(fitCardZoom).observe($('#card-zoom-body'));
$('#placement-actions').onclick = () => {
  const o = placement?.kind === 'stack' && byId(placement.id);
  const card = placement?.kind === 'hand' && state.hand.find(c => c.uid === placement.card.uid);
  cancelPlacement();
  if (o) inspectObject(o);
  else if (card) inspectHand(card);
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
    if (overlay.id === 'help' && syncingDevice) return;
    if (overlay.id === 'card-zoom') closeCardZoom();
    else if (overlay.id === 'reserve-dialog') closeReserve();
    else overlay.hidden = true;
  });
  overlay.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const buttons = [...overlay.querySelectorAll('button, a[href], select, input, [tabindex="0"]')].filter(el => el.getClientRects().length);
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
$('#btn-help').onclick = () => { updateBackupUI(); $('#help').hidden = false; };
$('#help-close').onclick = () => { if (!syncingDevice) $('#help').hidden = true; };
$('#sync-generate').onclick = () => deviceOperation(generatePrivateCode);
$('#sync-open').onclick = () => deviceOperation(resumePrivateCode);
$('#sync-code').onkeydown = event => { if (event.key === 'Enter') deviceOperation(resumePrivateCode); };
$('#sync-copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('#sync-private-code').value); syncMessage('Código privado copiado. Úsalo solo en tus dispositivos.'); }
  catch { $('#sync-private-code').focus(); $('#sync-private-code').select(); syncMessage('Selecciona y copia tu código privado.'); }
};
$('#backup-download').onclick = downloadBackup;
$('#backup-open').onclick = () => { $('#backup-file').value = ''; $('#backup-file').click(); };
let importingBackup = false;
async function openBackup(read) {
  if (importingBackup || syncingDevice) return;
  importingBackup = true;
  $('#backup-open').disabled = true; $('#backup-previous').disabled = true;
  backupMessage('Abriendo copia…');
  try { await importBackup(AlienBackup.parse(await read())); }
  catch (error) { backupMessage(error.message, true); }
  finally { importingBackup = false; $('#backup-open').disabled = false; updateBackupUI(); }
}
$('#backup-file').onchange = () => {
  const file = $('#backup-file').files[0];
  if (!file) return;
  if (file.size > AlienBackup.maxBytes) { backupMessage('La copia es demasiado grande. Tu partida no se ha cambiado.', true); return; }
  openBackup(() => file.text());
};
$('#backup-previous').onclick = () => openBackup(() => localStorage.getItem(PRE_IMPORT_KEY));
$('#modal-close').onclick = closeModal;

// ---------- Selector de juego y acciones de X-Files ----------
$('#btn-games').onclick = () => {
  for (const link of document.querySelectorAll('#games-dialog a[data-game]')) {
    const url = new URL(location.href); url.searchParams.set('game', link.dataset.game); url.hash = '';
    try { const code = localStorage.getItem(`lea-last-room-v1:${link.dataset.game}`); if (code) url.hash = `room=${code}`; } catch {}
    link.href = url.href;
    link.setAttribute('aria-current', link.dataset.game === GAME.id ? 'page' : 'false');
  }
  $('#games-dialog').hidden = false;
};
$('#games-close').onclick = () => { $('#games-dialog').hidden = true; };
for (const link of document.querySelectorAll('#games-dialog a[data-game]')) link.onclick = async e => {
  e.preventDefault();
  await online?.queue;
  save(); location.assign(link.href);
};
function updateEnemiesSummary() {
  $('#btn-enemies').hidden=!IS_MARVEL;
  if(!IS_MARVEL)return;
  const setup=state?.setup;
  const meta=GameSetup.modern||GameSetup.marvel;
  const master=meta?.masterminds.find(m=>m.key===setup?.mastermind);
  $('#enemies-mastermind').textContent=setup?.hiddenMastermind?'Por revelar':master?master.name+(setup.epic?' · Epic':''):'Sin preparar';
  $('#enemies-scheme').textContent=setup?.title||'Sin preparar';
  for(const kind of ['heroes','villains','henchmen'])$('#enemies-'+kind).textContent=setup?.[kind]?.length
    ? setup[kind].join(' · ') : setup?'Esta partida no guardó los grupos elegidos.':'Prepara una partida para ver sus grupos.';
  $('#enemies-leads').textContent=!setup?'':setup.hiddenMastermind?'El Mastermind se revela durante la partida.':setup.players>1
    ? 'Always Leads se aplica en partidas de dos o más jugadores.'
    : setup.soloAlwaysLeads?'Variante de solitario: Always Leads activado. Los grupos de arriba son los incluidos en esta preparación.'
    : master?.leadsSolo?'Este Mastermind exige su grupo también en solitario.'
    : 'Solitario: Always Leads no es obligatorio.'+(GAME.id==='marvel2'?' Si el Mastermind menciona su grupo habitual, aplica esas habilidades al grupo de villanos o Henchmen elegido en su lugar.':'');
}
$('#btn-enemies').onclick=()=>{updateEnemiesSummary();$('#enemies-dialog').hidden=false;$('#enemies-close').focus({preventScroll:true});};
$('#enemies-close').onclick=()=>{$('#enemies-dialog').hidden=true;$('#btn-enemies').focus({preventScroll:true});};
function updateTurnUI() {
  updateHandActions();
  updateEnemiesSummary();
  const seat = online?.room?.seat || 1;
  $('#turn-summary').textContent = state?.setup
    ? `Turno del jugador ${state.setup.turn||1} · Tu zona: jugador ${seat} · ${state.hand.length} cartas en tu mano`
    : 'Pulsa Preparar para elegir la partida y los jugadores.';
  for (const button of document.querySelectorAll('[data-xf-command]')) {
    if(button.dataset.xfCommand==='revealMastermind')button.hidden=!state?.setup?.hiddenMastermind;
    if(button.dataset.xfCommand==='fireflyNextEpisode')button.hidden=GAME.id!=='firefly'||state?.setup?.encountersVersion!==1||state.setup.episodeIndex>=2;
    button.disabled = discardingHand || xfilesPending || !state?.setup || Boolean(online?.active && !online.connected)
      || (IS_XFILES && button.dataset.xfCommand === 'endTurn' && state.setup.turn !== seat);
  }
}
let xfilesPending = false;
async function xfilesAction(action) {
  if (xfilesPending || discardingHand) return;
  xfilesPending = true;
  updateHandActions();
  $('#turn-feedback').textContent = 'Aplicando…';
  $('#turn-feedback').classList.remove('error');
  for (const button of document.querySelectorAll('[data-xf-command]')) button.disabled = true;
  try {
    let message;
    if (online?.active) {
      const response = await online.action({ type: IS_COLLECTION?'legendary':IS_XFILES?'xfiles':'alien', ...action }); message = response.message || 'Acción completada';
    } else {
      const next = clone(state);
      message = GameSetup.act(next, next.hand, 1, action);
      pushUndo(); state = next; renderAll();
    }
    $('#turn-feedback').textContent = message; status(message);
    if (action.command === 'playHand' || (action.command === 'endTurn' && activeZone === 'player')) focusZone('player');
  } catch (error) {
    $('#turn-feedback').textContent = error.message; $('#turn-feedback').classList.add('error'); status(error.message);
  } finally { xfilesPending=false; updateTurnUI(); }
}
function xfilesCardActions(object) {
  if (!IS_XFILES || !state.setup || object.cards.length !== 1) return [];
  const slot = GameSetup.bureauSlot(object, state);
  if (!slot) return [];
  if (!object.faceUp) return [['Escanear Bureau', () => xfilesAction({command:'bureau', slot, mode:'scan'})]];
  return [['Reclutar y reponer', () => xfilesAction({command:'bureau', slot, mode:'recruit'})],
    ...(slot===1 ? [['Reclutar encima de mi mazo', () => xfilesAction({command:'bureau',slot,mode:'top'})]] : []),
    ...(slot===2 ? [['Reclutar debajo de mi mazo', () => xfilesAction({command:'bureau',slot,mode:'bottom'})]] : [])];
}
$('#btn-turn').onclick = () => { updateTurnUI(); $('#turn-feedback').textContent=''; $('#turn-dialog').hidden=false; };
$('#turn-close').onclick = () => { $('#turn-dialog').hidden=true; };
for (const button of document.querySelectorAll('[data-xf-command]')) button.onclick = () => xfilesAction({
  command: button.dataset.xfCommand, count: Number(button.dataset.count), resource: button.dataset.resource,
});
if (IS_XFILES) {
  GameSetup.heroes.forEach((hero,i) => {
    const label=document.createElement('label'), input=document.createElement('input');
    input.type='checkbox'; input.value=i+1; input.checked=[2,3,4,9].includes(i+1); input.onchange=updateSetupSummary;
    label.append(input,document.createTextNode(hero)); $('#xf-heroes').appendChild(label);
  });
  GameSetup.avatars.forEach((avatar,i) => {
    const label=document.createElement('label'), select=document.createElement('select');
    label.dataset.xfAvatarLabel=''; select.id=`xf-avatar-${i+1}`;
    GameSetup.avatars.forEach(a => { const option=document.createElement('option'); option.value=a.id; option.textContent=a.name; select.appendChild(option); });
    select.value=avatar.id; label.append(document.createTextNode(`Jugador ${i+1}`),select); $('#xf-avatars').appendChild(label);
  });
  $('#xf-random-heroes').onclick=() => {
    const choices=[1,2,3,4,5,6,7,8,9]; shuffle(choices);
    for (const input of document.querySelectorAll('#xf-heroes input')) input.checked=choices.slice(0,4).includes(Number(input.value));
    updateSetupSummary();
  };
  const refill=document.createElement('div'); refill.className='bureau-refill';
  const title=document.createElement('p'); title.textContent='Reponer un espacio vacío del Bureau'; refill.appendChild(title);
  for(let slot=1;slot<=5;slot++) {
    const button=document.createElement('button'); button.textContent=String(slot); button.setAttribute('aria-label',`Reponer Bureau ${slot}`);
    button.dataset.xfCommand='bureau'; button.onclick=() => xfilesAction({command:'bureau',slot,mode:'refill'}); refill.appendChild(button);
  }
  $('#turn-actions').after(refill);
}

GameSetup.scenarios.forEach(scenario => {
  const option = document.createElement('option');
  option.value = scenario.id;
  option.textContent = scenario.title;
  $('#setup-scenario').appendChild(option);
});
let marvelCollectionInputs=[],marvelHeroInputs=[];
const modernGroupInputs={villain:[],henchmen:[]};
function selectedMarvelCollections(){return marvelCollectionInputs.filter(i=>i.checked).map(i=>i.value);}
function selectedMarvelHeroes(){return marvelHeroInputs.filter(i=>i.checked).map(i=>i.value);}
function populateHeroChoices(heroes,selected=new Set()) {
  $('#marvel-hero-list').innerHTML='';marvelHeroInputs=[];
  for(const h of [...heroes].sort((a,b)=>a.name.localeCompare(b.name))) {
    const label=document.createElement('label'),input=document.createElement('input');
    label.className='setup-check';input.type='checkbox';input.value=h.key;input.checked=selected.has(h.key);
    input.onchange=updateSetupSummary;label.appendChild(input);label.appendChild(document.createTextNode(h.name));
    $('#marvel-hero-list').appendChild(label);marvelHeroInputs.push(input);
  }
  $('#marvel-hero-search').value='';
  $('#marvel-hero-mode').onchange=updateSetupSummary;
  $('#marvel-hero-search').oninput=()=>{
    const search=$('#marvel-hero-search').value.toLocaleLowerCase();
    for(const input of marvelHeroInputs)input.parentElement.hidden=!heroes.find(h=>h.key===input.value).name.toLocaleLowerCase().includes(search);
  };
}
function filterMarvelSetup() {
  const metadata=GameSetup.marvel,chosen=new Set(selectedMarvelCollections());
  const fits=item=>chosen.has(MarvelSetup.collectionOf(item));
  const schemes=$('#setup-scenario'),masters=$('#marvel-mastermind');
  const previousScheme=schemes.value,previousMaster=masters.value,previousHeroes=new Set(selectedMarvelHeroes());
  schemes.innerHTML='';masters.innerHTML='';
  for(const s of [...metadata.schemes].filter(fits).sort((a,b)=>a.title.localeCompare(b.title))) {
    const o=document.createElement('option');o.value=s.id;o.textContent=s.title;schemes.appendChild(o);
  }
  schemes.value=[...schemes.options].some(o=>o.value===previousScheme)?previousScheme:[...schemes.options].some(o=>o.value==='cosmic-cube')?'cosmic-cube':schemes.options[0]?.value||'';
  const eligibleMasters=metadata.masterminds.filter(fits);
  for(const m of [{key:'random',name:'Al azar entre los compatibles'},...eligibleMasters.sort((a,b)=>a.name.localeCompare(b.name))]) {
    const o=document.createElement('option');o.value=m.key;o.textContent=m.name;masters.appendChild(o);
  }
  masters.value=eligibleMasters.some(m=>m.key===previousMaster)?previousMaster:eligibleMasters.some(m=>m.key==='889fb1')?'889fb1':'random';
  $('#marvel-epic').disabled=!eligibleMasters.some(m=>m.epic);
  if($('#marvel-epic').disabled)$('#marvel-epic').checked=false;
  const limited=chosen.size<MarvelSetup.collections(metadata).length;
  $('#marvel-supplies').disabled=limited;
  if(limited)$('#marvel-supplies').value='base';
  $('#marvel-collection-summary').textContent='Colecciones · '+(chosen.size===1?[...chosen][0]:chosen.size+' seleccionadas');
  populateHeroChoices(metadata.heroes.filter(fits),previousHeroes);
  $('#setup-error').textContent=chosen.size?'':'Elige al menos una colección.';
  $('#setup-error').hidden=chosen.size>0;
  $('#setup-submit').disabled=!chosen.size;
  updateSetupSummary();
}
function populateMarvelSetup() {
  if(!GameSetup.marvel)return;
  $('#marvel-options').hidden=false;$('#marvel-filters').hidden=false;
  $('#marvel-supplies').value='base';$('#marvel-solo').value='classic';$('#marvel-hero-mode').value='random';
  $('#marvel-collection-list').innerHTML='';marvelCollectionInputs=[];
  for(const name of MarvelSetup.collections(GameSetup.marvel)) {
    const label=document.createElement('label'),input=document.createElement('input');
    label.className='setup-check';input.type='checkbox';input.value=name;input.checked=name==='Core';input.onchange=filterMarvelSetup;
    label.appendChild(input);label.appendChild(document.createTextNode(name==='Core'?'Core · Juego base original':name));
    $('#marvel-collection-list').appendChild(label);marvelCollectionInputs.push(input);
  }
  $('#marvel-only-core').onclick=()=>{marvelCollectionInputs.forEach(i=>i.checked=i.value==='Core');filterMarvelSetup();};
  $('#marvel-all-collections').onclick=()=>{marvelCollectionInputs.forEach(i=>i.checked=true);filterMarvelSetup();};
  filterMarvelSetup();
}
function populateModernSetup() {
  const meta=GameSetup.modern,schemes=$('#setup-scenario'),masters=$('#marvel-mastermind');
  schemes.innerHTML='';masters.innerHTML='';
  for(const s of meta.schemes) {
    const option=document.createElement('option');option.value=s.id;option.textContent=s.title;schemes.appendChild(option);
  }
  schemes.value=meta.defaultScenario;
  for(const m of [{key:'random',name:'Al azar'},...meta.masterminds]) {
    const option=document.createElement('option');option.value=m.key;option.textContent=m.name;masters.appendChild(option);
  }
  masters.value=meta.defaultMastermind;
  $('#marvel-options').hidden=false;$('#marvel-supplies').parentElement.hidden=true;$('#marvel-solo-label').hidden=true;
  $('#marvel-filters').hidden=false;$('#marvel-collection-filter').hidden=true;
  $('#marvel-hero-mode').value='random';$('#marvel-hero-mode').options[0].textContent='Al azar';
  populateHeroChoices(meta.heroes);
  $('#modern-group-options').hidden=false;
  for(const [kind,group] of [['villain','Villanos'],['henchmen','Henchmen']]) {
    $(`#modern-${kind}-mode`).value='random';$(`#modern-${kind}-mode`).onchange=updateSetupSummary;
    $(`#modern-${kind}-list`).innerHTML='';modernGroupInputs[kind]=[];
    for(const deck of GameSetup.catalog().filter(d=>d.group===group)) {
      const label=document.createElement('label'),input=document.createElement('input');
      label.className='setup-check';input.type='checkbox';input.value=deck.key;input.onchange=updateSetupSummary;
      label.appendChild(input);label.appendChild(document.createTextNode(deck.name));
      $(`#modern-${kind}-list`).appendChild(label);modernGroupInputs[kind].push(input);
    }
  }
  const reveal=document.createElement('button');reveal.textContent='Revelar Mastermind';reveal.dataset.xfCommand='revealMastermind';
  reveal.onclick=()=>xfilesAction({command:'revealMastermind'});$('#turn-actions').appendChild(reveal);
}
let encountersAvatars=[],encountersStages=[],encountersHeroes=[];
function populateEncountersSetup() {
  const meta=GameSetup.encounters,select=$('#setup-scenario');
  select.innerHTML='';
  for(const s of meta.scenarios) {
    const option=document.createElement('option');option.value=s.id;option.textContent=s.title;select.appendChild(option);
  }
  select.value=meta.defaultScenario;$('#encounters-options').hidden=false;
  $('#predator-hero-mode').value='movie';$('#predator-hero-mode').onchange=updateSetupSummary;
  configureEncountersOptions();
  if(GAME.id==='firefly') {
    const button=document.createElement('button');button.textContent='Preparar episodio siguiente';button.dataset.xfCommand='fireflyNextEpisode';
    button.onclick=()=>xfilesAction({command:'fireflyNextEpisode'});$('#turn-actions').appendChild(button);
  }
}
function configureEncountersOptions(saved) {
  const meta=GameSetup.encounters,scenario=GameSetup.scenarios.find(s=>s.id===$('#setup-scenario').value);
  if(!meta||!scenario)return;
  const firefly=GAME.id==='firefly',hunters=scenario.mode==='hunters';
  $('#encounters-stages').hidden=!scenario.custom;
  $('#encounters-stages-title').textContent=firefly?'Episodios A, B y C':'Etapas 1, 2 y 3';
  $('#encounters-avatar-title').textContent=firefly?'Cinco personajes principales':'Avatares de los jugadores';
  $('#encounters-stage-fields').innerHTML='';encountersStages=[];
  $('#encounters-avatar-fields').innerHTML='';encountersAvatars=[];
  const field=(container,title,choices,value)=>{
    const label=document.createElement('label'),select=document.createElement('select'),text=document.createTextNode(title);
    for(const c of choices) {const o=document.createElement('option');o.value=c.key;o.textContent=c.name;select.appendChild(o);}
    select.value=value;select.onchange=updateSetupSummary;label.appendChild(text);label.appendChild(select);$(container).appendChild(label);
    return {label,select,text};
  };
  for(let i=0;i<3;i++) {
    const choices=firefly?meta.episodes.filter(e=>e.stage==='ABC'[i]).map(e=>({key:e.id,name:e.name})):
      meta.stages.filter(s=>s.mode===scenario.mode&&s.stage===i+1);
    const selected=firefly?(saved?.episodes||scenario.episodes)[i]:(saved?.stages?.[i]||choices.find(s=>s.movie===scenario.movie).key);
    encountersStages.push(field('#encounters-stage-fields',firefly?'Episodio '+'ABC'[i]:'Etapa '+(i+1),choices,selected).select);
  }
  const choices=meta.avatars.filter(a=>firefly||a.mode===scenario.mode);
  const numbers=hunters?[1,2,3,4,5]:scenario.movie===2?[6,7,9,8,10]:[1,2,5,4,3];
  const defaults=firefly?scenario.avatars:numbers.map(n=>'avatar'+n+(hunters?'predatorvpredator':'predator'));
  for(let i=0;i<5;i++)encountersAvatars.push(field('#encounters-avatar-fields','Jugador '+(i+1),choices,saved?.avatars?.[i]||defaults[i]));
  $('#predator-location-label').hidden=firefly||hunters;
  $('#predator-location').value=saved?.location||'locationpredator'+(scenario.movie||1);
  $('#predator-heroes').hidden=firefly;$('#predator-hunter-options').hidden=!hunters;
  $('#predator-hero-list').innerHTML='';encountersHeroes=[];
  if(!firefly) {
    $('#predator-hero-mode').value=saved?.heroMode||'movie';
    for(const h of meta.heroes.filter(h=>h.mode===scenario.mode)) {
      const label=document.createElement('label'),input=document.createElement('input');
      label.className='setup-check';input.type='checkbox';input.value=h.key;
      input.checked=saved?.heroKeys?saved.heroKeys.includes(h.key):h.movie===scenario.movie;input.onchange=updateSetupSummary;
      label.appendChild(input);label.appendChild(document.createTextNode(h.name));$('#predator-hero-list').appendChild(label);encountersHeroes.push(input);
    }
    for(const option of ['tests','challenges','cooperative'])$('#predator-'+option).checked=Boolean(saved?.[option]);
  }
}
function encountersOptions(players) {
  const options={avatars:encountersAvatars.slice(0,GAME.id==='firefly'?5:players).map(a=>a.select.value)};
  if(GAME.id==='firefly')options.episodes=encountersStages.map(s=>s.value);
  else {
    Object.assign(options,{stages:encountersStages.map(s=>s.value),location:$('#predator-location').value,randomHeroes:$('#predator-hero-mode').value==='random'});
    if($('#predator-hero-mode').value==='manual')options.heroKeys=encountersHeroes.filter(i=>i.checked).map(i=>i.value);
    for(const option of ['tests','challenges','cooperative'])options[option]=Boolean($('#predator-'+option).checked);
  }
  return options;
}
function updateEncountersSummary(players) {
  const firefly=GAME.id==='firefly',options=encountersOptions(players),distinct=new Set(options.avatars).size===options.avatars.length;
  encountersAvatars.forEach((a,i)=>{a.label.hidden=!firefly&&i>=players;a.text.textContent=i<players?'Jugador '+(i+1):'Principal sin jugador '+(i-players+1);});
  const manual=!firefly&&$('#predator-hero-mode').value==='manual';
  $('#predator-hero-picker').hidden=!manual;
  $('#predator-hero-count').textContent=encountersHeroes.filter(i=>i.checked).length+' de 4 seleccionados';
  $('#setup-submit').disabled=!distinct||(manual&&options.heroKeys.length!==4);
  $('#encounters-support').textContent=firefly?'Tripulación de apoyo: '+GameSetup.encounters.avatars.filter(a=>!options.avatars.includes(a.key)).map(a=>a.name).join(', ')+'.':(distinct?'':'Elige un avatar diferente para cada jugador.');
  const rounds=firefly?Math.max(0,players-3):players===5?1:0;
  $('#setup-summary').textContent=(firefly?`Cinco personajes principales y cuatro de apoyo · Crew: 56 cartas · ${players-1} Side Jobs por episodio · Un Inevitable al fondo de cada mazo.`:
    `Cuatro grupos de personajes / Armory · HQ: 5 cartas · Cartas adicionales por etapa: ${EncountersSetup.extrasByPlayers[players-1].join(', ')}.`)+
    ' Mazo inicial: 13 cartas; mano: 6. '+(rounds?rounds+' ronda(s) de preparación inicial sin revelar enemigos. ':'')+'Las cartas restantes quedan alrededor del tapete.';
}
if(IS_COLLECTION && GameSetup.avatars.length) {
  $('#collection-avatars').hidden=false;
  const defaults=['Neo1','Morpheus1','Trinity1','Switch','Mouse'];
  for(let seat=1;seat<=5;seat++) {
    const label=document.createElement('label'); label.dataset.collectionSeat=seat;
    const select=document.createElement('select'); select.id='collection-avatar-'+seat;
    for(const avatar of GameSetup.avatars) {
      const option=document.createElement('option'); option.value=avatar.id;option.textContent=avatar.name;select.appendChild(option);
    }
    select.value=defaults[seat-1];label.append(document.createTextNode('Jugador '+seat),select);$('#collection-avatar-fields').appendChild(label);
  }
}
function updateSetupSummary() {
  if (!initial) return;
  let scenario = GameSetup.scenarios.find(s => s.id === $('#setup-scenario').value);
  if (!scenario) {$('#setup-submit').disabled=true;return;}
  $('#setup-submit').disabled=false;
  if(IS_COLLECTION) {
    const players=Number($('#setup-players').value);
    for(const option of $('#setup-scenario').options)option.disabled=players<(GameSetup.scenarios.find(s=>s.id===option.value)?.minPlayers||1);
    if(players<(scenario.minPlayers||1)) {
      scenario=GameSetup.scenarios.find(s=>players>=(s.minPlayers||1)&&[...$('#setup-scenario').options].some(o=>o.value===s.id));
      if(!scenario)return;
      $('#setup-scenario').value=scenario.id;
    }
    $('#marvel-leads-option').hidden=!IS_MARVEL||players!==1;
    $('#marvel-solo-leads').disabled=!IS_MARVEL||players!==1||scenario.special==='bodyguards';
    const soloLeads=IS_MARVEL&&players===1&&$('#marvel-solo-leads').checked&&scenario.special!=='bodyguards';
    document.querySelectorAll('[data-collection-seat]').forEach(label=>{label.hidden=Number(label.dataset.collectionSeat)>players;});
    if(GameSetup.encounters) {updateEncountersSummary(players);return;}
    if(IS_MODERN) {
      const hidden=scenario.special==='bodyguards';
      $('#marvel-mastermind').disabled=hidden;
      const heroes=ModernLegendarySetup.count(scenario.heroes,players,[3,5,5,5,6][players-1])+(scenario.extraHeroes||0);
      const manualHeroes=$('#marvel-hero-mode').value==='manual';
      for(const input of marvelHeroInputs) {
        input.disabled=(scenario.heroesRequired||[]).includes(input.value);
        if(input.disabled)input.checked=true;
      }
      $('#marvel-hero-picker').hidden=!manualHeroes;
      $('#marvel-hero-count').textContent=`${selectedMarvelHeroes().length} de ${heroes} héroes seleccionados`;
      let valid=!manualHeroes||selectedMarvelHeroes().length===heroes;
      const manualGroups=Object.keys(modernGroupInputs).some(k=>$(`#modern-${k}-mode`).value==='manual');
      const randomOption=[...$('#marvel-mastermind').options].find(o=>o.value==='random');
      if(randomOption)randomOption.disabled=manualGroups&&!hidden;
      if(randomOption?.disabled&&$('#marvel-mastermind').value==='random')$('#marvel-mastermind').value=GameSetup.modern.defaultMastermind;
      const m=hidden?null:GameSetup.modern.masterminds.find(m=>m.key===$('#marvel-mastermind').value);
      const groups=ModernLegendarySetup.requiredGroups(scenario,players,m,soloLeads);
      const required={villain:groups.villains,henchmen:groups.henchmen};
      for(const kind of ['villain','henchmen']) {
        const manual=$(`#modern-${kind}-mode`).value==='manual';
        $(`#modern-${kind}-picker`).hidden=!manual;
        for(const input of modernGroupInputs[kind]) {
          input.disabled=required[kind].includes(input.value);
          if(input.disabled)input.checked=true;
        }
        const count=modernGroupInputs[kind].filter(i=>i.checked).length;
        const expected=Math.max(required[kind].length,kind==='villain'?players+(scenario.extraVillains||0):players>=4?2:1);
        $(`#modern-${kind}-count`).textContent=`${count} de ${expected} grupos seleccionados · Los obligatorios están marcados`;
        valid&&=!manual||count===expected;
      }
      if($('#modern-villain-mode').value==='manual'&&groups.villainChoices.length)valid&&=modernGroupInputs.villain.some(i=>i.checked&&groups.villainChoices.includes(i.value));
      const names=[...required.villain,...required.henchmen].map(k=>GameSetup.catalog().find(d=>d.key===k).name);
      const requiredHeroes=(scenario.heroesRequired||[]).map(k=>GameSetup.catalog().find(d=>d.key===k).name);
      $('#modern-required-groups').textContent=(names.length?'Obligatorios: '+names.join(', ')+'. ':'')+(requiredHeroes.length?'Héroes obligatorios: '+requiredHeroes.join(', ')+'. ':'')+(groups.villainChoices.length?'Always Leads: incluye '+groups.villainChoices.map(k=>GameSetup.catalog().find(d=>d.key===k).name).join(' o ')+'.':'')+(soloLeads?' El Scheme tiene prioridad; Always Leads no añade grupos adicionales.':'');
      $('#setup-submit').disabled=!valid;
      $('#setup-summary').textContent=`${GAME.id==='dc'?'DC':'Segunda Edición'} · ${heroes} héroes · ${players+(scenario.extraVillains||0)} grupos de villanos · ${ModernLegendarySetup.count(scenario.twists,players)} Scheme Twists · 5 Master Strikes. ${players===1?'Solitario: 2 Henchmen en el mazo y 2 en la ciudad. '+(soloLeads?'Variante: se aplica Always Leads.':'Se ignora Always Leads.'):(hidden?'El Mastermind se descubre durante la partida.':'Se respeta Always Leads.')} ${players>=4?'Warmup Round: no juegues carta del Villain Deck en el primer turno de cada jugador.':''} ${scenario.special==='liberation'?'Mankind Liberation Front: otros dos grupos de villanos y tres Bystanders en un mazo separado. ':''}Las cartas restantes quedan alrededor del tapete. Partida independiente de los demás juegos.`;
      return;
    }
    if(GAME.id==='marvel') {
      if(GameSetup.marvel) {
        const recipe=GameSetup.marvel.schemes.find(s=>s.id===scenario.id);
        const epic=$('#marvel-epic').checked;
        const manual=$('#marvel-hero-mode').value==='manual';
        for(const option of $('#marvel-mastermind').options) {
          const m=GameSetup.marvel.masterminds.find(m=>m.key===option.value);
          option.disabled=option.value==='random'?manual:Boolean(m&&(MarvelSetup.compatible(recipe,m)||(epic&&!m.epic)));
        }
        if(manual&&$('#marvel-mastermind').value==='random')$('#marvel-mastermind').value=[...$('#marvel-mastermind').options].find(o=>!o.disabled)?.value||'';
        const selected=GameSetup.marvel.masterminds.find(m=>m.key===$('#marvel-mastermind').value);
        if(!selected||MarvelSetup.compatible(recipe,selected)||(epic&&!selected.epic))$('#marvel-mastermind').value=[...$('#marvel-mastermind').options].find(o=>!o.disabled)?.value||'';
        const m=GameSetup.marvel.masterminds.find(m=>m.key===$('#marvel-mastermind').value);
        const heroes=Math.max(MarvelSetup.count(recipe.heroes,players,players===1?3:players===5?6:5)+MarvelSetup.count(recipe.extraHeroes,players)+(m?.extraHeroes||0),recipe.heroTeams?.reduce((n,t)=>n+t[1],0)||0,new Set([...(recipe.heroesRequired||[]),...(m?.heroes||[])]).size);
        const twists=recipe.special==='chthon'&&m?.key==='8ac205'?1:MarvelSetup.count(recipe.twists,players);
        $('#marvel-solo-label').hidden=players!==1;
        const solo=$('#marvel-solo').value==='advanced'?'Solitario avanzado: 5 Master Strikes.':'Solitario clásico: 1 Master Strike.';
        $('#marvel-hero-picker').hidden=!manual;
        $('#marvel-hero-count').textContent=`${selectedMarvelHeroes().length} de ${heroes} héroes seleccionados`;
        $('#setup-submit').disabled=manual&&selectedMarvelHeroes().length!==heroes;
        const filtered=marvelCollectionInputs.length>0;
        const pool=filtered?`${selectedMarvelCollections().join(', ')} · ${$('#setup-scenario').options.length} Schemes · ${Math.max(0,$('#marvel-mastermind').options.length-1)} Masterminds · ${marvelHeroInputs.length} héroes disponibles.`:'Toda la colección: 175 Schemes · 100 Masterminds · 285 héroes.';
        $('#setup-summary').textContent=`${pool} ${heroes} grupos de héroes · ${twists} Scheme Twists · HQ: ${recipe.hq||5}. ${players===1?solo+(soloLeads?' Variante: se aplica Always Leads; el Scheme tiene prioridad.':' Se ignora Always Leads salvo que la carta diga expresamente lo contrario.'):'Se aplica Always Leads; las instrucciones del Scheme tienen prioridad.'} Los mazos usan las colecciones elegidas. El resto de las cartas queda alrededor, fuera de partida.`;
        return;
      }
      const heroes=scenario.heroes||(scenario.id==='civil-war'&&players===2?4:players===1?3:players===5?6:5);
      const bystanders=scenario.bystanders||[1,2,8,8,12][players-1];
      const twists=scenario.id==='civil-war'&&players>=4?5:scenario.twists||8;
      $('#setup-summary').textContent=`Juego base original · ${heroes} grupos de héroes · HQ: 5 · Bystanders: ${30-bystanders} en reserva + ${bystanders} en el mazo de villanos · ${twists} Scheme Twists en el mazo${scenario.id==='killbots'?' + 3 junto al Scheme':''} · Wounds: ${scenario.id==='legacy-virus'?6*players:30} · Mano: 6. ${players===1?'Solitario clásico: 1 Master Strike. '+(soloLeads?'Variante: se aplica Always Leads; el Scheme tiene prioridad.':'Se ignora Always Leads.'):'Se respeta Always Leads del Mastermind.'} El resto de la colección queda alrededor, fuera de partida.`;
      return;
    }
    $('#setup-summary').textContent=GAME.id==='matrix'
      ? `Zion: 56 cartas · Dock: 5 cartas · Tres actos con ${[0,1,3,5,5][players-1]} cartas adicionales cada uno · Mano inicial: 6.`
      : GAME.id==='bond' ? `${players===1?4:players<4?5:6} héroes · Q Branch: 5 cartas · Villanos en tres etapas y misión final · Mazo inicial: 13 cartas; mano: 6.`
      : 'Mesa manual. Trae los mazos desde Reserva y prepara el escenario según el reglamento. Cada jugador tiene su zona y su mano privada.';
    return;
  }
  if (IS_XFILES) {
    const players = Number($('#setup-players').value);
    $('#xfiles-seasons').hidden = scenario.id !== 'custom';
    document.querySelectorAll('[data-xf-avatar-label]').forEach((label, i) => { label.hidden = i >= players; });
    const selected = document.querySelectorAll('#xf-heroes input:checked').length;
    $('#setup-summary').textContent = `${selected}/4 personajes · Conspiración: ${3*(players+8)+1} cartas en tres etapas · Mano inicial: 6 cartas.`;
    return;
  }
  const baseSize = scenario.stages.reduce((n, id) => n + initial.find(o => o.sourceId === id).cards.length, 0);
  const droneCount = GameSetup.dronesByPlayers[Number($('#setup-players').value) - 1].reduce((a, b) => a + b, 0);
  $('#setup-summary').textContent = `${scenario.crewLabel}. Colmena: ${baseSize + droneCount} cartas (${droneCount} drones).`;
}
$('#btn-setup').onclick = () => {
  if (!state) return;
  if (state.setup) {
    if(GAME.id==='marvel'&&marvelCollectionInputs.length) {
      const selected=new Set(state.setup.collections||['Core']);
      marvelCollectionInputs.forEach(i=>i.checked=selected.has(i.value));filterMarvelSetup();
      $('#marvel-hero-mode').value=state.setup.heroMode||'random';
      marvelHeroInputs.forEach(i=>i.checked=(state.setup.heroKeys||[]).includes(i.value));
    }
    if([...$('#setup-scenario').options].some(o=>o.value===state.setup.scenario))$('#setup-scenario').value=state.setup.scenario;
    $('#setup-players').value = state.setup.players;
    $('#setup-drones').checked = state.setup.expansionDrones;
    if(GAME.id==='marvel'||IS_MODERN) {
      $('#marvel-solo-leads').checked=Boolean(state.setup.soloAlwaysLeads);
      if([...$('#marvel-mastermind').options].some(o=>o.value===state.setup.mastermind))$('#marvel-mastermind').value=state.setup.mastermind;
      $('#marvel-epic').checked=!$('#marvel-epic').disabled&&Boolean(state.setup.epic);
      $('#marvel-solo').value=state.setup.soloMode||'classic';
      if(!$('#marvel-supplies').disabled)$('#marvel-supplies').value=state.setup.supplies||'base';
      if(IS_MODERN) {
        $('#marvel-hero-mode').value=state.setup.heroMode||'random';
        marvelHeroInputs.forEach(i=>i.checked=(state.setup.heroKeys||[]).includes(i.value));
        for(const kind of ['villain','henchmen']) {
          $(`#modern-${kind}-mode`).value=state.setup[kind+'Mode']||'random';
          modernGroupInputs[kind].forEach(i=>i.checked=(state.setup[kind+'Keys']||[]).includes(i.value));
        }
      }
    }
    if(GameSetup.encounters)configureEncountersOptions(state.setup);
    if(IS_COLLECTION && GameSetup.avatars.length && state.setup.avatars)state.setup.avatars.forEach((avatar,i)=>{$('#collection-avatar-'+(i+1)).value=avatar;});
    if (IS_XFILES) {
      document.querySelectorAll('#xf-heroes input').forEach(input => { input.checked = state.setup.heroes.includes(Number(input.value)); });
      state.setup.avatars.forEach((avatar, i) => { $(`#xf-avatar-${i+1}`).value=avatar; });
      state.setup.seasons.forEach((season, i) => { $(`#xf-season-${i+1}`).value=season; });
    }
  }
  if (IS_COMPACT) {
    // Collection setups may reserve seats before anyone joins a room.
    // X-Files still needs a room to advance turns between private hands.
    const minimum=online?.active?Math.max(1,online.room.players.length):1;
    for (const option of $('#setup-players').options) option.disabled = Number(option.value)<minimum || (IS_XFILES&&!online?.active&&Number(option.value)>1);
    if (IS_XFILES&&!online?.active) $('#setup-players').value='1';
    else $('#setup-players').value=String(Math.max(Number($('#setup-players').value)||1,minimum));
  }
  updateSetupSummary();
  $('#setup-error').hidden = true;
  $('#setup').hidden = false;
  $('#setup-scenario').focus();
};
$('#setup-close').onclick = () => { $('#setup').hidden = true; };
$('#setup-players').onchange = updateSetupSummary;
for(const selector of ['#marvel-mastermind','#marvel-epic','#marvel-supplies','#marvel-solo','#marvel-solo-leads'])$(selector).onchange=updateSetupSummary;
$('#setup-scenario').onchange = () => {
  if(GameSetup.encounters)configureEncountersOptions();
  if(IS_COLLECTION && GAME.id==='matrix') {
    const movie=GameSetup.scenarios.find(s=>s.id===$('#setup-scenario').value)?.movie||1;
    const defaults=movie===1?['Neo1','Morpheus1','Trinity1','Switch','Mouse']:['Neo'+movie,'Morpheus2','Trinity2','Niobe','Roland'];
    defaults.forEach((key,i)=>{$('#collection-avatar-'+(i+1)).value=key;});
  }
  updateSetupSummary();
};
$('#setup-form').onsubmit = async e => {
  e.preventDefault();
  const options = { scenario: $('#setup-scenario').value, players: Number($('#setup-players').value), expansionDrones: $('#setup-drones').checked };
  if(IS_MARVEL)options.soloAlwaysLeads=options.players===1&&!$('#marvel-solo-leads').disabled&&Boolean($('#marvel-solo-leads').checked);
  if(GameSetup.encounters)Object.assign(options,encountersOptions(options.players));
  if(GAME.id==='marvel')Object.assign(options,{mastermind:$('#marvel-mastermind').value,collection:'all',
    epic:Boolean($('#marvel-epic').checked),supplies:$('#marvel-supplies').value||'expanded',soloMode:$('#marvel-solo').value||'classic'});
  if(GAME.id==='marvel'&&marvelCollectionInputs.length)Object.assign(options,{collections:selectedMarvelCollections(),
    ...($('#marvel-hero-mode').value==='manual'?{heroKeys:selectedMarvelHeroes()}:{})});
  if(IS_MODERN) {
    Object.assign(options,{mastermind:$('#marvel-mastermind').value,epic:Boolean($('#marvel-epic').checked)});
    if($('#marvel-hero-mode').value==='manual')options.heroKeys=selectedMarvelHeroes();
    for(const kind of ['villain','henchmen'])if($(`#modern-${kind}-mode`).value==='manual')options[kind+'Keys']=modernGroupInputs[kind].filter(i=>i.checked).map(i=>i.value);
  }
  if(IS_COLLECTION && GameSetup.avatars.length)options.avatars=Array.from({length:options.players},(_,i)=>$('#collection-avatar-'+(i+1)).value);
  if (IS_XFILES) Object.assign(options, {
    heroes: [...document.querySelectorAll('#xf-heroes input:checked')].map(input => Number(input.value)),
    avatars: Array.from({length: options.players}, (_, i) => $(`#xf-avatar-${i+1}`).value),
    seasons: [1,2,3].map(n => Number($(`#xf-season-${n}`).value)),
  });
  if (online?.active) {
    $('#setup-submit').disabled = true;
    const result = await onlineAction({ type: 'setup', options });
    $('#setup-submit').disabled = false;
    if (result) { $('#setup').hidden = true; focusZone('playmat'); }
    else { $('#setup-error').textContent = $('#room-error').textContent; $('#setup-error').hidden=false; }
    return;
  }
  try {
    const prepared = GameSetup.create(initial, options);
    if (IS_COMPACT) GameSetup.draw(prepared, prepared.hand, 1, prepared.setup.handSize||6);
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
