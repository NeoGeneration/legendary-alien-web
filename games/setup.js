'use strict';

// Shared table tools and automatic scenario preparation. Card effects are
// resolved by the players. Bond recipes are reviewed in build_bond_setup.py.
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
    ] : id === 'bond' ? [
      ['goldfinger','Goldfinger'],['golden-gun','The Man with the Golden Gun'],
      ['casino-royale','Casino Royale'],['goldeneye','GoldenEye'],
      ['ohmss','On Her Majesty’s Secret Service'],['licence-to-kill','Licence to Kill'],
      ['spy-who-loved-me','The Spy Who Loved Me'],['no-time-to-die','No Time to Die'],['thunderball','Thunderball'],
    ].map(([id,title])=>({id,title})) : id === 'marvel' ? [
      {id:'cosmic-cube',title:'Unleash the Power of the Cosmic Cube',card:'marvel-846'},
      {id:'bank-robbery',title:'Midtown Bank Robbery',card:'marvel-769',bystanders:12},
      {id:'dark-portals',title:'Portals to the Dark Dimension',card:'marvel-845',twists:7},
      {id:'legacy-virus',title:'The Legacy Virus',card:'marvel-839'},
      {id:'killbots',title:'Replace Earth’s Leaders with Killbots',card:'marvel-777',twists:5,bystanders:18},
      {id:'skrull-invasion',title:'Secret Invasion of the Skrull Shapeshifters',card:'marvel-750',heroes:6},
      {id:'civil-war',title:'Super Hero Civil War · 2–5 jugadores',card:'marvel-743',minPlayers:2},
      {id:'prison-breakout',title:'Negative Zone Prison Breakout · 2–5 jugadores',card:'marvel-840',minPlayers:2},
    ] : [{id:'manual',title:'Mesa libre · preparación manual'}];
    const avatars = id === 'matrix' ? [
      ['Neo1','Neo · The Matrix'],['Neo2','Neo · Reloaded'],['Neo3','Neo · Revolutions'],
      ['Morpheus1','Morpheus · The Matrix'],['Morpheus2','Morpheus · Reloaded / Revolutions'],
      ['Trinity1','Trinity · The Matrix'],['Trinity2','Trinity · Reloaded / Revolutions'],
      ['Switch','Switch'],['Niobe','Niobe'],['Soren','Soren'],['Apoc','Apoc'],['Mouse','Mouse'],['Roland','Roland'],
    ].map(([id,name])=>({id,name})) : [];
    const configure = source => {
      if (source.gameId !== id) throw new Error('Colección incorrecta.'); data=source;
      if(id==='marvel'&&data.marvelSetups)for(const recipe of data.marvelSetups.schemes)
        if(!scenarios.some(s=>s.id===recipe.id))scenarios.push(recipe);
    };
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
      if (current+source.cards.length>(id==='marvel'?10000:4000)) throw new Error('La mesa está llena. Retira mazos que ya no necesites antes de añadir más.');
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
      if(players<(scenario.minPlayers||1))throw new Error('Este escenario necesita al menos '+scenario.minPlayers+' jugadores.');
      const game=newGame(players);
      game.setup={scenario:scenario.id,title:scenario.title,players,turn:1};
      if (id==='bond') return createBond(game,scenario,players,random);
      if (id==='marvel') {
        const extended=options.collection==='all'||options.epic||options.soloMode==='advanced'||scenario.id.startsWith('scheme-')
          || options.mastermind&&!['889fb1','f848b2','7c91e7','5da711','random'].includes(options.mastermind);
        if(extended) {
          const preparer=typeof module!=='undefined'?require('./marvel/setup.js'):MarvelSetup;
          preparer.prepare({data,game,scenario:data.marvelSetups?.schemes.find(s=>s.id===scenario.id),players,options,random,add,seatZone,shuffle});
          addMarvelReserves(game,true);return game;
        }
        return createMarvel(game,scenario,players,options,random);
      }
      if (id!=='matrix') return game;
      if(data.matrixCardVersion!==2) throw new Error('Recarga la página para actualizar las cartas de Matrix.');
      game.setup.matrixVersion=2;
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
        const freeYourMind=load(pills[seat-1].key);
        if(selected[seat-1]!=='Neo1') deck.cards.push(...freeYourMind.cards.splice(0));
        else { freeYourMind.faceUp=true; freeYourMind.name='Free Your Mind · Jugador '+seat+' · Fuera de juego'; }
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
    function createMarvel(game,scenario,players,options,random) {
      // First-edition Core rules and the scheme scripts in Workshop 1829020636.
      // Classic solo uses one Master Strike and ignores Always Leads.
      const masterminds=[
        {key:'889fb1',villain:'5adbdf'}, {key:'f848b2',henchman:'7af677'},
        {key:'7c91e7',villain:'9d6725'}, {key:'5da711',villain:'cb5efe'},
      ];
      const selected=options.mastermind||'889fb1';
      const mastermind=selected==='random'?shuffle([...masterminds],random)[0]:masterminds.find(m=>m.key===selected);
      if(!mastermind)throw new Error('Elige un Mastermind del juego base.');
      const entry=key=>catalog().find(o=>o.key===key);
      const take=(key,count)=>{
        if(game.libraryTaken.includes(key))throw new Error('Mazo repetido en la preparación.');
        const source=entry(key);if(!source)throw new Error('Falta un mazo de Marvel: '+key);
        game.libraryTaken.push(key);return copy(source.cards.slice(0,count));
      };
      const pick=(group,count,required=[])=>{
        const pool=shuffle(catalog().filter(o=>o.group===group&&o.name.endsWith('(Core)')&&!required.includes(o.key)),random);
        return [...required,...pool.slice(0,count-required.length).map(o=>o.key)];
      };
      const heroCount=scenario.heroes||(scenario.id==='civil-war'&&players===2?4:players===1?3:players===5?6:5);
      const recommended=['5afc9d','969bbc','2e5e5e','c4e624','3df983','7ba7ad'];
      const heroes=scenario.id==='cosmic-cube'&&mastermind.key==='889fb1'?recommended.slice(0,heroCount):pick('Héroes',heroCount);
      const heroDeck=shuffle(heroes.flatMap(key=>take(key)),random);
      const requiredVillains=scenario.id==='skrull-invasion'?['a63d04']:[];
      if(players>1&&mastermind.villain&&!requiredVillains.includes(mastermind.villain))requiredVillains.push(mastermind.villain);
      const villainKeys=pick('Villanos',[1,2,3,3,4][players-1],requiredVillains);
      const henchKeys=pick('Henchmen',(players>=4?2:1)+(scenario.id==='prison-breakout'?1:0),players>1&&mastermind.henchman?[mastermind.henchman]:[]);
      const bystanders=take('eae6a5',30), twists=take('c82082',11), wounds=take('f49fdc',scenario.id==='legacy-virus'?players*6:30);
      const twistCount=scenario.id==='civil-war'&&players>=4?5:scenario.twists||8;
      const villainDeck=[...villainKeys.flatMap(key=>take(key)),...henchKeys.flatMap(key=>take(key,players===1?3:10)),
        ...bystanders.splice(0,scenario.bystanders||[1,2,8,8,12][players-1]),
        ...take('c7aaa3',players===1?1:5),...twists.splice(0,twistCount)];
      if(scenario.id==='skrull-invasion')villainDeck.push(...heroDeck.splice(0,12));
      const point=(x,y)=>({x:(x-1831/2)*20/1304,z:7+(1304/2-y)*20/1304});
      const masterCards=take(mastermind.key);
      add(game,'Mastermind',masterCards.splice(0,1),point(176,842),true);
      add(game,'Mastermind Tactics',shuffle(masterCards,random),{x:-16,z:4});
      const scheme=take('54a8c8').find(c=>c.uid===scenario.card);
      if(!scheme)throw new Error('Falta la carta de Scheme.');
      add(game,'Scheme',[scheme],point(176,472),true);
      if(scenario.id==='killbots')add(game,'Killbots · Fuerza inicial',twists.splice(0,3),{x:-16,z:10},true);
      add(game,'Wounds',wounds,point(1382,472),true);
      add(game,'Bystanders',bystanders,point(1680,472),true);
      add(game,'S.H.I.E.L.D. Officers',take('49f6ff',30),point(176,1160),true);
      add(game,'Villain Deck',shuffle(villainDeck,random),point(1658,842));
      for(const [i,x] of [490,700,912,1126,1340].entries())add(game,'HQ '+(i+1),heroDeck.splice(0,1),point(x,1160),true);
      add(game,'Hero Deck',heroDeck,point(1658,1160));
      for(const [i,key] of ['792aaa','763235','3536ec','5f46be','a9a627'].slice(0,players).entries()) {
        add(game,'Mazo de jugador '+(i+1),shuffle(take(key),random),seatZone(game,i+1,'draw'));
      }
      Object.assign(game.setup,{mastermind:mastermind.key,heroes:heroes.map(key=>entry(key).name),villains:villainKeys.map(key=>entry(key).name),
        henchmen:henchKeys.map(key=>entry(key).name),edition:'core-first',soloMode:players===1?'classic':null});
      addMarvelReserves(game,true);
      return game;
    }
    function addMarvelReserves(game,fromSetup=false) {
      if(id!=='marvel'||game.gameId!=='marvel')throw new Error('Esta colección es de Marvel.');
      if(game.marvelReservesVersion===1)return 0;
      game.libraryTaken ||= [];
      const existing=new Set([...game.hand,...game.objects.flatMap(o=>o.cards||[])].map(c=>c.uid));
      const scenario=scenarios.find(s=>s.id===game.setup?.scenario);
      // Older Core setups consumed the Scheme collection but retained only
      // the chosen Scheme. Recover the unused Schemes, never the active one,
      // even when that card has since moved to a private hand or been removed.
      if(scenario?.card)existing.add(scenario.card);
      const groups=['Reservas','Horrores y ambiciones','Transformaciones','Masterminds','Villanos','Henchmen','Héroes','Mazos iniciales'];
      const sources=[...catalog()].sort((a,b)=>groups.indexOf(a.group)-groups.indexOf(b.group)||a.name.localeCompare(b.name,'es',{numeric:true}));
      let z=Math.max(24,...game.objects.filter(o=>o.z>=19).map(o=>o.z+8)),group,slot=0,count=0;
      game.nextId=Math.max(game.nextId,20000);
      const occupiedIds=new Set(game.objects.map(o=>o.id));
      const stableId=preferred=>{const id=occupiedIds.has(preferred)?game.nextId++:preferred;occupiedIds.add(id);return id;};
      for(const [index,source] of sources.entries()) {
        if(group!==source.group) {
          if(group!==undefined)z+=Math.ceil(slot/20)*5.8+4;
          group=source.group;slot=0;
        }
        const point={x:-42+(slot%20)*4.5,z:z+4+Math.floor(slot/20)*5.8};slot++;
        const taken=game.libraryTaken.includes(source.key);
        const unusedSchemes=source.key==='54a8c8'&&game.setup?.edition==='core-first';
        // Existing games may have discarded/deleted/privately held cards.
        // Never refill an already claimed deck from its source collection.
        if(taken&&!fromSetup&&!unusedSchemes)continue;
        const cards=copy(source.cards.filter(c=>!existing.has(c.uid)));
        if(!cards.length)continue;
        const headingKey='marvel-reserve-'+source.group;
        if(!game.objects.some(o=>o.key===headingKey)) {
          game.objects.push({type:'text',id:stableId(19000+groups.indexOf(group)),key:headingKey,name:group,text:group.toUpperCase(),fontSize:40,x:-42,z:z-0.5,rot:0,scale:1});
        }
        add(game,source.name+(taken?' · Restantes':''),cards,point,true,
          {id:stableId(10000+index),z_:2000+index,key:source.key,group:source.group,libraryReserve:true});
        count++;
        for(const c of cards)existing.add(c.uid);
        if(!taken)game.libraryTaken.push(source.key);
      }
      game.nextId=Math.max(game.nextId,...game.objects.map(o=>o.id+1));
      game.marvelReservesVersion=1;
      return count;
    }
    function createBond(game,scenario,players,random) {
      const recipes=data.bondSetups, recipe=recipes?.find(r=>r.id===scenario.id);
      if(!recipe) throw new Error('Falta la preparación de esta película. Recarga la página.');
      const byUid=new Map(catalog().flatMap(o=>o.cards.map(c=>[c.uid,{card:c,key:o.key}]))), used=new Set();
      const take=ids=>ids.map(uid=>{
        const source=byUid.get(uid);
        if(!source||used.has(uid))throw new Error('Carta de preparación no válida: '+uid);
        used.add(uid);
        if(!game.libraryTaken.includes(source.key))game.libraryTaken.push(source.key);
        return copy(source.card);
      });
      const deckCards=key=>catalog().find(o=>o.key===key).cards.map(c=>c.uid);
      const load=key=>take(deckCards(key));
      const reserve=(name,cards,faceUp=false)=>add(game,name,cards,{x:-22+(reserve.slot++%10)*4.7,z:22},faceUp);
      reserve.slot=0;
      const helpers=recipes.slice(0,4).filter(r=>r!==recipe);
      const groups=recipe.heroes.slice(0,players===1?4:5);
      if(players>=4)groups.push(helpers[0].heroes.find(h=>!h.bond));
      const heroCards=take(groups.flatMap(h=>h.cards));
      if(recipe.gold)heroCards.push(...take(shuffle([...recipe.gold],random).slice(0,6)));
      if(recipe.angels)heroCards.push(...take(recipe.angels));
      shuffle(heroCards,random);
      game.setup.heroes=groups.map(h=>h.name);
      const gold=new Set(recipe.gold||[]), attached=[];
      for(const [i,x] of [-10.13,-5.77,-1.42,2.98,7.43].entries()) {
        while(heroCards.length&&gold.has(heroCards[0].uid))attached.push(heroCards.shift());
        add(game,'Q Branch '+(i+1),heroCards.splice(0,1),{x,z:.1},true);
      }
      add(game,'Hero Deck',heroCards,{x:12.33,z:.14});
      add(game,'Mastermind Tactics',shuffle(take(recipe.tactics),random),{x:-20,z:6.6});
      add(game,'Mastermind',take(recipe.mastermind),{x:-15.18,z:6.61},true,{rot:recipe.submerged?0:180});
      add(game,'Scheme',take(recipe.scheme),{x:-15.18,z:13.13},true);
      if(attached.length)add(game,'Smuggled Gold · Mastermind',attached,{x:-20,z:2},true);
      add(game,'Miss Moneypenny',load('cacece'),{x:-15.18,z:.14},true);
      const wounds=load('be3a03');
      if(recipe.wounds)wounds.push(...take(recipe.wounds));
      add(game,'Wounds',shuffle(wounds,random),{x:7.34,z:13.13},!recipe.wounds);
      const gadgets=load('ab749e');
      if(recipe.gadgets)gadgets.push(...take(recipe.gadgets));
      shuffle(gadgets,random);
      const extraVillains=[0,0,1,1,2][players-1], villainGroups=[recipe,...helpers.slice(0,extraVillains)];
      const villainCards=take(villainGroups.flatMap(r=>r.villains));
      const missionCards=take(recipe.missions), inevitable=missionCards.filter(c=>c.bondStage==='I');
      let henchIds=[...recipe.henchmen];
      if(players===1)henchIds=['A','B','C'].map(stage=>shuffle(henchIds.filter(uid=>byUid.get(uid).card.bondStage===stage),random)[0]);
      if(players>=4)henchIds.push(...helpers[0].henchmen);
      const henchmen=take(henchIds), strikes=load('91a700'), twists=load('2164b3');
      const gadgetCounts=[[0,0,0],[1,1,0],[3,3,2],[3,3,2],[4,4,4]][players-1];
      const layers=['A','B','C'].map((stage,i)=>shuffle([
        ...villainCards.filter(c=>c.bondStage===stage),...missionCards.filter(c=>c.bondStage===stage),
        ...henchmen.filter(c=>c.bondStage===stage),...gadgets.splice(0,gadgetCounts[i]),
        ...strikes.splice(0,(recipe.strikes||[1,2,2])[i]),...twists.splice(0,(recipe.twists||[1,2,2])[i]),
      ],random));
      game.setup.bondLayers=layers.map(cards=>cards.length);
      game.setup.villains=villainGroups.map(r=>r.title);
      add(game,'Villain Deck',[...layers.flat(),...inevitable],{x:12.33,z:6.61});
      add(game,'Gadgets',gadgets,{x:12.33,z:13.13},!recipe.gadgets);
      for(const extra of recipe.reserves||[]) {
        const cards=take(extra.cards);if(extra.shuffle)shuffle(cards,random);
        if(extra.name==='Nanobot Infection')add(game,extra.name,cards,{x:7.34,z:20},true);
        else reserve(extra.name,cards,!!extra.faceUp);
      }
      const agents=['ef86e8','df5c5a','587458','fbebb7'].flatMap(deckCards), operatives=deckCards('ee16c8');
      const special=shuffle([...recipe.starters],random);
      for(let seat=1;seat<=players;seat++) {
        const cards=take([...agents.splice(0,8),...operatives.splice(0,4),special.shift()]);
        add(game,'Mazo de jugador '+seat,shuffle(cards,random),seatZone(game,seat,'draw'));
      }
      game.objects.push({type:'counter',id:game.nextId++,name:'Peligro',resource:'danger',value:recipe.danger||0,
        x:17,z:0,rot:180,scale:1,color:'#b1393b'});
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
      if (action.command==='reserves') return addMarvelReserves(game)+' mazos añadidos alrededor del tapete';
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
        const n=draw(game,hand,seat,game.setup.handSize||6,random);
        for(const o of game.objects)if(o.type==='counter'&&o.playerId===seat&&['combat','stars'].includes(o.resource))o.value=0;
        game.setup.turn=seat%game.setup.players+1;
        return 'Turno terminado · Robadas '+n;
      }
      throw new Error('Acción no válida.');
    }
    const engine={configure,scenarios,avatars,catalog,newGame,create,act,draw,bring,seatZone,inPlayArea,firstTurn,
      get rules(){return data?.rules||[];},get marvel(){return data?.marvelSetups;}};
    engines.set(id,engine);return engine;
  }
  return {titles,forGame};
})();
if (typeof module!=='undefined') module.exports=LegendarySetup;
