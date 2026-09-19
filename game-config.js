'use strict';
const requestedGame = new URL(location.href).searchParams.get('game');
window.AlienGame = Object.hasOwn(LegendarySetup.titles,requestedGame)
  ? { id: requestedGame, title: LegendarySetup.titles[requestedGame], collection: true, data: `games/${requestedGame}/data.json?v=${requestedGame==='matrix'?3:2}`, saveKey: `legendary-${requestedGame}-state-v1`, previousKey: `legendary-${requestedGame}-before-import-v1` }
  : requestedGame === 'xfiles'
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
if (window.AlienGame.collection) {
  const game = window.AlienGame.id;
  document.querySelector('[data-zone="complex"]').textContent = {matrix:'Matrix',bond:'Assignment',marvel:'Ciudad',predator:'Wilds',firefly:'Verse'}[game];
  document.querySelector('[data-zone="hq"]').textContent = {matrix:'Dock',bond:'Q Branch',marvel:'HQ',predator:'HQ',firefly:'Bridge'}[game];
  document.querySelector('#setup-drones-label').hidden = true;
  document.querySelector('#setup-players').value = '1';
  document.querySelector('#btn-turn').hidden = false;
  document.querySelector('#collection-help').hidden = false;
  document.querySelector('#setup-description').textContent = game === 'matrix'
    ? 'Prepara la película, los tres actos, Zion, Dock y los personajes. Reparte seis cartas a cada jugador conectado.'
    : game === 'bond' ? 'Elige una película. Prepara el Mastermind, Scheme, villanos por etapas, Q Branch y los mazos de jugador. Reparte seis cartas a cada jugador conectado.'
    : game === 'marvel' ? 'Prepara los ocho Schemes y cuatro Masterminds del juego base original, con héroes y enemigos según los jugadores. Solitario clásico. Las expansiones siguen disponibles en Reserva.'
    : 'Abre la mesa y usa Reserva para traer los mazos del juego y sus expansiones. Sigue el reglamento para preparar el escenario.';
  document.querySelector('#turn-note').textContent = 'Los efectos, costes y avances de enemigos se resuelven manualmente. Terminar turno descarta la mano y las cartas jugadas, roba seis y reinicia Combate y Estrellas.';
  for (const button of document.querySelectorAll('[data-xf-command="gain"], [data-xf-command="conspiracy"]')) button.hidden = true;
  document.querySelector('#marvel-mastermind-label').hidden = game !== 'marvel';
}
