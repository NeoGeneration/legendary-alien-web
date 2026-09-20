'use strict';

// Printed setup rules for Firefly and both sides of Predator. Card effects and
// intermission spending remain player decisions, as on the other virtual tables.
const EncountersSetup=(()=>{
  const clone=v=>JSON.parse(JSON.stringify(v));
  const extrasByPlayers=[[0,0,0],[0,1,2],[2,3,4],[4,5,6],[4,5,6]];
  function positions(game) {
    const mat=game.objects.find(o=>o.type==='playmat');
    const p=(x,y)=>({x:mat.x+(x/2048-.5)*mat.width,z:mat.z+(.5-y/888)*mat.height});
    if(game.gameId==='firefly')return {p,objective:p(610,173),episode:p(1745,173),crew:p(1745,730),
      browncoats:p(612,730),crewStrikes:p(1745,455),shipStrikes:p(612,455),upgrades:p(373,125),defeated:p(1935,173),
      hq:i=>p([805,990,1175,1360,1545][i],733),verse:i=>p([1540,1357,1174,991,808][i],160)};
    return {p,objective:p(274,158),location:p(280,432),support:p(270,710),strikes:p(1350,430),enemy:p(1350,164),
      market:p(1350,710),testing:p(1070,430),hq:i=>p([455,630,805,980,1155][i],700)};
  }
  function prepare({data,game,scenario,players,options,random,add,seatZone,shuffle}) {
    const meta=data.encountersSetups;
    if(meta?.version!==1)throw new Error('Recarga para actualizar la preparación del juego.');
    const decks=new Map(data.objects.filter(o=>o.type==='stack').map(o=>[o.key,o]));
    const pools=new Map([...decks].map(([k,d])=>[k,clone(d.cards)]));
    const mix=cards=>shuffle(cards,random),used=new Set(),p=positions(game),notes=[];
    const take=(key,n)=>{
      const cards=pools.get(key);if(!cards)throw new Error('Falta el mazo '+key+'.');
      n??=cards.length;if(!Number.isInteger(n)||n<0||cards.length<n)throw new Error('Faltan cartas de '+decks.get(key).name+'.');
      used.add(key);return cards.splice(0,n);
    };
    const names=keys=>keys.map(k=>decks.get(k).name);
    const selected=(value,n,available,defaults,label)=>{
      const keys=value===undefined?[...defaults].slice(0,n):value;
      if(!Array.isArray(keys)||keys.length!==n||new Set(keys).size!==n||keys.some(k=>!available.includes(k)))throw new Error('Elige '+n+' '+label+' distintos.');
      return [...keys];
    };
    const counter=(name,value,at,extra={})=>game.objects.push({type:'counter',id:game.nextId++,name,value,rot:180,scale:1,resource:'custom',...at,...extra});
    const label=(name,at)=>game.objects.push({type:'text',id:game.nextId++,name,text:name,fontSize:24,rot:0,scale:1,...at});
    if(game.gameId==='firefly') {
      const avatarKeys=meta.avatars.map(a=>a.key);
      const mains=selected(options.avatars,5,avatarKeys,scenario.avatars,'personajes principales');
      const support=meta.avatars.filter(a=>!mains.includes(a.key));
      const episodeKeys=selected(scenario.custom?options.episodes:undefined,3,meta.episodes.map(e=>e.id),scenario.episodes,'episodios A, B y C');
      const episodes=episodeKeys.map((id,i)=>{
        const e=meta.episodes.find(e=>e.id===id);if(e.stage!=='ABC'[i])throw new Error('Elige un episodio A, uno B y uno C, en ese orden.');return e;
      });
      const sideJobs=mix(take('sidejob')),inevitable=mix(take('inevitable'));
      mix(pools.get('talent'));
      const pending=[];
      for(const [i,e] of episodes.entries()) {
        const cards=mix([...take(e.deck),...sideJobs.splice(0,players-1)]);cards.push(inevitable.shift());
        const at=i===0?p.episode:{x:27+(i-1)*5,z:12};
        const deck=add(game,'Episode '+e.stage+' · '+e.name,cards,at,false,{encounterRole:'episode',episodeIndex:i});
        const objective=add(game,'Objetivo '+e.stage+' · '+e.name,take(e.objective),i===0?p.objective:{x:at.x,z:at.z+5},true,{encounterRole:'objective',episodeIndex:i});
        pending.push({deck:deck.id,objective:objective.id,id:e.id});
      }
      pools.get('sidejob').push(...sideJobs);
      const crew=mix(support.flatMap(a=>take(a.crew)));
      for(let i=0;i<5;i++)add(game,'Bridge '+(i+1),crew.splice(0,1),p.hq(i),true);
      add(game,'Crew Deck',crew,p.crew);
      for(const [key,name,at,rot] of [['browncoats','Browncoats',p.browncoats,180],['upgrade','Serenity Upgrades',p.upgrades,270],
        ['strikefireflycrew','Crew Strikes',p.crewStrikes,180],['strikefireflyship','Ship Strikes',p.shipStrikes,270]])add(game,name,mix(take(key)),at,false,{key,rot});
      for(const [i,key] of mains.entries()) {
        const at=i<players?seatZone(game,i+1,'avatar'):{x:-7+(i-players)*4.5,z:-6};
        add(game,decks.get(key).name,take(key),at,true,{...(i<players?{playerId:i+1}:{}),encounterRole:'main-avatar'});
        if(i<players)add(game,'Mazo de jugador '+(i+1),mix([...take('starting'+(i+1)+'firefly'),...take('talent',1)]),seatZone(game,i+1,'draw'));
      }
      add(game,'Talents',take('talent'),{x:-6,z:21},true,{key:'talent'});
      add(game,'Flaws',take('flaw'),{x:-1,z:21},true,{key:'flaw'});
      counter('Créditos',0,{x:-12,z:21},{resource:'credits'});
      const ranks=mains.slice(0,players).map(k=>meta.avatars.find(a=>a.key===k).rank);
      Object.assign(game.setup,{avatars:mains,heroes:names(support.map(a=>a.crew)),episodes:episodeKeys,episodeIndex:0,episodePiles:pending,
        turn:ranks.indexOf(Math.min(...ranks))+1,sideJobs:players-1,handSize:6,preparationRounds:Math.max(0,players-3)});
      if(players>=4)notes.push('Al inicio del episodio A, cada jugador tiene '+(players-3)+' ronda(s) de preparación sin fase de Episodio.');
      notes.push('Cada mazo de episodio termina con un Inevitable. B y C permanecen separados hasta que les toque.');
      notes.push('Entre episodios: termina el turno, resuelve los efectos y gastos del intermedio y pulsa «Preparar episodio siguiente». Se limpia el episodio anterior y se colocan 2 cartas iniciales en B o 4 en C.');
      if(episodeKeys.includes('5'))notes.push('Safe: los dos cautivos y las cinco Flames se colocan al empezar el episodio C.');
    } else {
      const hunters=scenario.mode==='hunters',prefix=hunters?'prey':'enemy',movie=scenario.movie;
      const available=meta.avatars.filter(a=>a.mode===scenario.mode);
      const defaultNumbers=hunters?[1,2,3,4,5]:movie===1?[1,2,5,4,3]:[6,7,9,8,10];
      const defaults=defaultNumbers.map(n=>'avatar'+n+(hunters?'predatorvpredator':'predator'));
      const avatars=selected(options.avatars,players,available.map(a=>a.key),defaults,'avatares');
      const stages=selected(scenario.custom?options.stages:undefined,3,meta.stages.filter(s=>s.mode===scenario.mode).map(s=>s.key),[1,2,3].map(n=>prefix+n+'predator'+movie),'etapas');
      stages.forEach((key,i)=>{if(meta.stages.find(s=>s.key===key).stage!==i+1)throw new Error('Las etapas deben seguir el orden 1, 2 y 3.');});
      const choices=meta.heroes.filter(h=>h.mode===scenario.mode);
      const heroes=selected(options.heroKeys,4,choices.map(h=>h.key),options.randomHeroes?mix(choices.map(h=>h.key)):choices.filter(h=>h.movie===movie).map(h=>h.key),hunters?'grupos de Armory':'personajes');
      const tests=hunters&&Boolean(options.tests),challenges=hunters&&Boolean(options.challenges),cooperative=hunters&&Boolean(options.cooperative);
      const extras=mix(take(hunters?'mercenary':'youngblood')),layers=[];
      for(const [i,key] of stages.entries())layers.push(mix([...take(key),...extras.splice(0,extrasByPlayers[players-1][i])]));
      pools.get(hunters?'mercenary':'youngblood').push(...extras);
      add(game,hunters?'Prey Deck':'Enemy Deck',layers.flat(),p.enemy,false,{encounterRole:'encounter-deck'});
      add(game,hunters?'Killer Instinct':'Commanders',mix(take(hunters?'killerinstinct':'commander')),p.support);
      add(game,hunters?'Prey Strikes':'Enemy Strikes',mix(take(hunters?'strikepredatorprey':'strikepredatorenemy')),p.strikes);
      if(hunters) {
        add(game,'Gear',mix(take('gear')),p.objective);
        const traps=take('trap'),allowed=traps.filter(c=>!cooperative||!meta.coopExcluded.includes(c.uid));
        pools.get('trap').push(...traps.filter(c=>!allowed.includes(c)));
        add(game,'Traps',mix(allowed),p.location);
      } else {
        const location=options.location||'locationpredator'+movie;
        if(!['locationpredator1','locationpredator2'].includes(location))throw new Error('Elige una localización de Predator.');
        add(game,'Location',take(location),p.location,true,{rot:270});
        const objectives=stages.map((key,i)=>{
          const group='objectivespredator'+meta.stages.find(s=>s.key===key).movie;
          const original=decks.get(group).cards[i].uid,remaining=pools.get(group),index=remaining.findIndex(c=>c.uid===original);
          used.add(group);return remaining.splice(index,1)[0];
        });
        add(game,'Objectives',objectives,p.objective,true);
        game.setup.location=location;
      }
      let market=heroes.flatMap(k=>take(k));
      if(tests){const cards=mix(take('test'));market.push(...cards.splice(0,10));pools.get('test').push(...cards);}
      mix(market);
      const testIds=new Set(decks.get('test').cards.map(c=>c.uid)),revealedTests=[];
      for(let i=0;i<5;i++) {
        while(testIds.has(market[0]?.uid))revealedTests.push(market.shift());
        add(game,'HQ '+(i+1),market.splice(0,1),p.hq(i),true);
      }
      add(game,hunters?'Armory':'Barracks',market,p.market);
      if(revealedTests.length)add(game,'Testing Ground',revealedTests,p.testing,true);
      const challengeCards=challenges?mix(take('challenge')):[];
      for(const [i,key] of avatars.entries()) {
        const avatar=available.find(a=>a.key===key),seat=i+1;
        add(game,avatar.name,take(key),seatZone(game,seat,'avatar'),true,{playerId:seat});
        add(game,'Mazo de jugador '+seat,mix([...take('starting'+seat+'predator'),...take(avatar.role)]),seatZone(game,seat,'draw'));
        if(challenges)add(game,'Challenge · Jugador '+seat,challengeCards.splice(0,1),{x:seatZone(game,seat,'avatar').x,z:-6},false,{playerId:seat});
        if(hunters)counter('Honor',0,{x:seatZone(game,seat,'draw').x-8,z:-18},{playerId:seat,resource:'honor'});
      }
      if(challenges)pools.get('challenge').push(...challengeCards);
      const ranks=avatars.map(k=>available.find(a=>a.key===k).rank||0);
      Object.assign(game.setup,{avatars,mode:scenario.mode,heroes:names(heroes),heroKeys:heroes,stages,tests,challenges,cooperative,
        heroMode:options.heroKeys?'manual':options.randomHeroes?'random':'movie',
        handSize:6,extraCards:[...extrasByPlayers[players-1]],turn:hunters?ranks.indexOf(Math.min(...ranks))+1:1,preparationRounds:players===5?1:0});
      if(players===5)notes.push('Cinco jugadores: una ronda inicial de preparación sin fase de Enemigo/Presa.');
      notes.push(hunters?'Las Presas entran en Wilds boca arriba.':'Los Enemigos entran en Wilds boca abajo.');
      if(tests)notes.push('Los Tests que aparezcan al reponer HQ van al Testing Ground; sigue reponiendo hasta que haya cinco cartas de Armory.');
      if(challenges)notes.push('Cada Challenge está boca abajo junto al avatar de su jugador. Puede consultarlo llevándolo a su mano y devolviéndolo boca abajo.');
      if(cooperative)notes.push('Cazadores cooperativos: se retiran Flash Trap, Laser Trap, Log Trap y Razor Trap. Ganáis al derrotar a Ultimate Prey.');
    }
    game.setup.encountersVersion=1;game.setup.notes=notes;
    label(notes.join('\n'),{x:0,z:27});
    // Unused physical cards remain available and never duplicate an active card.
    const groups=[...new Set([...decks.values()].map(d=>d.group))];let z=35;
    for(const group of groups) {
      const remaining=[...decks.values()].filter(d=>d.group===group&&pools.get(d.key).length);
      if(!remaining.length)continue;
      label(group.toUpperCase(),{x:-22,z:z+3});
      remaining.forEach((d,i)=>add(game,d.name+(used.has(d.key)?' · Restantes':''),take(d.key),{x:-22+(i%10)*4.7,z:z+Math.floor(i/10)*6},true,{key:d.key,group,libraryReserve:true}));
      z+=Math.ceil(remaining.length/10)*6+5;
    }
    game.libraryTaken=[...decks.keys()];return game;
  }
  function nextEpisode({data,game,add,random,shuffle}) {
    if(game.gameId!=='firefly'||game.setup?.encountersVersion!==1)throw new Error('Prepara una partida automática de Firefly.');
    const next=game.setup.episodeIndex+1;if(next>2)throw new Error('El episodio C ya es el último de la partida.');
    const previous=game.setup.episodePiles[next-1],target=game.setup.episodePiles[next];
    const deck=game.objects.find(o=>o.id===target.deck),objective=game.objects.find(o=>o.id===target.objective);
    const count=next*2,p=positions(game);
    if(!deck||deck.cards?.length<count||!objective?.cards?.length)throw new Error('Devuelve a su sitio el mazo y el objetivo del siguiente episodio.');
    let flames,captives=[];
    if(target.id==='5') {
      flames=game.objects.find(o=>o.key==='strikefireflycrew'&&!o.libraryReserve);
      const support=data.encountersSetups.avatars.filter(a=>!game.setup.avatars.includes(a.key));
      captives=shuffle(support.map(a=>game.objects.find(o=>o.key===a.key&&o.cards?.length===1)).filter(Boolean),random).slice(0,2);
      if(flames?.cards?.length<5||!flames||captives.length<2)throw new Error('Safe necesita cinco Crew Strikes y dos avatares sin usar. Devuélvelos a sus reservas.');
    }
    const inevitable=new Set(data.objects.find(o=>o.key==='inevitable').cards.map(c=>c.uid)),defeated=[],timers=[];
    const topLeft=p.p(710,20),bottomRight=p.p(1635,580);
    const future=new Set(game.setup.episodePiles.slice(next).flatMap(e=>[e.deck,e.objective]));
    for(const object of game.objects) {
      if(object.type!=='stack'||object.libraryReserve||future.has(object.id))continue;
      const inEpisode=object.x>=topLeft.x&&object.x<=bottomRight.x&&object.z<=topLeft.z&&object.z>=bottomRight.z;
      if(!inEpisode&&object.id!==previous.deck&&object.id!==previous.objective)continue;
      for(const card of object.cards.splice(0)) {
        if(inevitable.has(card.uid))timers.push({card,faceUp:object.faceUp});else defeated.push(card);
      }
    }
    game.objects=game.objects.filter(o=>o.type!=='stack'||o.cards.length);
    const discarded=game.objects.find(o=>o.encounterRole==='defeated');
    if(discarded)discarded.cards.unshift(...defeated);else add(game,'Defeated Cards',defeated,p.defeated,true,{encounterRole:'defeated'});
    for(const [i,timer] of timers.entries())add(game,'Inevitable · Episodio '+next,[timer.card],{x:27+(next-1)*5,z:4-i*4},timer.faceUp);
    Object.assign(deck,p.episode,{faceUp:false});Object.assign(objective,p.objective,{faceUp:true});
    game.setup.episodeIndex=next;game.setup.preparationRounds=0;
    for(let i=0;i<count;i++)add(game,'Verse · Inicio del episodio '+('ABC'[next]),deck.cards.splice(0,1),p.verse(count-1-i),false);
    if(flames) {
      for(const [i,captive] of captives.entries())Object.assign(captive,p.p(i?1570:1340,450),{libraryReserve:false,faceUp:true,encounterRole:'captive',name:'Captive · '+captive.name});
      add(game,'Flames',flames.cards.splice(0,5),p.p(1455,450),false,{encounterRole:'flames'});
    }
    for(const o of game.objects)if(o.type==='counter'&&o.resource==='credits')o.value=0;
    return 'Episodio '+('ABC'[next])+' preparado · '+count+' cartas boca abajo en el Verse'+(flames?' · Safe: 2 cautivos y 5 Flames':'');
  }
  return {prepare,positions,nextEpisode,extrasByPlayers};
})();
if(typeof module!=='undefined')module.exports=EncountersSetup;
