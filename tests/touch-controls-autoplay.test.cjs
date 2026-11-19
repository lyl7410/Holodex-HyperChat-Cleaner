'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('userscripts/holodex-touch-controls.user.js','utf8');
const start=source.indexOf('    const autoCfg={');
const end=source.indexOf("    doc.addEventListener(channel+':request'",start);
assert.ok(start>0&&end>start);

// Execute the production autoplay module, with deterministic time and named
// YouTube IFrame API callbacks. No copy of its pause/retry logic lives here.
function harness(config={},storage=new Map(),startAt=100000){
  let now=startAt,seq=0;const timers=new Map(),listeners=new Map();
  const calls=[];const cells=[];
  const doc={hidden:false,querySelector:()=>({}),querySelectorAll:()=>cells,
    addEventListener:(name,fn)=>listeners.set('doc:'+name,fn)};
  const win={document:doc,location:{pathname:'/multiview'},
    sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{at:now+ms,fn});return id;},
    setInterval:()=>0,addEventListener:(name,fn)=>listeners.set('win:'+name,fn)};
  const ctx=vm.createContext({win,doc,bootConfig:{enabled:true,...config},
    Date:{now:()=>now},findCell:root=>root.vm,valid:id=>/^[\w-]{11}$/.test(id)});
  vm.runInContext(source.slice(start,end)+
    '\nthis.api={scan:autoScan,configure:autoConfigure,diagnose:autoDiagnostics};',ctx);
  function add(id='abcdefghijk',state=5,events=true){
    const callbacks=new Map();
    const player={state,muted:false,getPlayerState(){return this.state;},
      playVideo(){calls.push('play:'+id);},isMuted(){return this.muted;},
      mute(){this.muted=true;calls.push('mute:'+id);},
      removeEventListener:(name,cb)=>{if(callbacks.get(name)===cb)callbacks.delete(name);}};
    if(events)player.addEventListener=(name,cb)=>callbacks.set(name,cb);
    const cell={vm:{item:{i:cells.length+1},video:{id,title:id},ytPlayer:player},
      querySelector:()=>({})};cells.push(cell);
    return {player,cell,callbacks,emit(state){player.state=state;
      win[callbacks.get('onStateChange')]?.({data:state});},
      blocked(){win[callbacks.get('onAutoplayBlocked')]?.();}};
  }
  function advance(ms){
    const target=now+ms;
    while(true){const next=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}
    now=target;
  }
  return {api:ctx.api,add,advance,calls,cells,doc,win,listeners,storage};
}
function started(h,events=true){const p=h.add('abcdefghijk',5,events);h.api.scan();p.emit(1);return p;}

test('v0.6.47 fast PLAYING -> PAUSED between scans blocks immediate and later retries',()=>{
  const h=harness(),p=started(h);h.advance(100);p.emit(2);
  assert.match(h.api.diagnose().rows[0].issue,/暂停保护/);
  h.advance(700);assert.equal(h.api.scan('gesture').protected,1);
  h.advance(400);assert.equal(h.api.diagnose().manualPaused,1);
  for(let i=0;i<8;i++){h.advance(5200);h.api.scan();}
  assert.equal(h.calls.length,1);
});
test('buffering after established play then pause is protected',()=>{
  const h=harness(),p=started(h);p.emit(3);p.emit(2);h.advance(1000);
  assert.equal(h.api.scan().protected,1);assert.equal(h.calls.length,1);
});
test('autoplay denial cancels pause attribution and retains bounded retry',()=>{
  const h=harness(),p=started(h);p.emit(2);h.advance(150);p.blocked();h.advance(1200);
  assert.equal(h.api.diagnose().manualPaused,0);h.api.scan();assert.equal(h.calls.length,2);
});
test('scan fallback protects a pause when state events are unavailable',()=>{
  const h=harness(),p=started(h,false);h.api.scan();p.emit(2);h.advance(1050);
  assert.equal(h.api.scan().protected,1);h.advance(1000);
  assert.equal(h.api.diagnose().manualPaused,1);assert.equal(h.calls.length,1);
});
test('explicit play clears persisted pause; another quick pause is protected',()=>{
  const h=harness(),p=started(h);p.emit(2);h.advance(1000);
  p.emit(1);assert.equal(h.api.diagnose().manualPaused,0);
  p.emit(2);h.advance(1000);assert.equal(h.api.scan().protected,1);
});
test('force play overrides a pause and invalidates pending attribution',()=>{
  const h=harness(),p=started(h);p.emit(2);h.api.scan('force');h.advance(1100);
  assert.equal(h.api.diagnose().manualPaused,0);assert.equal(h.calls.length,2);
});
test('respectPause off releases both pending and confirmed manual protection',()=>{
  for(const wait of [0,1100]){
    const h=harness(),p=started(h);p.emit(2);h.advance(wait);
    h.api.configure({respectPause:false});h.advance(5200);h.api.scan();
    assert.ok(h.calls.length>1);assert.equal(h.api.scan().protected,0);
  }
});
test('pause protection cancels a delayed muted play request',()=>{
  const h=harness({muteFallback:true}),p=h.add();h.api.scan();p.blocked();
  p.player.state=2;h.advance(1000);h.api.scan();
  assert.equal(h.api.diagnose().rows[0].mutePending,true);
  // Playback and a quick user pause can arrive while the 220ms mute delay runs.
  p.emit(1);p.emit(2);
  const before=h.calls.filter(c=>c.startsWith('play')).length;
  h.advance(220);h.api.scan();assert.equal(h.calls.filter(c=>c.startsWith('play')).length,before);
});
test('removed/replaced players cannot persist a stale pending pause or leak callbacks',()=>{
  const h=harness(),p=started(h);p.emit(2);const oldCallbacks=[...p.callbacks.values()];
  h.cells.length=0;h.api.scan();h.advance(1100);
  assert.equal(h.api.diagnose().manualPaused,0);
  assert.ok(oldCallbacks.every(name=>h.win[name]===undefined));
  const next=h.add();h.api.scan();assert.equal(h.calls.length,2);assert.equal(next.player.state,5);
});
test('background interruption resumes only when enabled and does not become a manual pause',()=>{
  const h=harness(),p=started(h);h.api.scan();h.doc.hidden=true;
  h.listeners.get('doc:visibilitychange')();p.emit(2);h.advance(1200);
  assert.equal(h.api.diagnose().manualPaused,0);assert.equal(h.api.scan().attempted,0);
  h.doc.hidden=false;h.listeners.get('doc:visibilitychange')();assert.equal(h.calls.length,2);
  // A real PLAYING event after return resets the background exception promptly.
  p.emit(1);p.emit(2);h.advance(1100);assert.equal(h.api.scan().protected,1);
});
test('manual pause survives reload, while master off prevents all automatic requests',()=>{
  const h=harness(),p=started(h);p.emit(2);h.advance(1100);
  const reloaded=harness({},h.storage,200000);reloaded.add('abcdefghijk',2);
  assert.equal(reloaded.api.scan().protected,1);assert.equal(reloaded.calls.length,0);
  const off=harness({enabled:false});off.add();off.api.scan();off.api.scan('gesture');
  assert.equal(off.calls.length,0);off.api.scan('force');assert.equal(off.calls.length,1);
});
