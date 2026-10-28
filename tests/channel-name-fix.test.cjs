'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const source=fs.readFileSync('userscripts/channel-name-fix.user.js','utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const validators=section('    const isVideo =','    function imageUrl(');
const metadata=section('    function findVue(','    // Official Holodex ChannelImg');
const LIVE='JIpsyJmhfM4',VOD='NOaZlPpHNRA',OTHER='abcdefghijk';
const CHANNEL='UC1234567890123456789012';
function video(id,status){return {id,title:id,channel:{name:id},status,start_actual:'2026-10-28T10:00:00Z',
  duration:status==='past'?7200:null,playerFlags:{ready:true}};}
function fixture(){
  const writes=[],warnings=[];
  const live=video(LIVE,'live'),vod=video(VOD,'past'),other=video(OTHER,'upcoming');
  const rows={a:{type:'video',video:live,currentTime:230},b:{type:'video',video:vod,currentTime:840},
    c:{type:'video',video:other,currentTime:0},chat:{type:'chat',currentTab:0,url:'unchanged-chat-setting'}};
  const store={state:{multiview:{layoutContent:rows},settings:{nameProperty:'english_name'}},
    commit(){throw Error('A metadata fill must not call a bulk or selection mutation');}};
  const owner={$store:store,_isDestroyed:false,$set(target,key,value){
    assert.equal(this,owner);writes.push({target,key,value});target[key]=value;
  }};
  const root={__vue__:owner};
  const doc={querySelector:s=>s==='#app'?root:null};
  const ctx=vm.createContext({doc,console:{warn:(...args)=>warnings.push(args)},
    location:{pathname:'/multiview'},videoCache:{},channelCache:{},avatarByChannel:{},
    KEY:'videos',CHANNEL_KEY:'channels',GM_setValue(){},rememberAvatar(){},preloadAvatar(){},
    imageUrl:s=>typeof s==='string'&&s.startsWith('https://yt3.googleusercontent.com/')?s:null,
    Date,Set,Map});
  vm.runInContext('const VIDEO=/^[\\w-]{11}$/,CHANNEL=/^UC[\\w-]{22}$/;let storeCache=null,storeOwner=null;'+validators+metadata+
    '\nthis.api={store,writeStore};',ctx);
  const info=(title)=>({name:'Shared owner',channelId:CHANNEL,title});
  const apply=(id,data)=>ctx.api.writeStore(ctx.api.store(),id,data);
  const selected=()=>Object.values(rows).filter(x=>x.type==='video')[rows.chat.currentTab]?.video;
  const select=index=>{
    rows.chat.currentTab=index;const current=selected();
    const key=Object.keys(rows).find(k=>rows[k].video===current);
    return {id:current.id,time:rows[key].currentTime,
      url:`https://www.youtube.com/${current.status==='past'?'live_chat_replay':'live_chat'}?v=${current.id}`};
  };
  return {ctx,doc,root,owner,store,rows,live,vod,other,writes,warnings,info,apply,selected,select};
}
test('same-channel live and recording retain independent chat selection, references and protected state',()=>{
  const f=fixture(),refs=[f.live.channel,f.vod.channel],before=JSON.stringify(f.rows);
  f.apply(LIVE,f.info('Current live title'));f.apply(VOD,f.info('Archived title'));
  assert.equal(f.rows.a.video,f.live);assert.equal(f.rows.b.video,f.vod);
  assert.equal(f.live.channel,refs[0]);assert.equal(f.vod.channel,refs[1]);
  assert.equal(f.live.channel.id,CHANNEL);assert.equal(f.vod.channel.id,CHANNEL);
  assert.equal(f.live.title,'Current live title');assert.equal(f.vod.title,'Archived title');
  const original=JSON.parse(before);
  for(const key of ['a','b','c']){
    for(const field of ['id','status','start_actual','duration','playerFlags','noData'])
      assert.deepEqual(f.rows[key].video[field],original[key].video[field]);
    assert.equal(f.rows[key].currentTime,original[key].currentTime);
  }
  assert.deepEqual(f.rows.chat,original.chat);assert.deepEqual(f.other,original.c.video);
  for(const index of [0,1,0,1,0]){
    const selected=f.select(index);assert.equal(selected.id,index?VOD:LIVE);
    assert.equal(selected.time,index?840:230);
    assert.match(selected.url,index?/live_chat_replay/:/live_chat\?/);
  }
  for(const {target,key} of f.writes){
    if(target===f.live||target===f.vod)assert.equal(key,'title');
    else {assert.ok(refs.includes(target));assert.ok(['name','id','english_name'].includes(key));}
  }
});
test('repeat metadata fills are idempotent and do not replace a shared channel object',()=>{
  const f=fixture(),shared={id:CHANNEL,name:'Shared owner'};f.live.channel=shared;f.vod.channel=shared;
  f.apply(LIVE,f.info('Live title'));f.apply(VOD,f.info('Recording title'));
  const count=f.writes.length;f.apply(LIVE,f.info('Live title'));f.apply(VOD,f.info('Recording title'));
  assert.equal(f.writes.length,count);assert.equal(f.live.channel,shared);assert.equal(f.vod.channel,shared);
});
test('out-of-order async results remain keyed by video ID',async()=>{
  const f=fixture();let resolveLive,resolveVod;
  const a=new Promise(resolve=>{resolveLive=resolve;}).then(info=>f.apply(LIVE,info));
  const b=new Promise(resolve=>{resolveVod=resolve;}).then(info=>f.apply(VOD,info));
  f.select(1);resolveVod(f.info('Recording title'));await b;
  f.select(0);resolveLive(f.info('Live title'));await a;
  assert.equal(f.selected(),f.live);assert.equal(f.live.title,'Live title');assert.equal(f.vod.title,'Recording title');
  assert.equal(f.vod.status,'past');assert.equal(f.live.status,'live');
});
test('removed videos discard late results instead of adding or modifying other cells',async()=>{
  const f=fixture();let resolve;
  const pending=new Promise(r=>{resolve=r;}).then(info=>f.apply(LIVE,info));
  delete f.rows.a;const before=JSON.stringify(f.rows);resolve(f.info('Late title'));await pending;
  assert.equal(JSON.stringify(f.rows),before);assert.equal(f.writes.length,0);
});
test('late results resolve the current object and preserve valid native data',()=>{
  const f=fixture(),replacement=video(LIVE,'past');replacement.title='Native refreshed title';
  replacement.channel={id:CHANNEL,name:'Native owner',english_name:'Native localized owner'};
  replacement.noData=false;f.rows.a.video=replacement;
  f.apply(LIVE,{...f.info('Stale cached title'),channelId:'UCabcdefghijklmnopqrstuv'});
  assert.equal(f.rows.a.video,replacement);assert.equal(replacement.title,'Native refreshed title');
  assert.equal(replacement.channel.name,'Native owner');assert.equal(replacement.channel.id,CHANNEL);
  assert.equal(replacement.status,'past');assert.equal(replacement.noData,false);assert.equal(f.writes.length,0);
  assert.equal(f.live.title,LIVE);
});
test('missing channels are created reactively only when needed, while placeholder titles are filled',()=>{
  const f=fixture();f.live.channel=null;
  f.apply(LIVE,f.info('Live title'));const channel=f.live.channel;
  assert.equal(channel.name,'Shared owner');assert.ok(f.writes.some(x=>x.target===f.live&&x.key==='channel'));
  f.apply(LIVE,f.info('Live title'));assert.equal(f.live.channel,channel);
  f.vod.channel={name:'Shared owner',id:CHANNEL};f.vod.title='Shared owner';
  f.apply(VOD,f.info('Actual recording title'));assert.equal(f.vod.title,'Actual recording title');
});
test('invalid data and unsafe preference keys cannot write extra channel or video fields',()=>{
  for(const preference of ['status','id','__proto__','constructor']){
    const f=fixture();f.store.state.settings.nameProperty=preference;
    f.apply(LIVE,{...f.info('Live title'),status:'past',noData:true,videoId:VOD,url:'wrong'});
    assert.equal(f.live.status,'live');assert.equal(f.live.noData,undefined);
    assert.equal(f.live.channel.status,undefined);assert.equal(Object.getPrototypeOf(f.live.channel),Object.prototype);
    assert.ok(f.writes.every(x=>['name','id','title'].includes(x.key)));
  }
  const f=fixture();f.apply('not-a-video',f.info('Wrong'));f.apply(LIVE,{name:LIVE,channelId:'invalid',title:LIVE});
  assert.equal(f.writes.length,0);
});
test('unavailable, destroyed, strict-mode or foreign Vue setters leave state alone',()=>{
  for(const kind of ['missing','destroyed','foreign','strict','no-vue']){
    const f=fixture();if(kind==='no-vue')delete f.root.__vue__;
    const store=f.ctx.api.store();
    if(kind==='missing')delete f.owner.$set;
    if(kind==='destroyed')f.owner._isDestroyed=true;
    if(kind==='foreign')f.owner.$store={};
    if(kind==='strict')f.store.strict=true;
    const before=JSON.stringify(f.rows);f.ctx.api.writeStore(store,LIVE,f.info('Title'));
    assert.equal(JSON.stringify(f.rows),before,kind);assert.equal(f.writes.length,0,kind);
  }
});
test('failing reactive setter skips patch without falling back to a bulk mutation',()=>{
  const f=fixture();f.owner.$set=()=>{throw Error('No writable Vue entry');};
  const before=JSON.stringify(f.rows);assert.doesNotThrow(()=>f.apply(LIVE,f.info('Title')));
  assert.equal(JSON.stringify(f.rows),before);assert.equal(f.warnings.length,1);
});
test('multiple layout instances of one video are patched without changing their identities',()=>{
  const f=fixture(),duplicate=video(LIVE,'live');f.rows.d={type:'video',video:duplicate};
  f.apply(LIVE,f.info('Live title'));
  assert.equal(f.rows.d.video,duplicate);assert.equal(duplicate.title,'Live title');
  assert.equal(f.rows.a.video,f.live);assert.equal(f.vod.title,VOD);
});
test('no Vue entry leaves the native chat selector DOM untouched',()=>{
  const f=fixture();delete f.root.__vue__;
  const label={};Object.defineProperty(label,'textContent',{get:()=>LIVE,set(){throw Error('Native selector modified');}});
  f.doc.querySelectorAll=()=>[label];
  vm.runInContext(section("    let lastPath='';",'    function schedule(')+'\nthis.tick=tick;',f.ctx);
  assert.doesNotThrow(()=>f.ctx.tick());assert.equal(label.textContent,LIVE);
});
test('video caches isolate titles while shared channel caches contain only channel data',()=>{
  const f=fixture();
  vm.runInContext(section('    function saveVideo(','    function legacyName(')+
    '\nthis.cacheApi={saveVideo,saveChannel};',f.ctx);
  f.ctx.cacheApi.saveVideo(LIVE,f.info('Live title'));
  f.ctx.cacheApi.saveVideo(VOD,f.info('Recording title'));
  f.ctx.cacheApi.saveChannel('https://www.youtube.com/channel/'+CHANNEL,
    {...f.info('Must not be shared'),status:'past',noData:true,chatUrl:'wrong'});
  assert.equal(f.ctx.videoCache[LIVE].title,'Live title');assert.equal(f.ctx.videoCache[VOD].title,'Recording title');
  const channel=Object.values(f.ctx.channelCache)[0];
  assert.equal(channel.name,'Shared owner');
  for(const key of ['title','status','noData','chatUrl'])assert.equal(channel[key],undefined);
});
test('valid native channel identity takes precedence over conflicting cached avatar identity',()=>{
  const f=fixture();f.live.channel={id:CHANNEL,name:'Native owner'};
  f.ctx.videoCache[LIVE]={channelId:'UCabcdefghijklmnopqrstuv',avatar:'https://yt3.googleusercontent.com/wrong'};
  vm.runInContext(section('    function avatarFor(','    function saveVideo(')+'\nthis.avatarFor=avatarFor;',f.ctx);
  assert.equal(f.ctx.avatarFor(f.live),null);
  f.ctx.avatarByChannel[CHANNEL]={url:'https://yt3.googleusercontent.com/correct'};
  assert.equal(f.ctx.avatarFor(f.live),'https://yt3.googleusercontent.com/correct');
});
