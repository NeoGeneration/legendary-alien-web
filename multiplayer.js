'use strict';

window.AlienRooms = class {
  constructor(api, callbacks) {
    this.api = api.replace(/\/$/, '');
    this.callbacks = callbacks;
    this.active = false;
    this.connected = false;
    this.revision = -1;
    this.queue = Promise.resolve();
    addEventListener('online', () => { if (this.active) this.poll(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.active) this.poll(); });
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
    this.callbacks.joining();
    this.code = data.room.code; this.sessionToken = token;
    this.active = true; this.revision = -1;
    localStorage.setItem(this.storageKey(this.code), JSON.stringify({ token, name }));
    localStorage.setItem('lea-room-name', name);
    const url = new URL(location.href); url.hash = `room=${this.code}`; history.replaceState(null, '', url);
    this.receive(data); this.schedule();
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
    this.revision = data.room.revision;
    this.room = data.room;
    this.connection(true);
    this.callbacks.snapshot(data);
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.active) this.timer = setTimeout(() => this.poll(), document.hidden ? 5000 : 900);
  }
  async poll() {
    if (!this.active || this.polling) return;
    this.polling = true;
    const code = this.code;
    try {
      const data = await this.request(`/rooms/${code}?since=${this.revision}`, this.sessionToken);
      if (this.active && this.code === code) this.receive(data);
    } catch (error) {
      if (this.active && this.code === code) {
        this.connection(false);
        if (error.status === 401) this.callbacks.error(error.message);
      }
    } finally { this.polling = false; this.schedule(); }
  }
  action(action) {
    const code = this.code, body = { opId: crypto.randomUUID(), action };
    const run = async () => {
      if (!this.active || this.code !== code) throw new Error('Ya no estás en esa sala.');
      if (!this.connected) throw new Error('Sin conexión. Espera a que la sala se reconecte.');
      let data;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { data = await this.request(`/rooms/${code}/action`, this.sessionToken, body); break; }
        catch (error) {
          if (error.status) { await this.poll(); throw error; }
          if (attempt === 1) { this.connection(false); throw new Error('Conexión interrumpida. La mesa se recuperará al reconectar.'); }
        }
      }
      if (this.active && this.code === code) { this.receive(data); return data; }
    };
    const pending = this.queue.then(run);
    this.queue = pending.catch(() => {});
    return pending;
  }
  search(id) { return this.request(`/rooms/${this.code}/search`, this.sessionToken, { id }); }
  leave() {
    clearTimeout(this.timer);
    const code = this.code, token = this.sessionToken;
    this.active = false; this.connected = false; this.room = null; this.revision = -1;
    this.request(`/rooms/${code}/disconnect`, token, {}).catch(() => {});
    const url = new URL(location.href); url.hash = ''; history.replaceState(null, '', url);
  }
};
