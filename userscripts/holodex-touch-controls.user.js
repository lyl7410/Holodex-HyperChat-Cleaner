// ==UserScript==
// @name         Holodex Touch Controls（手势音量与播放统计）
// @namespace    https://github.com/lyl7410/Holodex-HyperChat-Cleaner
// @version      0.3.0
// @description  Holodex YouTube 视频内无图标手势：右侧上下滑动音量、左侧轻点精简原生连接统计（实验性）。
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

    // Gestures are armed by a verified Holodex parent message. No visible overlays
    // and no changes to the embedded player's CSS or native clickable controls.
    let gestureOrigin=null,gestureInstalled=false,touch=null,suppressClickUntil=0;
    function setupGestures(){
      if(gestureInstalled)return;
      gestureInstalled=true;
      const interactive='button,a,input,textarea,select,[role="button"],[contenteditable],.ytp-chrome-bottom,.ytp-chrome-top,.ytp-settings-menu,.ytp-popup,.ytp-panel,.ytp-ad-overlay-container,.ytp-endscreen-content,.ytp-large-play-button';
      const inControls=target=>!!target?.closest?.(interactive);
      function send(kind,stage,delta){
        if(!gestureOrigin)return;
        window.parent.postMessage({
          tag:TAG,action:'gesture',videoId,kind,stage,
          ...(typeof delta==='number'?{delta:Math.max(-1,Math.min(1,delta))}:{})
        },gestureOrigin);
      }
      function start(event){
        touch=null;
        if(!gestureOrigin||event.touches?.length!==1||inControls(event.target))return;
        const p=player();
        if(!p||!p.contains?.(event.target))return;
        let id;
        try{id=p.getVideoData?.()?.video_id;}catch{}
        if(id && id!==videoId)return;
        const rect=p.getBoundingClientRect();
        if(rect.width<140||rect.height<85)return;
        const t=event.touches[0];
        const x=(t.clientX-rect.left)/rect.width;
        const y=(t.clientY-rect.top)/rect.height;
        if(y<.19||y>.79)return;
        const side=x<=.26?'left':x>=.74?'right':null;
        if(!side)return;
        touch={identifier:t.identifier,side,x:t.clientX,y:t.clientY,
          rectHeight:rect.height,at:Date.now(),moving:false,cancelled:false,last:0};
      }
      function changed(event) {
        if(!touch)return null;
        for(const t of Array.from(event.changedTouches||[]))
          if(t.identifier===touch.identifier)return t;
        return null;
      }
      function move(event){
        const g=touch;if(!g||!gestureOrigin)return;
        if(event.touches?.length!==1){touch=null;return;}
        const t=changed(event)||event.touches[0];
        if(!t||t.identifier!==g.identifier)return;
        const dy=g.y-t.clientY, dx=t.clientX-g.x;
        if(g.side==='left'){
          if(Math.abs(dx)>13||Math.abs(dy)>13)g.cancelled=true;
          return;
        }
        if(!g.moving){
          if(Math.abs(dx)>17&&Math.abs(dx)>Math.abs(dy)) {g.cancelled=true;return;}
          if(g.cancelled||Math.abs(dy)<18||Math.abs(dy)<Math.abs(dx)*1.25)return;
          g.moving=true;send('volume','start',0);
        }
        if(event.cancelable)event.preventDefault();
        event.stopImmediatePropagation?.();
        const delta=dy/Math.max(120,g.rectHeight*.8);
        const now=Date.now();
        if(now-g.last>=85){g.last=now;send('volume','move',delta);}
      }
      function end(event,cancelled){
        const g=touch;if(!g)return;
        const t=changed(event);if(!t)return;
        touch=null;
        const dx=t.clientX-g.x,dy=g.y-t.clientY;
        if(g.side==='right'&&g.moving){
          if(event.cancelable)event.preventDefault();
          event.stopImmediatePropagation?.();
          suppressClickUntil=Date.now()+450;
          send('volume',cancelled?'cancel':'end',dy/Math.max(120,g.rectHeight*.8));
        }else if(g.side==='left'&&!cancelled&&!g.cancelled&&
          Date.now()-g.at<550&&Math.abs(dx)<13&&Math.abs(dy)<13){
          if(event.cancelable)event.preventDefault();
          event.stopImmediatePropagation?.();
          suppressClickUntil=Date.now()+450;
          send('stats','tap');
        }
      }
      // Capture before YouTube's bubble handlers; avoid suppressing native taps
      // except a recognized left-side stats tap or a confirmed right-side swipe.
      document.addEventListener('touchstart',start,{capture:true,passive:true});
      document.addEventListener('touchmove',move,{capture:true,passive:false});
      document.addEventListener('touchend',e=>end(e,false),{capture:true,passive:false});
      document.addEventListener('touchcancel',e=>end(e,true),{capture:true,passive:false});
      document.addEventListener('click',e=>{
        if(Date.now()<suppressClickUntil&&player()?.contains?.(e.target)){
          e.preventDefault();e.stopImmediatePropagation?.();
          suppressClickUntil=0;
        }
      },true);
      window.addEventListener('blur',()=>{touch=null;});
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
      if(message.action==='enableGestures') {
        gestureOrigin=event.origin;
        setupGestures();
        respond({ok:true,data:{enabled:true}});
        return;
      }
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

  const VERSION='0.3.0', KEY='hmtc_enabled_v1';
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
  const activeFrames=new WeakSet(),armingFrames=new WeakSet(),swipes=new WeakMap();
  let volumeToast=null,toastTimer=null;
  const YT_ORIGINS=new Set(['https://www.youtube.com','https://youtube.com','https://www.youtube-nocookie.com']);
  let sequence=0,nativeSequence=0,installed=false,installing=false,listing=false,active=null,sheet=null,statsBusy=false;
  let hintTimer=null,statsInterval=null;

  GM_addStyle(`
  /* v0.3.0: zero permanent UI elements within the video; temporary volume toast only. */
  #hmtc-volume-toast{position:fixed;z-index:2147482999;pointer-events:none;
    padding:6px 12px;border-radius:10px;background:#101725d9;color:#fff;
    font:700 16px/1.3 system-ui;box-shadow:0 2px 12px #0008;min-width:54px;
    text-align:center;transform:translate(-50%,-50%)}
  #hmtc-volume-toast[hidden]{display:none!important}
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
    if(!['stats','nativeToggle','enableGestures'].includes(action))
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
    if(response?.tag!==NATIVE_TAG)return;
    if(response.action==='gesture'){
      // Match both frame WindowProxy and current video ID. Never trust a bare
      // iframe-origin message as a command for arbitrary video cells.
      if(!coarse||!isMulti()||document.hidden||
        !['stats','volume'].includes(response.kind))return;
      let row=null,frame=null;
      for(const candidate of rowMap.values()){
        if(candidate.videoId!==response.videoId)continue;
        const result=nativeFrame(candidate);
        if(result?.frame.contentWindow===event.source&&result.origin===event.origin){
          row=candidate;frame=result.frame;break;
        }
      }
      if(!row)return;
      if(response.kind==='stats'){
        if(response.stage==='tap')openSheet(row);
        return;
      }
      if(!['start','move','end','cancel'].includes(response.stage))return;
      if(response.stage==='start'){
        swipes.set(frame,{videoId:row.videoId,layoutId:row.layoutId,
          base:row.volume,started:Date.now()});
        return;
      }
      const swipe=swipes.get(frame);
      if(response.stage==='cancel'){swipes.delete(frame);return;}
      if(!swipe||swipe.videoId!==row.videoId||swipe.layoutId!==row.layoutId||
         Date.now()-swipe.started>8000||!Number.isFinite(response.delta)||
         Math.abs(response.delta)>1.001)return;
      const value=clamp(swipe.base+response.delta*100);
      if(value!==row.volume||row.muted)volume(row,value);
      showVolumeToast(frame,value);
      if(response.stage==='end')swipes.delete(frame);
      return;
    }
    if(!Number.isSafeInteger(response.seq))return;
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
  function volume(row,value){
    value=clamp(value);
    row.volume=value;row.muted=value===0;
    if(active&&active.layoutId===row.layoutId&&active.videoId===row.videoId)
      renderVolume(row);
    rpc('volume',{layoutId:row.layoutId,videoId:row.videoId,volume:value})
      .catch(e=>field('note',e.message));
  }
  function showVolumeToast(frame,value){
    if(!volumeToast?.isConnected){
      volumeToast=document.createElement('div');
      volumeToast.id='hmtc-volume-toast';
      document.body.appendChild(volumeToast);
    }
    const rect=frame.getBoundingClientRect();
    volumeToast.style.left=Math.max(32,Math.min(innerWidth-32,rect.right-35))+'px';
    volumeToast.style.top=Math.max(20,Math.min(innerHeight-20,rect.top+rect.height*.5))+'px';
    volumeToast.textContent=value+'%';
    volumeToast.hidden=false;
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{if(volumeToast)volumeToast.hidden=true;},750);
  }
  function armFrame(row){
    const mapped=nativeFrame(row),frame=mapped?.frame;
    if(!frame||activeFrames.has(frame)||armingFrames.has(frame))return;
    armingFrames.add(frame);
    nativeRequest(row,'enableGestures',1700).then(result=>{
      if(result?.enabled){
        activeFrames.add(frame);
        // Loading new content into the same iframe requires a new handshake.
        frame.addEventListener('load',()=>activeFrames.delete(frame),{once:true});
      }
    }).catch(()=>{ /* Webview may prohibit third-party iframe userscripts. */ })
      .finally(()=>armingFrames.delete(frame));
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
      '<div class="net"><div class="sub">YouTube 原生连接速度估计 · 当前视频</div>',
      '<div class="speed" data-field="speed">—</div>',
      '<div class="sub" data-field="network">正在读取 YouTube 嵌入播放器…</div></div>',
      '<div class="grid">',
      '<div><label>缓冲健康度</label><strong data-field="health">—</strong></div>',
      '<div><label>播放时间</label><strong data-field="position">—</strong></div>',
      '<div><label>当前 / 推荐分辨率</label><strong data-field="resolution">—</strong></div>',
      '<div><label>播放状态</label><strong data-field="state">—</strong></div>',
      '</div><div class="actions" style="margin-top:10px">',
      '<button data-action="native">切换 YouTube 原版统计</button></div>',
      '<div class="note" data-field="note">',
      'Connection Speed 是 YouTube 对当前播放连接的带宽估计，非瞬时下载流量。内部接口可能随播放器更新而失效。</div>'
    ].join('');
    document.body.appendChild(sheet);
    const slider=sheet.querySelector('[data-field="slider"]');
    slider.addEventListener('input',()=>{
      const row=active&&rowMap.get(active.layoutId+':'+active.videoId);
      if(row)volume(row,Number(slider.value));
    });
    sheet.addEventListener('click',async e=>{
      const btn=e.target.closest('button[data-action]');
      if(!btn)return;
      const action=btn.dataset.action;
      if(action==='close'){closeSheet();return;}
      const row=active&&rowMap.get(active.layoutId+':'+active.videoId);
      if(!row)return;
      if(action==='minus')volume(row,row.volume-10);
      if(action==='plus')volume(row,row.volume+10);
      if(action==='full')volume(row,100);
      if(action==='mute'){
        try{
          const result=await rpc('mute',{layoutId:row.layoutId,videoId:row.videoId});
          row.muted=!!result.muted;renderVolume(row);
        }catch(error){field('note',error.message);}
      }
      if(action==='native'){
        try{
          const result=await nativeRequest(row,'nativeToggle',2000);
          field('note',result.visible
            ? '已请求显示 YouTube 原版统计，它会覆盖在当前小播放器画面内。'
            : '已请求隐藏 YouTube 原版统计。');
          stats();
        }catch(error){field('note',error.message);}
      }
    });
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden)closeSheet();});
  }
  function renderYouTubeStats(data,reason) {
    if(!data?.available){
      field('speed','—');
      field('network',reason||data?.reason||'YouTube 原生连接统计不可用');
    }else {
      const kbps=data.bandwidthKbps;
      field('speed',typeof kbps==='number'&&Number.isFinite(kbps)&&kbps>0
        ? '≈ '+(kbps/1000).toFixed(2)+' Mbps':'—');
      field('network',kbps!=null
        ? '当前视频 · YouTube '+(data.source||'原生统计')
        : '已连接 YouTube，但本播放器未提供带宽数值');
    }
    field('health',typeof data?.bufferSeconds==='number'
      ? data.bufferSeconds.toFixed(1)+' s':'—');
    field('resolution',data?.resolution||'—');
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
    const key=active.layoutId+':'+active.videoId;
    const row=rowMap.get(key);
    if(!row){closeSheet();return;}
    statsBusy=true;
    try {
      const [basic,yt]=await Promise.allSettled([
        rpc('stats',{layoutId:row.layoutId,videoId:row.videoId},4000),
        nativeRequest(row,'stats',1900)
      ]);
      // Responses from an old or replaced cell must not update a newer panel.
      if(sheet.hidden||!active||active.layoutId+':'+active.videoId!==key)return;
      if(basic.status==='fulfilled'){
        const v=basic.value;
        field('state',!v.ready?'播放器尚未就绪':status[String(v.state)]||'未知');
        field('position',timestamp(v.position)+(v.live?'（直播）':' / '+timestamp(v.duration)));
      }else field('state','暂时无法读取播放器状态');
      if(yt.status==='fulfilled')renderYouTubeStats(yt.value);
      else renderYouTubeStats(null,yt.reason?.message||'YouTube iframe 未响应');
    }finally{statsBusy=false;}
  }
  function openSheet(row){
    makeSheet();
    active={layoutId:row.layoutId,videoId:row.videoId};
    sheet.hidden=false;
    field('title',row.title||row.videoId);
    renderVolume(row);
    renderYouTubeStats(null,'正在读取 YouTube 嵌入播放器…');
    stats();
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
        const frame=nativeFrame({...row,index:row.index})?.frame;
        const swipe=frame&&swipes.get(frame);
        if(swipe && Date.now()-swipe.started<8000 && old){
          row.volume=old.volume;row.muted=old.muted;
        } else if(swipe){swipes.delete(frame);}
        rowMap.set(key,row);
        armFrame(row);
        if(active&&active.layoutId+':'+active.videoId===key)renderVolume(row);
      }
      for(const key of rowMap.keys())if(!validKeys.has(key))rowMap.delete(key);
      // Remove any leftover overlays if the old version was injected in-place.
      for(const root of roots)root.querySelector('.mv-frame > .hmtc-zone')?.remove();
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
    GM_registerMenuCommand('Touch Controls 操作说明',()=>alert('v0.3.0：无常驻图标。YouTube 画面右侧中部向上/下滑调音量，左侧中部轻点打开精简统计。数据来自 YouTube Stats for nerds；需要允许第三方 YouTube iframe 运行脚本。')); 
    GM_registerMenuCommand('选择视频查看统计（备用入口）',()=>{
      const rows=[...rowMap.values()];
      if(!rows.length)return alert('当前没有已识别的 YouTube 视频格子。');
      if(rows.length===1){openSheet(rows[0]);return;}
      const choice=prompt('选择要查看统计的序号：\n'+
        rows.map((r,i)=>(i+1)+'. '+(r.title||r.videoId).slice(0,36)).join('\n'),'1');
      if(choice===null)return;
      const n=Number(choice);
      if(Number.isInteger(n)&&n>=1&&n<=rows.length)openSheet(rows[n-1]);
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
