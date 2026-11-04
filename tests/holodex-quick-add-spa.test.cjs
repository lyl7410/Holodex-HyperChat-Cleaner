'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(
  path.resolve(__dirname, '../userscripts/holodex-mobile-quick-add.user.js'), 'utf8'
);
function slice(start, end) {
  const a = code.indexOf(start);
  const b = code.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'source section missing: ' + start);
  return code.slice(a, b);
}
const stateSource = slice('  const outgoingByVideo = new Map();', '  const receiverToken');
const sendSource = slice('  async function openHolodex(forceNew = false) {', '  function findContext()');
const buttonSource = slice('  function refreshYouTubeButton() {', '  function isTypingIn(target)');

function createHarness() {
  const storage = new Map(), notices = [], waiters = [];
  const clock = { now: 10000000 };
  const location = { href: 'https://m.youtube.com/watch?v=AAAAAAAAAAA',
    assign() { throw new Error('Unexpected navigation on existing receiver'); } };
  const btn = { isConnected: true, textContent: '', title: '', disabled: false,
    attrs: {}, onclick: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    classList: {
      values: new Set(),
      add(k) { this.values.add(k); },
      remove(k) { this.values.delete(k); },
      toggle(k, on) { on ? this.add(k) : this.remove(k); }
    }
  };
  storage.set('hma_v2_target', {
    id: 'receiver-alive', owner: 'Holodex', updated: clock.now, ready: true
  });
  const fragments = [
    "const PC_MODE=false,TARGET_KEY='hma_v2_target',PREFIX='hma_v2_request_',WAKE_KEY='hma_v2_wake';",
    "const TTL=12*60*60*1000,Date={now:()=>clock.now};",
    "const document={body:{}},window={open(){throw Error('Unexpected window.open')}};",
    "const notice={remove(){}};let busy=false,nextId=0;",
    "const uid=()=>String(++nextId);",
    "const videoIdFromURL=href=>href.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1]||null;",
    "const read=async(k,f)=>storage.has(k)?storage.get(k):f;",
    "const write=async(k,v)=>{storage.set(k,v)};",
    "const delay=()=>new Promise(resolve=>waiters.push(resolve));",
    "const makeButton=()=>button;",
    "const showNotice=text=>notices.push({videoId:videoIdFromURL(location.href),text});",
    stateSource,sendSource,buttonSource,
    'return {startSend,refreshYouTubeButton,get busy(){return busy},outgoingByVideo,recentVideoStatus};'
  ];
  const runtime = new Function(
    'location','storage','notices','waiters','button','clock',fragments.join('\n')
  )(location,storage,notices,waiters,btn,clock);
  async function flush(){for(let i=0;i<16;i++)await Promise.resolve();}
  function wake(){for(const fn of waiters.splice(0))fn();}
  function requests(){return [...storage.entries()].filter(([key])=>key.startsWith('hma_v2_request_'));}
  return {runtime,location,btn,notices,storage,clock,flush,wake,requests};
}

test('SPA A remains queued while B is immediately sendable',async()=>{
  const h=createHarness();
  await h.flush();
  h.runtime.refreshYouTubeButton();
  h.runtime.startSend();
  await h.flush();
  assert.equal(h.runtime.busy,false);
  assert.equal(h.runtime.outgoingByVideo.has('AAAAAAAAAAA'),true);
  assert.equal(h.btn.textContent,'已排队：AAAAAAAAAAA');
  h.location.href='https://m.youtube.com/watch?v=BBBBBBBBBBB';
  h.runtime.refreshYouTubeButton();
  assert.equal(h.btn.textContent,'＋H');
  assert.equal(h.btn.disabled,false);
  h.btn.onclick();
  await h.flush();
  assert.equal(h.runtime.busy,false);
  assert.equal(h.btn.textContent,'已排队：BBBBBBBBBBB');
  assert.deepEqual(h.requests().map(([,v])=>v.videoId).sort(),['AAAAAAAAAAA','BBBBBBBBBBB']);
});

test('same video does not enqueue twice while still pending',async()=>{
  const h=createHarness();
  await h.flush();h.runtime.startSend();await h.flush();
  h.runtime.startSend();await h.flush();
  assert.equal(h.requests().length,1);
  assert.match(h.notices.at(-1).text,/已在接收队列中/);
});

test('late ACK for video A cannot overwrite button for video B',async()=>{
  const h=createHarness();
  await h.flush();h.runtime.startSend();await h.flush();
  h.location.href='https://m.youtube.com/watch?v=BBBBBBBBBBB';
  h.runtime.refreshYouTubeButton();h.runtime.startSend();await h.flush();
  const a=h.requests().find(([,v])=>v.videoId==='AAAAAAAAAAA');
  const b=h.requests().find(([,v])=>v.videoId==='BBBBBBBBBBB');
  const oldNotices=h.notices.length;
  h.storage.set(a[0],{...a[1],status:'done',result:'added'});
  h.wake();await h.flush();
  assert.equal(h.btn.textContent,'已排队：BBBBBBBBBBB');
  assert.equal(h.notices.length,oldNotices);
  h.storage.set(b[0],{...b[1],status:'done',result:'added'});
  h.wake();await h.flush();
  assert.equal(h.btn.textContent,'已加入多视图');
  assert.match(h.notices.at(-1).text,/BBBBBBBBBBB 已加入/);
});

test('timeout clears local sending state but retains persistent queue',async()=>{
  const h=createHarness();
  await h.flush();h.runtime.startSend();await h.flush();
  h.clock.now+=46000;h.wake();await h.flush();
  assert.equal(h.runtime.outgoingByVideo.size,0);
  assert.equal(h.btn.textContent,'接收未确认 · 重试');
  assert.equal(h.requests()[0][1].status,'pending');
  assert.match(h.notices.at(-1).text,/未收到 Holodex 确认/);
});

test('old request timeout cannot interfere with video C',async()=>{
  const h=createHarness();
  await h.flush();h.runtime.startSend();await h.flush();
  h.location.href='https://m.youtube.com/watch?v=CCCCCCCCCCC';
  h.runtime.refreshYouTubeButton();
  h.clock.now+=46000;h.wake();await h.flush();
  assert.equal(h.btn.textContent,'＋H');
  h.runtime.startSend();await h.flush();
  assert.equal(h.requests().length,2);
  assert.equal(h.runtime.outgoingByVideo.has('CCCCCCCCCCC'),true);
});
