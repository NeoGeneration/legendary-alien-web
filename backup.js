'use strict';

const AlienBackup = (() => {
  const format = 'legendary-alien-backup';
  const maxBytes = 5 * 1024 * 1024;
  const types = new Set(['stack', 'playmat', 'board', 'tile', 'player-zone', 'text', 'token', 'bag', 'counter']);
  const image = value => typeof value === 'string'
    && /^(cards|assets)\/[\w/.-]+\.(png|jpe?g|webp)$/i.test(value) && !value.split('/').includes('..');
  const card = value => value && image(value.face) && image(value.back);
  const finite = (object, keys) => keys.every(key => Number.isFinite(object[key]));
  function validate(backup) {
    const invalid = () => { throw new Error('El archivo no es una copia válida de Legendary Alien. Tu partida no se ha cambiado.'); };
    if (!backup || backup.format !== format || backup.version !== 1) invalid();
    if (backup.kind === 'room') {
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(backup.room?.code || '') || !/^[a-f0-9]{64}$/.test(backup.room?.token || '')) invalid();
    } else if (backup.kind === 'solo') {
      const game = backup.state;
      if (!game || game.schemaVersion !== 4 || !Array.isArray(game.objects) || game.objects.length > 1600
        || !Array.isArray(game.hand) || game.hand.length > 10000 || !game.hand.every(card)
        || !Number.isSafeInteger(game.nextId) || game.nextId < 1) invalid();
      const ids = new Set();
      for (const object of game.objects) {
        if (!object || !types.has(object.type) || !Number.isSafeInteger(object.id) || object.id < 1
          || ids.has(object.id) || object.id >= game.nextId || !finite(object, ['x', 'z', 'rot', 'scale']) || object.scale <= 0) invalid();
        ids.add(object.id);
        if (object.type === 'stack' && (!Array.isArray(object.cards) || !object.cards.length || object.cards.length > 10000 || !object.cards.every(card))) invalid();
        if (['board', 'tile', 'playmat', 'player-zone'].includes(object.type) && !image(object.img)) invalid();
        if (object.type === 'playmat' && (!finite(object, ['width', 'height']) || object.width <= 0 || object.height <= 0)) invalid();
        if (object.type === 'board' && (!Number.isFinite(object.widthScale) || object.widthScale <= 0)) invalid();
        if (object.textureBounds && (!Array.isArray(object.textureBounds) || object.textureBounds.length !== 4 || !object.textureBounds.every(Number.isFinite))) invalid();
        if (['bag', 'token'].includes(object.type) && (!Array.isArray(object.color) || object.color.length < 3 || !object.color.every(Number.isFinite))) invalid();
        if (object.type === 'counter' && !Number.isFinite(object.value)) invalid();
        if (object.type === 'text' && (typeof object.text !== 'string' || !Number.isFinite(object.fontSize))) invalid();
      }
    } else invalid();
    return backup;
  }
  function create(state, room = null) {
    return validate(JSON.parse(JSON.stringify({ format, version: 1, createdAt: new Date().toISOString(),
      ...(room ? { kind: 'room', room: { code: room.code, token: room.sessionToken } } : { kind: 'solo', state })
    })));
  }
  function parse(text) {
    if (text.length > maxBytes) throw new Error('La copia es demasiado grande. Tu partida no se ha cambiado.');
    let backup;
    try { backup = JSON.parse(text); } catch { throw new Error('No se puede leer esa copia. Tu partida no se ha cambiado.'); }
    return validate(backup);
  }
  return { create, parse, maxBytes };
})();
if (typeof module !== 'undefined') module.exports = AlienBackup;
