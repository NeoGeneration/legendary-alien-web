'use strict';

// Shared table tools plus the setup port from Workshop 3232976645 (Matrix).
// The other mods retain a manual library so their cards and expansion rules
// remain usable without pretending to automate their individual effects.
const LegendarySetup = (() => {
  const titles = { matrix: 'THE MATRIX', bond: 'JAMES BOND', marvel: 'MARVEL LEGENDARY', predator: 'PREDATOR', firefly: 'FIREFLY' };
  const engines = new Map();
  const copy = value => JSON.parse(JSON.stringify(value));
  function shuffle(cards, random = Math.random) {
    for (let i=cards.length-1; i>0; i--) { const j=Math.floor(random()*(i+1)); [cards[i],cards[j]]=[cards[j],cards[i]]; }
    return cards;
  }
  function forGame(id) {
    if (!Object.hasOwn(titles,id)) throw new Error('Juego no válido.');
    if (engines.has(id)) return engines.get(id);
    let data;
    const scenarios = id === 'matrix' ? [
      {id:'matrix-1',title:'The Matrix',movie:1},
      {id:'matrix-2',title:'The Matrix Reloaded',movie:2},
      {id:'matrix-3',title:'The Matrix Revolutions',movie:3},
    ] : [{id:'manual',title:'Mesa libre · preparación manual'}];
    const avatars = id === 'matrix' ? [
      ['Neo1','Neo · The Matrix'],['Neo2','Neo · Reloaded'],['Neo3','Neo · Revolutions'],
      ['Morpheus1','Morpheus · The Matrix'],['Morpheus2','Morpheus · Reloaded / Revolutions'],
      ['Trinity1','Trinity · The Matrix'],['Trinity2','Trinity · Reloaded / Revolutions'],
      ['Switch','Switch'],['Niobe','Niobe'],['Soren','Soren'],['Apoc','Apoc'],['Mouse','Mouse'],['Roland','Roland'],
    ].map(([id,name])=>({id,name})) : [];
    const configure = source => { if (source.gameId !== id) throw new Error('Colección incorrecta.'); data=source; };
    const catalog = () => data.objects.filter(o=>o.type==='stack');
    const seatZone = (game,seat,zone) => game.objects.find(o=>o.type==='player-zone'&&o.playerId===seat&&o.zone===zone);
    const inPlayArea = (o,area) => area && o.type==='stack' && Math.abs(o.x-area.x)<area.width/2 && Math.abs(o.z-area.z)<area.height/2;
    function newGame(players=5) {
      const objects=copy(data.objects.filter(o=>!o.catalogOnly && (!o.playerId || o.playerId<=players)))
        .map((o,i)=>({...o,id:i+1,z_:i}));
      return {gameId:id,schemaVersion:4,objects,hand:[],nextId:objects.length+1,libraryTaken:[]};
    }
    function add(game,name,cards,p,faceUp=false,extras={}) {
      if (!cards.length) return null;
      const o={type:'stack',id:game.nextId++,name,cards,x:p.x,z:p.z,rot:180,scale:1.12,faceUp,
        z_:Math.max(0,...game.objects.map(o=>o.z_||0))+1,...extras};
      game.objects.push(o); return o;
    }
    function bring(game,key,p) {
      if (game.gameId!==id) throw new Error('Colección incorrecta.');
      const source=catalog().find(o=>o.key===key);
      if (!source) throw new Error('No se encuentra ese mazo en la colección.');
      game.libraryTaken ||= [];
      if (game.libraryTaken.includes(key)) throw new Error('Ese mazo ya está en la mesa. Usa la búsqueda de Reserva para localizarlo.');
      const current=game.objects.flatMap(o=>o.cards||[]).length+game.hand.length;
      if (current+source.cards.length>4000) throw new Error('La mesa está llena. Retira mazos que ya no necesites antes de añadir más.');
      const n=game.libraryTaken.length;
      game.libraryTaken.push(key);
      return add(game,source.name,copy(source.cards),p||{x:-22+(n%11)*4.5,z:24+Math.floor(n/11)*5},source.faceUp,
        {key,group:source.group,sourceId:source.sourceId,scale:source.scale||1.12});
    }
    const stacksAt=(game,p)=>game.objects.filter(o=>o.type==='stack'&&Math.abs(o.x-p.x)<1.1&&Math.abs(o.z-p.z)<1.5).sort((a,b)=>(b.z_||0)-(a.z_||0));
    const prune=game=>{ game.objects=game.objects.filter(o=>o.type!=='stack'||o.cards.length); };
    function draw(game,hand,seat,count,random=Math.random) {
      const p=seatZone(game,seat,'draw'),discard=seatZone(game,seat,'discard');
      if (!p || !discard) throw new Error('No hay zona para ese jugador.');
      let drawn=0;
      while(drawn<count) {
        let decks=stacksAt(game,p);
        if (!decks.length) {
          const cards=stacksAt(game,discard).flatMap(o=>o.cards.splice(0)); prune(game);
          if (!cards.length) break;
          add(game,'Mazo de jugador '+seat,shuffle(cards,random),p); decks=stacksAt(game,p);
        }
        const top=decks[0]; hand.push(top.cards.shift()); drawn++; prune(game);
      }
      return drawn;
    }
    function create(initial,options,random=Math.random) {
      const scenario=scenarios.find(s=>s.id===options.scenario), players=Number(options.players);
      if (!scenario || !Number.isInteger(players)||players<1||players>5) throw new Error('Elige una preparación y entre uno y cinco jugadores.');
      const game=newGame(players);
      game.setup={scenario:scenario.id,title:scenario.title,players,turn:1};
      if (id!=='matrix') return game;
      const movie=scenario.movie;
      const defaults=movie===1?['Neo1','Morpheus1','Trinity1','Switch','Mouse']:['Neo'+movie,'Morpheus2','Trinity2','Niobe','Roland'];
      const selected=(options.avatars||defaults).slice(0,players);
      if (selected.length!==players || selected.some(key=>!avatars.some(a=>a.id===key))
        || new Set(selected.map(key=>key.replace(/\d$/,''))).size!==players) throw new Error('Cada jugador necesita un personaje diferente.');
      game.setup.avatars=selected;
      game.setup.turn=firstTurn(selected);
      const zone=key=>{if(!data.zones[key])throw new Error('Falta una zona de Matrix: '+key);return data.zones[key];};
      const load=key=>bring(game,key);
      const move=(o,p,faceUp=false)=>Object.assign(o,{x:p.x,z:p.z,faceUp});
      for (const [key,spot] of [['StrikesDeck','Strikes'],['HoverCraftDeck','Hovercraft']]) {
        const deck=move(load(key),zone(spot)); shuffle(deck.cards,random);
      }
      const zion=[];
      for(let i=(movie-1)*4+1;i<=movie*4;i++) zion.push(...load('Market'+i).cards.splice(0));
      shuffle(zion,random);
      for(let i=1;i<=5;i++) add(game,'Dock '+i,zion.splice(0,1),zone('Dock'+i),true);
      add(game,'Zion',zion,zone('Zion'));
      const system=shuffle(load('PartOfTheSystemDeck').cards,random), extra=[0,1,3,5,5][players-1];
      const layers=[], acts=[], bottom=[];
      for(let act=1;act<=3;act++) {
        const entries=catalog().filter(o=>o.container===`Movie${movie}Act${act}Bag`);
        const deck=entries.find(o=>o.actPart==='enemies'), objective=entries.find(o=>o.actPart==='objective');
        const inevitable=entries.find(o=>o.actPart==='inevitable');
        if (!deck||!objective) throw new Error('Faltan cartas del acto '+act+'.');
        const cards=load(deck.key).cards.splice(0); cards.push(...system.splice(0,extra));
        layers.push(shuffle(cards,random)); acts.push(...load(objective.key).cards.splice(0));
        if(inevitable) bottom.push(...load(inevitable.key).cards.splice(0));
        for (const extra of catalog().filter(o=>o.movie===movie&&o.act===act&&o.actPart==='extras')) load(extra.key);
      }
      game.setup.matrixLayers=layers.map(cards=>cards.length);
      add(game,'Matrix Deck',[...layers.flat(),...bottom],zone('MatrixDeck'));
      add(game,'Acts',acts,zone('Acts'),true);
      const starters=catalog().filter(o=>o.container==='StartingDecks'&&o.cards.length===12);
      const pills=catalog().filter(o=>o.container==='StartingDecks'&&o.cards.length===1);
      if(starters.length<players||pills.length<players) throw new Error('Faltan mazos iniciales.');
      for(let seat=1;seat<=players;seat++) {
        move(load(selected[seat-1]),seatZone(game,seat,'avatar'),true);
        const deck=load(starters[seat-1].key);
        if(selected[seat-1]!=='Neo1') deck.cards.push(...load(pills[seat-1].key).cards.splice(0));
        shuffle(deck.cards,random); move(deck,seatZone(game,seat,'draw')); deck.name='Mazo de jugador '+seat;
        const figure=load(selected[seat-1].replace(/\d$/,'')+'Standee');
        move(figure,zone(selected[seat-1]==='Neo1'?'InTheMatrix':'TheRealWorld'+seat),true);
        Object.assign(figure,{width:1.3,height:2.1});
      }
      addRealWorldLabel(game);
      // Unused Part of the System cards are returned to the box.
      const spare=game.objects.find(o=>o.key==='PartOfTheSystemDeck');
      if(spare) game.objects=game.objects.filter(o=>o!==spare);
      for (const key of ['PhoneToken1','PhoneToken2','TimeToken']) {
        const o=move(load(key),zone(key),true); Object.assign(o,{width:1.1,height:1.1});
      }
      prune(game);
      return game;
    }
    function firstTurn(selected,seats=selected.map((_,i)=>i+1)) {
      return seats.reduce((first,seat)=>avatars.findIndex(a=>a.id===selected[seat-1])<avatars.findIndex(a=>a.id===selected[first-1])?seat:first,seats[0]);
    }
    function addRealWorldLabel(game) {
      game.objects.push({type:'text',id:game.nextId++,name:'Real World',text:'REAL WORLD',fontSize:40,x:-27,z:10,rot:0,scale:1});
    }
    function act(game,hand,seat,action,random=Math.random) {
      if (action.command==='library') { bring(game,action.key); return 'Mazo añadido a la reserva'; }
      if (!game.setup || seat<1||seat>game.setup.players) throw new Error('Prepara la mesa para tu jugador.');
      if(action.command==='draw') {
        if(![1,6].includes(action.count))throw new Error('Puedes robar una o seis cartas.');
        return 'Robadas '+draw(game,hand,seat,action.count,random);
      }
      if(action.command==='playHand') {
        const p=seatZone(game,seat,'play');
        let slot=0;
        for(const card of hand.splice(0)) {
          let at;
          do {at={x:p.x-5.7+(slot%5)*2.85,z:p.z+3.6-Math.floor(slot/5)*3.6};slot++;}while(stacksAt(game,at).length);
          add(game,'Carta en juego',[card],at,true);
        }
        return 'Mano jugada';
      }
      if(action.command==='endTurn') {
        const p=seatZone(game,seat,'play'), discard=seatZone(game,seat,'discard');
        const cards=[...hand.splice(0),...game.objects.filter(o=>inPlayArea(o,p)).flatMap(o=>o.cards.splice(0))]; prune(game);
        const existing=stacksAt(game,discard).find(o=>o.faceUp);
        if(existing)existing.cards.unshift(...cards);else add(game,'Descarte de jugador '+seat,cards,discard,true);
        const n=draw(game,hand,seat,6,random);
        for(const o of game.objects)if(o.type==='counter'&&o.playerId===seat&&['combat','stars'].includes(o.resource))o.value=0;
        game.setup.turn=seat%game.setup.players+1;
        return 'Turno terminado · Robadas '+n;
      }
      throw new Error('Acción no válida.');
    }
    const engine={configure,scenarios,avatars,catalog,newGame,create,act,draw,bring,seatZone,inPlayArea,firstTurn,
      get rules(){return data?.rules||[];}};
    engines.set(id,engine);return engine;
  }
  return {titles,forGame};
})();
if (typeof module!=='undefined') module.exports=LegendarySetup;
