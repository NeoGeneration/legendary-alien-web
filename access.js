'use strict';

window.AlienAccess = (() => {
  const key = 'lea-app-access-v1';
  const gate = document.querySelector('#app-access');
  const form = document.querySelector('#access-form');
  const input = document.querySelector('#access-password');
  const button = document.querySelector('#access-submit');
  const error = document.querySelector('#access-error');
  let session = null, started = false, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  try { session = JSON.parse(localStorage.getItem(key)); } catch {}
  const token = () => session?.expires > Date.now() ? session.token : '';
  function message(value) { error.textContent = value; error.hidden = !value; }
  function requireLogin() {
    session = null;
    try { localStorage.removeItem(key); } catch {}
    if (document.body.classList.contains('access-locked')) return;
    document.body.classList.add('access-locked'); gate.hidden = false;
    message('Introduce la contraseña para volver a entrar.'); input.focus();
  }
  function unlock() {
    gate.hidden = true; document.body.classList.remove('access-locked');
    input.value = ''; input.blur(); message('');
    if (started) location.reload();
    else { started = true; resolveReady(); }
  }
  async function request(password) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(window.ALIEN_ROOM_API + '/access', {
        method: password === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit', signal: controller.signal,
        headers: password === undefined ? { 'X-App-Session': token() } : { 'Content-Type': 'application/json' },
        ...(password === undefined ? {} : { body: JSON.stringify({ password }) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'El servidor de acceso no está disponible. Vuelve a intentarlo.');
      return data;
    } finally { clearTimeout(timeout); }
  }
  form.onsubmit = async event => {
    event.preventDefault(); message(''); button.disabled = true; button.textContent = 'Entrando…';
    try {
      session = await request(input.value);
      try { localStorage.setItem(key, JSON.stringify(session)); } catch {}
      unlock();
    } catch (err) {
      message(['TypeError', 'AbortError'].includes(err.name) ? 'No se pudo conectar. Comprueba tu conexión y vuelve a intentarlo.' : err.message);
      input.focus(); input.select();
    } finally { button.disabled = false; button.textContent = 'Entrar'; }
  };
  document.querySelector('#btn-lock').onclick = async () => {
    button.disabled = true;
    // Complete any already submitted move before locking and preserving the room URL.
    if (typeof online !== 'undefined' && online?.active) await online.queue;
    session = null; try { localStorage.removeItem(key); } catch {}
    location.reload();
  };
  if (token()) {
    button.disabled = true;
    request().then(unlock).catch(() => { requireLogin(); }).finally(() => { button.disabled = false; });
  }
  return { ready, token, requireLogin };
})();
