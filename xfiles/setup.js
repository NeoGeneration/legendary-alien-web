'use strict';

// Workshop 3245264516: StartGame, SetupBureau, BuildSeason and player actions.
const XFilesSetup = (() => {
  let layout;
  function configure(data) {
    const mat = data.objects.find(o => o.type === 'playmat');
    // Centers measured on the replacement 3200 × 1421 playmat. Keep the
    // original TTS zones for games prepared before this calibration.
    const point = (x, y) => ({ x: mat.x + (x / 3200 - .5) * mat.width, z: mat.z + (.5 - y / 1421) * mat.height });
    const boardZones = {
      Evidence1: point(610, 280), Evidence2: point(610, 715), Evidence3: point(610, 1145),
      BeliefStack: point(950, 280), DoubtStack: point(950, 715), SpecialAgents: point(950, 1145),
      ConspiracyDeck: point(2695, 280), Strikes: point(2695, 715), Academy: point(2695, 1145),
      DefeatedEnemies: point(2998, 280), DiscardedStrikes: point(2998, 715), DefeatedHeroes: point(2998, 1145),
    };
    for (let i = 1; i <= 5; i++) {
      boardZones['Shadows' + i] = point(1110 + (i - .5) * (2518 - 1110) / 5, 280);
      boardZones['Bureau' + i] = point(1114 + (i - .5) * (2521 - 1114) / 5, 1125);
    }
    for (let i = 1; i <= 6; i++) boardZones['CombatZone' + i] = point(1114 + (i - .5) * (2521 - 1114) / 6, 719);
    layout = { zones: data.zones, colors: data.colors, boardZones };
  }
  const scenarios = [
    { id: 'seasons-1-3', title: 'Temporadas 1–3', seasons: [1, 2, 3] },
    { id: 'seasons-4-6', title: 'Temporadas 4–6', seasons: [4, 5, 6] },
    { id: 'seasons-7-9', title: 'Temporadas 7–9', seasons: [7, 8, 9] },
    { id: 'custom', title: 'Combinar temporadas', seasons: [1, 2, 3] },
  ];
  const heroes = ['Sean Pendrell', 'The Lone Gunmen', 'Walter Skinner', 'Fox Mulder', 'John Doggett', 'Monica Reyes', 'Brad Follmer', 'Charles Burks', 'Dana Scully'];
  const avatars = [
    { id: 'aFox', name: 'Fox Mulder' }, { id: 'aDana', name: 'Dana Scully' },
    { id: 'aWalter', name: 'Walter Skinner' }, { id: 'aDoggett', name: 'John Doggett' }, { id: 'aMonica', name: 'Monica Reyes' },
  ];
  const firstTurn = (selected, seats = selected.map((_,i)=>i+1)) => {
    const priority = ['aWalter','aFox','aDana','aDoggett','aMonica'];
    return [...seats].sort((a,b)=>priority.indexOf(selected[a-1])-priority.indexOf(selected[b-1]))[0];
  };
  const copy = value => JSON.parse(JSON.stringify(value));
  function shuffle(cards, random = Math.random) {
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    return cards;
  }
  const position = (name, game) => (game?.setup?.boardLayout === 2 && layout.boardZones[name]) || layout.zones[name];
  const seatZone = (game, seat, zone) => game.objects.find(o => o.type === 'player-zone' && o.playerId === seat && o.zone === zone);
  const inPlayArea = (object, area) => area && object.type === 'stack'
    && Math.abs(object.x-area.x)<area.width/2 && Math.abs(object.z-area.z)<area.height/2;
  function compactPlayers(game) {
    if (game.gameId !== 'xfiles' || game.playerLayout === 2) return false;
    const plans = [];
    for (let seat = 1; seat <= 5; seat++) {
      const area = seatZone(game, seat, 'play');
      if (!area) continue;
      const x = [0, -22, 22, -44, 44][seat-1];
      const play = { x, z: -21, width: 16, height: 11 };
      const bases = ['strikes', 'draw', 'avatar', 'discard'].map((zone, i) => {
        const object = seatZone(game, seat, zone);
        return object && { object, old: { ...object }, next: { x: x-6+i*4, z: -10 } };
      }).filter(Boolean);
      plans.push({ seat, area, old: { ...area }, play, bases, x });
    }
    // Move cards with their bases and translate played cards once. Preserve
    // every card, order, ID, orientation, counter value and private hand.
    for (const object of game.objects.filter(o => o.type === 'stack')) {
      let moved = false;
      for (const plan of plans) {
        const base = plan.bases.find(b => Math.abs(object.x-b.old.x) <= 2.25*b.old.scale/2
          && Math.abs(object.z-b.old.z) <= 3.15*b.old.scale/2);
        if (base) {
          object.x += base.next.x-base.old.x; object.z += base.next.z-base.old.z;
          moved = true; break;
        }
      }
      if (moved) continue;
      const plan = plans.find(p => inPlayArea(object, p.old));
      if (plan) { object.x += plan.play.x-plan.old.x; object.z += plan.play.z-plan.old.z; }
    }
    for (const plan of plans) {
      for (const base of plan.bases) Object.assign(base.object, base.next);
      Object.assign(plan.area, plan.play);
      for (const object of game.objects.filter(o => o.type === 'counter' && o.playerId === plan.seat)) {
        const z = { stars: -7, combat: -10, strikes: -13 }[object.resource];
        if (z !== undefined) Object.assign(object, { x: plan.x-10, z });
      }
    }
    game.playerLayout = 2;
    return true;
  }
  const at = (game, p) => game.objects.filter(o => o.type === 'stack' && Math.abs(o.x - p.x) < 1.1 && Math.abs(o.z - p.z) < 1.5).sort((a, b) => (b.z_ || 0) - (a.z_ || 0));
  const removeEmpty = game => { game.objects = game.objects.filter(o => o.type !== 'stack' || o.cards.length); };
  function add(game, name, cards, p, faceUp = true) {
    if (!cards.length) return null;
    const id = game.nextId++;
    const object = { type: 'stack', id, name, cards, x: p.x, z: p.z, faceUp, scale: 1.12, rot: 180,
      z_: Math.max(0, ...game.objects.map(o => o.z_ || 0)) + 1 };
    game.objects.push(object); return object;
  }
  function put(game, cards, p, name, faceUp = true, bottom = false) {
    if (!cards.length) return;
    let target = at(game, p).find(o => o.faceUp === faceUp);
    if (!target) target = add(game, name, [], p, faceUp) || add(game, name, cards.splice(0), p, faceUp);
    else if (bottom) target.cards.push(...cards.splice(0));
    else target.cards.unshift(...cards.splice(0));
    return target;
  }
  function take(game, p, count = 1) {
    const cards = [];
    for (const stack of at(game, p)) {
      cards.push(...stack.cards.splice(0, count - cards.length));
      if (cards.length === count) break;
    }
    removeEmpty(game); return cards;
  }
  function draw(game, hand, seat, count, random = Math.random) {
    const drawZone = seatZone(game, seat, 'draw'), discard = seatZone(game, seat, 'discard');
    if (!drawZone || !discard) throw new Error('Prepara la mesa para tu jugador antes de robar.');
    let drawn = 0;
    while (drawn < count) {
      if (!at(game, drawZone).length) {
        const cards = take(game, discard, 10000);
        if (!cards.length) break;
        add(game, 'Mazo de jugador ' + seat, shuffle(cards, random), drawZone, false);
      }
      const cards = take(game, drawZone);
      if (!cards.length) break;
      hand.push(...cards); drawn++;
    }
    return drawn;
  }
  function create(initial, options, random = Math.random) {
    const scenario = scenarios.find(s => s.id === options.scenario), players = Number(options.players);
    if (!scenario || !Number.isInteger(players) || players < 1 || players > 5) throw new Error('Elige las temporadas y entre 1 y 5 jugadores.');
    const seasons = scenario.id === 'custom' ? options.seasons : scenario.seasons;
    if (!Array.isArray(seasons) || seasons.length !== 3 || seasons.some((n, i) => ![i+1, i+4, i+7].includes(n))) throw new Error('Elige una temporada para cada etapa: 1/4/7, 2/5/8 y 3/6/9.');
    const selectedHeroes = options.heroes ?? shuffle([1,2,3,4,5,6,7,8,9], random).slice(0, 4);
    if (!Array.isArray(selectedHeroes) || selectedHeroes.length !== 4 || new Set(selectedHeroes).size !== 4 || selectedHeroes.some(n => !Number.isInteger(n) || n < 1 || n > 9)) throw new Error('Selecciona exactamente cuatro personajes para la Academia.');
    const selectedAvatars = (options.avatars || avatars.map(a => a.id)).slice(0, players);
    if (selectedAvatars.length !== players || new Set(selectedAvatars).size !== players || selectedAvatars.some(id => !avatars.some(a => a.id === id))) throw new Error('Cada jugador necesita un agente diferente.');
    const objects = copy(initial).map((o, i) => ({ ...o, id: i+1, z_: i }));
    const game = { gameId: 'xfiles', schemaVersion: 4, objects, hand: [], nextId: objects.length+1,
      setup: { scenario: scenario.id, title: scenario.id === 'custom' ? `Temporadas ${seasons.join(' / ')}` : scenario.title,
        players, seasons: [...seasons], heroes: [...selectedHeroes], avatars: selectedAvatars, turn: 1, conspiracySize: 5, boardLayout: 2 } };
    compactPlayers(game);
    const find = name => {
      const stack = objects.find(o => (o.key || o.name) === name && o.type === 'stack');
      if (!stack) throw new Error('Falta un mazo de X-Files: ' + name);
      return stack;
    };
    for (const [key, zone] of Object.entries({ Belief: 'BeliefStack', Doubt: 'DoubtStack', StrikesDeck: 'Strikes', SpecialAgentDeck: 'SpecialAgents' })) {
      Object.assign(find(key), position(zone, game));
    }
    for (const key of ['Evidence1Deck','Evidence2Deck','Evidence3Deck','Informant','Lead','SyndaciteEnemy','EndGame','Cliffhanger','StrikesDeck','SpecialAgentDeck']) shuffle(find(key).cards, random);
    const academy = selectedHeroes.flatMap(n => find('Market'+n).cards.splice(0));
    academy.push(...find('SyndaciteEnemy').cards.splice(0, 6));
    shuffle(academy, random);
    for (let i=1; i<=5; i++) add(game, 'Bureau ' + i, academy.splice(0, 1), position('Bureau'+i, game), false);
    add(game, 'Academia', academy, position('Academy', game), false);
    const layers = seasons.map(n => {
      const cards = shuffle(find('Season'+n).cards, random).splice(0, players+6);
      cards.push(...find('Informant').cards.splice(0, 1), ...find('Lead').cards.splice(0, 1));
      return shuffle(cards, random);
    });
    game.setup.conspiracyLayers = layers.map(cards => cards.length);
    add(game, 'Conspiración', [...layers.flat(), ...find('EndGame').cards.splice(0, 1)], position('ConspiracyDeck', game), false);
    for (let i=1; i<=3; i++) add(game, 'Evidencia · Prioridad '+i, find('Evidence'+i+'Deck').cards.splice(0, 1), position('Evidence'+i, game), true);
    for (let seat=1; seat<=5; seat++) {
      const stack = find(layout.colors[seat-1]+'StartingDeck');
      if (seat <= players) {
        const drawZone = seatZone(game, seat, 'draw');
        Object.assign(stack, { x: drawZone.x, z: drawZone.z, name: 'Mazo de jugador '+seat, faceUp: false });
        shuffle(stack.cards, random);
        const avatar = find(selectedAvatars[seat-1]);
        const avatarZone = seatZone(game, seat, 'avatar');
        Object.assign(avatar, { x: avatarZone.x, z: avatarZone.z, faceUp: true });
      } else Object.assign(stack, { x: -12+(seat-1)*6, z: 21, name: 'Mazo inicial de reserva' });
    }
    game.objects = game.objects.filter(o => !o.playerId || o.playerId <= players);
    // Skinner, Mulder, Scully, Doggett, Reyes is the mod's initial turn priority.
    game.setup.turn = firstTurn(selectedAvatars);
    removeEmpty(game);
    return game;
  }
  function act(game, hand, seat, action, random = Math.random) {
    if (game.gameId !== 'xfiles' || !game.setup || seat < 1 || seat > game.setup.players) throw new Error('Prepara una partida de X-Files para tu jugador.');
    const discard = seatZone(game, seat, 'discard');
    switch (action.command) {
      case 'draw': {
        if (![1,6].includes(action.count)) throw new Error('Puedes robar una o seis cartas.');
        return `Robadas ${draw(game, hand, seat, action.count, random)}`;
      }
      case 'playHand': {
        const center = seatZone(game, seat, 'play');
        let slot=0;
        for (const card of hand.splice(0)) {
          let p;
          do { p = { x: center.x-5.7+(slot%5)*2.85, z: center.z+3.6-Math.floor(slot/5)*3.6 }; slot++; } while (at(game,p).length && slot < 15);
          add(game, 'Carta en juego', [card], p);
        }
        return 'Mano jugada';
      }
      case 'endTurn': {
        if (game.setup.turn !== seat) throw new Error('Ahora es el turno del jugador '+game.setup.turn+'.');
        const area = seatZone(game, seat, 'play');
        const played = game.objects.filter(o => inPlayArea(o, area));
        const cards = [...hand.splice(0), ...played.flatMap(o => o.cards.splice(0))];
        removeEmpty(game); put(game, cards, discard, 'Descarte de jugador '+seat);
        const count = draw(game, hand, seat, 6, random);
        for (const o of game.objects) if (o.type==='counter' && o.playerId===seat && ['combat','stars'].includes(o.resource)) o.value=0;
        game.setup.turn = seat % game.setup.players + 1;
        return `Turno terminado · Robadas ${count} · Turno del jugador ${game.setup.turn}`;
      }
      case 'gain': {
        const names = { belief: 'BeliefStack', doubt: 'DoubtStack', strike: 'Strikes', agent: 'SpecialAgents' };
        if (!names[action.resource]) throw new Error('Reserva no válida.');
        const cards = take(game, position(names[action.resource], game));
        if (!cards.length) throw new Error('Esa reserva está vacía.');
        put(game, cards, action.resource==='strike' ? seatZone(game,seat,'strikes') : discard, action.resource==='strike' ? 'Heridas' : 'Descarte');
        return 'Carta recibida · Resuelve su efecto';
      }
      case 'bureau': {
        if (!Number.isInteger(action.slot) || action.slot<1 || action.slot>5) throw new Error('Espacio del Bureau no válido.');
        const p=position('Bureau'+action.slot, game), stack=at(game,p)[0];
        if (action.mode==='scan') {
          if (!stack) throw new Error('Ese espacio está vacío.');
          if (stack.faceUp) throw new Error('Esa carta ya está revelada.');
          stack.faceUp=true; return 'Carta revelada · Aplica el coste de escaneo';
        }
        if (!['recruit','top','bottom','refill'].includes(action.mode)) throw new Error('Acción del Bureau no válida.');
        if (action.mode!=='refill') {
          if (!stack?.faceUp) throw new Error('Revela primero la carta del Bureau.');
          if (action.mode==='top' && action.slot!==1 || action.mode==='bottom' && action.slot!==2) throw new Error('Ese beneficio corresponde a otro espacio.');
          const cards=take(game,p), toDeck=['top','bottom'].includes(action.mode);
          put(game,cards,toDeck?seatZone(game,seat,'draw'):discard,toDeck?'Mazo de jugador '+seat:'Descarte',!toDeck,action.mode==='bottom');
        } else if (stack) throw new Error('Ese espacio ya tiene una carta.');
        add(game,'Bureau '+action.slot,take(game,position('Academy', game)),p,false);
        return 'Bureau actualizado · Resuelve el coste y el beneficio de la carta';
      }
      case 'conspiracy': {
        const size=game.setup.conspiracySize || 5;
        let empty=0;
        for (let i=size;i>=1;i--) if (!at(game,position('Shadows'+i, game)).length) { empty=i; break; }
        if (!empty) {
          const first=at(game,position('Shadows1', game))[0];
          let combat=1; while(combat<6 && at(game,position('CombatZone'+combat, game)).length) combat++;
          if (!first.faceUp) first.cards.reverse();
          Object.assign(first,position('CombatZone'+combat, game),{faceUp:true}); empty=1;
        }
        for (let i=empty+1;i<=size;i++) for (const stack of at(game,position('Shadows'+i, game))) Object.assign(stack,position('Shadows'+(i-1), game));
        const cards=take(game,position('ConspiracyDeck', game));
        if (cards.length) add(game,'Sombras',[...cards],position('Shadows'+size, game),false);
        else game.setup.conspiracySize=Math.max(1,size-1);
        return 'Conspiración avanzada · Resuelve las cartas y sus efectos';
      }
      default: throw new Error('Acción de X-Files no reconocida.');
    }
  }
  const bureauSlot = (object, game) => [1,2,3,4,5].find(n => Math.abs(object.x-position('Bureau'+n, game).x)<1.1 && Math.abs(object.z-position('Bureau'+n, game).z)<1.5);
  return { configure, scenarios, heroes, avatars, create, draw, act, seatZone, bureauSlot, firstTurn, compactPlayers, inPlayArea };
})();
if (typeof module !== 'undefined') module.exports = XFilesSetup;
