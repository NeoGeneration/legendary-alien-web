'use strict';
const requestedGame = new URL(location.href).searchParams.get('game');
window.AlienGame = Object.hasOwn(LegendarySetup.titles,requestedGame)
  ? { id: requestedGame, title: LegendarySetup.titles[requestedGame], collection: true, data: `games/${requestedGame}/data.json?v=${['matrix','marvel','marvel2','predator','firefly'].includes(requestedGame)?3:2}`, saveKey: `legendary-${requestedGame}-state-v1`, previousKey: `legendary-${requestedGame}-before-import-v1` }
  : requestedGame === 'xfiles'
  ? { id: 'xfiles', title: 'X-FILES', data: 'xfiles/data.json?v=1', saveKey: 'lex-web-state-v1', previousKey: 'lex-web-before-import-v1' }
  : { id: 'alien', title: 'ALIEN', data: 'data.json?v=7', saveKey: 'lea-web-state-v1', previousKey: 'lea-web-before-import-v1' };
document.documentElement.dataset.game = window.AlienGame.id;
document.title = `Legendary Encounters: ${window.AlienGame.title} — Mesa`;
document.querySelector('#game-name').textContent = window.AlienGame.title;
document.querySelector('#access-form h1').textContent = window.AlienGame.title;
document.querySelector('#btn-turn').hidden = false;
if(window.AlienGame.id==='alien') {
  for(const button of document.querySelectorAll('[data-xf-command="gain"], [data-xf-command="conspiracy"]'))button.hidden=true;
  document.querySelector('#turn-note').textContent='Terminar turno descarta tu mano y las cartas de tu zona de juego, roba seis y reinicia Combate y Estrellas. Si se agota tu mazo, baraja el descarte. Los efectos y el avance de la Colmena se resuelven manualmente.';
}
if (window.AlienGame.id === 'xfiles') {
  document.querySelector('[data-zone="complex"]').textContent = 'Sombras';
  document.querySelector('[data-zone="hq"]').textContent = 'Bureau';
  document.querySelector('#setup-drones-label').hidden = true;
  document.querySelector('#setup-players').value = '1';
  document.querySelector('#xfiles-setup').hidden = false;
  document.querySelector('#setup-description').textContent = 'Prepara evidencias, Academia, Bureau boca abajo, conspiración por etapas y agentes. Reparte seis cartas a cada jugador conectado.';
  document.querySelector('#xfiles-help').hidden = false;
}
if (window.AlienGame.collection) {
  const game = window.AlienGame.id;
  document.querySelector('[data-zone="complex"]').textContent = {matrix:'Matrix',bond:'Assignment',marvel:'Ciudad',marvel2:'Ciudad',dc:'Ciudad',predator:'Wilds',firefly:'Verse'}[game];
  document.querySelector('[data-zone="hq"]').textContent = {matrix:'Dock',bond:'Q Branch',marvel:'HQ',marvel2:'HQ',dc:'HQ',predator:'HQ',firefly:'Bridge'}[game];
  document.querySelector('#setup-drones-label').hidden = true;
  document.querySelector('#setup-players').value = '1';
  document.querySelector('#collection-help').hidden = false;
  document.querySelector('#setup-description').textContent = game === 'matrix'
    ? 'Prepara la película, los tres actos, Zion, Dock y los personajes. Reparte seis cartas a cada jugador conectado.'
    : game === 'bond' ? 'Elige una película. Prepara el Mastermind, Scheme, villanos por etapas, Q Branch y los mazos de jugador. Reparte seis cartas a cada jugador conectado.'
    : game === 'marvel' ? 'Filtra por colecciones: Solo Core usa el juego base original. Elige tus héroes o déjalos al azar. Puedes elegir dificultad Epic y solitario clásico o avanzado.'
    : game === 'marvel2' ? 'Segunda Edición: 550 cartas, 9 Schemes y 5 Masterminds, con sus versiones Epic. Elige héroes, villanos y Henchmen o déjalos al azar. Tapete de esta edición y guardado independiente.'
    : game === 'dc' ? 'DC: 500 cartas, 14 héroes, 9 Schemes y 5 Masterminds con versiones Epic. Elige los grupos o déjalos al azar. Tapete propio, contador de Hope/Fear y transformaciones disponibles.'
    : game === 'predator' ? 'Elige humanos o cazadores, película, personajes y variantes. Prepara los tres mazos por etapas, HQ, suministros y los mazos de jugador con su Role.'
    : 'Elige cinco personajes principales y tres episodios. Prepara los cuatro personajes de apoyo, Bridge, suministros y los mazos de jugador con un Talent.';
  document.querySelector('#turn-note').textContent = 'Los efectos, costes y avances de enemigos se resuelven manualmente. Terminar turno descarta la mano y las cartas jugadas, roba seis y reinicia Combate y Estrellas.';
  for (const button of document.querySelectorAll('[data-xf-command="gain"], [data-xf-command="conspiracy"]')) button.hidden = true;
  document.querySelector('#marvel-mastermind-label').hidden = !['marvel','marvel2','dc'].includes(game);
}
