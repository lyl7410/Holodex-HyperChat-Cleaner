'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync('userscripts/holodex-touch-controls.user.js','utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
const policy=section('  let mouseInputSeen=false;',"  const HUD_KEY=");
function mediaEnv(coarse,fine){
  const media=new Map();
  for(const [query,matches] of [['(pointer:coarse)',coarse],['(any-pointer:fine)',fine]])
    media.set(query,{matches,addEventListener(type,fn){this.change=fn;}});
  return {media,matchMedia:q=>media.get(q),document:{addEventListener(){},dispatchEvent(){},documentElement:{classList:{add(){}}}},Event};
}
test('desktop, touch laptop and hybrid mouse never enable broad overlays; pure touch does',()=>{
  for(const [coarse,fine,want] of [[false,true,false],[true,true,false],[true,false,true],[false,false,false]]){
    const ctx=vm.createContext({...mediaEnv(coarse,fine),navigator:{maxTouchPoints:10}});
    vm.runInContext(policy,ctx);
    assert.equal(vm.runInContext('touchZonesAllowed()',ctx),want);
  }
});
test('input changes and legacy MediaQueryList listeners refresh policy',()=>{
  const env=mediaEnv(true,false),ctx=vm.createContext(env);let calls=0;
  vm.runInContext(policy,ctx);ctx.refresh=()=>calls++;
  vm.runInContext('watchTouchZonePolicy(refresh)',ctx);
  env.media.get('(any-pointer:fine)').matches=true;
  env.media.get('(any-pointer:fine)').change();
  assert.equal(calls,1);assert.equal(vm.runInContext('touchZonesAllowed()',ctx),false);
  for(const item of env.media.values()){delete item.addEventListener;item.addListener=fn=>{item.change=fn;};}
  vm.runInContext('watchTouchZonePolicy(refresh)',ctx);
  env.media.get('(pointer:coarse)').change();assert.equal(calls,2);
});
test('PC initialization registers statistics; selection opens the correct video without an overlay',()=>{
  const menus=new Map(),opened=[],rows=[{videoId:'abcdefghijk',layoutId:1,title:'A'}];
  let removed=0,policyChange;
  const noop=()=>{};
  const ctx=vm.createContext({
    document:{body:{},documentElement:{classList:{toggle:noop}},addEventListener:noop,
      querySelectorAll:()=>[{remove(){removed++;}}]},window:{addEventListener:noop},
    location:{href:'https://holodex.net/multiview'},backdrop:{hidden:false},sheet:{hidden:false},
    GM_registerMenuCommand:(name,fn)=>menus.set(name,fn),
    watchTouchZonePolicy:fn=>{policyChange=fn;},touchZonesAllowed:()=>false,
    cycleHudMode:noop,pollCornerHuds:noop,clearHudCells:noop,openSettings:noop,
    manualAutoPlay:noop,diagnoseAutoPlay:noop,makeSheet:noop,get:(_k,d)=>d,DEBUG_KEY:'debug',
    installBridge:noop,isMulti:()=>true,setInterval:noop,refresh:noop,
    rowMap:new Map(rows.map(r=>[r.layoutId+':'+r.videoId,r])),
    openSheet:r=>opened.push(r),alert:noop,prompt:()=> '2'
  });
  vm.runInContext(section('  function init(){',"  if(document.readyState==='loading')")+'\ninit();',ctx);
  const select=menus.get('选择视频查看统计（PC／触屏）');assert.equal(typeof select,'function');
  select();assert.equal(opened[0],rows[0]);
  const second={videoId:'zyxwvutsrqp',layoutId:2,title:'B'};ctx.rowMap.set('2:'+second.videoId,second);
  select();assert.equal(opened[1],second);
  ctx.prompt=()=>null;select();assert.equal(opened.length,2);
  ctx.prompt=()=> '999';select();assert.equal(opened.length,2);
  ctx.rowMap.clear();select();assert.equal(opened.length,2);
  policyChange();assert.equal(removed,1);assert.equal(ctx.backdrop.hidden,true);
});
test('actual zone handlers pass idle right-click and desktop mouse through, retaining touch tap/hold',()=>{
  const zones=[];let opened=0,allowed=true;
  const frame={querySelector:()=>null,appendChild:z=>zones.push(z),getBoundingClientRect:()=>({height:300})};
  const row={layoutId:1,videoId:'abcdefghijk',volume:50};
  const ctx=vm.createContext({document:{createElement:()=>({dataset:{},handlers:{},
    setAttribute(){},addEventListener(t,f){this.handlers[t]=f;},isConnected:true})},
    rowMap:new Map([['1:abcdefghijk',row]]),allowsHold:()=>true,allowsTap:()=>true,
    touchZonesAllowed:()=>allowed,openSheet:()=>opened++,getSensitivity:()=>1,
    setTimeout:()=>123,clearTimeout(){},Date});
  vm.runInContext(section('  function attachEdges(root,row){','  let backdrop=null;'),ctx);
  ctx.root={querySelector:()=>frame};ctx.row=row;vm.runInContext('attachEdges(root,row)',ctx);
  const left=zones[0];
  function event(extra={}){return {preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};}
  let e=event();left.handlers.contextmenu(e);assert.equal(e.prevented,undefined);
  allowed=false;e=event({button:0});left.handlers.click(e);assert.equal(e.prevented,undefined);assert.equal(opened,0);
  allowed=true;e=event({button:0});left.handlers.click(e);assert.equal(opened,1);
  left.handlers.touchstart(event({touches:[{identifier:1,clientX:10,clientY:10}]}));
  e=event();left.handlers.contextmenu(e);assert.equal(e.prevented,true);
  left.handlers.touchcancel();e=event();left.handlers.contextmenu(e);assert.equal(e.prevented,undefined);
});
test('both overlay classes get immediate desktop CSS hit-test protection',()=>{
  assert.match(source,/@media \(pointer:fine\),\(pointer:none\),\(any-pointer:fine\)/);
  assert.match(source,/\.hmtc-edge,\.hmtc-yt-edge,#hmtc-backdrop,#hmtc-yt-backdrop\{/);
  assert.doesNotMatch(source,/maxTouchPoints>0/);
});

test('actual mouse entry overrides incorrect coarse reports without cancelling input',()=>{
  const env=mediaEnv(true,false),listeners=new Map(),classes=new Set();let changes=0;
  env.document={addEventListener:(name,fn)=>listeners.set(name,fn),
    dispatchEvent:e=>listeners.get(e.type)?.(e),documentElement:{classList:{add:c=>classes.add(c)}}};
  const ctx=vm.createContext(env);vm.runInContext(policy,ctx);
  ctx.refresh=()=>changes++;vm.runInContext('watchTouchZonePolicy(refresh)',ctx);
  listeners.get('pointerover')({pointerType:'touch'});
  assert.equal(vm.runInContext('touchZonesAllowed()',ctx),true);
  listeners.get('pointerover')({pointerType:'mouse',preventDefault(){assert.fail('mouse must pass through');}});
  assert.equal(vm.runInContext('touchZonesAllowed()',ctx),false);
  assert.ok(classes.has('hmtc-mouse-input'));assert.equal(changes,1);
  listeners.get('pointerdown')({pointerType:'mouse'});assert.equal(changes,1);
});
test('YouTube panel opens with no full-screen mouse blocker and closes cleanly',()=>{
  for(const touch of [false,true]){
    const ctx=vm.createContext({supported:()=>true,p:()=>({}),makePanel(){},
      sheet:{hidden:true},backdrop:{hidden:true},touchZonesAllowed:()=>touch,
      bandwidth:{start(){},stop(){}},hudWantsSpeed:()=>false,
      refreshSheet(){},refreshQualityChoices(){}});
    const yt=source.slice(0,source.indexOf('  // Run a minimal, read-only stats bridge'));
    const start=yt.indexOf('    function open(){');const end=yt.indexOf('    function toastVolume',start);
    vm.runInContext(yt.slice(start,end)+section('    function close(){','    let qualitySwitching=false;'),ctx);
    vm.runInContext('open()',ctx);assert.equal(ctx.sheet.hidden,false);
    assert.equal(ctx.backdrop.hidden,!touch);
    vm.runInContext('close()',ctx);assert.equal(ctx.sheet.hidden,true);assert.equal(ctx.backdrop.hidden,true);
  }
});
test('YouTube panel stays centered in landscape and all desktop backdrops are excluded from hit-testing',()=>{
  assert.doesNotMatch(source,/@media\(orientation:landscape\)\{#hmtc-yt-panel\{left:auto/);
  assert.match(source,/#hmtc-yt-panel\{position:fixed;bottom:/);
  assert.match(source,/'left:8px;right:8px;[^\n]+margin:0 auto;/);
  assert.match(source,/html\.hmtc-mouse-input #hmtc-backdrop,html\.hmtc-mouse-input #hmtc-yt-backdrop/);
  assert.match(source,/if\(backdrop\)backdrop.hidden=!touchZonesAllowed\(\);/);
});

test('desktop bandwidth collection never opens or hides Tweaks for YouTube native statistics',()=>{
  for(const initiallyVisible of [false,true]){
    let visible=initiallyVisible,shows=0,hides=0;
    const classes=new Set();
    const player={isVideoInfoVisible:()=>visible,showVideoInfo(){shows++;visible=true;},
      hideVideoInfo(){hides++;visible=false;},getStatsForNerds:()=>({connection_speed:26820})};
    const pageDoc={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],
      documentElement:{classList:{toggle(c,on){on?classes.add(c):classes.delete(c);}}}};
    const ctx=vm.createContext({pageDoc,player,touchZonesAllowed:()=>false});
    vm.runInContext(section('  function youtubeWatchBandwidth(',
      '  // HTMLMediaElement.duration')+'\nvar collector=youtubeWatchBandwidth(pageDoc,()=>player);',ctx);
    for(let i=0;i<3;i++){ctx.collector.start();assert.equal(ctx.collector.read().bandwidthKbps,26820);ctx.collector.stop();}
    assert.equal(shows,0);assert.equal(hides,0);assert.equal(visible,initiallyVisible);assert.equal(classes.size,0);
    player.showVideoInfo();ctx.collector.start();ctx.collector.stop();
    assert.equal(visible,true);assert.equal(hides,0);assert.equal(classes.size,0);
  }
});
test('switching from touch silent sampling releases ownership before native stats are opened by another extension',()=>{
  let allowed=true,visible=false,shows=0,hides=0;const classes=new Set();
  const player={isVideoInfoVisible:()=>visible,showVideoInfo(){shows++;visible=true;},hideVideoInfo(){hides++;visible=false;}};
  const pageDoc={getElementById:()=>({}),querySelector:()=>null,
    documentElement:{classList:{toggle(c,on){on?classes.add(c):classes.delete(c);}}}};
  const ctx=vm.createContext({pageDoc,player,touchZonesAllowed:()=>allowed});
  vm.runInContext(section('  function youtubeWatchBandwidth(',
    '  // HTMLMediaElement.duration')+'\nvar collector=youtubeWatchBandwidth(pageDoc,()=>player);',ctx);
  ctx.collector.start();assert.equal(shows,1);assert.ok(classes.size);
  allowed=false;ctx.collector.start();assert.equal(hides,1);assert.equal(classes.size,0);
  player.showVideoInfo();ctx.collector.start();ctx.collector.stop();
  assert.equal(visible,true);assert.equal(hides,1);assert.equal(shows,2);
});

test('desktop iframe monitor stays passive while explicit native toggle remains usable',()=>{
  let visible=false,shows=0,hides=0,silentState=false;
  const p={isVideoInfoVisible:()=>visible,showVideoInfo(){shows++;visible=true;},hideVideoInfo(){hides++;visible=false;}};
  const ctx=vm.createContext({player:()=>p,touchZonesAllowed:()=>false,
    monitor:{active:false,forced:false,manual:false},silent:on=>{silentState=on;},watchTouchZonePolicy(){}});
  vm.runInContext(section('    function isNativeVisible(p){','    function readStats() {'),ctx);
  vm.runInContext('startMonitor();stopMonitor();',ctx);assert.equal(shows,0);assert.equal(hides,0);
  vm.runInContext('toggleNative();startMonitor();stopMonitor();',ctx);
  assert.equal(visible,true);assert.equal(shows,1);assert.equal(hides,0);assert.equal(silentState,false);
  vm.runInContext('toggleNative()',ctx);assert.equal(visible,false);assert.equal(hides,1);
});
