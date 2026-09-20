'use strict';

// Core Set Second Edition and DC use the 2026 setup table. Card effects remain
// player-resolved, as on the other virtual tables.
const ModernLegendarySetup=(()=>{
  const clone=v=>JSON.parse(JSON.stringify(v));
  const count=(v,p,fallback=0)=>v===undefined?fallback:Array.isArray(v)?v[p-1]:v;
  function requiredGroups(scenario,players,mastermind,soloAlwaysLeads=false) {
    const villains=[...(scenario.villains||[])],henchmen=[];
    let villainChoices=[];
    if(mastermind&&(players>1||soloAlwaysLeads)) {
      const capacity=players+(scenario.extraVillains||0);
      for(const key of mastermind.villains||[]) {
        // The optional solo rule fills an existing slot; Scheme requirements win.
        if(!villains.includes(key)&&(players>1||villains.length<capacity))villains.push(key);
      }
      if(mastermind.villainChoices&&(players>1||villains.length<capacity||mastermind.villainChoices.some(k=>villains.includes(k))))villainChoices=[...mastermind.villainChoices];
      henchmen.push(...mastermind.henchmen||[]);
    }
    return {villains,henchmen,villainChoices};
  }
  function project(matrix,x,y) {
    const [a,b,c,d,e,f,g,h]=matrix,k=g*x+h*y+1;
    return {x:(a*x+b*y+c)/k,y:(d*x+e*y+f)/k};
  }
  function positions(data,game) {
    const mat=(game||data).objects.find(o=>o.type==='playmat');
    const board=mat.board||(game?'classic':data.modernSetups.board);
    const pixel=(x,y,w,h)=>({x:mat.x+(x/w-.5)*mat.width,z:mat.z+(.5-y/h)*mat.height});
    if(board==='marvel2') {
      const p=(x,y)=>{const at=project(mat.textureProjection,x/2048,y/954);return pixel(at.x,at.y,1,1);};
      return {mastermind:p(718,496),tactics:p(263,496),scheme:p(718,230),special:p(522,230),
        officers:p(718,764),sidekicks:p(516,764),bystanders:p(1794,224),wounds:p(1610,224),
        villain:p(1805,496),hero:p(1813,761),hq:i=>p([908,1083,1258,1433,1610][i],764),
        city:i=>p([1600,1425,1250,1075,900][i],477)};
    }
    if(board==='dc') {
      const p=(x,y)=>pixel(x,y,2048,934);
      return {mastermind:p(716,482),tactics:p(270,212),scheme:p(716,212),special:p(517,212),officers:p(716,746),sidekicks:p(517,746),
        bystanders:p(1800,212),wounds:p(1612,212),villain:p(1800,482),hero:p(1800,746),
        hq:i=>p([900,1075,1250,1425,1600][i],746),city:i=>p([1600,1425,1250,1075,900][i],482),hope:p(270,612),
        tornado:{x:p(1600,482).x,z:mat.z+mat.height/2+2.3}};
    }
    const p=(x,y)=>pixel(x,y,1831,1304);
    return {mastermind:p(176,842),scheme:p(176,472),officers:p(176,1160),sidekicks:{x:-17,z:-1},
      bystanders:p(1680,472),wounds:p(1382,472),villain:p(1658,842),hero:p(1658,1160),
      hq:i=>p([490,700,912,1126,1340][i],1160),city:i=>p([1340,1126,912,700,490][i],842)};
  }
  function prepare({data,game,scenario,players,options,random,add,seatZone,shuffle}) {
    const meta=data.modernSetups;
    if(meta?.version!==1)throw new Error('Recarga la página para actualizar este juego.');
    const p=positions(data,game),decks=new Map(data.objects.filter(o=>o.type==='stack').map(o=>[o.key,o]));
    const pools=new Map([...decks].map(([key,d])=>[key,clone(d.cards)]));
    const mix=cards=>shuffle(cards,random),notes=[],taken=new Set();
    const take=(key,n)=>{
      const pool=pools.get(key);
      if(!pool)throw new Error('Falta el mazo '+key+'.');
      n??=pool.length;
      if(!Number.isInteger(n)||n<0||n>pool.length)throw new Error('No hay suficientes cartas de '+decks.get(key).name+'.');
      taken.add(key);return pool.splice(0,n);
    };
    const choose=(group,n,required=[],excluded=[])=>{
      const keys=[...new Set(required)];
      if(keys.some(k=>!decks.has(k)||decks.get(k).group!==group||excluded.includes(k)))throw new Error('Selección de grupos incompatible.');
      n=Math.max(n,keys.length);
      const available=mix([...decks.values()].filter(d=>d.group===group&&!keys.includes(d.key)&&!excluded.includes(d.key)));
      keys.push(...available.slice(0,n-keys.length).map(d=>d.key));
      if(keys.length!==n)throw new Error('Faltan grupos de '+group+'.');
      return keys;
    };
    const selection=(field,group,n,required=[])=>{
      const selected=options[field];
      if(selected===undefined)return choose(group,n,required);
      if(!Array.isArray(selected)||new Set(selected).size!==selected.length||selected.some(k=>decks.get(k)?.group!==group))throw new Error('Selección no válida de '+group+'.');
      const expected=Math.max(n,new Set(required).size);
      if(selected.length!==expected)throw new Error('Elige '+expected+' grupos de '+group+'.');
      const missing=required.filter(k=>!selected.includes(k));
      if(missing.length)throw new Error('El Scheme o Always Leads exige incluir '+missing.map(k=>decks.get(k).name).join(', ')+'.');
      return [...selected];
    };
    let sideSlot=0;
    const label=(name,pos)=>game.objects.push({type:'text',id:game.nextId++,text:name,name,fontSize:24,rot:0,scale:1,...pos});
    const side=(name,cards,faceUp=true,pos)=>{
      pos||={x:-22+(sideSlot++%10)*4.7,z:24+Math.floor((sideSlot-1)/10)*6};
      const o=add(game,name,cards,pos,faceUp);if(o)label(name,{x:pos.x,z:pos.z+2.5});return o;
    };
    const concealed=scenario.special==='bodyguards';
    const requested=options.mastermind||meta.defaultMastermind;
    const m=concealed?null:requested==='random'?mix([...meta.masterminds])[0]:meta.masterminds.find(m=>m.key===requested);
    if(!concealed&&!m)throw new Error('Elige un Mastermind de este juego.');
    const epic=Boolean(options.epic);
    const soloAlwaysLeads=game.gameId==='marvel2'&&players===1&&options.soloAlwaysLeads===true&&!concealed;
    const required=requiredGroups(scenario,players,m,soloAlwaysLeads);
    const requiredVillains=required.villains,requiredHenchmen=required.henchmen;
    if(required.villainChoices.length&&!required.villainChoices.some(k=>requiredVillains.includes(k))) {
      const choices=Array.isArray(options.villainKeys)?required.villainChoices.filter(k=>options.villainKeys.includes(k)):required.villainChoices;
      if(!choices.length)throw new Error('Always Leads exige incluir '+required.villainChoices.map(k=>decks.get(k).name).join(' o ')+'.');
      requiredVillains.push(mix([...choices])[0]);
    }
    const heroKeys=selection('heroKeys','Héroes',count(scenario.heroes,players,[3,5,5,5,6][players-1])+(scenario.extraHeroes||0),scenario.heroesRequired||[]);
    const villainKeys=selection('villainKeys','Villanos',players+(scenario.extraVillains||0),requiredVillains);
    const henchKeys=selection('henchmenKeys','Henchmen',players>=4?2:1,requiredHenchmen);
    const extraVillains=scenario.special==='liberation'?choose('Villanos',2,[],villainKeys):[];
    const bystanders=mix(take('bystanders')),officers=mix(take('officers'));
    const bystanderCount=[1,2,8,8,16][players-1]+(scenario.extraBystanders||0);
    const wounds=take('wounds',count(scenario.wounds,players,30));
    const twists=count(scenario.twists,players);
    let heroDeck=mix(heroKeys.flatMap(k=>take(k)));
    let villainDeck=[...villainKeys.flatMap(k=>take(k)),...take('twists',twists),...take('strikes',5),...bystanders.splice(0,bystanderCount)];
    let city=[];
    for(const key of henchKeys) {
      const cards=mix(take(key));
      if(players===1) {
        villainDeck.push(...cards.splice(0,2));city=cards.splice(0,2);pools.get(key).push(...cards);
      } else villainDeck.push(...cards);
    }
    if(scenario.heroVillains)villainDeck.push(...heroDeck.splice(0,scenario.heroVillains));
    if(m) {
      const cards=take(m.key),face=cards.shift();
      if(epic)[face.face,face.back]=[face.back,face.face];
      add(game,'Mastermind',[face],p.mastermind,true);
      side('Mastermind Tactics',mix(cards),false,p.tactics||{x:p.mastermind.x-5,z:p.mastermind.z});
    }
    if(concealed) {
      side('Bodyguards',officers.splice(0,3),true,p.mastermind);
      notes.push('Enshrouded Identity: no hay Mastermind ni Always Leads al empezar. Al derrotar todos los Bodyguards, usa «Revelar Mastermind» en Turno.');
    }
    if(scenario.special==='killgorithm')side('Killgorithm',take('twists',1),true,p.special||{x:p.scheme.x-5,z:p.scheme.z});
    if(scenario.special==='labors')side('Labor of Superman',wounds.splice(0,1),true,p.special||{x:p.scheme.x-5,z:p.scheme.z});
    if(scenario.special==='liberation')side('Mankind Liberation Front',mix([...extraVillains.flatMap(k=>take(k)),...bystanders.splice(0,3)]),false);
    if(scenario.special==='bizarro') {
      const index=villainDeck.findIndex(c=>c.name==='Bizarro');
      if(index<0)throw new Error('Falta Bizarro en Legion of Doom.');
      side('Bizarro · Twist 7',villainDeck.splice(index,1));
    }
    const schemes=pools.get('schemes'),index=schemes.findIndex(c=>c.uid===scenario.card);
    if(index<0)throw new Error('Falta la carta de Scheme.');
    add(game,'Scheme',schemes.splice(index,1),scenario.special==='tornado'?(p.tornado||{x:p.city(0).x,z:p.city(0).z+6}):p.scheme,true);
    taken.add('schemes');
    for(let i=0;i<5;i++)add(game,'HQ '+(i+1),heroDeck.splice(0,1),p.hq(i),true);
    add(game,'Hero Deck',heroDeck,p.hero);
    add(game,'Villain Deck',mix(villainDeck),p.villain);
    add(game,'Bystanders',bystanders,p.bystanders);
    add(game,'Wounds',wounds,p.wounds,true);
    add(game,meta.supplyNames.officers,officers,p.officers,game.gameId==='dc');
    add(game,'Daring Sidekicks',take('sidekicks'),p.sidekicks,true);
    if(game.gameId==='dc') {
      game.objects.push({type:'counter',id:game.nextId++,name:'Hope (+) / Fear (−)',resource:'hope',value:0,rot:180,scale:1,...p.hope});
      notes.push('Hope/Fear empieza en 0. Al desbordar +3: roba una carta y vuelve a +2. Al desbordar −3: descarta una carta y vuelve a −2.');
      for(const h of heroKeys) {
        const transforms=meta.heroes.find(x=>x.key===h)?.transforms;
        if(transforms)side('Transformaciones · '+decks.get(h).name,take(transforms));
      }
    }
    if(city.length) {
      city.forEach((card,i)=>add(game,'Inicio solitario · '+(i+1),[card],p.city(1-i),true));
      notes.push('Solitario: tras robar tu mano inicial, resuelve en orden los Ambush de los dos Henchmen que empiezan en la ciudad. Después juega la primera carta del Villain Deck. '+(soloAlwaysLeads?'Variante: se aplica Always Leads.':'Se ignora Always Leads.'));
    }
    if(players>=4)notes.push('Warmup Round: en el primer turno de cada jugador no se juega carta del Villain Deck.');
    notes.push('HQ inicial: si hay al menos dos Héroes de coste 7 o más, podéis acordar sustituir esos espacios y barajar las cartas retiradas en el Hero Deck.');
    for(let seat=1;seat<=players;seat++)add(game,'Mazo de jugador '+seat,mix([...take('agents',8),...take('troopers',4)]),seatZone(game,seat,'draw'));
    game.setup={...game.setup,edition:game.gameId,mastermind:m?.key||null,epic,soloAlwaysLeads,handSize:6,twists,masterStrikes:5,bystanders:bystanderCount,
      heroes:heroKeys.map(k=>decks.get(k).name),villains:villainKeys.map(k=>decks.get(k).name),henchmen:henchKeys.map(k=>decks.get(k).name),
      extraVillains:extraVillains.map(k=>decks.get(k).name),soloMode:players===1?'modern':null,hiddenMastermind:concealed,notes,
      heroKeys,villainKeys,henchmenKeys:henchKeys,heroMode:options.heroKeys?'manual':'random',
      villainMode:options.villainKeys?'manual':'random',henchmenMode:options.henchmenKeys?'manual':'random'};
    label(notes.join('\n'),{x:-22,z:36});
    // Every unused physical card remains available outside the active setup.
    const groups=['Reservas','Masterminds','Villanos','Henchmen','Héroes','Transformaciones','Mazos iniciales'];
    let z=43;
    for(const group of groups) {
      const remaining=[...decks.values()].filter(d=>d.group===group&&pools.get(d.key).length);
      if(!remaining.length)continue;
      label(group.toUpperCase(),{x:-24,z:z+3});
      remaining.forEach((d,i)=>add(game,d.name+(taken.has(d.key)?' · Restantes':''),take(d.key),{x:-22+(i%10)*4.7,z:z+Math.floor(i/10)*6},true,{key:d.key,group,libraryReserve:true}));
      z+=Math.ceil(remaining.length/10)*6+4;
    }
    game.libraryTaken=[...decks.keys()];
    return game;
  }
  function revealMastermind({data,game,random,add,shuffle}) {
    if(!game.setup?.hiddenMastermind)throw new Error('Este Scheme ya tiene un Mastermind.');
    const m=data.modernSetups.masterminds[Math.floor(random()*data.modernSetups.masterminds.length)];
    const source=game.objects.find(o=>o.key===m.key&&o.cards?.length===5);
    if(!source)throw new Error('Devuelve a Reserva las cinco cartas de '+m.name+' antes de revelarlo.');
    const cards=source.cards.splice(0),face=cards.shift(),p=positions(data,game);
    game.objects=game.objects.filter(o=>o!==source);
    if(game.setup.epic)[face.face,face.back]=[face.back,face.face];
    add(game,'Mastermind',[face],p.mastermind,true);
    add(game,'Mastermind Tactics',shuffle(cards,random),p.tactics||{x:p.mastermind.x-5,z:p.mastermind.z});
    game.setup.mastermind=m.key;game.setup.hiddenMastermind=false;
    return 'Mastermind revelado: '+m.name;
  }
  return {prepare,positions,revealMastermind,count,project,requiredGroups};
})();
if(typeof module!=='undefined')module.exports=ModernLegendarySetup;
