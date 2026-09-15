'use strict';

window.AlienRooms = class {
  constructor(api, callbacks) {
    this.api = api.replace(/\/$/, '');
    this.callbacks = callbacks;
    this.active = false;
    this.connected = false;
    this.revision = -1;
    this.queue = Promise.resolve();
    this.generation = 0;
    const resume = () => {
      if (!this.active) return;
      if (this.live && Date.now() - this.lastMessage > 45000) { this.socket?.close(); this.stream?.abort(); }
      clearTimeout(this.retryTimer); this.openLive(); this.poll();
    };
    addEventListener('online', resume);
    addEventListener('offline', () => {
      if (this.active) { this.connection(false); this.socket?.close(); this.stream?.abort(); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
  }
  storageKey(code) { return `lea-room-session-v1:${code}`; }
  saved(code) {
    try { return JSON.parse(localStorage.getItem(this.storageKey(code))); } catch { return null; }
  }
  token() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }
  async request(path, token, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(this.api + path, {
        method: body === undefined ? 'GET' : 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'X-App-Session': window.AlienAccess.token(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', credentials: 'omit'
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.code === 'APP_ACCESS_REQUIRED') window.AlienAccess.requireLogin();
        const error = new Error(data.error || 'No se pudo completar la petición.'); error.status = response.status; throw error;
      }
      return data;
    } finally { clearTimeout(timeout); }
  }
  start(data, token, name) {
    this.stopLive();
    this.callbacks.joining();
    this.code = data.room.code; this.sessionToken = token;
    this.active = true; this.revision = -1;
    localStorage.setItem(this.storageKey(this.code), JSON.stringify({ token, name }));
    localStorage.setItem('lea-room-name', name);
    const url = new URL(location.href); url.hash = `room=${this.code}`; history.replaceState(null, '', url);
    this.receive(data); this.schedule(); this.openLive();
    return data;
  }
  async create(name) {
    let token = localStorage.getItem('lea-room-create-token');
    if (!token) { token = this.token(); localStorage.setItem('lea-room-create-token', token); }
    const data = await this.request('/rooms', token, { name });
    const result = this.start(data, token, name);
    localStorage.removeItem('lea-room-create-token');
    return result;
  }
  async join(code, name) {
    code = code.trim().toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new Error('El código de sala tiene 8 letras o números.');
    const saved = this.saved(code), token = saved?.token || this.token();
    // Persist before joining, so a lost response cannot create a second seat.
    localStorage.setItem(this.storageKey(code), JSON.stringify({ token, name }));
    const data = await this.request(`/rooms/${code}/join`, token, { name });
    return this.start(data, token, name);
  }
  connection(connected) {
    if (this.connected !== connected) { this.connected = connected; this.callbacks.connection(connected); }
  }
  receive(data) {
    if (!this.active || data.room.code !== this.code || data.room.revision < this.revision) return;
    // Notifications and action responses can deliver the same state in either order.
    // Still accept player presence updates without rendering that state twice.
    if (data.room.revision === this.revision && data.state) data = { room: data.room };
    this.revision = data.room.revision;
    this.room = data.room;
    this.connection(true);
    this.callbacks.snapshot(data);
  }
  schedule() {
    clearTimeout(this.timer);
    // With a healthy socket this is only a presence heartbeat and recovery check.
    if (this.active) this.timer = setTimeout(() => this.poll(), this.live ? 25000 : (document.hidden ? 5000 : 900));
  }
  stopLive() {
    this.generation++;
    clearTimeout(this.timer); clearTimeout(this.retryTimer); clearTimeout(this.connectTimer);
    clearInterval(this.pingTimer); this.pingTimer = null;
    const socket = this.socket;
    this.stream?.abort(); this.stream = null; this.preferStream = false; this.transport = null;
    this.socket = null; this.live = false; this.opening = false;
    this.polling = false; this.refreshAgain = false; this.retryCount = 0;
    socket?.close();
  }
  retryLive(generation) {
    if (!this.active || generation !== this.generation) return;
    clearTimeout(this.retryTimer);
    const delay = Math.min(30000, 500 * 2 ** Math.min(this.retryCount++, 6)) + Math.random() * 500;
    this.retryTimer = setTimeout(() => this.openLive(), delay);
  }
  async openLive() {
    if (!this.active || this.socket || this.stream || this.opening || !navigator.onLine) return;
    const generation = this.generation, code = this.code;
    this.opening = true;
    try {
      if (this.preferStream) { await this.openStream(generation, code); return; }
      const { ticket } = await this.request(`/rooms/${code}/live-ticket`, this.sessionToken, {});
      if (!this.active || generation !== this.generation) return;
      const url = new URL(`${this.api}/rooms/${code}/events`);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = this.socket = new WebSocket(url, ['alien-v1', `ticket.${ticket}`]);
      const current = () => this.active && generation === this.generation && this.socket === socket;
      this.connectTimer = setTimeout(() => { if (current()) socket.close(); }, 12000);
      socket.onmessage = event => {
        if (!current()) return;
        this.liveMessage(event.data);
        if (this.live && !this.pingTimer) {
          clearTimeout(this.connectTimer);
          this.transport = 'websocket';
          this.pingTimer = setInterval(() => {
            if (!current()) return;
            if (Date.now() - this.lastMessage > 45000) socket.close();
            else if (socket.readyState === WebSocket.OPEN) socket.send('ping');
          }, 20000);
        }
      };
      socket.onclose = () => {
        if (!current()) return;
        clearTimeout(this.connectTimer); clearInterval(this.pingTimer); this.pingTimer = null;
        this.socket = null; this.live = false;
        this.preferStream = true;
        this.schedule(); this.retryLive(generation);
      };
      socket.onerror = () => { if (current()) socket.close(); };
    } catch (error) {
      if (generation === this.generation && error.status !== 401) this.retryLive(generation);
    } finally { if (generation === this.generation) this.opening = false; }
  }
  liveMessage(raw) {
    this.lastMessage = Date.now();
    if (raw === 'pong') return;
    let message; try { message = JSON.parse(raw); } catch { return; }
    if (message.type === 'ready') {
      this.live = true; this.retryCount = 0;
      this.poll();
    } else if (message.type === 'presence' || (message.type === 'changed' && message.revision > this.revision)) this.poll();
  }
  async openStream(generation, code) {
    const controller = this.stream = new AbortController();
    const current = () => this.active && generation === this.generation && this.stream === controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    const end = () => {
      if (!current()) return;
      clearInterval(this.pingTimer); this.pingTimer = null;
      this.stream = null; this.live = false;
      this.schedule(); this.retryLive(generation);
    };
    try {
      const response = await fetch(`${this.api}/rooms/${code}/live-stream`, { signal: controller.signal,
        headers: { Authorization: `Bearer ${this.sessionToken}`, 'X-App-Session': window.AlienAccess.token(), Accept: 'text/event-stream' }, cache: 'no-store', credentials: 'omit' });
      clearTimeout(timeout);
      if (!current()) { controller.abort(); return; }
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
        if (response.status === 401) window.AlienAccess.requireLogin();
        throw new Error('Conexión en directo no disponible.');
      }
      this.transport = 'stream'; this.lastMessage = Date.now();
      this.pingTimer = setInterval(() => { if (current() && Date.now() - this.lastMessage > 45000) controller.abort(); }, 20000);
      const read = async () => {
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '';
        try {
          while (current()) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let end;
            while ((end = buffer.indexOf('\n\n')) >= 0) {
              const message = buffer.slice(0, end); buffer = buffer.slice(end + 2);
              if (current() && message.startsWith('data: ')) this.liveMessage(message.slice(6));
            }
            if (buffer.length > 4096) throw new Error('Evento no válido');
          }
        } finally { await reader.cancel().catch(() => {}); }
      };
      read().catch(() => {}).finally(end);
    } catch { end(); }
    finally { clearTimeout(timeout); }
  }
  async poll() {
    if (!this.active) return;
    if (this.polling) { this.refreshAgain = true; return; }
    this.polling = true;
    const code = this.code, generation = this.generation;
    try {
      const data = await this.request(`/rooms/${code}?since=${this.revision}`, this.sessionToken);
      if (this.active && generation === this.generation) this.receive(data);
    } catch (error) {
      if (this.active && generation === this.generation) {
        this.connection(false);
        if (error.status === 401) this.callbacks.error(error.message);
      }
    } finally {
      if (generation === this.generation) {
        this.polling = false;
        if (this.refreshAgain) { this.refreshAgain = false; this.poll(); }
        else this.schedule();
      }
    }
  }
  action(action) {
    const code = this.code, generation = this.generation, body = { opId: crypto.randomUUID(), action };
    const run = async () => {
      if (!this.active || generation !== this.generation) throw new Error('Ya no estás en esa sala.');
      if (!this.connected) throw new Error('Sin conexión. Espera a que la sala se reconecte.');
      let data;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { data = await this.request(`/rooms/${code}/action`, this.sessionToken, body); break; }
        catch (error) {
          if (error.status) { await this.poll(); throw error; }
          if (attempt === 1) { this.connection(false); throw new Error('Conexión interrumpida. La mesa se recuperará al reconectar.'); }
        }
      }
      if (this.active && generation === this.generation) { this.receive(data); return data; }
    };
    const pending = this.queue.then(run);
    this.queue = pending.catch(() => {});
    return pending;
  }
  search(id) { return this.request(`/rooms/${this.code}/search`, this.sessionToken, { id }); }
  leave() {
    this.stopLive();
    const code = this.code, token = this.sessionToken;
    this.active = false; this.connected = false; this.room = null; this.revision = -1;
    this.request(`/rooms/${code}/disconnect`, token, {}).catch(() => {});
    const url = new URL(location.href); url.hash = ''; history.replaceState(null, '', url);
  }
};
