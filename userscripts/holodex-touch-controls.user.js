// ==UserScript==
// @name         Holodex Touch Controls（手势音量与播放统计）
// @namespace    https://github.com/lyl7410/Holodex-HyperChat-Cleaner
// @version      0.2.0
// @description  Holodex 多视图触摸音量与 YouTube 原生 Stats for nerds 连接速度统计（实验性）。
// @match        https://holodex.net/*
// @match        https://www.holodex.net/*
// @match        https://www.youtube.com/embed/*
// @match        https://youtube.com/embed/*
// @match        https://www.youtube-nocookie.com/embed/*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/lyl7410/Holodex-HyperChat-Cleaner/main/userscripts/holodex-touch-controls.user.js
// @downloadURL  https://raw.githubusercontent.com/lyl7410/Holodex-HyperChat-Cleaner/main/userscripts/holodex-touch-controls.user.js
// ==/UserScript==

(function HolodexTouchControls() {
  'use strict';
  // Run a minimal, read-only stats bridge inside YouTube's actual embedded iframe.
  // The Holodex UI remains in the top page. No extra downloads or network tests.
  function youtubeFrameBridge(videoId) {
    const TAG = 'hmtc-youtube-stats-v1';
    const origins = new Set(['https://holodex.net','https://www.holodex.net']);
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const player = () => page.document.getElementById('movie_player');
    const number = value => {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value !== 'string') return null;
      const match = value.replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : null;
    };
    function parse(raw) {
      const s = raw && typeof raw === 'object' ? raw : {};
      const text = typeof raw === 'string' ? raw : '';
      const panel = document.querySelector('.html5-video-info-panel-content');
      const body = (text + '\n' + (panel?.textContent || '')).slice(0,12000);
      const metric = (pattern) => {
        const m = body.match(pattern);
        return m ? number(m[1]) : null;
      };
      const getNumber = (...values) => {
        for (const val of values) {
          if (val == null) continue;
          const n = number(val);
          if (n != null && Number.isFinite(n)) return n;
        }
        return null;
      };
      const bandwidthKbps = getNumber(
        s.bandwidth_kbps, s.bandwidthKbps, s.connection_speed_kbps,
        s.connectionSpeedKbps,
        metric(/(?:Connection Speed|连接速度|連線速度)\s*[:：]?\s*([\d,.]+)\s*Kbps/i)
      );
      const bufferSeconds = getNumber(
        s.buffer_health_seconds, s.bufferHealthSeconds,
        metric(/(?:Buffer Health|缓冲健康度|緩衝健康度)\s*[:：]?\s*([\d,.]+)\s*s/i)
      );
      const sourceResolution = s.resolution || s.current_resolution || '';
      const resolution = typeof sourceResolution === 'string'
        ? sourceResolution.slice(0,90)
        : '';
      const sourceCodecs = s.codecs || '';
      const codecs = typeof sourceCodecs === 'string' ? sourceCodecs.slice(0,120) : '';
      const viewportFrames = String(s.viewport || s.frames || '').slice(0,100);
      const dropped = getNumber(s.dropped_frames, s.droppedFrames,
        metric(/(\d+)\s+dropped\s+of\s+\d+/i));
      const liveLatencySeconds = getNumber(
        s.live_latency_seconds, s.liveLatencySeconds,
        metric(/(?:Live Latency|直播延迟|直播延遲)\s*[:：]?\s*([\d,.]+)\s*s/i)
      );
      return {
        bandwidthKbps: bandwidthKbps!=null&&bandwidthKbps>0?bandwidthKbps:null,
        bufferSeconds:bufferSeconds!=null&&bufferSeconds>=0?bufferSeconds:null,
        resolution,codecs,
        viewportFrames,dropped,
        liveLatencySeconds:liveLatencySeconds!=null&&liveLatencySeconds>=0?liveLatencySeconds:null
      };
    }
    function readStats() {
      const p=player();
      if(!p)return {available:false, reason:'YouTube 播放器尚未就绪'};
      let actualId=null;
      try{actualId=p.getVideoData?.()?.video_id||null;}catch{}
      if(actualId&&actualId!==videoId)
        return {available:false,reason:'播放视频已切换'};
      let raw=null,source='none';
      if(typeof p.getStatsForNerds==='function') {
        try{raw=p.getStatsForNerds();source='getStatsForNerds';}catch{}
        if(!raw)try{raw=p.getStatsForNerds(0);source='getStatsForNerds(0)';}catch{}
      }
      if(!raw&&typeof p.getDebugText==='function'){
        try{raw=p.getDebugText();source='getDebugText';}catch{}
      }
      const data=parse(raw);
      const meaningful=data.bandwidthKbps!=null||data.bufferSeconds!=null||
        !!data.resolution||!!data.codecs;
      return {available:meaningful,source,
        reason:meaningful?'':'嵌入播放器未提供原生详细统计',...data};
    }
    window.addEventListener('message',event=>{
      if(event.source!==window.parent || !origins.has(event.origin))return;
      const message=event.data;
      if(!message||message.tag!==TAG||message.videoId!==videoId||
         !Number.isSafeInteger(message.seq)||message.seq<=0)return;
      const respond=result=>{
        window.parent.postMessage(
          {tag:TAG,seq:message.seq,videoId,action:message.action,...result},
          event.origin
        );
      };
      if(message.action==='stats') {
        respond({ok:true,data:readStats()});
        return;
      }
      if(message.action==='nativeToggle') {
        const p=player();
        if(!p)return respond({ok:false,error:'播放器尚未就绪'});
        try{
          const visible=typeof p.isVideoInfoVisible==='function'?
            !!p.isVideoInfoVisible():null;
          if(visible===true && typeof p.hideVideoInfo==='function') {
            p.hideVideoInfo();return respond({ok:true,data:{visible:false}});
          }
          if(typeof p.showVideoInfo==='function') {
            p.showVideoInfo();return respond({ok:true,data:{visible:true}});
          }
          return respond({ok:false,error:'此嵌入播放器不支持切换原版统计面板'});
        }catch(err){return respond({ok:false,error:String(err?.message||err).slice(0,120)});}
      }
      respond({ok:false,error:'不支持的指令'});
    });
  }

  const embed = location.pathname.match(/^\/embed\/([\w-]{11})(?:\/|$)/);
  if(embed && /^(?:www\.)?youtube(?:-nocookie)?\.com$/.test(location.hostname)) {
    if(window.top!==window.self)youtubeFrameBridge(embed[1]);
    return;
  }
  if(window.top!==window.self || !/^(www\.)?holodex\.net$/.test(location.hostname))return;

  const VERSION='0.2.0', KEY='hmtc_enabled_v1';
  const get=(key,def)=>GM_getValue(key,def);
  const set=(key,value)=>GM_setValue(key,value);
  if(!get(KEY,true)){
    GM_registerMenuCommand('启用 Holodex Touch Controls',()=>{set(KEY,true);location.reload();});
    return;
  }
  GM_registerMenuCommand('暂停 Holodex Touch Controls',()=>{set(KEY,false);location.reload();});
  const coarse=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0;
  const isMulti=()=>/^\/multiview(?:\/|$)/.test(location.pathname);
  const page=typeof unsafeWindow!=='undefined'?unsafeWindow:window;
  const token='hmtc-'+(crypto.randomUUID?.()||String(Date.now())+Math.random());
  const clamp=n=>Math.max(0,Math.min(100,Math.round(Number(n)||0)));
  const rowMap=new Map(), pending=new Map();
  const nativePending=new Map(), NATIVE_TAG='hmtc-youtube-stats-v1';
  const YT_ORIGINS=new Set(['https://www.youtube.com','https://youtube.com','https://www.youtube-nocookie.com']);
  let sequence=0,nativeSequence=0,installed=false,installing=false,listing=false,active=null,sheet=null,statsBusy=false;
  let hintTimer=null,statsInterval=null;

  GM_addStyle(`
  .hmtc-zone{position:absolute;z-index:25;right:0;top:16%;height:62%;width:34%;min-width:36px;max-width:104px;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;cursor:pointer;display:flex;justify-content:flex-end;align-items:center;padding-right:4px;box-sizing:border-box;pointer-events:auto;background:linear-gradient(to left,rgba(0,0,0,.12),transparent 80%)}
  .hmtc-handle{pointer-events:none;width:32px;height:38px;border-radius:13px;background:rgba(17,23,36,.55);border:1px solid #ffffff44;color:white;display:flex;align-items:center;justify-content:center;font:20px system-ui;opacity:.68}
  .hmtc-zone:active .hmtc-handle{opacity:1}
  .hmtc-bubble{pointer-events:none;position:absolute;right:44px;top:50%;transform:translateY(-50%);background:#10151de8;padding:8px 12px;border-radius:9px;color:white;font:700 17px system-ui;white-space:nowrap}
  .hmtc-bubble[hidden]{display:none!important}
  #hmtc-sheet{position:fixed;z-index:2147483000;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));max-width:460px;max-height:74vh;overflow:auto;margin:0 auto;background:#1a1e28f7;border:1px solid #ffffff54;border-radius:17px;padding:15px;color:#fff;box-shadow:0 8px 32px #000b;font:14px/1.45 system-ui,sans-serif;touch-action:pan-y;overscroll-behavior:contain;box-sizing:border-box}
  #hmtc-sheet[hidden]{display:none!important}
  #hmtc-sheet *{box-sizing:border-box}
  #hmtc-sheet button{min-height:43px;min-width:44px;border:1px solid #ffffff33;border-radius:10px;padding:6px 10px;background:#343b4e;color:white;cursor:pointer;font:600 14px system-ui}
  #hmtc-sheet button:active{background:#57657d}
  #hmtc-sheet .head{display:flex;align-items:center;gap:8px}
  #hmtc-sheet .title{font-weight:700;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #hmtc-sheet .volume{display:flex;gap:8px;align-items:center;margin:12px 0}
  #hmtc-sheet .volume input{flex:1;width:100%;min-width:0;height:38px;accent-color:#48d1ce;touch-action:pan-x}
  #hmtc-sheet .value{min-width:46px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
  #hmtc-sheet .actions{display:flex;gap:6px}
  #hmtc-sheet .actions button{flex:1}
  #hmtc-sheet .net{padding:10px 12px;background:#233d45;border-radius:12px;margin-top:12px}
  #hmtc-sheet .speed{font-size:27px;font-weight:700;font-variant-numeric:tabular-nums}
  #hmtc-sheet .sub{color:#c5d0d7;font-size:11px}
  #hmtc-sheet .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
  #hmtc-sheet .grid>div{padding:8px;border-radius:8px;background:#ffffff13;min-width:0}
  #hmtc-sheet .grid label{font-size:11px;color:#aeb8c9;display:block}
  #hmtc-sheet .grid strong{font-size:13px;overflow-wrap:anywhere}
  #hmtc-sheet .note{font-size:11px;color:#bcc3d0;margin-top:10px;line-height:1.5}
  @media(orientation:landscape){#hmtc-sheet{left:auto;right:9px;bottom:8px;margin:0;max-width:min(380px,65vw);max-height:calc(100vh - 16px);padding:11px}#hmtc-sheet .grid{gap:5px;margin-top:7px}#hmtc-sheet .volume{margin:7px 0}}
  `);

  // This function is serialized into the real Holodex page world.
  // It only interacts with the already present Vue VideoCell / YoutubePlayer.
  function pageAgent(channel,win) {
    const doc=win.document;
    if(win.__hmtcAgentChannel===channel)return;
    win.__hmtcAgentChannel=channel;
    const valid=id=>typeof id==='string'&&/^[\w-]{11}$/.test(id);
    function findCell(root) {
      const seeds=[root,root.querySelector('.mv-frame'),root.parentElement];
      const queue=[],seen=new Set();
      for(const el of seeds){
        if(!el)continue;
        if(el.__vue__)queue.push(el.__vue__);
        for(const child of Array.from(el.children||[]).slice(0,5))
          if(child.__vue__)queue.push(child.__vue__);
      }
      let scanned=0;
      while(queue.length&&scanned++<250){
        let vm=queue.shift();
        vm=vm?.wrappedJSObject||vm;
        if(!vm||seen.has(vm))continue;
        seen.add(vm);
        if(vm.$options?.name==='VideoCell'&&!vm._isDestroyed&&
           vm.cellContent?.type==='video'&&!vm.isTwitchVideo&&valid(vm.video?.id))return vm;
        if(vm.$parent)queue.push(vm.$parent);
        if(Array.isArray(vm.$children))queue.push(...vm.$children.slice(0,16));
      }
      return null;
    }
    function enumerate(){
      const roots=[...doc.querySelectorAll('.multiview .mv-cell > .cell-content')];
      const rows=[];
      for(let index=0;index<roots.length;index++){
        const root=roots[index];
        if(!root.querySelector('.mv-frame'))continue;
        const vm=findCell(root);
        if(!vm)continue;
        const layoutId=String(vm.item?.i??''),videoId=vm.video?.id;
        if(!layoutId||!valid(videoId))continue;
        rows.push({index,layoutId,videoId,
          title:String(vm.video?.title||vm.video?.channel?.name||videoId).slice(0,140),
          volume:Number.isFinite(Number(vm.volume))?Math.max(0,Math.min(100,Math.round(Number(vm.volume)))):50,
          muted:!!vm.muted,ready:!!vm.ytPlayer,live:vm.video?.status==='live'
        });
      }
      return rows;
    }
    function locate(layoutId,videoId){
      for(const root of doc.querySelectorAll('.multiview .mv-cell > .cell-content')){
        if(!root.querySelector('.mv-frame'))continue;
        const vm=findCell(root);
        if(vm&&String(vm.item?.i)===layoutId&&vm.video?.id===videoId)return vm;
      }
      return null;
    }
    async function snapshot(vm){
      const p=vm.ytPlayer;
      if(!p)return {ready:false};
      const methods=['getPlayerState','getCurrentTime','getDuration',
        'getVideoLoadedFraction','getPlaybackRate','getVolume','isMuted'];
      const fields=['state','position','duration','fraction','rate','volume','muted'];
      const values=await Promise.allSettled(methods.map(x=>
        typeof p[x]==='function'?Promise.resolve(p[x]()):null));
      const data={ready:true,live:vm.video?.status==='live'};
      values.forEach((v,i)=>{if(v.status==='fulfilled'&&v.value!=null)data[fields[i]]=v.value;});
      return data;
    }
    doc.addEventListener(channel+':request',async ev=>{
      let msg;try{msg=JSON.parse(ev.detail);}catch{return;}
      if(!Number.isSafeInteger(msg?.seq))return;
      const reply=payload=>doc.dispatchEvent(new win.CustomEvent(channel+':reply',{
        detail:JSON.stringify({seq:msg.seq,...payload})
      }));
      try{
        if(!doc.querySelector('.multiview'))return reply({ok:false,error:'不在多视图页面'});
        if(msg.action==='list')return reply({ok:true,data:enumerate()});
        if(typeof msg.layoutId!=='string'||!valid(msg.videoId))
          return reply({ok:false,error:'没有对应的视频 ID'});
        const vm=locate(msg.layoutId,msg.videoId);
        if(!vm)return reply({ok:false,error:'未找到此视频格子'});
        if(msg.action==='volume'){
          if(!Number.isFinite(msg.volume)||msg.volume<0||msg.volume>100)
            return reply({ok:false,error:'音量无效'});
          const value=Math.round(msg.volume);
          vm.setVolume(value);
          if(value>0&&vm.muted)vm.setMuted(false);
          if(value===0&&!vm.muted)vm.setMuted(true);
          return reply({ok:true,data:{volume:value,muted:!!vm.muted}});
        }
        if(msg.action==='mute'){
          vm.setMuted(!vm.muted);
          return reply({ok:true,data:{volume:Number(vm.volume)||0,muted:!!vm.muted}});
        }
        if(msg.action==='stats')return reply({ok:true,data:await snapshot(vm)});
        return reply({ok:false,error:'操作不支持'});
      }catch(error){return reply({ok:false,error:String(error?.message||error).slice(0,140)});}
    });
    doc.dispatchEvent(new win.CustomEvent(channel+':ready'));
  }

  function rpc(action,args={},timeout=3000){
    if(!installed)return Promise.reject(new Error('播放器接口尚未连接'));
    const seq=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(seq);reject(new Error('播放器响应超时'));},timeout);
      pending.set(seq,{resolve,reject,timer});
      document.dispatchEvent(new CustomEvent(token+':request',{detail:JSON.stringify({seq,action,...args})}));
    });
  }
  document.addEventListener(token+':reply',ev=>{
    let response;try{response=JSON.parse(ev.detail);}catch{return;}
    const task=pending.get(response.seq);
    if(!task)return;
    clearTimeout(task.timer);pending.delete(response.seq);
    response.ok?task.resolve(response.data):task.reject(new Error(response.error||'操作失败'));
  });
  function installBridge(){
    if(installed||installing||!isMulti())return;
    installing=true;
    const ready=()=>{
      installed=true;installing=false;
      document.removeEventListener(token+':ready',ready);
      refresh();
    };
    document.addEventListener(token+':ready',ready);
    const tag=document.createElement('script');
    const nonce=document.querySelector('script[nonce]')?.nonce;
    if(nonce)tag.nonce=nonce;
    tag.textContent='('+pageAgent.toString()+')('+JSON.stringify(token)+',window);';
    try{(document.head||document.documentElement).appendChild(tag);tag.remove();}catch{}
    setTimeout(()=>{
      if(installed)return;
      try{
        if(page.document?.querySelector('.multiview'))pageAgent(token,page);
      }catch(error){console.warn('[Holodex Touch Controls] 页面桥接失败',error);}
      if(!installed){installing=false;document.removeEventListener(token+':ready',ready);}
    },800);
  }

  // The YouTube embed is a separate cross-origin document.
  // Send a narrow request to that frame only; never use window.top document access.
  function nativeFrame(row) {
    if (!row || !/^[\w-]{11}$/.test(row.videoId||'')) return null;
    const roots=[...document.querySelectorAll('.multiview .mv-cell > .cell-content')];
    const root=roots[row.index];
    if(!root)return null;
    const slot=root.querySelector('.mv-frame');
    if(!slot)return null;
    const zone=slot.querySelector('.hmtc-zone');
    if(zone && zone.dataset.key!==row.layoutId+':'+row.videoId)return null;
    for(const frame of slot.querySelectorAll('iframe[src]')){
      let u;
      try{u=new URL(frame.src,location.href);}catch{continue;}
      if(!YT_ORIGINS.has(u.origin))continue;
      const match=u.pathname.match(/^\/embed\/([\w-]{11})(?:\/|$)/);
      if(match?.[1]===row.videoId)return {frame,origin:u.origin};
    }
    return null;
  }
  function nativeRequest(row,action,timeout=1800) {
    if(action!=='stats'&&action!=='nativeToggle')
      return Promise.reject(new Error('不支持的 YouTube 指令'));
    const target=nativeFrame(row);
    if(!target)return Promise.reject(new Error('未找到当前视频的 YouTube 嵌入播放器'));
    const seq=++nativeSequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        nativePending.delete(seq);
        reject(new Error('YouTube iframe 未响应，可能未启用跨域 iframe 脚本注入'));
      },timeout);
      nativePending.set(seq,{...target,videoId:row.videoId,action,timer,resolve,reject});
      try{
        target.frame.contentWindow.postMessage(
          {tag:NATIVE_TAG,seq,videoId:row.videoId,action},
          target.origin
        );
      }catch(error){
        clearTimeout(timer);
        nativePending.delete(seq);
        reject(error);
      }
    });
  }
  window.addEventListener('message',event=>{
    if(!YT_ORIGINS.has(event.origin))return;
    const response=event.data;
    if(response?.tag!==NATIVE_TAG||!Number.isSafeInteger(response.seq))return;
    const task=nativePending.get(response.seq);
    if(!task||task.frame.contentWindow!==event.source||
       task.origin!==event.origin||
       task.videoId!==response.videoId||
       task.action!==response.action)return;
    clearTimeout(task.timer);
    nativePending.delete(response.seq);
    response.ok?task.resolve(response.data):task.reject(new Error(response.error||'YouTube 统计不可用'));
  });

  function field(name,text){
    const el=sheet?.querySelector('[data-field="'+name+'"]');
    if(el)el.textContent=String(text);
  }
  function renderVolume(row){
    if(!sheet||sheet.hidden||!active)return;
    const input=sheet.querySelector('[data-field="slider"]');
    if(input&&document.activeElement!==input)input.value=String(row.volume);
    field('volume',(row.muted?'静音 ':'')+row.volume+'%');
    const mute=sheet.querySelector('[data-action="mute"]');
    if(mute)mute.textContent=row.muted?'🔇':'🔊';
  }
  function bubble(zone,text,ms=1150){
    const el=zone?.querySelector('.hmtc-bubble');
    if(!el)return;
    el.textContent=text;el.hidden=false;
    clearTimeout(zone._hideTimer);
    zone._hideTimer=setTimeout(()=>{el.hidden=true;},ms);
  }
  function volume(row,value,zone){
    value=clamp(value);
    row.volume=value;row.muted=value===0;
    if(zone){zone.dataset.volume=String(value);bubble(zone,'🔊 '+value+'%');}
    if(active&&active.layoutId===row.layoutId&&active.videoId===row.videoId)renderVolume(row);
    rpc('volume',{layoutId:row.layoutId,videoId:row.videoId,volume:value})
      .catch(e=>zone?bubble(zone,e.message,2000):field('note',e.message));
  }

  function attach(root,row){
    const frame=root.querySelector('.mv-frame');
    if(!frame)return;
    let zone=frame.querySelector(':scope > .hmtc-zone');
    if(!zone){
      zone=document.createElement('div');
      zone.className='hmtc-zone';
      zone.innerHTML='<div class="hmtc-handle" aria-hidden="true">🔊</div><div class="hmtc-bubble" hidden></div>';
      frame.appendChild(zone);
      zone.addEventListener('pointerdown',e=>{
        if(e.button>0||!e.isPrimary)return;
        const current=rowMap.get(zone.dataset.key);
        if(!current)return;
        e.preventDefault();e.stopPropagation();
        zone._drag={id:e.pointerId,startY:e.clientY,volume:current.volume,
          range:Math.max(105,zone.getBoundingClientRect().height*.9),moved:false,lastSent:0};
        try{zone.setPointerCapture(e.pointerId);}catch{}
      });
      zone.addEventListener('pointermove',e=>{
        const drag=zone._drag;
        if(!drag||drag.id!==e.pointerId)return;
        e.preventDefault();e.stopPropagation();
        const dy=drag.startY-e.clientY;
        if(!drag.moved&&Math.abs(dy)<8)return;
        drag.moved=true;
        const current=rowMap.get(zone.dataset.key);
        if(!current)return;
        const v=clamp(drag.volume+dy/drag.range*100);
        if(v===current.volume&&!current.muted)return;
        current.volume=v;current.muted=v===0;
        bubble(zone,'🔊 '+v+'%',900);
        if(active&&active.layoutId===current.layoutId&&active.videoId===current.videoId)
          renderVolume(current);
        if(performance.now()-drag.lastSent>90){
          drag.lastSent=performance.now();
          rpc('volume',{layoutId:current.layoutId,videoId:current.videoId,volume:v})
            .catch(e=>bubble(zone,e.message,1800));
        }
      });
      function finish(e,cancel){
        const drag=zone._drag;
        if(!drag||drag.id!==e.pointerId)return;
        e.preventDefault();e.stopPropagation();
        zone._drag=null;
        try{zone.releasePointerCapture(e.pointerId);}catch{}
        const current=rowMap.get(zone.dataset.key);
        if(!current||cancel)return;
        if(drag.moved)volume(current,current.volume,zone);
        else openSheet(current);
      }
      zone.addEventListener('pointerup',e=>finish(e,false));
      zone.addEventListener('pointercancel',e=>finish(e,true));
      zone.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();});
      zone.addEventListener('contextmenu',e=>e.preventDefault());
    }
    zone.dataset.key=row.layoutId+':'+row.videoId;
    zone.title='向上/向下滑动调音量；轻点打开统计';
  }

  function makeSheet(){
    if(sheet?.isConnected)return;
    sheet=document.createElement('section');
    sheet.id='hmtc-sheet';sheet.hidden=true;
    sheet.setAttribute('role','dialog');
    sheet.setAttribute('aria-label','YouTube 音量和播放统计');
    sheet.innerHTML=[
      '<div class="head"><div class="title" data-field="title">YouTube</div>',
      '<button data-action="close" aria-label="关闭">✕</button></div>',
      '<div class="volume"><button data-action="mute" aria-label="切换静音">🔊</button>',
      '<input type="range" data-field="slider" aria-label="当前视频音量" min="0" max="100" step="1">',
      '<span class="value" data-field="volume">—</span></div>',
      '<div class="actions"><button data-action="minus">−10</button>',
      '<button data-action="plus">＋10</button><button data-action="full">100%</button></div>',
      '<div class="net"><div class="sub">设备网络速度估算 · 非此视频的实际连接速度</div>',
      '<div class="speed" data-field="speed">—</div>',
      '<div class="sub" data-field="network">读取浏览器网络信息…</div></div>',
      '<div class="grid">',
      '<div><label>播放状态</label><strong data-field="state">—</strong></div>',
      '<div><label>录播缓冲比例</label><strong data-field="buffer">—</strong></div>',
      '<div><label>播放时间</label><strong data-field="position">—</strong></div>',
      '<div><label>倍速</label><strong data-field="rate">—</strong></div>',
      '</div><div class="note" data-field="note">',
      'YouTube IFrame API 不提供稳定的每路 CDN 连接速度；不进行额外下载测速。</div>'
    ].join('');
    document.body.appendChild(sheet);
    const slider=sheet.querySelector('[data-field="slider"]');
    slider.addEventListener('input',()=>{
      const row=active&&rowMap.get(active.layoutId+':'+active.videoId);
      if(row)volume(row,Number(slider.value),null);
    });
    sheet.addEventListener('click',async e=>{
      const btn=e.target.closest('button[data-action]');
      if(!btn)return;
      const action=btn.dataset.action;
      if(action==='close'){closeSheet();return;}
      const row=active&&rowMap.get(active.layoutId+':'+active.videoId);
      if(!row)return;
      if(action==='minus')volume(row,row.volume-10,null);
      if(action==='plus')volume(row,row.volume+10,null);
      if(action==='full')volume(row,100,null);
      if(action==='mute'){
        try{
          const result=await rpc('mute',{layoutId:row.layoutId,videoId:row.videoId});
          row.muted=!!result.muted;renderVolume(row);
        }catch(error){field('note',error.message);}
      }
    });
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden)closeSheet();});
  }
  function network(){
    const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
    const speed=Number(c?.downlink);
    field('speed',Number.isFinite(speed)&&speed>0?'≈ '+speed.toFixed(2)+' Mbps':'—');
    if(!c){field('network','此浏览器不支持 Network Information API');return;}
    const rtt=Number(c.rtt);
    field('network',(c.type||c.effectiveType||'网络类型未知')+
      (Number.isFinite(rtt)&&rtt>=0?' · 估算延迟 '+rtt+' ms':'')+
      (c.saveData?' · 节省流量':''));
  }
  const status={'-1':'未开始','0':'结束','1':'播放中','2':'已暂停','3':'缓冲中','5':'待播放'};
  function timestamp(n){
    if(!Number.isFinite(Number(n))||Number(n)<0)return '—';
    n=Math.floor(Number(n));
    return String(Math.floor(n/3600)).padStart(2,'0')+':'+
      String(Math.floor(n%3600/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  }
  async function stats(){
    if(statsBusy||!active||sheet.hidden)return;
    statsBusy=true;
    const key=active.layoutId+':'+active.videoId;
    network();
    try{
      const v=await rpc('stats',{layoutId:active.layoutId,videoId:active.videoId},4000);
      if(sheet.hidden||!active||active.layoutId+':'+active.videoId!==key)return;
      field('state',!v.ready?'播放器尚未就绪':status[String(v.state)]||'未知');
      field('buffer',v.live?'直播：不可用':
        Number.isFinite(v.fraction)?(Math.min(100,v.fraction*100).toFixed(1)+'%'):'—');
      field('position',timestamp(v.position)+(v.live?'（直播）':' / '+timestamp(v.duration)));
      field('rate',Number.isFinite(v.rate)?v.rate+'×':'—');
    }catch{field('state','无法读取播放器状态');}
    finally{statsBusy=false;}
  }
  function openSheet(row){
    makeSheet();
    active={layoutId:row.layoutId,videoId:row.videoId};
    sheet.hidden=false;
    field('title',row.title||row.videoId);
    renderVolume(row);network();stats();
    clearInterval(statsInterval);statsInterval=setInterval(stats,2400);
  }
  function closeSheet(){
    active=null;
    if(sheet)sheet.hidden=true;
    clearInterval(statsInterval);statsInterval=null;
  }
  async function refresh(){
    if(!installed||listing||!isMulti()||!coarse||document.hidden)return;
    listing=true;
    try{
      const rows=await rpc('list',{},3500);
      const roots=[...document.querySelectorAll('.multiview .mv-cell > .cell-content')];
      const validKeys=new Set();
      for(const row of rows){
        const key=row.layoutId+':'+row.videoId;
        validKeys.add(key);
        const old=rowMap.get(key);
        // Keep optimistic swipe volume until the user releases the gesture.
        const zone=roots[row.index]?.querySelector('.mv-frame > .hmtc-zone');
        if(zone?._drag&&old){row.volume=old.volume;row.muted=old.muted;}
        rowMap.set(key,row);
        if(roots[row.index])attach(roots[row.index],row);
        if(active&&active.layoutId+':'+active.videoId===key)renderVolume(row);
      }
      for(const key of rowMap.keys())if(!validKeys.has(key))rowMap.delete(key);
      for(const root of roots){
        const zone=root.querySelector('.mv-frame > .hmtc-zone');
        if(zone&&!validKeys.has(zone.dataset.key))zone.remove();
      }
      if(active&&!rowMap.has(active.layoutId+':'+active.videoId))closeSheet();
    }catch{ /* Holodex may be building/changing the layout. */ }
    finally{listing=false;}
  }
  function init(){
    if(!document.body)return;
    if(!coarse){
      GM_registerMenuCommand('Touch Controls 说明',()=>alert('未检测到触摸屏；此独立脚本只对触控设备显示视频手势控制。'));
      return;
    }
    makeSheet();
    installBridge();
    let last=location.href;
    setInterval(()=>{
      if(!document.body)return;
      if(location.href!==last){last=location.href;if(!isMulti()){closeSheet();rowMap.clear();}}
      if(isMulti()){if(!installed)installBridge();else refresh();}
    },1700);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    GM_registerMenuCommand('Touch Controls 操作说明',()=>alert('Holodex 多视图中，在 YouTube 视频右侧中段上下滑动调音量，轻点 🔊 打开控制/统计面板。网络速度是设备连接估算，非 YouTube 单路 CDN 实际速率。'));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
