'use strict';
window.AlienGame = new URL(location.href).searchParams.get('game') === 'xfiles'
  ? { id: 'xfiles', title: 'X-FILES', data: 'xfiles/data.json?v=1', saveKey: 'lex-web-state-v1', previousKey: 'lex-web-before-import-v1' }
  : { id: 'alien', title: 'ALIEN', data: 'data.json?v=7', saveKey: 'lea-web-state-v1', previousKey: 'lea-web-before-import-v1' };
document.documentElement.dataset.game = window.AlienGame.id;
document.title = `Legendary Encounters: ${window.AlienGame.title} — Mesa`;
document.querySelector('#game-name').textContent = window.AlienGame.title;
document.querySelector('#access-form h1').textContent = window.AlienGame.title;
if (window.AlienGame.id === 'xfiles') {
  document.querySelector('[data-zone="complex"]').textContent = 'Sombras';
  document.querySelector('[data-zone="hq"]').textContent = 'Bureau';
  document.querySelector('#setup-drones-label').hidden = true;
  document.querySelector('#setup-players').value = '1';
  document.querySelector('#xfiles-setup').hidden = false;
  document.querySelector('#btn-turn').hidden = false;
  document.querySelector('#setup-description').textContent = 'Prepara evidencias, Academia, Bureau boca abajo, conspiración por etapas y agentes. Reparte seis cartas a cada jugador conectado.';
  document.querySelector('#xfiles-help').hidden = false;
}
