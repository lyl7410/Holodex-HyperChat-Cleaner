'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync('userscripts/holodex-touch-controls.user.js','utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
const policy=section('  let mouseInputSeen=false;',"  const DESKTOP_TAG=");
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
    manualAutoPlay:noop,diagnoseAutoPlay:noop,makeSheet:noop,installDesktopDismiss:noop,get:(_k,d)=>d,DEBUG_KEY:'debug',
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
      sheet:{hidden:true},backdrop:{hidden:true},touchZonesAllowed:()=>touch,desktopMountAllowed:()=>true,presentPanel(){},
      bandwidth:{start(){},stop(){}},hudWantsSpeed:()=>false,
      refreshSheet(){},refreshQualityChoices(){}});
    const yt=source.slice(0,source.indexOf('  // Run a minimal, read-only stats bridge'));
    const start=yt.indexOf('    function open(anchor){');const end=yt.indexOf('    function toastVolume',start);
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

test('multiview formatting distinguishes missing metadata, real start, VOD and live',()=>{
  const ctx=vm.createContext({});vm.runInContext(section('  function timestamp(n){','  async function readMultiviewClock(row){'),ctx);
  for(const value of [null,undefined,'',false,NaN,-1])assert.equal(ctx.timestamp(value),'—');
  assert.equal(ctx.playbackTimeText({ready:true,position:0,duration:0}),'—');
  assert.equal(ctx.playbackTimeText({ready:true,position:null,duration:3600}),'—');
  assert.equal(ctx.playbackTimeText({ready:true,position:0,duration:3600}),'00:00:00 / 01:00:00');
  assert.equal(ctx.playbackTimeText({ready:true,position:4085,duration:7674}),'01:08:05 / 02:07:54');
  assert.equal(ctx.playbackTimeText({ready:true,position:4085,duration:3600,live:true}),'01:08:05');
});
test('frame media clock requires metadata and rejects recycled video identity',()=>{
  let video={readyState:0,currentTime:0,duration:NaN},id='abcdefghijk',live=false;
  const ctx=vm.createContext({youtubeWatchLiveState:()=>({live})});
  vm.runInContext(section('  function readFrameClock(', '  function youtubeWatchLiveState('),ctx);
  const read=()=>ctx.readFrameClock({},()=>({getVideoData:()=>({video_id:id})}),()=>video,{},'abcdefghijk');
  assert.equal(read().ready,false);video={readyState:4,currentTime:4085,duration:7674};
  assert.equal(read().position,4085);assert.equal(read().duration,7674);
  live=true;video.duration=Infinity;assert.equal(read().live,true);assert.equal(read().duration,null);
  id='zyxwvutsrqp';assert.equal(read().ready,false);
});
test('multiview clock prefers actual media over stale wrapper zero and falls back without iframe access',async()=>{
  let fail=false;
  const ctx=vm.createContext({rpc:async()=>({ready:true,position:0,duration:0}),
    nativeRequest:async()=>{if(fail)throw Error('no injection');return {ready:true,position:120,duration:600};}});
  vm.runInContext(section('  function timestamp(n){','  async function stats(){'),ctx);
  assert.equal(ctx.playbackTimeText(await ctx.readMultiviewClock({})), '00:02:00 / 00:10:00');
  fail=true;assert.equal(ctx.playbackTimeText(await ctx.readMultiviewClock({})),'—');
  ctx.rpc=async()=>({ready:true,position:60,duration:600});
  assert.equal(ctx.playbackTimeText(await ctx.readMultiviewClock({})),'00:01:00 / 00:10:00');
});
test('one failing wrapper method does not discard other playback fields',async()=>{
  const ctx=vm.createContext({});vm.runInContext(section('    async function snapshot(vm){','    // Multiview-wide autoplay'),ctx);
  const result=await ctx.snapshot({video:{status:'live'},ytPlayer:{getCurrentTime:()=>123,
    getDuration:()=>3600,getVolume(){throw Error('not ready');},getPlaybackRate:async()=>1.25}});
  assert.equal(result.position,123);assert.equal(result.duration,3600);assert.equal(result.rate,1.25);
  assert.equal(result.live,true);assert.equal(result.volume,undefined);
});
test('HUD remains and no constant statistics button is created',()=>{
  const layer={appendChild(el){el.parentNode=this;}};
  const button={style:{},remove(){this.removed=true;}};
  const row={layoutId:1,videoId:'abcdefghijk'};
  const frame={getBoundingClientRect:()=>({width:500,height:300,left:10,top:20,right:510,bottom:320})};
  const ctx=vm.createContext({hudCells:new Map(),hudSessionStop(){},createCornerHud:()=>button,
    document:{body:layer},innerHeight:1000,innerWidth:1200,displayCornerHud(){}});
  vm.runInContext(section('  function hudCellDispose(cell){','  function hudSpeedValue(cell,kbps){'),ctx);
  ctx.attachCornerHud({querySelector:()=>frame},row);
  assert.equal(ctx.hudCells.get('1:abcdefghijk').button,button);
  ctx.hudCellDispose(ctx.hudCells.get('1:abcdefghijk'));assert.ok(button.removed);
  assert.doesNotMatch(source,/hmtc-panel-open|panelButton/);
});

const desktopSource=section("  const DESKTOP_TAG=","  const HUD_KEY=");
function desktopEnv(){
  const handlers=new Map(),sent=[],styles=[];
  const document={fullscreenElement:null,body:{appendChild(p){p.parentNode=this;}},
    addEventListener(n,fn){if(!handlers.has(n))handlers.set(n,[]);handlers.get(n).push(fn);}};
  const parent={postMessage:(m,o)=>sent.push({m,o})};
  const ctx=vm.createContext({document,window:{parent,addEventListener(){}},
    GM_addStyle:s=>styles.push(s),touchZonesAllowed:()=>false,innerWidth:1000,innerHeight:800,
    Date,Map,Number,Math});
  vm.runInContext(desktopSource,ctx);
  const fire=(name,event)=>{for(const handler of handlers.get(name)||[])handler(event);};
  return {ctx,handlers,fire,sent,styles,parent,document};
}
function contextEvent(x=300,y=200,extra={}){
  return {button:2,clientX:x,clientY:y,target:{closest:()=>null},
    preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};
}
const testPlayer=()=>({contains:()=>true,getBoundingClientRect:()=>({left:0,top:0,width:600,height:400}),getVideoData:()=>({video_id:'abcdefghijk'})});
test('central right-click covers full height, exact two-thirds width, no other mouse actions',()=>{
  const {ctx}=desktopEnv(),p=testPlayer();
  for(const [x,y,want] of [[100,0,true],[500,400,true],[300,1,true],[300,399,true],[99,200,false],[501,200,false],[300,-1,false],[300,401,false]])
    assert.equal(!!ctx.desktopContextPoint(contextEvent(x,y),p),want,`${x},${y}`);
  for(const extra of [{button:0},{button:1},{ctrlKey:true},{altKey:true},{shiftKey:true},{metaKey:true}])
    assert.equal(ctx.desktopContextPoint(contextEvent(300,200,extra),p),null);
  assert.equal(ctx.desktopContextPoint(contextEvent(300,200,{target:{closest:()=>({})}}),p),null);
  ctx.touchZonesAllowed=()=>true;assert.equal(ctx.desktopContextPoint(contextEvent(),p),null);
});
test('compact panel placement avoids all viewport edges and stays fixed when pointer moves',()=>{
  const {ctx,fire}=desktopEnv();
  for(const a of [{x:0,y:0},{x:999,y:0},{x:0,y:799},{x:999,y:799}]){
    const p=ctx.desktopPanelCoordinates(a,320,480,1000,800);
    assert.ok(p.x>=8&&p.x+320<=992);assert.ok(p.y>=8&&p.y+480<=792);
  }
  const panel={hidden:false,classList:{toggle(){}},style:{},getBoundingClientRect:()=>({width:320,height:480})};
  ctx.presentPanel(panel,{x:100,y:100});assert.equal(panel.style.left,'110px');assert.equal(panel.style.top,'110px');
  fire('pointermove',{pointerType:'mouse',clientX:900,clientY:700});ctx.desktopPanelReflow();
  assert.equal(panel.style.left,'110px');assert.equal(panel.style.top,'110px');
  ctx.innerWidth=400;ctx.innerHeight=600;ctx.desktopPanelReflow();
  assert.ok(parseFloat(panel.style.left)+320<=392);assert.ok(parseFloat(panel.style.top)+480<=592);
});
test('panel mounts within full-screen container; mobile clears desktop positioning',()=>{
  const {ctx,document}=desktopEnv(),classes=new Set();
  const layer={tagName:'DIV',appendChild(p){p.parentNode=this;}};document.fullscreenElement=layer;
  const panel={hidden:false,classList:{toggle(c,on){on?classes.add(c):classes.delete(c);}},
    style:{removeProperty(k){delete this[k];}},getBoundingClientRect:()=>({width:320,height:400})};
  ctx.presentPanel(panel,{x:500,y:300});assert.equal(panel.parentNode,layer);assert.ok(classes.has('hmtc-desktop-panel'));
  document.fullscreenElement={tagName:'IFRAME'};assert.equal(ctx.desktopMountAllowed(),false);
  document.fullscreenElement=null;ctx.touchZonesAllowed=()=>true;ctx.presentPanel(panel);
  assert.equal(panel.style.left,undefined);assert.equal(panel.style.top,undefined);assert.equal(classes.size,0);
});
test('outside left-click dismisses without consuming playback or control input',()=>{
  const {ctx,fire}=desktopEnv();let closed=0;ctx.installDesktopDismiss(()=>closed++);
  const e=contextEvent(0,0,{button:0});fire('pointerdown',e);
  assert.equal(closed,1);assert.equal(e.prevented,undefined);assert.equal(e.stopped,undefined);
  fire('pointerdown',contextEvent(0,0,{button:0,target:{closest:()=>({})}}));assert.equal(closed,1);
  fire('pointerdown',contextEvent());assert.equal(closed,1);
});
test('iframe right-click requires trusted pairing, current video and non-expired configuration',()=>{
  const {ctx,parent,fire,sent,document}=desktopEnv();let now=10000,id='abcdefghijk';
  ctx.Date={now:()=>now};const p=testPlayer();p.getVideoData=()=>({video_id:id});
  const bridge=ctx.installDesktopFrameBridge('abcdefghijk',()=>p,new Set(['https://holodex.net']));
  let e=contextEvent();fire('contextmenu',e);assert.equal(e.prevented,undefined);
  assert.equal(bridge.configure({source:{},origin:'https://holodex.net'},{videoId:id,enabled:true}),false);
  assert.equal(bridge.configure({source:parent,origin:'https://evil.example'},{videoId:id,enabled:true}),false);
  bridge.configure({source:parent,origin:'https://holodex.net'},{videoId:id,enabled:true});
  e=contextEvent();fire('contextmenu',e);assert.equal(e.prevented,true);assert.equal(sent.at(-1).m.type,'open');assert.equal(sent.at(-1).m.x,.3);
  e=contextEvent(10);fire('contextmenu',e);assert.equal(e.prevented,undefined);
  document.fullscreenElement={tagName:'DIV'};e=contextEvent();fire('contextmenu',e);assert.equal(e.prevented,undefined);
  document.fullscreenElement=null;id='zyxwvutsrqp';e=contextEvent();fire('contextmenu',e);assert.equal(e.prevented,undefined);
  id='abcdefghijk';now+=5001;e=contextEvent();fire('contextmenu',e);assert.equal(e.prevented,undefined);
});
test('iframe forwards dismissal and Escape without cancelling underlying events',()=>{
  const {ctx,parent,fire,sent}=desktopEnv();
  const bridge=ctx.installDesktopFrameBridge('abcdefghijk',testPlayer,new Set(['https://holodex.net']));
  bridge.configure({source:parent,origin:'https://holodex.net'},{videoId:'abcdefghijk',enabled:true});
  const e=contextEvent(0,0,{button:0});fire('pointerdown',e);fire('keydown',{key:'Escape'});
  assert.deepEqual(sent.map(x=>x.m.type),['dismiss','escape']);assert.equal(e.prevented,undefined);
});
test('parent validates frame origin, window and coordinates, then opens correct video at scaled point',()=>{
  const {ctx}=desktopEnv(),opened=[];const row={videoId:'abcdefghijk',layoutId:'1'};
  const origin='https://www.youtube.com',win={};
  const frame={contentWindow:win,getBoundingClientRect:()=>({left:600,top:100,width:300,height:200})};
  Object.assign(ctx,{YT_ORIGINS:new Set([origin]),rowMap:new Map([['1:abcdefghijk',row]]),
    isMulti:()=>true,nativeFrame:()=>({frame,origin}),settings:null,sheet:{hidden:false},
    closeSettings(){},openSheet:(r,p)=>opened.push({r,p}),closeSheet(){},observeMouseInput(){}});
  vm.runInContext(section('  function configureDesktopFrame(row){',"  window.addEventListener('message',event=>{"),ctx);
  function send(extra={},eventExtra={}){ctx.receiveDesktopFrameMessage({origin,source:win,
    data:{tag:'hmtc-desktop-panel-v1',type:'open',videoId:row.videoId,x:.5,y:.5,...extra},...eventExtra});}
  send({}, {origin:'https://evil.example'});send({}, {source:{}});send({videoId:'zyxwvutsrqp'});send({x:NaN});send({x:1.01});assert.equal(opened.length,0);
  send();assert.equal(opened[0].r,row);assert.equal(opened[0].p.x,750);assert.equal(opened[0].p.y,200);
  ctx.rowMap.clear();send();assert.equal(opened.length,1);
});
