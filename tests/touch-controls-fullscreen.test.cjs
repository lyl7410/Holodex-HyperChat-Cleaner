'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('userscripts/holodex-touch-controls.user.js','utf8');
const start=source.indexOf('  const isMulti=()=>');
const end=source.indexOf('  const token=',start);
const settle=()=>new Promise(setImmediate);
function harness({enabled=false,landscape=false,activation=true,mobile=true,mode='ok'}={}){
  const saved=new Map([['hmtc_landscape_auto_fullscreen_v1',enabled]]);
  const listeners=new Map(),calls=[],alerts=[];
  const button={setAttribute(){},textContent:''},status={textContent:''},checkbox={};
  const doc={fullscreenElement:null,querySelector:s=>s.includes('landscapeFullscreen')?button:
    s.includes('fullscreenState')?status:s.includes('fullscreenAuto')?checkbox:null,
    querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners.set('doc:'+name,fn),
    exitFullscreen(){calls.push('exit');doc.fullscreenElement=null;listeners.get('doc:fullscreenchange')?.();return Promise.resolve();}};
  doc.documentElement={requestFullscreen(){calls.push('enter');
    if(mode==='reject')return Promise.reject(new Error('Permissions policy denied'));
    if(mode==='throw')throw Error('No activation');
    if(mode==='unconfirmed')return Promise.resolve();
    doc.fullscreenElement=doc.documentElement;listeners.get('doc:fullscreenchange')?.();return Promise.resolve();}};
  if(mode==='unsupported')delete doc.documentElement.requestFullscreen;
  const ctx=vm.createContext({document:doc,window:{
    matchMedia:()=>({matches:false}),addEventListener:(n,f)=>listeners.set('win:'+n,f)},
    location:{pathname:'/multiview'},navigator:{userAgent:mobile?'Android':'Desktop',userActivation:{isActive:activation}},
    innerWidth:landscape?900:430,innerHeight:landscape?430:900,
    get:(k,d)=>saved.has(k)?saved.get(k):d,set:(k,v)=>saved.set(k,v),
    alert:s=>alerts.push(s),console:{warn(){}}});
  vm.runInContext(source.slice(start,end)+
    '\nthis.nativePath=NATIVE_FULLSCREEN_PATH;this.morePath=NATIVE_MORE_PATH;'+
    '\nthis.state=()=>({pending:autoFullscreenPending,suppressed:autoFullscreenSuppressed,busy:fullscreenRequestBusy});',ctx);
  ctx.installMultiviewFullscreenButton();ctx.reconcileLandscapeFullscreen();
  return {ctx,doc,calls,alerts,status,checkbox,button,saved,listeners,
    click({trusted=true,path=ctx.nativePath,item=true,prevented=false}={}){
      const event={isTrusted:trusted,defaultPrevented:prevented,
        target:{closest:()=>item?{querySelectorAll:()=>[{getAttribute:()=>path}]}:null},
        preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
      ctx.onNativeFullscreenClick(event);return event;
    }};
}
test('native menu click requests fullscreen synchronously, with auto setting off and in portrait',async()=>{
  const h=harness();let closes=0;
  h.doc.querySelectorAll=()=>[{querySelectorAll:()=>[{getAttribute:()=>h.ctx.morePath}],
    getAttribute:()=> 'true',click(){closes++;}}];
  const e=h.click();assert.deepEqual(h.calls,['enter']);assert.equal(e.stopped,true);
  assert.equal(closes,1);await settle();assert.match(h.status.textContent,/已进入/);
  h.click();assert.deepEqual(h.calls,['enter','exit']);await settle();
  assert.equal(h.doc.fullscreenElement,null);assert.equal(h.ctx.state().suppressed,true);
});
test('untrusted, unrelated, already-handled and desktop clicks pass through untouched',()=>{
  for(const options of [{trusted:false},{path:'other'},{item:false},{prevented:true}]){
    const h=harness();const e=h.click(options);assert.equal(e.stopped,undefined);assert.equal(h.calls.length,0);
  }
  const h=harness({mobile:false});assert.equal(h.click().stopped,undefined);assert.equal(h.calls.length,0);
});
test('reload and rotation only arm the saved setting; no arbitrary user gesture is consumed',()=>{
  const h=harness({enabled:true,landscape:true});assert.equal(h.ctx.state().pending,true);
  assert.match(h.status.textContent,/横屏已准备/);assert.equal(h.calls.length,0);
  assert.equal(h.listeners.has('doc:pointerup'),false);
  h.ctx.innerWidth=430;h.ctx.innerHeight=900;h.ctx.reconcileLandscapeFullscreen();
  assert.equal(h.ctx.state().pending,false);
  h.ctx.innerWidth=900;h.ctx.innerHeight=430;h.ctx.reconcileLandscapeFullscreen();
  assert.equal(h.ctx.state().pending,true);assert.equal(h.calls.length,0);
});
test('no activation, rejected, thrown and unconfirmed requests show retry guidance, never success',async()=>{
  for(const options of [{activation:false},{mode:'reject'},{mode:'throw'},{mode:'unconfirmed'}]){
    const h=harness({enabled:true,landscape:true,...options});h.click();await settle();
    assert.equal(h.doc.fullscreenElement,null);assert.equal(h.ctx.state().busy,false);
    assert.equal(h.ctx.state().pending,true);assert.match(h.status.textContent,/未进入全屏/);
    assert.equal(h.alerts.length,1);
    if(options.activation===false)assert.equal(h.calls.length,0);
  }
});
test('unsupported and foreign fullscreen preserve the native handler and do not disturb another video',()=>{
  const unsupported=harness({mode:'unsupported'});assert.equal(unsupported.click().stopped,undefined);
  unsupported.ctx.toggleMultiviewFullscreen();assert.match(unsupported.status.textContent,/不支持/);
  const foreign=harness();foreign.doc.fullscreenElement={};
  assert.equal(foreign.click().stopped,undefined);assert.equal(foreign.calls.length,0);
});
test('portrait failure feedback survives periodic reconciliation',async()=>{
  const h=harness({mode:'reject'});h.click();await settle();
  h.ctx.reconcileLandscapeFullscreen();h.ctx.reconcileLandscapeFullscreen();
  assert.match(h.status.textContent,/未进入全屏/);
});
test('duplicate clicks are bounded; Android Back suppresses re-entry until a fresh orientation cycle',async()=>{
  const h=harness({enabled:true,landscape:true});h.click();h.click();assert.equal(h.calls.length,1);await settle();
  h.doc.fullscreenElement=null;h.listeners.get('doc:fullscreenchange')();
  h.ctx.reconcileLandscapeFullscreen();assert.equal(h.ctx.state().suppressed,true);
  assert.equal(h.ctx.state().pending,false);assert.match(h.status.textContent,/已退出/);
  h.ctx.innerWidth=430;h.ctx.innerHeight=900;h.ctx.reconcileLandscapeFullscreen();
  h.ctx.innerWidth=900;h.ctx.innerHeight=430;h.ctx.reconcileLandscapeFullscreen();
  assert.equal(h.ctx.state().pending,true);assert.equal(h.calls.length,1);
});
test('off, route exit and failed in-flight requests cannot leave the auto setting armed incorrectly',async()=>{
  const h=harness({enabled:true,landscape:true,mode:'reject'});h.click();
  h.ctx.setLandscapeAutoFullscreen(false);await settle();
  assert.equal(h.ctx.state().pending,false);assert.equal(h.checkbox.checked,false);
  h.ctx.setLandscapeAutoFullscreen(true);assert.equal(h.ctx.state().pending,true);
  h.ctx.location.pathname='/favorites';h.ctx.reconcileLandscapeFullscreen();
  assert.equal(h.ctx.state().pending,false);assert.match(h.status.textContent,/先进入/);
});
test('fullscreen module contains no DOM insertion, removal, style changes or Vue state writes',()=>{
  assert.doesNotMatch(source.slice(start,end),/appendChild|createElement|innerHTML|\.remove\(|\.style\.|__vue__/);
  assert.match(source,/仍需触摸入口/);
});
