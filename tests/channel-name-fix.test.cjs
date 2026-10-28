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

function traceFixture(){
  const f=fixture(),listeners=new Map(),watchers=[],observers=[],timers=new Map();let timerId=0;
  let src='https://www.youtube.com/live_chat?v='+LIVE;
  const frame={getAttribute:()=>src},cell={querySelectorAll:()=>[frame]};
  const watch={$options:{name:'WatchLiveChat'},video:f.live,$children:[]};
  const chat={$options:{name:'ChatCell'},item:{i:'chat-1'},activeVideos:[f.live,f.vod],
    currentTab:0,currentVideo:f.live,$children:[watch],$watch(getter,callback){
      const item={getter,callback};watchers.push(item);return ()=>watchers.splice(watchers.indexOf(item),1);
    }};
  const select={$options:{name:'v-select'},$parent:chat,internalValue:0,
    items:[{text:'Same owner',value:0},{text:'Same owner',value:1}],getValue:item=>item.value,
    $on(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
    $off(name,fn){listeners.get(name)?.delete(fn);}};
  const node={__vue__:select,closest:()=>cell};
  f.doc.querySelectorAll=()=>[node];
  Object.assign(f.ctx,{URL,V:'2.6.4',location:{href:'https://holodex.net/multiview'},
    MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}},
    setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(section('    function chatSwitchConclusion(','    const chatSwitchTrace=')+
    '\nthis.trace=createChatSwitchDiagnostics();',f.ctx);
  const emit=(value)=>{for(const fn of listeners.get('input')||[])fn(value);};
  const change=({tab=1,video=f.vod,watchVideo=video,url='https://www.youtube.com/live_chat_replay?v='+VOD}={})=>{
    chat.currentTab=tab;chat.currentVideo=video;select.internalValue=tab;watch.video=watchVideo;src=url;
    for(const {getter,callback} of watchers)callback(getter());
    for(const observer of observers)if(!observer.disconnected)observer.fn();
  };
  return {...f,trace:f.ctx.trace,listeners,watchers,observers,timers,chat,select,frame,emit,change};
}
test('trace distinguishes missing selection, model, child binding and iframe transitions',()=>{
  for(const [kind,expected] of [['none','未记录到下拉框 input'],['model','第1步'],['video','第2步'],
    ['child','WatchLiveChat 仍绑定旧视频'],['frame','iframe 地址仍是旧视频'],['unknown','尚未识别到带视频 ID'],['ok','视频 ID 一致']]){
    const f=traceFixture();assert.equal(f.trace.start(),1);
    if(kind!=='none')f.emit(1);
    if(kind==='video')f.change({video:f.live});
    if(kind==='child')f.change({watchVideo:f.live});
    if(kind==='frame')f.change({url:'https://www.youtube.com/live_chat?v='+LIVE});
    if(kind==='unknown')f.change({url:'https://example.com/?secret=PRIVATE'});
    if(kind==='ok')f.change();
    assert.ok(f.trace.report().includes(expected),kind);
  }
});
test('trace keeps same-name options distinct and omits continuation tokens and chat content',()=>{
  const f=traceFixture();f.trace.start();f.emit(1);
  f.change({url:'https://www.youtube.com/live_chat_replay?v='+VOD+'&continuation=PRIVATE_TOKEN&auth=PRIVATE'});
  const report=f.trace.report();assert.ok(report.includes(LIVE));assert.ok(report.includes(VOD));
  assert.ok(report.includes('Same owner'));assert.ok(report.includes('视频 ID 一致'));
  for(const value of ['PRIVATE','continuation','auth='])assert.ok(!report.includes(value));
});
test('trace never switches chat state and removes only its own observers and event handlers',()=>{
  const f=traceFixture(),before=JSON.stringify(f.rows);let existingCalls=0;
  f.select.$on('input',()=>existingCalls++);
  f.trace.start();f.trace.start();assert.equal(f.watchers.length,2);
  assert.equal(f.listeners.get('input').size,2);assert.equal(f.timers.size,1);
  f.emit(1);assert.equal(JSON.stringify(f.rows),before);f.trace.report();
  assert.equal(f.watchers.length,0);assert.equal(f.listeners.get('input').size,1);assert.equal(f.timers.size,0);
  assert.ok(f.observers.every(o=>o.disconnected));f.emit(1);assert.equal(existingCalls,2);
});
test('trace caps event history, expires recording, and does not mistake selecting the original video for failure',()=>{
  const f=traceFixture();assert.ok(f.trace.report().includes('尚未录制'));
  f.trace.start();for(let i=0;i<80;i++)f.emit(0);
  for(const fn of [...f.timers.values()])fn();
  const report=f.trace.report();assert.ok(report.includes('本次选中的仍是原视频'));
  assert.ok(report.includes('已自动结束'));assert.ok((report.match(/ms input=/g)||[]).length<=30);
});
test('trace recognizes a completed switch back and maps reordered options at event time',()=>{
  const f=traceFixture();f.trace.start();f.emit(1);f.change();
  f.emit(0);f.change({tab:0,video:f.live,url:'https://www.youtube.com/live_chat?v='+LIVE});
  assert.ok(f.trace.report().includes('视频 ID 一致'));
  f.trace.start();f.chat.activeVideos=[f.vod,f.live];f.emit(0);f.change({tab:0});
  assert.ok(f.trace.report().includes('视频 ID 一致'));
});
test('a hidden target iframe is not mistaken for the visible chat having switched',()=>{
  const f=traceFixture();f.frame.getClientRects=()=>[];
  f.trace.start();f.emit(1);f.change();
  const report=f.trace.report();assert.ok(report.includes('尚未识别到带视频 ID'));
  assert.ok(report.includes('"visible":false'));
});

test('trace reports render dependency failures and layout identity without leaking exception details',()=>{
  const f=traceFixture();f.chat.layoutContent=f.rows;
  Object.defineProperty(f.chat,'currentTime',{get(){throw new TypeError('PRIVATE_URL_TOKEN');}});
  f.chat.videoCellId='a';f.chat.channels=f.select.items;
  f.trace.start();f.emit(1);f.change();const report=f.trace.report();
  assert.ok(report.includes('"identityMatches":1'));
  assert.ok(report.includes('"currentTime":{"ok":false,"error":"TypeError"}'));
  assert.ok(report.includes('"channels":{"ok":true,"value":2}'));
  assert.ok(!report.includes('PRIVATE_URL_TOKEN'));
});

test('report uses a readonly selectable text area and closes without changing chat',()=>{
  const f=traceFixture(),nodes=[];let removed=false;
  f.doc.getElementById=()=>null;
  f.doc.createElement=tag=>{const node={tag,style:{},events:{},children:[],
    setAttribute(){},addEventListener(event,fn){this.events[event]=fn;},
    append(...children){this.children.push(...children);},showModal(){this.open=true;},
    close(){this.events.close();},remove(){removed=true;},focus(){this.focused=true;},select(){this.selected=true;}};
    nodes.push(node);return node;};
  f.doc.body={append(){}};f.ctx.V='2.6.5';
  vm.runInContext(section('    function showChatSwitchReport(','    const chatSwitchTrace=')+
    '\nshowChatSwitchReport("Report contents");',f.ctx);
  const text=nodes.find(n=>n.tag==='textarea'),buttons=nodes.filter(n=>n.tag==='button');
  assert.equal(text.readOnly,true);assert.equal(text.value,'Report contents');
  buttons[0].events.click();assert.equal(text.focused,true);assert.equal(text.selected,true);
  buttons[1].events.click();assert.equal(removed,true);assert.equal(f.chat.currentTab,0);
});

function progressFixture({broken=true}={}) {
  const f=fixture();let forced=0,invalidated=0;
  const chat={$options:{name:'ChatCell'},layoutContent:f.rows,currentVideo:broken?{...f.live}:f.live,
    $forceUpdate(){forced++;},_computedWatchers:{}};
  const getters={videoCellId(){return Object.keys(this.layoutContent).find(key=>this.layoutContent[key].video===this.currentVideo);},
    currentTime(){return this.layoutContent[this.videoCellId].currentTime||0;}};
  for(const key of Object.keys(getters)){
    chat._computedWatchers[key]={getter:getters[key],update(){invalidated++;}};
    Object.defineProperty(chat,key,{get(){return chat._computedWatchers[key].getter.call(chat);}});
  }
  f.ctx.chat=chat;
  vm.runInContext('this.guard=guardChatProgress;this.resolve=resolveChatVideoCell;',f.ctx);
  return {...f,chat,guard:f.ctx.guard,resolve:f.ctx.resolve,forced:()=>forced,invalidated:()=>invalidated};
}
test('progress guard recovers stale video identity and switches same-channel videos by ID',()=>{
  const f=progressFixture(),before=JSON.stringify(f.rows),refs=[f.live,f.vod,f.live.channel];
  assert.throws(()=>f.chat.currentTime,/currentTime/);
  assert.equal(f.guard(f.chat),true);assert.equal(f.chat.videoCellId,'a');assert.equal(f.chat.currentTime,230);
  f.chat.currentVideo={...f.vod};assert.equal(f.chat.videoCellId,'b');assert.equal(f.chat.currentTime,840);
  assert.equal(JSON.stringify(f.rows),before);assert.equal(f.rows.a.video,refs[0]);assert.equal(f.rows.b.video,refs[1]);
  assert.equal(f.live.channel,refs[2]);assert.equal(f.forced(),1);assert.equal(f.invalidated(),2);
  assert.equal(f.guard(f.chat),false);assert.equal(f.forced(),1);
});
test('progress guard prefers native identity, handles removed videos and preserves healthy instances',()=>{
  const healthy=progressFixture({broken:false});assert.equal(healthy.guard(healthy.chat),false);
  assert.equal(healthy.forced(),0);
  const f=progressFixture();f.guard(f.chat);
  f.rows.duplicate={type:'video',video:{...f.vod},currentTime:42};f.chat.currentVideo=f.rows.duplicate.video;
  assert.equal(f.chat.videoCellId,'duplicate');assert.equal(f.chat.currentTime,42);
  f.chat.currentVideo={id:'notinlayout'};assert.equal(f.chat.currentTime,0);
  f.chat.currentVideo=null;assert.equal(f.chat.currentTime,0);
});
test('progress guard skips unsupported or destroyed Vue instances',()=>{
  for(const change of [c=>c._isDestroyed=true,c=>c.$options.name='Other',c=>delete c._computedWatchers.currentTime,
    c=>delete c.$forceUpdate]){
    const f=progressFixture();change(f.chat);assert.equal(f.guard(f.chat),false);assert.equal(f.forced(),0);
  }
});
