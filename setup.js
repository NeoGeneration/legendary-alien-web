'use strict';

// Port of the mod's Global Lua setup (Workshop 2035047404, version 3.1.2).
// Deck references, drone counts and coordinates come from that save.
const AlienSetup = (() => {
  const scenarios = [
    { id: 'alien', title: 'Alien', location: 'location-alien', objectives: 'deck.objective-alien',
      stages: ['f8b466', '9ed669', '9ab1a0'], crew: ['dallas', 'lambert', 'wo_ripley', 'parker'],
      crewLabel: 'Dallas, Lambert, W. O. Ripley y Parker' },
    { id: 'aliens', title: 'Aliens', location: 'location-aliens', objectives: 'deck.objective-alien2',
      stages: ['243d87', '5176c1', '3013b0'], crew: ['lt_ripley', 'hudson', 'hicks', 'bishop'],
      crewLabel: 'Lt. Ripley, Hudson, Hicks y Bishop' },
    { id: 'alien3', title: 'Alien 3', location: 'location-alien3', objectives: 'deck.objective-alien3',
      stages: ['a955be', 'f8c208', 'b05d5c'], crew: ['dillon', 'clemons', 'aaron', 'sister_ripley'],
      crewLabel: 'Dillon, Clemons, Aaron y Sister Ripley' },
    { id: 'alien4', title: 'Alien Resurrection', location: 'location-alien4', objectives: 'deck.objective-alien4',
      stages: ['05d39b', 'becc6c', 'f59e06'], crew: ['ripley_8', 'christie', 'johner', 'call'],
      crewLabel: 'Ripley 8, Christie, Johner y Call' },
    { id: 'aviary', title: 'Alien Incursion · The Aviary', location: 'location-aviary', objectives: 'deck.objective-aviary',
      stages: ['3b0998', 'a5c763', 'c3aa3e'], crew: ['brett', 'kane', 'gorman', 'drake'],
      crewLabel: 'Brett, Kane, Gorman y Drake' },
    { id: 'echidna', title: 'Alien Evolved · Echidna Station', location: 'location-echidna', objectives: 'deck.objective-echidna',
      stages: ['2ccf29', '3ea346', 'c78d69'], crew: ['morse', 'andrews', 'elgyn', 'vriess'],
      crewLabel: 'Morse, Andrews, Elgyn y Vriess' },
    { id: 'covenant', title: 'Alien: Covenant', location: 'location-planet4', objectives: 'deck.objective-covenant',
      stages: ['fd5964', 'e5e911', '05b573'], crew: ['daniels', 'walter_1', 'karine', 'oram'],
      crewLabel: 'Daniels, Walter, Karine y Oram' }
  ];
  const dronesByPlayers = [[0, 0, 0], [0, 1, 2], [2, 3, 4], [4, 5, 6], [4, 5, 6]];
  function create(initial, options, random = Math.random) {
    const scenario = scenarios.find(s => s.id === options.scenario);
    const players = Number(options.players);
    if (!scenario || !Number.isInteger(players) || players < 1 || players > 5) throw new Error('Elige un escenario y entre 1 y 5 jugadores.');
    const objects = JSON.parse(JSON.stringify(initial)).map((o, i) => ({ ...o, id: i + 1, z_: i }));
    let nextId = objects.length + 1;
    const removed = new Set();
    const find = (key, value) => {
      const o = objects.find(o => o.type === 'stack' && o[key] === value);
      if (!o) throw new Error(`Falta un mazo del mod: ${value}`);
      return o;
    };
    const byName = name => find('name', name);
    const shuffle = cards => {
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
      return cards;
    };
    const add = (name, cards, x, z, faceUp) => {
      const o = { type: 'stack', id: nextId++, name, cards, x, z, faceUp, rot: 180, scale: 1.42, z_: nextId };
      objects.push(o);
      return o;
    };
    const crew = scenario.crew.map(byName);
    const stages = scenario.stages.map(id => find('sourceId', id));
    const location = byName(scenario.location);
    const objectives = byName(scenario.objectives);
    const drones = byName('deck.drone');
    const expansion = options.expansionDrones ? byName('deck.drone_exp') : null;
    const counts = dronesByPlayers[players - 1];
    if (expansion) {
      drones.cards.push(...expansion.cards);
      removed.add(expansion.id);
    }
    if (drones.cards.length < counts.reduce((a, b) => a + b, 0)) throw new Error('No hay suficientes drones para preparar la colmena.');
    shuffle(drones.cards);
    shuffle(byName('deck.sergeant').cards);
    shuffle(byName('deck.strike').cards);

    const barracks = shuffle(crew.flatMap(o => o.cards));
    crew.forEach(o => removed.add(o.id));
    for (const x of [-14.5, -10.3, -6.1, -1.9, 2.4]) add('HQ', [barracks.shift()], x, -4, true);
    add('Cuartel', barracks, 7.54, -4.39, false);

    // Shuffle each objective's mini-deck separately, then stack 1, 2, 3.
    // Shuffling the completed Hive would mix the three stages of the scenario.
    const layers = stages.map((o, i) => {
      removed.add(o.id);
      return shuffle(o.cards.concat(drones.cards.splice(0, counts[i])));
    });
    add('Colmena', layers.flat(), 7.5, 9.2, false);
    location.x = -19; location.z = 2.5; location.faceUp = true;
    objectives.x = -19.8; objectives.z = 9.2; objectives.faceUp = true;
    // Face-up TTS stacks are serialized from the bottom; objective 1 goes on top.
    objectives.cards.reverse();
    return {
      schemaVersion: 4, objects: objects.filter(o => !removed.has(o.id)), hand: [], nextId,
      setup: { scenario: scenario.id, title: scenario.title, players, expansionDrones: Boolean(options.expansionDrones), hiveLayers: layers.map(a => a.length) }
    };
  }
  return { scenarios, dronesByPlayers, create };
})();
if (typeof module !== 'undefined') module.exports = AlienSetup;
