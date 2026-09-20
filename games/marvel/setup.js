'use strict';

// Marvel preparation only. Players resolve card effects during play.
// The recipes are compiled from reviewed printed cards by prepare_marvel_setups.py.
const MarvelSetup = (() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const count = (value,players,fallback=0) => value===undefined ? fallback : Array.isArray(value) ? value[players-1] : value;
  const point = (x,y) => ({x:(x-1831/2)*20/1304,z:7+(1304/2-y)*20/1304});
  const cityPoint = i => point([1340,1126,912,700,490][i] ?? 490-(i-4)*212,842);
  const hqPoint = i => point([490,700,912,1126,1340][i] ?? 1340+(i-4)*212,1160);
  const classes = ['strength','instinct','covert','tech','ranged'];
  const classNames = ['Fuerza','Instinto','Encubierto','Tecnología','A distancia'];
  const collectionOf=item=>[...(item.name||item.title||'').matchAll(/\(([^()]+)\)/g)].at(-1)?.[1]||'Core';
  const collections=metadata=>[...new Set([...metadata.schemes,...metadata.masterminds,...metadata.heroes].map(collectionOf))].sort((a,b)=>a==='Core'?-1:b==='Core'?1:a.localeCompare(b));
  function compatible(scenario,mastermind) {
    if(['hidden-heart','tyrants','world-war-hulk','symbiotic'].includes(scenario.special)&&mastermind.adapting)
      return 'Este Scheme necesita un Mastermind con carta principal y cuatro tácticas.';
    return '';
  }
  function prepare({data,game,scenario,players,options,random,add,seatZone,shuffle}) {
    const metadata=data.marvelSetups;
    if(metadata?.version!==1)throw new Error('Recarga la página para actualizar las preparaciones de Marvel.');
    const deckMap=new Map(data.objects.filter(o=>o.type==='stack').map(o=>[o.key,o]));
    const heroMap=new Map(metadata.heroes.map(h=>[h.key,h]));
    const knownCollections=collections(metadata);
    if(options.collections!==undefined&&!Array.isArray(options.collections))throw new Error('Elige al menos una colección válida.');
    const selectedCollections=options.collections===undefined?null:new Set(options.collections);
    if(selectedCollections&&(!Array.isArray(options.collections)||!selectedCollections.size||[...selectedCollections].some(c=>!knownCollections.includes(c))))throw new Error('Elige al menos una colección válida.');
    const allowed=d=>!selectedCollections||selectedCollections.has(collectionOf(d));
    if(!allowed(scenario))throw new Error('El Scheme no pertenece a las colecciones seleccionadas.');
    if(options.heroKeys!==undefined&&!Array.isArray(options.heroKeys))throw new Error('Elige una lista de héroes.');
    const manualHeroes=options.heroKeys===undefined?null:new Set(options.heroKeys);
    if(manualHeroes&&(!Array.isArray(options.heroKeys)||manualHeroes.size!==options.heroKeys.length||[...manualHeroes].some(k=>!heroMap.has(k)||!allowed(heroMap.get(k)))))throw new Error('Elige héroes distintos de las colecciones seleccionadas.');
    const coreOnly=selectedCollections?.size===1&&selectedCollections.has('Core');
    const pools=new Map(),blocked=new Set(),notes=[];
    const entry=key=>{const d=deckMap.get(key);if(!d)throw new Error('Falta un mazo de Marvel: '+key);return d;};
    const pool=key=>{if(!pools.has(key))pools.set(key,clone(entry(key).cards));return pools.get(key);};
    const mix=cards=>shuffle(cards,random);
    const take=(key,n,randomize=false)=>{
      if(['Héroes','Villanos','Henchmen','Masterminds'].includes(entry(key).group)&&!allowed(entry(key)))throw new Error('La preparación necesita '+entry(key).name+'. Activa también su colección.');
      const cards=pool(key);n??=cards.length;
      if(n<0||!Number.isInteger(n)||n>cards.length)throw new Error('No hay suficientes cartas de '+entry(key).name+'.');
      if(randomize)mix(cards);
      if(!game.libraryTaken.includes(key))game.libraryTaken.push(key);
      blocked.add(key);return cards.splice(0,n);
    };
    const remove=(cards,n,name)=>{
      if(cards===bystanders&&cards.length<n)for(const key of ['eae6a5','9e5b1e','616d01']) {
        const extra=Math.min(n-cards.length,pool(key).length);
        if(extra>0)cards.push(...take(key,extra));
      }
      if(cards.length<n)throw new Error('Faltan cartas en '+name+'.');return cards.splice(0,n);
    };
    let sideIndex=0;
    const label=(name,p)=>game.objects.push({type:'text',id:game.nextId++,name,text:name,fontSize:24,rot:0,scale:1,x:p.x,z:p.z});
    const side=(name,cards,faceUp=false,p)=>{
      p ||= {x:-37+(sideIndex%17)*4.5,z:23+Math.floor(sideIndex++/17)*6};
      const object=add(game,name,cards,p,faceUp,{marvelActive:true});
      if(object)label(name,{x:p.x,z:p.z+2.5});return object;
    };
    const counter=(name,value,p)=>game.objects.push({type:'counter',id:game.nextId++,name,value,
      x:p?.x??(-18-(sideIndex%3)*4),z:p?.z??(15-Math.floor(sideIndex++/3)*3),rot:180,scale:1,resource:'custom'});
    const choose=(group,n,required=[],preferred=[],filter=()=>true)=>{
      const keys=[...new Set(required)];
      for(const key of keys)if(entry(key).group!==group||blocked.has(key)||!allowed(entry(key))||!filter(entry(key)))
        throw new Error('El Scheme y el Mastermind necesitan reservar el mismo grupo: '+entry(key).name+'.');
      n=Math.max(n,keys.length);
      for(const key of preferred)if(keys.length<n&&!keys.includes(key)&&!blocked.has(key)&&filter(entry(key))) {
        if(!allowed(entry(key)))throw new Error('Always Leads necesita '+entry(key).name+'. Activa también su colección.');
        keys.push(key);
      }
      const candidates=mix([...deckMap.values()].filter(d=>d.group===group&&allowed(d)&&!blocked.has(d.key)&&!keys.includes(d.key)&&filter(d)));
      keys.push(...candidates.slice(0,n-keys.length).map(d=>d.key));
      if(keys.length!==n)throw new Error('No hay suficientes grupos disponibles de '+group+'.');
      keys.forEach(k=>blocked.add(k));return keys;
    };
    const chooseHero=(predicate=()=>true,main=false)=>choose('Héroes',1,[],[],d=>predicate(heroMap.get(d.key),d)&&(!manualHeroes||(main?manualHeroes.has(d.key):!manualHeroes.has(d.key))))[0];
    const schemeNumber=Number(scenario.card.split('-')[1]);
    const epic=Boolean(options.epic);
    const candidates=metadata.masterminds.filter(m=>allowed(m)&&!compatible(scenario,m)&&(!epic||m.epic));
    const selected=options.mastermind||'889fb1';
    const mastermind=selected==='random'?mix([...candidates])[0]:metadata.masterminds.find(m=>m.key===selected);
    if(!mastermind)throw new Error('Elige un Mastermind de la colección.');
    if(!allowed(mastermind))throw new Error('El Mastermind no pertenece a las colecciones seleccionadas.');
    const incompatibility=compatible(scenario,mastermind);
    if(incompatibility)throw new Error(incompatibility);
    if(epic&&!mastermind.epic)throw new Error('Este Mastermind no tiene una versión Epic en el mod.');
    if(players<(scenario.minPlayers||1))throw new Error('Este Scheme necesita al menos '+scenario.minPlayers+' jugadores.');
    if(options.soloMode&&!['classic','advanced'].includes(options.soloMode))throw new Error('Modo solitario no válido.');
    const special=scenario.special;
    const leads=players>1||mastermind.leadsSolo;
    const villainLeads=leads?[...mastermind.villains]:[];
    const henchLeads=leads?[...mastermind.henchmen]:[];
    if(leads&&mastermind.villainChoices)villainLeads.push(mix([...mastermind.villainChoices])[0]);
    if(leads&&mastermind.henchmanChoices)henchLeads.push(mix([...mastermind.henchmanChoices])[0]);
    const mmExtra=epic?(mastermind.epicExtraVillains??mastermind.extraVillains??0):(mastermind.extraVillains||0);
    let heroCount=count(scenario.heroes,players,players===1?3:players===5?6:5)+count(scenario.extraHeroes,players)+(mastermind.extraHeroes||0);
    let villainCount=count(scenario.villainGroups,players,[1,2,3,3,4][players-1])+count(scenario.extraVillains,players)+mmExtra;
    let henchCount=(players>=4?2:1)+count(scenario.extraHenchmen,players);
    const requiredVillains=[...(scenario.villains||[]),...(scenario.extraVillainsRequired||[])];
    const requiredHenchmen=[...(scenario.henchmen||[]),...(scenario.extraHenchmenRequired||[])];
    const requiredHeroes=[...(scenario.heroesRequired||[]),...(mastermind.heroes||[])];
    requiredHeroes.forEach(k=>blocked.add(k));
    const sideMasters=[];
    const pickMaster=()=>{
      const remaining=metadata.masterminds.filter(m=>allowed(m)&&!m.adapting&&m.key!==mastermind.key&&!sideMasters.some(s=>s.key===m.key));
      if(!remaining.length)throw new Error('No quedan Masterminds compatibles con el Scheme.');
      const m=mix(remaining)[0];sideMasters.push(m);return m;
    };
    if(special==='symbiotic') {
      // The Scheme specifically asks for a Villain group, not a Henchman group.
      const remaining=metadata.masterminds.filter(m=>allowed(m)&&!m.adapting&&m.key!==mastermind.key&&m.villains.length===1);
      if(!remaining.length)throw new Error('Activa otra colección con un Mastermind compatible con este Scheme.');
      const m=mix(remaining)[0];sideMasters.push(m);villainCount++;requiredVillains.push(...m.villains);
    }
    if(special==='world-war-hulk'||special==='tyrants')for(let i=0;i<3;i++)pickMaster();
    if(special==='chthon'&&mastermind.key==='8ac205')notes.push('Lilith: se usa 1 Scheme Twist y se mantiene el grupo extra Lilin.');
    if(special==='mixtape') {villainCount*=2;henchCount*=2;}
    if(special==='assault-squads')requiredHenchmen.push('0ff56f');
    if(special==='maggia')requiredHenchmen.push('80b5e4');
    // Reserve groups used outside the normal decks before selecting random ones.
    const reserveKeys={ 'quantum-realm':['0df648'],'cytoplasm':['fcc501'],'monster-pit':['abeca3'],'thor':['e9eb8d'],'cops':['b2a269'] };
    for(const key of reserveKeys[special]||[])blocked.add(key);
    const sideHeroKeys={};
    if(scenario.villainHero) {
      const match=scenario.villainHero;
      const explicit={'jean-grey':'31acc7','scarlet-witch':'b12bf2'}[match];
      sideHeroKeys.villain=explicit||(chooseHero(h=>match==='random'||h.name.toLowerCase().includes(match)));
      blocked.add(sideHeroKeys.villain);
    }
    if(special==='adam-warlock') {sideHeroKeys.adam='8dd9d8';blocked.add('8dd9d8');}
    if(special==='shrink-tech')sideHeroKeys.shrink=chooseHero(h=>/^(Ant-Man|Wasp|Goliath|Stature)\(/.test(h.name));
    if(special==='hulk-deck'||special==='mutation-pile')sideHeroKeys.hulk=chooseHero(h=>h.name.includes('Hulk'));
    if(special==='wedding')sideHeroKeys.wedding=[chooseHero(h=>h.costReady),chooseHero(h=>h.costReady)];
    if(special==='dark-loyalty')sideHeroKeys.loyalty=chooseHero(h=>h.costReady);
    if(special==='time-heist')sideHeroKeys.past=Array.from({length:4},()=>chooseHero());
    if(special==='marvel-zombies') {
      const zombies=['3547fc','8f35e2'];
      requiredVillains.push(villainLeads.find(k=>zombies.includes(k))||mix([...zombies])[0]);
      for(const k of zombies)if(!requiredVillains.includes(k))blocked.add(k);
    }
    if(special==='shield-hydra') {
      const hydra=['dab7c4','58ffcc'];
      requiredVillains.push(villainLeads.find(k=>hydra.includes(k))||mix([...hydra])[0]);
      for(const k of hydra)if(!requiredVillains.includes(k))blocked.add(k);
    }
    const predicate=key=>heroMap.get(key);
    if(scenario.heroMatch==='nova')requiredHeroes.push('952177');
    else if(scenario.heroMatch)requiredHeroes.push(chooseHero(h=>h.name.toLowerCase().includes(scenario.heroMatch),true));
    if(scenario.heroTeam)requiredHeroes.push(chooseHero(h=>h.team===scenario.heroTeam,true));
    if(special==='two-hulks')requiredHeroes.push(chooseHero(h=>h.name.includes('Hulk'),true),chooseHero(h=>h.name.includes('Hulk'),true));
    const homeHeroes=special==='heroes-homes'?Array.from({length:players},()=>chooseHero(h=>h.costReady,true)):[];
    requiredHeroes.push(...homeHeroes);
    // The helper reserves candidates as it selects them. Required Heroes are
    // selected into the main deck now, so release those reservations only.
    requiredHeroes.forEach(k=>blocked.delete(k));
    const heroAllowed=d=>{
      const h=predicate(d.key);
      if(manualHeroes&&!manualHeroes.has(d.key))return false;
      if(special==='divide-conquer'&&!h.classReady)return false;
      if(special==='nova-corps'&&h.name.toLowerCase().includes('nova')&&d.key!=='952177')return false;
      if(special==='two-hulks'&&h.name.includes('Hulk')&&!requiredHeroes.includes(d.key))return false;
      return true;
    };
    let heroKeys=[];
    if(manualHeroes) {
      const expected=Math.max(heroCount,new Set(requiredHeroes).size,scenario.heroTeams?.reduce((n,t)=>n+t[1],0)||0);
      if(manualHeroes.size!==expected)throw new Error('Esta preparación necesita '+expected+' héroes. Has elegido '+manualHeroes.size+'.');
      const missing=requiredHeroes.filter(k=>!manualHeroes.has(k));
      if(missing.length)throw new Error('Incluye los héroes que exige la preparación: '+missing.map(k=>entry(k).name).join(', ')+'.');
    }
    if(scenario.heroTeams) {
      for(const [team,n] of scenario.heroTeams) {
        const fits=d=>heroAllowed(d)&&(team.startsWith('!')?predicate(d.key).team!==team.slice(1):predicate(d.key).team===team);
        heroKeys.push(...choose('Héroes',n,requiredHeroes.filter(k=>fits(entry(k))),[],fits));
      }
      // A Mastermind's additional Hero still applies to team-based schemes.
      if(heroCount>heroKeys.length)heroKeys.push(...choose('Héroes',heroCount-heroKeys.length,[],[],heroAllowed));
    } else heroKeys=choose('Héroes',heroCount,[...new Set(requiredHeroes)],[],heroAllowed);
    heroCount=heroKeys.length;
    // Scheme requirements have priority over Always Leads when slots conflict.
    // Kree-Skrull War explicitly includes both groups even in a one-player game.
    const villainKeys=choose('Villanos',villainCount,[...new Set(requiredVillains)],villainLeads);
    const henchKeys=choose('Henchmen',henchCount,[...new Set(requiredHenchmen)],henchLeads);
    let variantKey;
    if(mastermind.timelineVariants)variantKey=choose('Villanos',1)[0];
    let heroDeck=mix(heroKeys.flatMap(k=>take(k)));
    const standardBystanders=take('eae6a5',30);
    const expanded=options.supplies!=='base'&&(!selectedCollections||selectedCollections.size===knownCollections.length);
    const bystanders=expanded?mix([...standardBystanders,...take('f83db1'),...take('3050c9')]):standardBystanders;
    const allWounds=expanded?mix([...take('f49fdc',30),...take('28b1a8')]):take('f49fdc',30);
    const wounds=remove(allWounds,count(scenario.wounds,players,allWounds.length),'Wounds');
    // Unused wound copies stay outside the game, not in the active stack.
    const officers=expanded?mix([...take('49f6ff',30),...take('fab774')]):take('49f6ff',30);
    if(scenario.officers!==undefined)officers.splice(scenario.officers);
    const sidekicks=coreOnly?[]:mix([...take('43623a'),...(expanded?[...take('201e40'),...take('05355a')]:[])]);
    const bindings=coreOnly?[]:take('51c60e',count(scenario.bindings,players,30));
    const twists=take('c82082');
    let twistCount=special==='chthon'&&mastermind.key==='8ac205'?1:count(scenario.twists,players);
    let strikeCount=players===1&&options.soloMode!=='advanced'?1:5;
    const strikes=take('c7aaa3',strikeCount);
    const baseBystanders=count(scenario.bystanders,players,[1,2,8,8,12][players-1])+count(scenario.extraBystanders,players);
    const bystanderCards=remove(bystanders,baseBystanders,'Bystanders');
    if(scenario.bystandersSupply!==undefined)bystanders.splice(Math.max(0,scenario.bystandersSupply-baseBystanders));
    const villainGroups=villainKeys.map(k=>({key:k,cards:take(k,special==='mixtape'?Math.floor(entry(k).cards.length/2):undefined,special==='mixtape')}));
    const extraHenchmen=new Set(scenario.extraHenchmenRequired||[]);
    // Extra Scheme groups always contain ten cards, including in solo.
    for(const k of [...henchKeys].reverse())if(extraHenchmen.size<count(scenario.extraHenchmen,players))extraHenchmen.add(k);
    if(special==='assault-squads')extraHenchmen.add('0ff56f');
    if(special==='maggia')extraHenchmen.add('80b5e4');
    const henchmen=henchKeys.flatMap(k=>take(k,special==='mixtape'?(players===1?2:5):extraHenchmen.has(k)?10:players===1?(mastermind.soloHenchmen&&!epic?mastermind.soloHenchmen:3):10,true));
    let villainDeck=[...villainGroups.flatMap(g=>g.cards),...henchmen,...bystanderCards,...strikes];
    if(twistCount>11) {
      const proxies=remove(wounds,twistCount-11,'Wounds');
      for(const c of proxies)c.name='Scheme Twist · representado por Wound';
      villainDeck.push(...twists,...proxies);twists.length=0;
      notes.push('14 Twists: 11 Scheme Twists y 3 Wounds que los representan.');
    } else if(special!=='nexus'&&special!=='fragmented-realities')villainDeck.push(...remove(twists,twistCount,'Scheme Twists'));
    if(sideHeroKeys.villain)villainDeck.push(...take(sideHeroKeys.villain,scenario.villainHeroCards,true));
    if(scenario.villainOfficers)villainDeck.push(...remove(officers,scenario.villainOfficers,'S.H.I.E.L.D. Officers'));
    if(scenario.heroBystanders)heroDeck.push(...remove(bystanders,count(scenario.heroBystanders,players),'Bystanders'));
    const cost=c=>{const value=metadata.faces[c.face]?.cost;if(value===undefined)throw new Error('No se conoce el coste de '+c.name+'.');return value;};
    const starters=Array.from({length:players},(_,i)=>take(['792aaa','763235','3536ec','5f46be','a9a627'][i]));
    if(mastermind.starterWounds)for(const deck of starters)deck.push(...remove(wounds,mastermind.starterWounds,'Wounds'));
    if(special==='heroes-homes')homeHeroes.forEach((key,i)=>{
      const names=new Set(),source=entry(key).cards;
      const nonRare=new Set(source.filter(c=>source.filter(other=>other.face===c.face).length>1).map(c=>c.face));
      for(let at=heroDeck.length-1;at>=0&&names.size<3;at--)if(source.some(c=>c.uid===heroDeck[at].uid)&&nonRare.has(heroDeck[at].face)&&!names.has(heroDeck[at].face)) {
        names.add(heroDeck[at].face);starters[i].push(...heroDeck.splice(at,1));
      }
      if(names.size!==3)throw new Error('Faltan las tres cartas iniciales del héroe del jugador '+(i+1)+'.');
      starters[i].push(...remove(wounds,3,'Wounds'));
    });
    if(special==='nova-corps')for(const deck of starters) {
      const at=heroDeck.findIndex(c=>entry('952177').cards.some(n=>n.uid===c.uid)&&cost(c)===2);
      if(at<0)throw new Error('Falta una carta de Nova de coste 2.');
      deck.push(...heroDeck.splice(at,1),...remove(wounds,2,'Wounds'),...remove(officers,1,'Officers'));
    }
    const addMaster=(m,name='Mastermind',tacticCount=4,main=false)=>{
      const cards=take(m.key),pos=main?(scenario.city===7?{x:-21,z:cityPoint(0).z}:point(176,842)):undefined;
      if(epic&&main)for(const c of m.adapting?cards:[cards[0]])[c.face,c.back]=[c.back,c.face];
      if(m.adapting) {
        if(main)add(game,name,mix(cards),pos,true,{marvelActive:true});else side(name,mix(cards),true);
        return [];
      }
      const face=cards.shift(),tactics=mix(cards).splice(0,tacticCount);
      if(main) {
        add(game,name,[face],pos,true);
        if(special==='hidden-heart')return tactics;
        side(name+' Tactics',tactics,false,{x:scenario.city===7?-26:-17,z:3.5});
      } else {side(name,[face],true);side(name+' · Tactics',tactics);}
      return tactics;
    };
    const masterTactics=addMaster(mastermind,'Mastermind',special==='world-war-hulk'?2:4,true);
    if(special==='hidden-heart')villainDeck.push(...masterTactics);
    for(const m of sideMasters) {
      if(special==='tyrants') {
        const cards=take(m.key);side('Tyrant · '+m.name,cards.splice(0,1),true);villainDeck.push(...cards);
      } else addMaster(m,(special==='world-war-hulk'?'Lurking · ':'Drained · ')+m.name,special==='world-war-hulk'?2:4);
    }
    const hostages=epic?(mastermind.epicHostages??mastermind.hostages):mastermind.hostages;
    if(hostages)side(mastermind.hostageName,remove(bystanders,hostages,'Bystanders'),Boolean(mastermind.hostagesFaceUp),{x:-17,z:10});
    if(mastermind.angryMobs)side('Angry Mobs',remove(officers,players*2,'S.H.I.E.L.D. Officers'),false,{x:-17,z:10});
    if(variantKey)side('Timeline Variants',mix(take(variantKey)));
    let handSize=mastermind.handSize||6,openingPlays=0;
    if(epic&&mastermind.epicHorrors) {
      const horrors=take('b119a8',mastermind.epicHorrors,true),inPlay=[];
      for(const horror of horrors) {
        const n=Number(horror.uid.split('-')[1]);
        if(n===19)handSize--;
        if(n===6||n===17) {
          const sourceKey=n===6?'c7aaa3':'c82082';
          const cards=pool(sourceKey).length?take(sourceKey,1):remove(wounds,1,'Wounds');
          if(cards[0].face!==entry(sourceKey).cards[0].face)cards[0].name=(n===6?'Master Strike':'Scheme Twist')+' · representado por Wound';
          villainDeck.push(...cards);if(n===6){strikeCount++;openingPlays++;}else twistCount++;
        }
        if(n===9)openingPlays+=2;
        if(n===16) {
          const m=pickMaster();addMaster(m,'Horror · '+m.name,1);
          if(m.handSize)handSize--;
        }
        if(n===20)for(let seat=1;seat<=players;seat++)side('Descarte de jugador '+seat,remove(wounds,1,'Wounds'),true,seatZone(game,seat,'discard'));
        if(n===2||n===15)side('Descarte de jugador 1',[horror],true,seatZone(game,1,'discard'));
        else inPlay.push(horror);
      }
      side('Horrors · En juego',inPlay,true);
    }
    const card=pool('54a8c8').find(c=>c.uid===scenario.card);
    if(!card)throw new Error('Falta la carta de Scheme.');
    game.libraryTaken.push('54a8c8');
    add(game,'Scheme',[card],special==='blood-bank'?{...cityPoint(1),z:10}:point(176,472),true);
    const sortedHero=k=>take(k).sort((a,b)=>cost(a)-cost(b));
    switch(special) {
      case 'quantum-realm': {
        const cards=take('0df648');const ambush=cards.findIndex(c=>c.uid==='marvel-2280');
        villainDeck.push(...cards.splice(ambush,1));side('Quantum Realm · Fuera del Villain Deck',mix(cards));break;
      }
      case 'shrink-tech':side('Shrink Tech',mix(take(sideHeroKeys.shrink)),true);break;
      case 'dark-loyalty':side('Dark Loyalty',mix(take(sideHeroKeys.loyalty).filter(c=>cost(c)<=5)).slice(0,5));break;
      case 'wedding':sideHeroKeys.wedding.forEach(k=>side('Wedding Hero · '+entry(k).name,sortedHero(k),true));break;
      case 'adam-warlock':side('Adam Warlock · Menor a mayor coste',sortedHero(sideHeroKeys.adam),true);break;
      case 'hulk-deck':side('Hulk Deck',mix(take(sideHeroKeys.hulk)));break;
      case 'mutation-pile':side('Mutation Pile',take(sideHeroKeys.hulk),true);break;
      case 'killbots':side('Killbots · Fuerza inicial',remove(twists,3,'Twists'),true);break;
      case 'jurors':side('Galactic Jurors',remove(bystanders,11,'Bystanders'));break;
      case 'young-mutants':side('Young Mutants',remove(bystanders,8,'Bystanders'),true);break;
      case 'spies':side('Infiltrating Spies',remove(bystanders,21,'Bystanders'),true);break;
      case 'nega-bomb':side('Nega-Bomb Deck',remove(bystanders,6,'Bystanders'));break;
      case 'cops':side('Cops · Scheme',take('b2a269',players*2,true),true);break;
      case 'traitor':side('Betrayal Deck',mix([...remove(bindings,players*3,'Bindings'),...remove(twists,1,'Twists')]));break;
      case 'monster-pit':side('Monster Pit',mix(take('abeca3')));break;
      case 'cytoplasm':side('Infected Deck',mix([...remove(bystanders,20,'Bystanders'),...take('fcc501')]));break;
      case 'annihilation-army': {
        const k=choose('Henchmen',1)[0],cards=take(k);
        for(const c of cards)c.name='Annihilation Wave · '+c.name;
        side('KO · Annihilation Wave',cards,true);notes.push('Un grupo extra de 10 Henchmen representa la Annihilation Wave en la pila KO.');break;
      }
      case 'ambitions':villainDeck.push(...take('cf8452',10,true));break;
      case 'corrupt-sidekicks':villainDeck.push(...remove(sidekicks,10,'Sidekicks'));break;
      case 'skrull-invasion':villainDeck.push(...remove(heroDeck,12,'Hero Deck'));break;
      case 'bugle':heroDeck.push(...take(choose('Henchmen',1)[0],6,true));break;
      case 'demon-bear': {
        const at=villainDeck.findIndex(c=>c.uid==='marvel-1409');
        if(at<0)throw new Error('Falta Demon Bear en la preparación.');
        side('Demon Bear',villainDeck.splice(at,1),true);break;
      }
      case 'thor': {
        const cards=take('e9eb8d');side('Thor · Scheme',cards.filter(c=>c.uid==='marvel-1546'),true);break;
      }
      case 'monument': {
        const floors=mix([...remove(bystanders,18,'Bystanders'),...remove(wounds,14,'Wounds')]);
        for(let i=1;i<=8;i++)side('Washington Monument · Piso '+i,floors.splice(0,4));break;
      }
      case 'tornado':for(let i=1;i<=players;i++)counter('Posición · Jugador '+i,1,{x:cityPoint(0).x+(i-1)*2,z:12});break;
      case 'baby-hope':counter('Baby Hope',1,{x:-17,z:14});break;
      case 'oxygen':counter('Oxygen Level',9);break;
      case 'fear-level':counter('Fear Level',8);break;
      case 'shards':counter('Shards · Reserva',30);break;
      case 'throne':counter('Throne’s Favor · 0 = sin dueño',0);break;
    }
    mix(heroDeck);mix(villainDeck);
    if(openingPlays) {
      for(let i=1;i<=openingPlays;i++)side('Horror · Resolver carta inicial '+i,remove(villainDeck,1,'Villain Deck'),true);
      notes.push('Resuelve en orden las cartas iniciales reveladas por los Horrors, con sus efectos y avances normales.');
    }
    const hqCount=scenario.hq||5;
    if(special==='divide-conquer') {
      const piles=classes.map(()=>[]);
      for(const c of heroDeck)piles[classes.indexOf(metadata.faces[c.face].class)].push(c);
      piles.forEach((cards,i)=>{mix(cards);add(game,'HQ '+(i+1),cards.splice(0,1),hqPoint(i),true);side('Hero Deck · '+classNames[i],cards,false,{x:hqPoint(i).x,z:-6});});
    } else {
      if(special==='contest-row')for(let i=1;i<=11;i++)side('Contest Row '+i,heroDeck.splice(0,1),true);
      for(let i=0;i<hqCount;i++)add(game,'HQ '+(i+1),heroDeck.splice(0,1),hqPoint(scenario.city===3?i+2:i),!scenario.hqFaceDown);
      add(game,'Hero Deck',heroDeck,hqCount>5?{x:23,z:-1}:point(1658,1160));
    }
    if(special==='time-heist') {
      const past=mix(sideHeroKeys.past.flatMap(k=>take(k)));
      side('Past Hero Deck',past.splice(5));
      for(let i=0;i<5;i++){side('Past HQ '+(i+1),past.splice(0,1),true);label('Past City '+(i+1),{x:-8+i*4,z:32});}
    }
    if(special==='nexus') {
      const remainingUids=new Set(villainDeck.map(c=>c.uid));
      const groupUids=new Set(villainGroups.flatMap(g=>g.cards.map(c=>c.uid)));
      const rest=mix(villainDeck.filter(c=>!groupUids.has(c.uid)));
      villainGroups.forEach((group,i)=>{
        const cards=[...group.cards.filter(c=>remainingUids.has(c.uid)),...remove(twists,2,'Twists')];
        for(let j=i;j<rest.length;j+=villainGroups.length)cards.push(rest[j]);
        side('Reality '+(i+1),mix(cards));
      });
    } else if(['fragmented-realities','five-families'].includes(special)) {
      const n=special==='five-families'?5:players;
      for(let i=0;i<n;i++) {
        const cards=villainDeck.filter((c,j)=>j%n===i);
        if(special==='fragmented-realities')cards.push(...remove(twists,2,'Twists'));
        side((special==='five-families'?'Familia ':'Dimensión · Jugador ')+(i+1),mix(cards));
        label('Ciudad · '+(i+1),{x:-20+i*5,z:18});
      }
      notes.push('Cada mazo tiene su propia ciudad de un espacio.');
    } else if(special==='parallel-dimensions') {
      for(let i=1;villainDeck.length;i++)side('Dimension '+i,villainDeck.splice(0,i));
    } else add(game,'Villain Deck',villainDeck,special==='baseball'?{x:0,z:-6}:special==='two-dimensions'?cityPoint(1):point(1658,842));
    if(special==='two-dimensions')for(let i=0;i<3;i++)label('Dimensión paralela · '+(i+1),{x:cityPoint(i+2).x,z:12});
    if(special==='astral-plane'||mastermind.key==='72de1b')label('Astral Plane',{x:0,z:18});
    if(scenario.city===7)for(let i=5;i<7;i++)label('Low Tide · '+(i-4),{x:cityPoint(i).x,z:cityPoint(i).z});
    if(scenario.city===3)notes.push('La ciudad y el HQ empiezan con tres espacios, los de la derecha.');
    if(special==='baseball')notes.push('Ciudad: First Base (Sewers), Second Base (Rooftops), Third Base (Bridge). Bank y Streets no se usan.');
    if(special==='two-dimensions')notes.push('Dos ciudades de tres espacios. Sewers y Bank no se usan.');
    add(game,'Bystanders',bystanders,special==='ferry'?{x:cityPoint(0).x,z:15}:point(1680,472),!expanded);
    add(game,'Wounds',wounds,point(1382,472),!expanded);
    add(game,'S.H.I.E.L.D. Officers',officers,point(176,1160),!expanded);
    side('Sidekicks',sidekicks,false);side('Bindings',bindings,true);
    if(!coreOnly)side('New Recruits',take('152f2d'),true);
    if(!coreOnly&&special!=='shards')counter('Shards · Reserva',18);
    if(!coreOnly)counter('Shards · Mastermind',0,{x:-17,z:-1});
    if(!coreOnly&&special!=='throne')counter('Throne’s Favor · 0 = sin dueño',0);
    for(let seat=1;!coreOnly&&seat<=players;seat++) {
      const strikesCounter=game.objects.find(o=>o.type==='counter'&&o.playerId===seat&&o.resource==='strikes');
      if(strikesCounter)game.objects.push({...strikesCounter,id:game.nextId++,name:'Shards',resource:'shards',value:0,z:strikesCounter.z-3});
    }
    const horrorsRemaining=pool('b119a8');if(!coreOnly&&horrorsRemaining.length)side('Horrors · Reserva',take('b119a8',horrorsRemaining.length,true));
    for(let seat=1;seat<=players;seat++)add(game,'Mazo de jugador '+seat,mix(starters[seat-1]),seatZone(game,seat,'draw'));
    const setup={mastermind:mastermind.key,epic,heroes:heroKeys.map(k=>entry(k).name),villains:villainKeys.map(k=>entry(k).name),henchmen:henchKeys.map(k=>entry(k).name),
      edition:'marvel-collection',collection:'all',supplies:expanded?'expanded':'base',soloMode:players===1?(options.soloMode||'classic'):null,
      handSize,twists:twistCount,masterStrikes:strikeCount,bystanders:baseBystanders,hq:hqCount,notes};
    if(homeHeroes.length)setup.homeHeroes=homeHeroes.map(k=>entry(k).name);
    if(selectedCollections)setup.collections=[...selectedCollections];
    setup.heroMode=manualHeroes?'manual':'random';setup.heroKeys=heroKeys;
    Object.assign(game.setup,setup);
    if(notes.length)label(notes.join('\n'),{x:-35,z:38+Math.ceil(sideIndex/17)*6});
    return game;
  }
  return {prepare,compatible,count,collectionOf,collections};
})();
if(typeof module!=='undefined')module.exports=MarvelSetup;
