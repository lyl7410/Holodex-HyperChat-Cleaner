'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync('userscripts/holodex-touch-controls.user.js','utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
const policy=section('  function touchZonesAllowed()',"  const HUD_KEY=");
function mediaEnv(coarse,fine){
  const media=new Map();
  for(const [query,matches] of [['(pointer:coarse)',coarse],['(any-pointer:fine)',fine]])
    media.set(query,{matches,addEventListener(type,fn){this.change=fn;}});
  return {media,matchMedia:q=>media.get(q)};
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
    location:{href:'https://holodex.net/multiview'},
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
  policyChange();assert.equal(removed,1);
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
  assert.match(source,/\.hmtc-edge,\.hmtc-yt-edge\{display:none!important;pointer-events:none!important/);
  assert.doesNotMatch(source,/maxTouchPoints>0/);
});
