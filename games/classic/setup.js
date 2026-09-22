'use strict';

// Buffy (2017) and Big Trouble (2016): their printed classic setup tables.
// Ongoing card effects remain player-resolved, like the other virtual tables.
const ClassicLegendarySetup=(()=>{
  const clone=v=>JSON.parse(JSON.stringify(v));
  function counts(s,p) {
    return {heroes:[3,5,5,5,6][p-1]+(s.extraHeroes||0),villains:[1,2,3,3,4][p-1]+(s.extraVillains||0),
      henchmen:p>=4?2:1,henchmenCards:p===1?3:p>=4?20:10,strikes:p===1?1:5,
      bystanders:(s.bystanders??[1,2,8,8,12][p-1])/(s.halfBystanders?2:1),twists:s.twists};
  }
  function requiredGroups(s,p,m) {
    return {villains:[...new Set([...(s.villains||[]),...(!s.masterminds&&p>1?m?.villains||[]:[])])],
      henchmen:[...new Set([...(s.henchmen||[]),...(p>1?m?.henchmen||[]:[])])],villainChoices:[]};
  }
  function positions(data,game) {
    const mat=(game||data).objects.find(o=>o.type==='playmat');
    const pixel=(x,y,w,h)=>({x:mat.x+(x/w-.5)*mat.width,z:mat.z+(.5-y/h)*mat.height});
    if(data.gameId==='bigtrouble') {
      const p=(x,y)=>pixel(x,y,1500,763);
      return {scheme:p(276,169),mastermind:p(276,390),tactics:p(605,169),officers:p(276,620),extraBoss:p(755,169),extraTactics:p(905,169),special:p(755,169),
        bystanders:p(1230,169),wounds:p(1090,169),villain:p(1230,390),hero:p(1230,620),
        hq:i=>p([455,605,755,905,1055][i],620),city:i=>p([1055,905,755,605,455][i],390)};
    }
    // Coordinates in the cropped custom Buffy mat, normalized to its preview.
    const p=(x,y)=>pixel(x-242,y-37,1016,574);
    return {scheme:p(473,245),mastermind:p(473,386),tactics:p(340,390),officers:p(388,523),
      bystanders:p(1085,249),wounds:p(1000,249),villain:p(1000,389),hero:p(1000,523),
      hq:i=>p([557,645,733,820,908][i],523),city:i=>p([908,820,733,645,557][i],325),
      darkness:{x:mat.x+mat.width/2+2.7,z:mat.z}};
  }
  function prepare({data,game,scenario:s,players,options,random,add,seatZone,shuffle}) {
    const meta=data.classicSetups,china=data.gameId==='bigtrouble',p=positions(data,game),c=counts(s,players);
    if(meta?.version!==1)throw new Error('Recarga la página para actualizar este juego.');
    const decks=new Map(data.objects.filter(o=>o.type==='stack').map(o=>[o.key,o]));
    const pools=new Map([...decks].map(([k,d])=>[k,clone(d.cards)])),mix=a=>shuffle(a,random),notes=[],taken=new Set();
    const take=(key,n)=>{
      const pool=pools.get(key);n??=pool?.length;
      if(!pool||!Number.isInteger(n)||n<0||n>pool.length)throw new Error('No hay suficientes cartas de '+(decks.get(key)?.name||key)+'.');
      taken.add(key);return pool.splice(0,n);
    };
    const choose=(field,group,n,required=[],excluded=[])=>{
      const chosen=options[field];n=Math.max(n,new Set(required).size);
      if(chosen!==undefined) {
        if(!Array.isArray(chosen)||new Set(chosen).size!==chosen.length||chosen.length!==n||chosen.some(k=>decks.get(k)?.group!==group||excluded.includes(k)))throw new Error('Elige '+n+' grupos válidos de '+group+'.');
        if(required.some(k=>!chosen.includes(k)))throw new Error('Falta un grupo obligatorio del Scheme o Always Leads.');
        return [...chosen];
      }
      const keys=[...new Set(required)],available=mix([...decks.values()].filter(d=>d.group===group&&!keys.includes(d.key)&&!excluded.includes(d.key)).map(d=>d.key));
      keys.push(...available.slice(0,n-keys.length));
      if(keys.length!==n||keys.some(k=>excluded.includes(k)||decks.get(k)?.group!==group))throw new Error('No hay suficientes grupos de '+group+'.');
      return keys;
    };
    let sideSlot=0;
    const label=(name,pos)=>game.objects.push({type:'text',id:game.nextId++,text:name,name,fontSize:24,rot:0,scale:1,...pos});
    const side=(name,cards,faceUp=true,pos)=>{
      pos||={x:-22+(sideSlot++%10)*4.7,z:24+Math.floor((sideSlot-1)/10)*6};
      const o=add(game,name,cards,pos,faceUp);if(o)label(name,{x:pos.x,z:pos.z+2.5});return o;
    };
    const requested=options.mastermind||meta.defaultMastermind;
    const bosses=s.masterminds?mix(s.masterminds.map(k=>meta.masterminds.find(m=>m.key===k))):[requested==='random'?mix([...meta.masterminds])[0]:meta.masterminds.find(m=>m.key===requested)];
    if(bosses.some(m=>!m))throw new Error('Elige un jefe de este juego.');
    const m=bosses[0],required=requiredGroups(s,players,m);
    let extraHero=null;
    if(s.special==='hero-villains') {
      const available=(s.extraHeroChoices||meta.heroes.map(h=>h.key)).filter(k=>!(options.heroKeys||[]).includes(k));
      extraHero=options.extraHero&&options.extraHero!=='random'?options.extraHero:mix(available)[0];
      if(!available.includes(extraHero))throw new Error('El héroe del mazo de villanos debe ser válido para el Scheme y distinto de los héroes de la Library.');
    }
    const heroKeys=choose('heroKeys','Héroes',c.heroes,[],extraHero?[extraHero]:[]);
    const villainKeys=choose('villainKeys','Villanos',c.villains,required.villains);
    const henchmenKeys=choose('henchmenKeys','Henchmen',c.henchmen,required.henchmen);
    const excludedCommons={};
    const heroCards=k=>{
      const cards=take(k),choices=meta.commonChoices?.[k];
      if(choices) {
        const requested=options.excludedCommons?.[k];
        const choice=requested&&requested!=='random'?choices.find(a=>a.face===requested):mix([...choices])[0];
        if(!choice)throw new Error('Elige una carta común válida para excluir.');
        const removed=cards.filter(a=>a.face===choice.face);pools.get(k).push(...removed);
        excludedCommons[k]=choice.face;
        notes.push(decks.get(k).name+': se excluyen las 5 copias de '+choice.name+'.');
        return cards.filter(a=>a.face!==choice.face);
      }
      return cards;
    };
    let heroDeck=mix(heroKeys.flatMap(heroCards));
    const bystanders=mix(take('bystanders')),officers=take('officers');
    const villainDeck=[...villainKeys.flatMap(k=>take(k)),...take('twists',c.twists),...take('strikes',c.strikes),...bystanders.splice(0,c.bystanders)];
    for(const key of henchmenKeys) {
      const cards=mix(take(key));villainDeck.push(...cards.splice(0,players===1?3:10));pools.get(key).push(...cards);
    }
    if(s.heroVillains)villainDeck.push(...heroDeck.splice(0,s.heroVillains));
    if(extraHero) {
      villainDeck.push(...take(extraHero));notes.push('Héroe añadido al mazo de villanos: '+decks.get(extraHero).name+' (14 cartas).');
    }
    for(let i=0;i<bosses.length;i++) {
      const boss=bosses[i],cards=take(boss.key),face=cards.shift();
      if(i===0) {
        add(game,china?'Mastermind':'Big Bad',[face],p.mastermind,true);
        side(china?'Mastermind Tactics':'Big Bad Tactics',mix(cards),false,p.tactics);
      } else {
        side(boss.name+' · Inactivo',[face],true,p.extraBoss);side(boss.name+' · Tácticas',mix(cards),false,p.extraTactics);
      }
    }
    if(bosses.length>1)notes.push('Activo: '+m.name+'. El otro Lo Pan empieza inactivo. Se incluyen ambos grupos Always Leads; los cambios de jefe se resuelven según el Scheme.');
    let executionerKey=null;
    if(s.special==='executioners') {
      executionerKey=mix([...decks.values()].filter(d=>['Villanos','Henchmen'].includes(d.group)&&![...villainKeys,...henchmenKeys].includes(d.key)))[0]?.key;
      if(!executionerKey)throw new Error('No queda ningún grupo para el mazo de verdugos.');
      side('Executioner Deck · '+decks.get(executionerKey).name,mix(take(executionerKey)),false,p.special);
      notes.push('Mazo de verdugos: '+decks.get(executionerKey).name+'.');
    }
    if(s.special==='uncle-chu')villainDeck.push(...officers.splice(0,10));
    const schemes=pools.get('schemes'),index=schemes.findIndex(a=>a.uid===s.card);
    if(index<0)throw new Error('Falta la carta de Scheme.');
    add(game,'Scheme',schemes.splice(index,1),p.scheme,true);taken.add('schemes');
    for(let i=0;i<5;i++)add(game,(china?'HQ ':'Library ')+(i+1),heroDeck.splice(0,1),p.hq(i),true);
    add(game,'Hero Deck',heroDeck,p.hero);add(game,'Villain Deck',mix(villainDeck),p.villain);
    add(game,'Bystanders',bystanders,p.bystanders,!china?false:true);
    add(game,'Wounds',take('wounds'),p.wounds,true);add(game,meta.supplyNames.officers,officers,p.officers,true);
    const mediocre=china?mix(take('mediocre')):[];
    for(let seat=1;seat<=players;seat++) {
      const start=[...take('agents',china?(s.special==='mediocrity'?7:6):8),...take('troopers',4),...mediocre.splice(0,china?(s.special==='mediocrity'?1:2):0)];
      add(game,'Mazo de jugador '+seat,mix(start),seatZone(game,seat,'draw'));
    }
    if(china) {
      if(s.special==='mediocrity')side('Mediocre Heroes · Scheme',mediocre,false,p.special);
      else pools.get('mediocre').push(...mediocre);
      notes.push('Reglas para 2–5 jugadores. Para jugar solo, el reglamento propone controlar dos manos.');
    } else {
      game.objects.push({type:'counter',id:game.nextId++,name:'Luz / Oscuridad',resource:'darkness',value:-1,rot:180,scale:1,...p.darkness});
      notes.push('Cada jugador empieza con 1 Coraje. Oscuridad empieza en 1 Dark. Los efectos de cartas se resuelven manualmente.');
      if(s.special==='courage-supply') {
        game.objects.push({type:'counter',id:game.nextId++,name:'Reserva de Coraje',resource:'courage',value:4*players,rot:180,scale:1,x:p.darkness.x,z:p.darkness.z+5});
        notes.push('Twilight Terror: reserva limitada de '+4*players+' fichas de Coraje; mueve las fichas entre la reserva y los contadores de jugador.');
      }
      if(players===1)notes.push('Solitario: 3 Henchmen, 1 Master Strike y sin Always Leads. Con cada Twist, KO un héroe de la Library de coste 6 o menos.');
    }
    if(players>=4)notes.push('Primer turno de cada jugador: no se juega carta del mazo de villanos.');
    game.setup={...game.setup,edition:game.gameId,mastermind:m.key,masterminds:bosses.map(b=>b.key),handSize:6,
      heroes:heroKeys.map(k=>decks.get(k).name),villains:villainKeys.map(k=>decks.get(k).name),henchmen:henchmenKeys.map(k=>decks.get(k).name),
      twists:c.twists,masterStrikes:c.strikes,bystanders:c.bystanders,heroKeys,villainKeys,henchmenKeys,extraHero,excludedCommons,executionerKey,
      heroMode:options.heroKeys?'manual':'random',villainMode:options.villainKeys?'manual':'random',henchmenMode:options.henchmenKeys?'manual':'random',notes};
    let z=39;
    for(const group of ['Reservas','Masterminds','Villanos','Henchmen','Héroes','Mazos iniciales','Promocionales']) {
      const remaining=[...decks.values()].filter(d=>d.group===group&&pools.get(d.key).length);
      if(!remaining.length)continue;
      label(group.toUpperCase(),{x:-24,z:z+3});
      remaining.forEach((d,i)=>add(game,d.name+(taken.has(d.key)?' · Restantes':''),take(d.key),{x:-22+(i%10)*4.7,z:z+Math.floor(i/10)*6},true,{key:d.key,group,libraryReserve:true}));
      z+=Math.ceil(remaining.length/10)*6+4;
    }
    game.libraryTaken=[...decks.keys()];return game;
  }
  function advanceDarkness(game,delta,seat) {
    const counter=game.objects.find(o=>o.resource==='darkness');
    if(!counter||![1,-1].includes(delta))throw new Error('No se puede avanzar el marcador.');
    let value=counter.value+delta,message=delta>0?'Avanza la Luz':'Avanza la Oscuridad';
    if(value===0)value=delta;
    if(value===4) {
      value=1;const courage=game.objects.find(o=>o.resource==='courage'&&o.playerId===seat);
      const supply=game.objects.find(o=>o.resource==='courage'&&!o.playerId);
      if(courage&&(!supply||supply.value>0)) {courage.value++;if(supply)supply.value--;message='Luz 1 · Ganas 1 Coraje';}
      else message='Luz 1 · No queda Coraje en la reserva';
    }
    if(value===-4) {value=-1;message='Oscuridad 1 · Resuelve la habilidad Dark del Big Bad';}
    counter.value=value;return message;
  }
  return {prepare,counts,requiredGroups,positions,advanceDarkness};
})();
if(typeof module!=='undefined')module.exports=ClassicLegendarySetup;
