'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync('userscripts/holodex-touch-controls.user.js','utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
const stateHelpers=section('  function resolvePlaybackState(', '  function youtubeWatchLiveState(');
const policy=section('  let mouseInputSeen=false;',"  const DESKTOP_TAG=");
function statusPanel(){
  const badge={dataset:{}},metric={dataset:{}},value={},label={},time={};
  const elements={'[data-hmtc-media-kind]':badge,'[data-hmtc-latency-metric]':metric,
    '[data-hmtc-latency-value]':value,'[data-hmtc-latency-label]':label,'[data-hmtc-time-label]':time};
  return {badge,metric,value,label,time,panel:{querySelector:q=>elements[q]||null}};
}
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
      sheet:{hidden:true},backdrop:{hidden:true},touchZonesAllowed:()=>touch,desktopMountAllowed:()=>true,desktopVideoAnchor:()=>null,presentPanel(){},
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
  vm.runInContext(section('    function isNativeVisible(p){','    function readStats(statusHint,diagnose=false) {'),ctx);
  vm.runInContext('startMonitor();stopMonitor();',ctx);assert.equal(shows,0);assert.equal(hides,0);
  vm.runInContext('toggleNative();startMonitor();stopMonitor();',ctx);
  assert.equal(visible,true);assert.equal(shows,1);assert.equal(hides,0);assert.equal(silentState,false);
  vm.runInContext('toggleNative()',ctx);assert.equal(visible,false);assert.equal(hides,1);
});

test('multiview formatting distinguishes missing metadata, real start, VOD and live',()=>{
  const ctx=vm.createContext({});vm.runInContext(section('  function timestamp(n){','  async function readMultiviewClock(row){'),ctx);
  for(const value of [null,undefined,'',false,NaN,-1])assert.equal(ctx.timestamp(value),'—');
  assert.equal(ctx.playbackTimeText({ready:true,live:false,position:0,duration:0}),'—');
  assert.equal(ctx.playbackTimeText({ready:true,live:false,position:null,duration:3600}),'—');
  assert.equal(ctx.playbackTimeText({ready:true,live:false,position:0,duration:3600}),'00:00:00 / 01:00:00');
  assert.equal(ctx.playbackTimeText({ready:true,live:false,position:4085,duration:7674}),'01:08:05 / 02:07:54');
  assert.equal(ctx.playbackTimeText({ready:true,live:false,position:4085,duration:3600,live:true}),'01:08:05');
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
  const ctx=vm.createContext({rpc:async()=>({ready:true,live:false,position:0,duration:0}),
    nativeRequest:async()=>{if(fail)throw Error('no injection');return {ready:true,live:false,position:120,duration:600};}});
  vm.runInContext(stateHelpers+section('  function timestamp(n){','  async function stats(){'),ctx);
  assert.equal(ctx.playbackTimeText(await ctx.readMultiviewClock({})), '00:02:00 / 00:10:00');
  fail=true;assert.equal(ctx.playbackTimeText(await ctx.readMultiviewClock({})),'—');
  ctx.rpc=async()=>({ready:true,live:false,position:60,duration:600});
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
    document:{body:layer},innerHeight:1000,innerWidth:1200,displayCornerHud(){},clearTimeout(){}});
  vm.runInContext(section('  function hudCellDispose(cell){','  function hudSpeedValue(cell,kbps){'),ctx);
  ctx.attachCornerHud({querySelector:()=>frame},row);
  assert.equal(ctx.hudCells.get('1:abcdefghijk').button,button);
  assert.equal(button.style.left,'12px');assert.equal(button.style.top,'22px');
  ctx.hudCellDispose(ctx.hudCells.get('1:abcdefghijk'));assert.ok(button.removed);
  assert.doesNotMatch(source,/hmtc-panel-open|panelButton/);
});

function cornerHudContext(){
  let now=10000,mode='speed',nextTimer=0;
  const timers=new Map();
  const node=()=>({children:[],attributes:{},hidden:false,isConnected:true,
    classList:{values:new Set(),toggle(k,on){on?this.values.add(k):this.values.delete(k);}},
    append(...children){this.children.push(...children);},setAttribute(k,v){this.attributes[k]=v;},
    addEventListener(k,fn){this.handlers??={};this.handlers[k]=fn;}});
  const ctx=vm.createContext({document:{createElement:node,dispatchEvent(){}},Event,
    GM_getValue:()=>mode,GM_setValue:(k,v)=>{mode=v;},Date:{now:()=>now},
    setTimeout(fn,ms){timers.set(++nextTimer,{fn,at:now+ms});return nextTimer;},
    clearTimeout:id=>timers.delete(id)});
  vm.runInContext(section("  const HUD_KEY=","  GM_addStyle([")+
    section('  function hudSpeedValue(cell,kbps){','  async function pollCornerHuds(){'),ctx);
  return {ctx,timers,setMode:v=>{mode=v;},setNow:v=>{now=v;},runNext(){
    const [id,t]=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];
    timers.delete(id);now=t.at;t.fn();
  }};
}
test('HUD cache keeps original sample age, expires at six seconds and never leaks to a new video',()=>{
  const f=cornerHudContext(),a={},b={};
  assert.equal(f.ctx.hudSpeedValue(a,12340).text,'12.34 Mbps');
  f.setNow(13000);const stale=f.ctx.hudSpeedValue(a,NaN);
  assert.equal(stale.stale,true);assert.equal(stale.sampledAt,10000);
  f.setNow(16000);assert.equal(f.ctx.hudSpeedValue(a,NaN).stale,true);
  f.setNow(16001);assert.equal(f.ctx.hudSpeedValue(a,NaN).text,'—');
  assert.equal(f.ctx.hudSpeedValue(b,NaN).text,'—');
  f.setNow(9999);assert.equal(f.ctx.hudSpeedValue(a,NaN).text,'—');
});
test('HUD uses separate colored readings in all modes and cache timer expires without another request',()=>{
  const f=cornerHudContext(),button=f.ctx.createCornerHud(),parts=button._hmtcHudParts;
  const fresh=f.ctx.hudSpeedReading(12340);f.ctx.displayCornerHud(button,'01:02:03',fresh);
  assert.equal(parts.time.hidden,true);assert.equal(parts.speed.hidden,false);
  assert.equal(parts.value.textContent,'12.34 Mbps');
  f.setNow(13000);const cached=f.ctx.hudSpeedReading(12340,true,10000);
  f.ctx.displayCornerHud(button,'01:02:03',cached);
  assert.equal(parts.value.textContent,fresh.text);assert.ok(button.classList.values.has('hmtc-hud-cached'));
  assert.match(button.title,/距今 3\.0 秒/);assert.match(button.attributes['aria-label'],/最近一次读取/);
  assert.ok(!parts.value.textContent.includes('上次'));
  while(f.timers.size)f.runNext();
  assert.equal(parts.value.textContent,'—');assert.ok(!button.classList.values.has('hmtc-hud-cached'));
  for(const mode of ['time','both','off','speed']){
    f.setMode(mode);f.ctx.displayCornerHud(button,'01:02:03',fresh);
    assert.equal(parts.time.hidden,!['time','both'].includes(mode));
    assert.equal(parts.speed.hidden,!['speed','both'].includes(mode));assert.equal(parts.off.hidden,mode!=='off');
  }
  f.ctx.displayCornerHud(button,'01:02:03',f.ctx.hudSpeedReading(12340,true,15000));
  assert.equal(f.timers.size,1);f.ctx.displayCornerHud(button,'01:02:03',fresh);assert.equal(f.timers.size,0);
});
test('watch HUD forwards cache timestamp and uses the same two-pixel viewport-safe position',()=>{
  const button={style:{},isConnected:true},layer={appendChild(b){b.parentNode=this;}};
  let reading,rect={width:100,height:100,left:1150,top:20,right:1250,bottom:120};
  const ctx=vm.createContext({watchHud:null,document:{body:layer},innerWidth:1200,innerHeight:800,
    createCornerHud:()=>button,hudWantsTime:()=>true,hudWantsSpeed:()=>true,
    readWatchClock:()=>({time:'01:02:03'}),bandwidth:{start(){},read:()=>({available:true,
      bandwidthKbps:12340,stale:true,sampledAt:10000})},
    hudSpeedReading:(kbps,stale,sampledAt)=>({kbps,stale,sampledAt}),
    displayCornerHud:(b,t,s)=>{reading=s;},clearTimeout(){}});
  vm.runInContext(section('    function refreshWatchHud(player){','    function refreshSheet(){'),ctx);
  ctx.refreshWatchHud({getBoundingClientRect:()=>rect});
  assert.equal(button.style.left,'1152px');assert.equal(button.style.top,'22px');
  assert.equal(button.style.maxWidth,'46px');assert.equal(reading.sampledAt,10000);assert.equal(reading.stale,true);
});

const desktopSource=section("  const DESKTOP_TAG=","  const HUD_KEY=");
function desktopEnv(){
  const handlers=new Map(),sent=[],styles=[];
  const document={fullscreenElement:null,body:{appendChild(p){p.parentNode=this;}},
    addEventListener(n,fn){if(!handlers.has(n))handlers.set(n,[]);handlers.get(n).push(fn);}};
  const parent={postMessage:(m,o)=>sent.push({m,o})};
  const ctx=vm.createContext({document,window:{parent,addEventListener(){}},
    GM_addStyle:s=>styles.push(s),touchZonesAllowed:()=>false,innerWidth:1000,innerHeight:800,
    Date,Map,Number,Math,URL,location:{ancestorOrigins:[]},setInterval:()=>1,clearInterval(){}});
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

test('embedded body-level controls portal is eligible while unrelated outside targets and buttons are excluded',()=>{
  const {ctx}=desktopEnv();const p=testPlayer();p.id='movie_player';p.contains=()=>false;
  const portalTarget={closest:selector=>selector==='#player-controls,.ytPlayerControlsContainerHost'?{}:null};
  assert.ok(ctx.desktopContextPoint(contextEvent(300,200,{target:portalTarget}),p));
  assert.equal(ctx.desktopContextPoint(contextEvent(300,200,{target:{closest:()=>null}}),p),null);
  assert.equal(ctx.desktopContextPoint(contextEvent(300,200,{target:{closest:()=>({})}}),p),null);
  p.id='other-player';assert.equal(ctx.desktopContextPoint(contextEvent(300,200,{target:portalTarget}),p),null);
});
test('video-centered panel stays centered as content and video bounds change and clamps only at viewport edges',()=>{
  const {ctx}=desktopEnv();let rect={left:200,top:100,width:600,height:400};
  const video={isConnected:true,getBoundingClientRect:()=>rect};let height=300;
  const panel={hidden:false,classList:{toggle(){}},style:{},getBoundingClientRect:()=>({width:320,height})};
  ctx.presentPanel(panel,ctx.desktopVideoAnchor(video));assert.equal(panel.style.left,'340px');assert.equal(panel.style.top,'150px');
  height=400;ctx.positionDesktopPanel(panel);assert.equal(panel.style.top,'100px');
  rect={left:0,top:0,width:300,height:200};ctx.desktopPanelReflow();
  assert.equal(panel.style.left,'8px');assert.equal(panel.style.top,'8px');
});
test('iframe announces readiness before configuration, then retries after an expired lease',()=>{
  const {ctx,document,parent,sent}=desktopEnv();document.referrer='https://holodex.net/multiview';
  let timer,now=10000;ctx.Date={now:()=>now};ctx.setInterval=fn=>{timer=fn;return 1;};
  const bridge=ctx.installDesktopFrameBridge('abcdefghijk',testPlayer,new Set(['https://holodex.net']));
  assert.equal(sent[0].m.type,'ready');assert.equal(bridge.status().paired,false);
  bridge.configure({source:parent,origin:'https://holodex.net'},{videoId:'abcdefghijk',enabled:true});
  timer();assert.equal(sent.length,1);now+=5001;timer();assert.equal(sent.length,2);assert.equal(sent.at(-1).m.type,'ready');
  assert.equal(bridge.status().paired,false);
});
test('parent replies to validated iframe readiness without depending on list refresh',()=>{
  const {ctx}=desktopEnv(),config=[];const origin='https://www.youtube.com',win={postMessage:(m,o)=>config.push({m,o})};
  const row={videoId:'abcdefghijk',layoutId:'1'};
  Object.assign(ctx,{YT_ORIGINS:new Set([origin]),rowMap:new Map([['1:abcdefghijk',row]]),isMulti:()=>true,
    nativeFrame:()=>({frame:{contentWindow:win},origin}),NATIVE_TAG:'hmtc-youtube-stats-v1',nativeSequence:0});
  vm.runInContext(section('  function configureDesktopFrame(row){',"  window.addEventListener('message',event=>{"),ctx);
  ctx.receiveDesktopFrameMessage({origin,source:win,data:{tag:'hmtc-desktop-panel-v1',type:'ready',videoId:row.videoId}});
  assert.equal(config[0].m.action,'desktopPanelConfig');assert.equal(config[0].m.enabled,true);assert.equal(config[0].o,origin);
});

const metricHelpers=section('  function currentResolution(value){','  const HUD_KEY=');
test('current resolution displays one value with frame rate, including different optimal resolution',()=>{
  const ctx=vm.createContext({});vm.runInContext(metricHelpers,ctx);
  assert.equal(ctx.currentResolution('1280x720@60 / 1280x720@60'),'1280×720@60');
  assert.equal(ctx.currentResolution('1280x720@59.94 / 1920x1080@60'),'1280×720@59.94');
  assert.equal(ctx.currentResolution('1920 × 1080'),'1920×1080');
  assert.equal(ctx.currentResolution(null),'');assert.equal(ctx.currentResolution('auto'),'');
});
test('latency reads explicit seconds, milliseconds and nested JSON; never infers generic latency or buffer',()=>{
  const ctx=vm.createContext({});vm.runInContext(metricHelpers,ctx);
  for(const [value,want] of [[{liveLatencySeconds:0},0],[{live_latency_ms:1250},1.25],
    [{diagnostics:{live_latency_seconds:'2.50'}},2.5],['{"stats":{"liveLatencyMs":2500}}',2.5],
    ['Live Latency 1500 ms',1.5],['Live Latency (ms): 1250',1.25],['直播延迟 3.25 秒',3.25],
    [{latency:9,buffer_health_seconds:3},null],[{liveLatencySeconds:null},null],
    [{liveLatencySeconds:-1},null],['Live Latency 123',null]])
    assert.equal(ctx.nativeLatencySeconds(value),want,JSON.stringify(value));
});
function frameStatsContext(p,live=true){
  const doc={querySelector:()=>null};
  const ctx=vm.createContext({document:doc,page:{document:doc},player:()=>p,videoId:'abcdefghijk',
    controls:{video:()=>null},monitor:{active:false,forced:false,manual:false},isNativeVisible:()=>false,
    youtubeWatchLiveState:()=>({live})});
  vm.runInContext(metricHelpers+stateHelpers+section('    const number = value => {','    // YouTube sometimes computes')+
    section('    function readStats(statusHint,diagnose=false) {',"    window.addEventListener('message',async event"),ctx);
  return ctx;
}
test('complete early metrics do not skip a later API carrying live latency',()=>{
  let lateCalls=0;
  const p={getStatsForNerdsData:()=>({bandwidth_kbps:42000,buffer_health_seconds:2.6,
    resolution:'1280x720@60 / 1280x720@60'}),getVideoStats:()=>{lateCalls++;return {liveLatencyMs:1750};}};
  const ctx=frameStatsContext(p);const result=ctx.readStats();
  assert.equal(result.liveLatencySeconds,1.75);assert.ok(lateCalls>0);assert.equal(result.resolution,'1280×720@60');
});
test('live getter fills missing latency, while unavailable and VOD remain explicit without invented zero',()=>{
  let calls=0;const p={getLiveLatency:()=>{calls++;return 1.25;}};
  assert.equal(frameStatsContext(p).readStats().liveLatencySeconds,1.25);
  p.getLiveLatency=()=>null;const missing=frameStatsContext(p).readStats();
  assert.equal(missing.liveLatencySeconds,null);assert.equal(missing.latencyReason,'未提供');
  p.getLiveLatency=()=>{calls++;return 5;};const before=calls;
  const vod=frameStatsContext(p,false).readStats();assert.equal(vod.liveLatencySeconds,null);
  assert.equal(vod.latencyReason,'非直播');assert.equal(calls,before);
});
test('normal desktop right-click inside panel closes without reaching video opener or native menu',()=>{
  let touch=false,closed=0,handler;
  const ctx=vm.createContext({touchZonesAllowed:()=>touch});vm.runInContext(metricHelpers,ctx);
  ctx.bindPanelRightClose({addEventListener:(name,fn)=>{assert.equal(name,'contextmenu');handler=fn;}},()=>closed++);
  const right=contextEvent();handler(right);assert.equal(closed,1);assert.equal(right.prevented,true);assert.equal(right.stopped,true);
  handler(contextEvent(0,0,{ctrlKey:true}));assert.equal(closed,1);
  touch=true;handler(contextEvent());assert.equal(closed,1);
});
test('sheet renders a single current resolution and explicit missing-latency reason',()=>{
  const fields={},ui=statusPanel();const ctx=vm.createContext({active:null,sheet:ui.panel,field:(k,v)=>fields[k]=v,Date});
  vm.runInContext(metricHelpers+stateHelpers+section('  let lastHolodexSpeed=null;','  function updateSheetRate(data){'),ctx);
  ctx.renderYouTubeStats({live:true,resolution:'1280x720@60 / 1280x720@60',liveLatencySeconds:null,latencyReason:'未提供'});
  assert.equal(fields.resolution,'1280×720@60');assert.equal(ui.value.textContent,'暂未提供');
  ctx.renderYouTubeStats({live:true,liveLatencySeconds:1.25});assert.equal(ui.value.textContent,'1.25 s');
  ctx.renderYouTubeStats({live:false,liveLatencySeconds:1.25});assert.equal(ui.metric.hidden,true);
});

test('archived live streams are recordings even when isLiveContent remains true',()=>{
  const ctx=vm.createContext({});vm.runInContext(section('  function readFrameClock(','  // YouTube\'s own watch/live/shorts'),ctx);
  const p={getVideoData:()=>({video_id:'abcdefghijk',isLiveContent:true,isLive:false}),
    getPlayerResponse:()=>({videoDetails:{videoId:'abcdefghijk',isLiveContent:true,lengthSeconds:'7674'}})};
  const v={readyState:4,currentTime:4085,duration:7674};
  const state=ctx.youtubeWatchLiveState({},()=>p,()=>v,{});
  assert.equal(state.live,false);assert.equal(ctx.playbackKindLabel(state),'录像');
  vm.runInContext(section('  function timestamp(n){','  function mergePlaybackClock('),ctx);
  assert.equal(ctx.playbackTimeText(ctx.readFrameClock({},()=>p,()=>v,{},'abcdefghijk')),'01:08:05 / 02:07:54');
});
test('current broadcast metadata preserves live classification with finite DVR duration',()=>{
  const ctx=vm.createContext({});vm.runInContext(section('  function readFrameClock(','  // YouTube\'s own watch/live/shorts'),ctx);
  const p={getVideoData:()=>({video_id:'abcdefghijk',isLiveContent:true}),getPlayerResponse:()=>({videoDetails:{videoId:'abcdefghijk'},
    microformat:{playerMicroformatRenderer:{liveBroadcastDetails:{isLiveNow:true}}}})};
  const v={readyState:4,currentTime:3000,duration:3600};
  assert.equal(ctx.readFrameClock({},()=>p,()=>v,{},'abcdefghijk').live,true);
});
test('historical flag and unrelated recommended live badges do not prove the current video is live',()=>{
  const ctx=vm.createContext({});vm.runInContext(section('  function readFrameClock(','  // YouTube\'s own watch/live/shorts'),ctx);
  let globalQueries=0;const doc={querySelector(){globalQueries++;return {getBoundingClientRect:()=>({width:20,height:20})};}};
  const p={getVideoData:()=>({video_id:'abcdefghijk',isLiveContent:true}),querySelector:()=>null};
  const state=ctx.youtubeWatchLiveState(doc,()=>p,()=>({readyState:4,duration:3600}),{});
  assert.equal(state.live,null);assert.equal(state.reason,'historic-live-flag-only');assert.equal(globalQueries,0);
});
test('stale SPA response cannot classify another video as live; ended broadcasts override old live flags',()=>{
  const ctx=vm.createContext({});vm.runInContext(section('  function readFrameClock(','  // YouTube\'s own watch/live/shorts'),ctx);
  const p={getVideoData:()=>({video_id:'abcdefghijk',isLiveContent:true}),getPlayerResponse:()=>({videoDetails:{videoId:'zyxwvutsrqp'},
    microformat:{playerMicroformatRenderer:{liveBroadcastDetails:{isLiveNow:true}}}}),querySelector:()=>null};
  assert.equal(ctx.youtubeWatchLiveState({},()=>p,()=>({}),{}).live,null);
  p.getVideoData=()=>({video_id:'abcdefghijk',isLive:true});
  p.getPlayerResponse=()=>({videoDetails:{videoId:'abcdefghijk'},microformat:{playerMicroformatRenderer:{liveBroadcastDetails:{endTimestamp:'2026-10-20T00:00:00Z'}}}});
  assert.equal(ctx.youtubeWatchLiveState({},()=>p,()=>({}),{}).live,false);
});
test('recording duration falls back to player API then matching video details, without losing current position',()=>{
  const ctx=vm.createContext({});vm.runInContext(section('  function readFrameClock(','  // YouTube\'s own watch/live/shorts'),ctx);
  const p={getVideoData:()=>({video_id:'abcdefghijk',isLive:false}),getDuration:()=>7200,
    getPlayerResponse:()=>({videoDetails:{videoId:'abcdefghijk',lengthSeconds:'7674'}})};
  const v={readyState:1,currentTime:4085,duration:NaN};
  let clock=ctx.readFrameClock({},()=>p,()=>v,{},'abcdefghijk');
  assert.equal(clock.duration,7200);assert.equal(clock.durationSource,'player-api');assert.equal(clock.position,4085);
  p.getDuration=()=>null;clock=ctx.readFrameClock({},()=>p,()=>v,{},'abcdefghijk');
  assert.equal(clock.duration,7674);assert.equal(clock.durationSource,'video-details');
});
test('Holodex past status and wrapper duration fill unknown frame data; confirmed live evidence takes precedence',()=>{
  const ctx=vm.createContext({});vm.runInContext(stateHelpers+section('  function timestamp(n){','  async function stats(){'),ctx);
  const result=ctx.mergePlaybackClock({ready:true,position:300,duration:null,live:null},
    {ready:true,status:'past',duration:7200,live:false},{status:'past'});
  assert.equal(result.live,false);assert.equal(result.liveReason,'holodex-past');assert.equal(result.duration,7200);assert.equal(result.durationSource,'holodex-api');
  assert.equal(ctx.playbackTimeText(result),'00:05:00 / 02:00:00');
  const live=ctx.mergePlaybackClock({ready:true,live:true,liveReason:'broadcast-details',duration:3600},null,{status:'past'});
  assert.equal(live.live,true);assert.equal(live.liveReason,'broadcast-details');
});
test('latency diagnostics distinguish absent APIs, ambiguous units, recordings and unknown classification',()=>{
  let ctx=frameStatsContext({});let report=ctx.readStats(undefined,true);
  assert.equal(report.latencyDiagnostics.reasonCode,'no-latency-api');assert.equal(report.latencyDiagnostics.getter.supported,false);
  ctx=frameStatsContext({getVideoStats:()=>({live_latency:7})});report=ctx.readStats(undefined,true);
  assert.equal(report.latencyDiagnostics.reasonCode,'unrecognized-latency-units');
  assert.ok(report.latencyDiagnostics.sources.some(s=>s.fields?.includes('live_latency')));
  ctx=frameStatsContext({},null);assert.equal(ctx.readStats('past',true).latencyDiagnostics.reasonCode,'not-live');
  assert.equal(ctx.readStats(undefined,true).latencyDiagnostics.reasonCode,'media-type-unknown');
});
test('panel badge explicitly labels live, recording and unknown states',()=>{
  const badge={dataset:{}};const panel={querySelector:q=>q==='[data-hmtc-media-kind]'?badge:null};const ctx=vm.createContext({});
  vm.runInContext(stateHelpers,ctx);ctx.renderMediaKind(panel,{live:false});assert.equal(badge.textContent,'录像');assert.equal(badge.dataset.kind,'vod');
  ctx.renderMediaKind(panel,{live:true});assert.equal(badge.textContent,'直播');
  ctx.renderMediaKind(panel,{live:null});assert.equal(badge.textContent,'待确认');
});

test('reported YouTube live_latency_secs payload is parsed without a getter or native overlay',()=>{
  const payload={bandwidth_kbps:42000,live_latency_style:'LOW_LATENCY',live_latency_secs:'3.125',live_latency_samples:[3.1,3.15]};
  const ctx=frameStatsContext({getStatsForNerds:()=>payload,getVideoStats:()=>({latency_class:2,lowlatency:true})});
  const result=ctx.readStats(undefined,true);
  assert.equal(result.liveLatencySeconds,3.125);assert.equal(result.latencyDiagnostics.reasonCode,'available');
  assert.equal(result.latencyDiagnostics.getter.supported,false);
  assert.ok(result.latencyDiagnostics.sources.some(x=>x.method==='getStatsForNerds'&&x.latencySeconds===3.125));
});
test('explicit secs key accepts real zero and distinguishes an invalid value from unknown units',()=>{
  const ctx=vm.createContext({});vm.runInContext(metricHelpers,ctx);
  assert.equal(ctx.nativeLatencySeconds({live_latency_secs:0}),0);
  assert.equal(ctx.nativeLatencySeconds('{"stats":{"live_latency_secs":"2.75"}}'),2.75);
  for(const value of [null,'',-1,NaN]){
    const frame=frameStatsContext({getStatsForNerds:()=>({live_latency_secs:value})});
    const result=frame.readStats(undefined,true);
    assert.equal(result.liveLatencySeconds,null);assert.equal(result.latencyDiagnostics.reasonCode,'latency-value-invalid');
  }
  assert.equal(ctx.nativeLatencySeconds({live_latency_style:'LOW_LATENCY',live_latency_samples:[3],latency_class:2,lowlatency:true}),null);
});

test('diagnostics preserve missing, invalid and unit-bearing scalar latency values',()=>{
  const ctx=vm.createContext({});vm.runInContext(metricHelpers,ctx);
  for(const [value,type,preview] of [[undefined,'undefined','undefined'],[null,'null','null'],
    [-1,'number','-1'],[NaN,'number','NaN'],[Infinity,'number','Infinity'],
    ['', 'string','""'],['12.5 s','string','"12.5 s"']]){
    const detail=ctx.latencyValueDetails({live_latency_secs:value})[0];
    assert.equal(detail.field,'live_latency_secs');assert.equal(detail.type,type);assert.equal(detail.preview,preview);
  }
  assert.equal(ctx.latencyValueDetails('{"stats":{"live_latency_secs":null}}')[0].type,'null');
});

test('diagnostics avoid accessors, cycles, unbounded output and unrelated payload data',()=>{
  const ctx=vm.createContext({});vm.runInContext(metricHelpers,ctx);
  let reads=0;const raw={url:'https://private.example/token',live_latency_secs:{secret:'private'},live_latency_ms:[1,2]};
  Object.defineProperty(raw,'liveLatencySeconds',{get(){reads++;throw Error('getter');}});raw.self=raw;
  const result=ctx.latencyValueDetails(raw);
  assert.equal(reads,0);assert.equal(result.length,3);
  assert.equal(result.find(x=>x.field==='liveLatencySeconds').type,'accessor');
  assert.equal(result.find(x=>x.field==='live_latency_ms').type,'array');
  assert.ok(!JSON.stringify(result).includes('private'));
  const text=ctx.latencyValueDetails({live_latency_secs:'https://private.example/token'})[0];
  assert.ok(!text.preview.includes('private'));
  const deep={};let next=deep;for(let i=0;i<10;i++)next=next.child={};next.live_latency_secs=1;
  assert.equal(ctx.latencyValueDetails(deep).length,0);
  assert.ok(ctx.latencyValueDetails(Array.from({length:100},()=>({live_latency_secs:1}))).length<=16);
});

test('actual readStats diagnostics include value types and distinguish the zero-argument source',()=>{
  const ctx=frameStatsContext({getStatsForNerds:(...args)=>({live_latency_secs:args.length?'12.5 s':null})});
  const result=ctx.readStats(undefined,true);
  const sources=result.latencyDiagnostics.sources;
  assert.equal(sources.find(x=>x.method==='getStatsForNerds').values[0].type,'null');
  assert.equal(sources.find(x=>x.method==='getStatsForNerds(0)').values[0].preview,'"12.5 s"');
  assert.equal(result.liveLatencySeconds,12.5);
  assert.equal(ctx.readStats().latencyDiagnostics,undefined);
});

test('reported 0.00s and explicit unit suffixes parse with correct scaling without accepting junk or negative values',()=>{
  const ctx=vm.createContext({});vm.runInContext(metricHelpers,ctx);
  for(const [raw,want] of [['0.00s',0],['2.75 s',2.75],['1250ms',1.25],['2 seconds',2],['3 秒',3]]){
    assert.equal(ctx.nativeLatencySeconds({live_latency_secs:raw}),want);
  }
  assert.equal(ctx.nativeLatencySeconds({live_latency_ms:'2s'}),2);
  assert.equal(ctx.nativeLatencySeconds({live_latency_ms:'1250'}),1.25);
  for(const raw of ['-1s','Infinitys','NaNs','2s junk','2frames','0x20s',''])
    assert.equal(ctx.nativeLatencySeconds({live_latency_secs:raw}),null);
  const result=frameStatsContext({getStatsForNerds:()=>({live_latency_secs:'0.00s',live_latency_samples:[]})}).readStats(undefined,true);
  assert.equal(result.liveLatencySeconds,0);assert.equal(result.latencyDiagnostics.reasonCode,'available');
});

test('status row separates live latency from title, disappears on recordings and resets on unknown media',()=>{
  const ctx=vm.createContext({});vm.runInContext(stateHelpers,ctx);const ui=statusPanel();
  ctx.renderMediaKind(ui.panel,{live:true});ctx.renderLatency(ui.panel,{liveLatencySeconds:0});
  assert.equal(ui.badge.textContent,'直播');assert.equal(ui.label.textContent,'直播延迟');
  assert.equal(ui.value.textContent,'0.00 s');assert.equal(ui.metric.hidden,false);
  assert.equal(ui.metric.dataset.state,'available');
  ctx.renderLatency(ui.panel,{liveLatencySeconds:null});assert.equal(ui.value.textContent,'暂未提供');
  ctx.renderMediaKind(ui.panel,{live:false});assert.equal(ui.metric.hidden,true);assert.equal(ui.time.textContent,'录像 · 播放时间');
  ctx.renderMediaKind(ui.panel,{live:null});assert.equal(ui.metric.hidden,false);assert.equal(ui.value.textContent,'识别中');
  assert.equal(ui.label.textContent,'视频状态');assert.equal(ui.time.textContent,'播放时间');
  for(const fragment of [section('    function makePanel(){','    function open('),section('  function makeSheet(){','  function closeSheet(')]){
    // Each title header ends before the media badge; a status badge cannot steal its width.
    if(!fragment)continue;
    assert.ok(fragment.indexOf('aria-label="关闭')<fragment.indexOf('data-hmtc-media-kind'));
  }
});

test('watch page latency reader accepts the real payload, handles failing APIs and preserves missing values',()=>{
  const ctx=vm.createContext({});vm.runInContext(metricHelpers+stateHelpers,ctx);
  const p={getLiveLatency(){throw Error('unavailable');},getStatsForNerds:()=>({live_latency_secs:'0.00s'})};
  assert.equal(ctx.readPlayerLatency(p).liveLatencySeconds,0);
  assert.equal(ctx.readPlayerLatency({getStatsForNerds:()=>({live_latency_secs:null})}).liveLatencySeconds,null);
  assert.ok(source.includes('if(currentClock.state.live===true)renderLatency(sheet,readPlayerLatency(p()))'));
});

// Minimal DOM movement model: verifies node identity and restoration, while
// real browser checks cover computed typography, wrapping and hit testing.
function compactPanelFixture(){
  class Node{
    constructor(){this.children=[];this.dataset={};this.classList={toggle(){}};}
    appendChild(node){node.remove();this.children.push(node);node.parentNode=this;return node;}
    remove(){if(this.parentNode){const a=this.parentNode.children;a.splice(a.indexOf(this),1);this.parentNode=null;}}
    before(node){node.remove();const a=this.parentNode.children;a.splice(a.indexOf(this),0,node);node.parentNode=this.parentNode;}
    after(node){node.remove();const a=this.parentNode.children;a.splice(a.indexOf(this)+1,0,node);node.parentNode=this.parentNode;}
    replaceWith(node){this.before(node);this.remove();}
    querySelectorAll(){return [];}
  }
  const panel=new Node(),head=new Node(),grid=new Node(),ui=statusPanel();
  const items={latency:new Node(),speed:new Node(),time:new Node(),resolution:new Node(),buffer:new Node()};
  items.latency.dataset.kind='live';
  for(const node of [head,items.latency,items.speed,grid])panel.appendChild(node);
  for(const node of [items.time,items.buffer,items.resolution])grid.appendChild(node);
  const values={speed:items.speed,position:items.time,resolution:items.resolution,health:items.buffer};
  panel.querySelector=selector=>{
    if(selector==='.head')return head;
    if(selector==='[data-hmtc-latency-metric]')return items.latency;
    for(const [field,node] of Object.entries(values))if(selector.includes('[data-field="'+field+'"]'))return {closest:()=>node};
    return ui.panel.querySelector(selector);
  };
  return {panel,head,grid,items,ui,document:{createElement:()=>new Node(),createComment:()=>new Node()}};
}
function compactContext(fixture){
  const ctx=vm.createContext({document:fixture.document});
  vm.runInContext(section('  function prepareDesktopMetrics(','  function desktopPanelReflow(')+stateHelpers,ctx);return ctx;
}
test('desktop compaction reuses readings, reflows recordings with no empty row and survives repeated updates',()=>{
  const f=compactPanelFixture(),ctx=compactContext(f);ctx.prepareDesktopMetrics(f.panel,true);
  const c=f.panel._hmtcCompact;assert.ok(c);assert.equal(c.rows[0].children[0],f.items.speed);
  assert.deepEqual(c.rows[0].children,[f.items.speed,f.items.latency]);
  assert.deepEqual(c.rows[1].children,[f.items.time,f.items.buffer]);
  assert.deepEqual(c.rows[2].children,[f.items.resolution]);
  ctx.renderMediaKind(f.panel,{live:false});assert.equal(f.items.latency.hidden,true);
  assert.deepEqual(c.rows[0].children,[f.items.speed,f.items.buffer]);
  assert.deepEqual(c.rows[1].children,[f.items.time]);assert.deepEqual(c.rows[2].children,[f.items.resolution]);
  assert.equal(f.ui.time.textContent,'录像时间');
  ctx.renderMediaKind(f.panel,{live:null});assert.equal(c.rows[2].hidden,false);assert.equal(f.ui.label.textContent,'状态');
  assert.equal(f.ui.value.textContent,'待确认');assert.equal(f.ui.badge.hidden,true);
  ctx.renderMediaKind(f.panel,{live:true});ctx.renderLatency(f.panel,{liveLatencySeconds:0});
  assert.equal(f.ui.label.textContent,'延迟');assert.equal(f.ui.value.textContent,'0.00 s');
  ctx.prepareDesktopMetrics(f.panel,true);assert.equal(f.panel._hmtcCompact,c);
  assert.equal(c.rows.flatMap(r=>r.children).length,5);
});
test('returning to touch restores original DOM order and mobile labels without duplicating or replacing readings',()=>{
  const f=compactPanelFixture(),ctx=compactContext(f),original=f.panel.children.slice(),grid=f.grid.children.slice();
  ctx.prepareDesktopMetrics(f.panel,true);ctx.renderMediaKind(f.panel,{live:false});ctx.prepareDesktopMetrics(f.panel,false);
  assert.equal(f.panel._hmtcCompact,undefined);assert.deepEqual(f.panel.children,original);assert.deepEqual(f.grid.children,grid);
  assert.equal(f.ui.time.textContent,'录像 · 播放时间');assert.equal(f.ui.badge.hidden,false);
  ctx.prepareDesktopMetrics(f.panel,true);assert.ok(f.panel._hmtcCompact);
  ctx.prepareDesktopMetrics(f.panel,false);assert.deepEqual(f.grid.children,grid);
});

