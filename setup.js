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
  const seats=[
    {draw:'0789ec',discard:'23d999',starter:'c42645',counter:'457f60',bounds:[-12,12,-30,-13]},
    {draw:'74fa8f',discard:'4cd4b1',starter:'2ab6c4',counter:'779c2a',bounds:[-43,-18,-31,-13]},
    {draw:'180f3b',discard:'b9bc82',starter:'a52092',counter:'5cb26a',bounds:[18,43,-31,-13]},
    {draw:'e22c84',discard:'92bd05',starter:'ec2dd3',counter:'340cec',bounds:[30,45,-12,18]},
    {draw:'181e72',discard:'fa5702',starter:'11f85b',counter:'de5319',bounds:[-47,-33,-12,23]},
  ];
  const seatZone=(game,seat,zone)=>game.objects.find(o=>o.type==='player-zone'&&o.sourceId===seats[seat-1]?.[zone]);
  function onZone(o,zone) {
    const a=(zone.rot-180)*Math.PI/180,dx=o.x-zone.x,dy=zone.z-o.z;
    return Math.abs(dx*Math.cos(a)+dy*Math.sin(a))<=2.25*zone.scale/2
      && Math.abs(-dx*Math.sin(a)+dy*Math.cos(a))<=3.15*zone.scale/2;
  }
  const stacksAt=(game,zone)=>game.objects.filter(o=>o.type==='stack'&&onZone(o,zone)).sort((a,b)=>(b.z_||0)-(a.z_||0));
  const prune=game=>{game.objects=game.objects.filter(o=>o.type!=='stack'||o.cards.length);};
  function drawPiles(game,seat) {
    const drawZone=seatZone(game,seat,'draw'),discard=seatZone(game,seat,'discard');
    const piles=stacksAt(game,drawZone);
    // The TTS starter decks initially sit beside their Draw markers.
    if(!piles.length) {
      const starter=game.objects.find(o=>o.type==='stack'&&o.sourceId===seats[seat-1].starter&&o.cards.length&&!onZone(o,discard));
      if(starter)piles.push(starter);
    }
    return piles;
  }
  function addPlayerStack(game,cards,p,faceUp,name='Carta en juego') {
    if(!cards.length)return;
    const stack={type:'stack',id:game.nextId++,name,cards,x:p.x,z:p.z,rot:p.rot??180,scale:1.47,faceUp,
      z_:Math.max(0,...game.objects.map(o=>o.z_||0))+1};
    game.objects.push(stack);return stack;
  }
  function draw(game,hand,seat,count,random=Math.random) {
    const drawZone=seatZone(game,seat,'draw'),discard=seatZone(game,seat,'discard');
    if(!drawZone||!discard)throw new Error('No hay mazo y descarte para tu jugador.');
    let drawn=0;
    while(drawn<count) {
      let piles=drawPiles(game,seat);
      if(!piles.length) {
        const cards=stacksAt(game,discard).flatMap(o=>o.cards.splice(0));prune(game);
        if(!cards.length)break;
        for(let i=cards.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[cards[i],cards[j]]=[cards[j],cards[i]];}
        piles=[addPlayerStack(game,cards,drawZone,false,'Mazo de jugador '+seat)];
      }
      hand.push(piles[0].cards.shift());drawn++;prune(game);
    }
    return drawn;
  }
  function inPlayArea(o,game,seat) {
    const [left,right,bottom,top]=seats[seat-1].bounds;
    if(o.type!=='stack'||o.x<=left||o.x>=right||o.z<=bottom||o.z>=top)return false;
    if(o.sourceId===seats[seat-1].starter)return false;
    if(game.objects.some(zone=>zone.type==='player-zone'&&onZone(o,zone)))return false;
    return !drawPiles(game,seat).includes(o);
  }
  function act(game,hand,seat,action,random=Math.random) {
    if(game.gameId&&game.gameId!=='alien')throw new Error('Esta acción pertenece a Alien.');
    if(!game.setup||!Number.isInteger(seat)||seat<1||seat>game.setup.players)throw new Error('Prepara la mesa para tu jugador.');
    const drawZone=seatZone(game,seat,'draw'),discard=seatZone(game,seat,'discard');
    if(!drawZone||!discard)throw new Error('No hay mazo y descarte para tu jugador.');
    if(action.command==='draw') {
      if(![1,6].includes(action.count))throw new Error('Puedes robar una o seis cartas.');
      return 'Robadas '+draw(game,hand,seat,action.count,random);
    }
    if(action.command==='playHand') {
      const [left,right,bottom,top]=seats[seat-1].bounds,side=seat>=4;
      const stepX=side?5:3.7,stepZ=side?3.7:5;
      const positions=[];
      for(let z=top-stepZ/2;z>bottom+stepZ/2;z-=stepZ)for(let x=left+stepX/2;x<right-stepX/2;x+=stepX) {
        const p={type:'stack',x,z,rot:drawZone.rot};
        if(!inPlayArea(p,game,seat))continue;
        if(game.objects.some(o=>['stack','counter'].includes(o.type)&&Math.abs(o.x-x)<stepX*.8&&Math.abs(o.z-z)<stepZ*.8))continue;
        positions.push(p);
      }
      if(positions.length<hand.length)throw new Error('Deja espacio en tu zona de juego para colocar la mano.');
      hand.splice(0).forEach((card,i)=>addPlayerStack(game,[card],positions[i],true));
      return 'Mano jugada';
    }
    if(action.command==='endTurn') {
      const played=game.objects.filter(o=>inPlayArea(o,game,seat));
      const cards=[...hand.splice(0),...played.flatMap(o=>o.cards.splice(0))];prune(game);
      const existing=stacksAt(game,discard).find(o=>o.faceUp);
      if(existing)existing.cards.unshift(...cards);
      else addPlayerStack(game,cards,discard,true,'Descarte de jugador '+seat);
      const n=draw(game,hand,seat,6,random);
      for(const o of game.objects)if(o.type==='counter'&&o.playerId===seats[seat-1].counter&&['combat','stars'].includes(o.resource))o.value=0;
      game.setup.turn=seat%game.setup.players+1;
      return 'Turno terminado · Robadas '+n;
    }
    throw new Error('Acción no válida.');
  }
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
    const game = {
      schemaVersion: 4, objects: objects.filter(o => !removed.has(o.id)), hand: [], nextId,
      setup: { scenario: scenario.id, title: scenario.title, players, turn:1, handSize:6, expansionDrones: Boolean(options.expansionDrones), hiveLayers: layers.map(a => a.length) }
    };
    // Only explicit preparation moves and shuffles starters; old saves are untouched.
    for(let seat=1;seat<=players;seat++) {
      const starter=find('sourceId',seats[seat-1].starter),zone=seatZone(game,seat,'draw');
      Object.assign(starter,{x:zone.x,z:zone.z,rot:zone.rot,faceUp:false,name:'Mazo de jugador '+seat});
      shuffle(starter.cards);
    }
    return game;
  }
  return { scenarios, dronesByPlayers, create,seatZone,draw,act,inPlayArea };
})();
if (typeof module !== 'undefined') module.exports = AlienSetup;
