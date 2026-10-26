// ==UserScript==
// @name         Holodex Touch Controls（手势音量、播放统计与智能自动播放）
// @namespace    https://github.com/lyl7410/Holodex-HyperChat-Cleaner
// @version      0.5.0
// @description  Holodex 多视图智能自动播放未播放视频（PC/安卓），保留音量手势、原生播放统计及手动暂停保护。
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
    // Never prefer a stale, previously-opened Stats for nerds DOM snapshot
    // over the YouTube player's current internal API values.
    function parse(raw, includePanel=false) {
      const s = raw && typeof raw === 'object' ? raw : {};
      const text = typeof raw === 'string' ? raw : '';
      const panel = includePanel ? document.querySelector('.html5-video-info-panel-content') : null;
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
      const sourceResolution = s.resolution || s.current_resolution ||
        s.currentResolution || s.current_optimal_resolution || '';
      const fromStatsText = body.match(
        /(?:Current\s*\/\s*Optimal\s*Res|当前\s*\/\s*最佳分辨率|当前.*分辨率)\s*[:：]?\s*(\d{3,5}\s*[x×]\s*\d{3,5}(?:@\d+)?(?:\s*\/\s*\d{3,5}\s*[x×]\s*\d{3,5}(?:@\d+)?)?)/i
      )?.[1] || '';
      const resolution = (typeof sourceResolution==='string' && sourceResolution
        ? sourceResolution : fromStatsText).slice(0,90);
      const sourceCodecs = s.codecs || '';
      const codecs = typeof sourceCodecs === 'string' ? sourceCodecs.slice(0,120) : '';
      const viewportFrames = String(s.viewport || s.frames || '').slice(0,100);
      const dropped = getNumber(s.dropped_frames, s.droppedFrames,
        metric(/(\d+)\s+dropped\s+of\s+\d+/i));
      // Interpret only fields whose units are explicit. Do not infer latency
      // from an ambiguous generic "latency" or DVR seekable window.
      const latencyMs=getNumber(s.live_latency_ms,s.liveLatencyMs);
      const liveLatencySeconds = getNumber(
        s.live_latency_seconds, s.liveLatencySeconds,
        s.live_latency_sec, s.latency_to_live_seconds,
        metric(/(?:Live Latency|Latency to Live Edge|直播延迟|直播延遲)\s*[:：]?\s*([\d,.]+)\s*(?:s|sec|秒)?/i)
      ) ?? (latencyMs!=null ? latencyMs/1000 : null);
      return {
        bandwidthKbps: bandwidthKbps!=null&&bandwidthKbps>0?bandwidthKbps:null,
        bufferSeconds:bufferSeconds!=null&&bufferSeconds>=0?bufferSeconds:null,
        resolution,codecs,
        viewportFrames,dropped,
        liveLatencySeconds:liveLatencySeconds!=null&&liveLatencySeconds>=0?liveLatencySeconds:null
      };
    }
    // YouTube sometimes computes its bandwidth diagnostics only while its own
    // Stats for nerds overlay is logically enabled. Keep those diagnostics on
    // only while the custom Holodex panel is open, but make the original overlay
    // transparent (not display:none) so YouTube can still refresh its DOM.
    const monitor = { active:false, forced:false, manual:false, initiallyVisible:false };
    const SILENT_CLASS='hmtc-native-stats-silent';
    function ensureSilentCss(){
      if(document.getElementById('hmtc-silent-stats-css'))return;
      const style=document.createElement('style');
      style.id='hmtc-silent-stats-css';
      const nonce=document.querySelector('script[nonce],style[nonce]')?.nonce;
      if(nonce)style.nonce=nonce;
      style.textContent='html.'+SILENT_CLASS+
        ' .html5-video-info-panel,html.'+SILENT_CLASS+
        ' .ytp-stats-for-nerds{opacity:0!important;pointer-events:none!important;'+
        'transition:none!important;}';
      (document.head||document.documentElement).appendChild(style);
    }
    function silent(enabled){
      if(enabled)ensureSilentCss();
      document.documentElement.classList.toggle(SILENT_CLASS,!!enabled);
    }
    function isNativeVisible(p){
      try {
        if(typeof p?.isVideoInfoVisible==='function')
          return !!p.isVideoInfoVisible();
      } catch {}
      return null;
    }
    function startMonitor(){
      const p=player();
      if(!p)return {enabled:false,reason:'YouTube 播放器尚未就绪'};
      if(typeof p.showVideoInfo!=='function')
        return {enabled:false,reason:'播放器没有原生统计启动接口'};
      const visible=isNativeVisible(p);
      if(visible===null)
        return {enabled:false,reason:'播放器无法确认原版统计的显示状态'};
      if(monitor.active){
        // The player may turn off its diagnostics after a media reload.
        if(monitor.forced&&!monitor.manual&&!visible){
          silent(true);
          try{p.showVideoInfo();}catch{}
        }
        return {enabled:true,hidden:monitor.forced&&!monitor.manual};
      }
      monitor.active=true;
      monitor.initiallyVisible=visible;
      monitor.forced=!visible;
      monitor.manual=false;
      if(monitor.forced){
        silent(true); // CSS is active BEFORE enabling the original overlay.
        try{p.showVideoInfo();}
        catch(error){
          monitor.active=false;monitor.forced=false;
          silent(false);
          return {enabled:false,reason:String(error?.message||error).slice(0,120)};
        }
      }
      return {enabled:true,hidden:monitor.forced};
    }
    function stopMonitor(){
      const p=player();
      if(monitor.active&&monitor.forced&&typeof p?.hideVideoInfo==='function'){
        // Restore the state that existed before the Holodex panel opened.
        try{p.hideVideoInfo();}catch{}
      }
      silent(false);
      monitor.active=false;
      monitor.forced=false;
      monitor.manual=false;
      monitor.initiallyVisible=false;
      return {stopped:true};
    }
    function toggleNative(){
      const p=player();
      if(!p)throw new Error('播放器尚未就绪');
      if(monitor.active){
        if(monitor.forced){
          // Keep collecting while switching between hidden and visible native UI.
          monitor.manual=!monitor.manual;
          silent(!monitor.manual);
          return {visible:monitor.manual};
        }
        // Original panel was already visible before Holodex monitoring began.
        // Convert it to silent collection when the user hides it in the custom UI.
        monitor.forced=true;
        monitor.manual=false;
        silent(true);
        return {visible:false};
      }
      const was=isNativeVisible(p);
      if(was===true&&typeof p.hideVideoInfo==='function'){
        p.hideVideoInfo();return {visible:false};
      }
      if(typeof p.showVideoInfo==='function'){
        p.showVideoInfo();return {visible:true};
      }
      throw new Error('此播放器不支持切换原版统计');
    }

    function readStats() {
      const p=player();
      if(!p)return {available:false, reason:'YouTube 播放器尚未就绪'};
      let actualId=null;
      try{actualId=p.getVideoData?.()?.video_id||null;}catch{}
      if(actualId&&actualId!==videoId)
        return {available:false,reason:'播放视频已切换'};
      let source='none';
      const data=parse(null);
      // Prefer fresh API output; previous versions wrongly read old panel DOM first.
      // Combine compatible fields instead of stopping at an API which happens
      // to return resolution but not the more important Connection Speed.
      for(const [name,args] of [
        ['getStatsForNerdsData',[]],
        ['getStatsForNerds',[]],
        ['getStatsForNerds',[0]],
        ['getDebugText',[]]
      ]) {
        if(typeof p[name]!=='function')continue;
        try{
          const raw=p[name](...args);
          if(!raw || (typeof raw!=='string'&&typeof raw!=='object'))continue;
          const sample=parse(raw);
          if(sample.bandwidthKbps!=null && data.bandwidthKbps==null){
            data.bandwidthKbps=sample.bandwidthKbps;
            source=name;
          }
          if(sample.bufferSeconds!=null && data.bufferSeconds==null)
            data.bufferSeconds=sample.bufferSeconds;
          for(const field of ['resolution','codecs','viewportFrames']){
            if(!data[field] && sample[field])data[field]=sample[field];
          }
          for(const field of ['dropped','liveLatencySeconds']){
            if(data[field]==null && sample[field]!=null)data[field]=sample[field];
          }
          if(source==='none' && (sample.resolution||sample.bufferSeconds!=null))
            source=name;
          if(data.bandwidthKbps!=null&&data.bufferSeconds!=null&&data.resolution)
            break;
        }catch{}
      }
      // DOM is used only as a fallback, and only while YouTube says its
      // statistics panel is actively enabled. Hidden snapshots can be stale.
      if(isNativeVisible(p)===true){
        const fromPanel=parse(null,true);
        // When the native panel is actively updating, its displayed value
        // may be newer than the return value of a cached internal method.
        if(fromPanel.bandwidthKbps!=null){
          data.bandwidthKbps=fromPanel.bandwidthKbps;
          source='native-panel-dom';
        }
        if(fromPanel.bufferSeconds!=null)data.bufferSeconds=fromPanel.bufferSeconds;
        if(!data.resolution) data.resolution=fromPanel.resolution;
        if(fromPanel.liveLatencySeconds!=null)data.liveLatencySeconds=fromPanel.liveLatencySeconds;
      }
      if(!data.resolution) {
        // HTMLVideoElement intrinsic dimensions reflect the decoded video
        // frame; label them explicitly rather than inventing optimal resolution.
        const video=p.querySelector?.('video') || page.document.querySelector('video.html5-main-video');
        if(video?.videoWidth>0 && video?.videoHeight>0)
          data.resolution=video.videoWidth+'×'+video.videoHeight+'（实际帧）';
      }
      const meaningful=data.bandwidthKbps!=null||data.bufferSeconds!=null||
        data.liveLatencySeconds!=null||!!data.resolution||!!data.codecs;
      return {available:meaningful,source,
        monitoring:monitor.active, silent:monitor.active&&monitor.forced&&!monitor.manual,
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
        // A YouTube playback change can turn its statistics off again.
        // Re-arm only if this script owns a silent monitoring session.
        if(monitor.active&&monitor.forced&&!monitor.manual&&
           isNativeVisible(player())===false)startMonitor();
        respond({ok:true,data:readStats()});
        return;
      }
      if(message.action==='monitorStart') {
        respond({ok:true,data:startMonitor()});
        return;
      }
      if(message.action==='monitorStop') {
        respond({ok:true,data:stopMonitor()});
        return;
      }
      if(message.action==='nativeToggle') {
        try{respond({ok:true,data:toggleNative()});}
        catch(err){respond({ok:false,error:String(err?.message||err).slice(0,120)});}
        return;
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

  const VERSION='0.5.0', KEY='hmtc_enabled_v1';
  const EDGE_KEY='hmtc_edge_gestures_enabled_v1';
  const DEBUG_KEY='hmtc_show_edge_zones_v1';
  const SENS_KEY='hmtc_volume_sensitivity_v1';
  const STATS_MODE_KEY='hmtc_stats_trigger_v1';
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
  const getSensitivity=()=>{
    const n=Number(get(SENS_KEY,1));
    return Number.isFinite(n)?Math.round(Math.max(.4,Math.min(2.5,n))*10)/10:1;
  };
  const getStatsMode=()=>{
    const m=get(STATS_MODE_KEY,'tap');
    return ['tap','hold','both'].includes(m)?m:'tap';
  };
  const allowsTap=()=>['tap','both'].includes(getStatsMode());
  const allowsHold=()=>['hold','both'].includes(getStatsMode());
  const rowMap=new Map(), pending=new Map();
  const nativePending=new Map(), NATIVE_TAG='hmtc-youtube-stats-v1';
  // v0.3.1 draws no icon, but transparent edge hit areas live on Holodex itself.
  // This remains functional even when ScriptCat cannot run inside the YouTube iframe.
  let volumeToast=null,toastTimer=null;
  const YT_ORIGINS=new Set(['https://www.youtube.com','https://youtube.com','https://www.youtube-nocookie.com']);
  let sequence=0,nativeSequence=0,installed=false,installing=false,listing=false,active=null,sheet=null,statsBusy=false;
  let hintTimer=null,statsInterval=null;

  GM_addStyle(`
  /* Invisible zones occupy twice the v0.3.1 width, and are 78% tall. */
  .hmtc-edge{position:absolute;z-index:45;top:11%;height:78%;width:36%;
    min-width:min(46px,46%);max-width:min(112px,46%);background:transparent;
    box-sizing:border-box;-webkit-user-select:none;user-select:none;
    -webkit-tap-highlight-color:transparent;overscroll-behavior:contain}
  .hmtc-edge--left{left:0;touch-action:pan-y;cursor:pointer}
  .hmtc-edge--right{right:0;touch-action:none;cursor:ns-resize}
  html.hmtc-debug .hmtc-edge--left{background:#37aaff33;outline:1px dashed #73c9ff}
  html.hmtc-debug .hmtc-edge--right{background:#48d9ac33;outline:1px dashed #70e7be}
  #hmtc-volume-toast{position:fixed;z-index:2147482999;pointer-events:none;
    display:flex;flex-direction:column;gap:8px;min-width:110px;
    padding:12px 14px;border-radius:14px;color:#f7fbff;text-align:center;
    background:linear-gradient(145deg,rgba(21,35,50,.94),rgba(24,27,41,.94));
    border:1px solid #a6e4f742;box-shadow:0 8px 24px #0009;
    backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
    font:700 22px/1.1 system-ui,sans-serif;transform:translate(-50%,-50%)}
  #hmtc-volume-toast[hidden]{display:none!important}
  #hmtc-volume-toast .hmtc-toast-label{font:600 11px/1.2 system-ui,sans-serif;color:#b9d2dd;letter-spacing:.1em}
  #hmtc-volume-toast .hmtc-toast-track{height:5px;background:#ffffff24;border-radius:100px;overflow:hidden}
  #hmtc-volume-toast .hmtc-toast-fill{height:100%;width:0;background:linear-gradient(90deg,#50d6d0,#7ebdff);border-radius:100px;transition:width 70ms linear}
  /* Only while the stats sheet is open: intercept taps even above YouTube
     cross-origin iframes. Hidden otherwise, so normal video touches are free. */
  #hmtc-backdrop{position:fixed;inset:0;z-index:2147482998;background:transparent;
    touch-action:manipulation}
  #hmtc-backdrop[hidden]{display:none!important}
  #hmtc-sheet,#hmtc-settings{
    position:fixed;z-index:2147483000;left:10px;right:10px;
    bottom:calc(10px + env(safe-area-inset-bottom,0px));
    max-width:460px;max-height:min(82vh,670px);overflow:auto;margin:0 auto;
    background:linear-gradient(155deg,rgba(27,37,51,.985),rgba(16,20,31,.99));
    color:#f1f6ff;border:1px solid #93bad13d;border-radius:22px;
    box-shadow:0 20px 60px #000c,0 0 0 1px #ffffff09;
    padding:18px;box-sizing:border-box;
    font:14px/1.45 system-ui,-apple-system,sans-serif;
    touch-action:pan-y;overscroll-behavior:contain;
    -webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)}
  #hmtc-sheet[hidden],#hmtc-settings[hidden]{display:none!important}
  #hmtc-sheet *,#hmtc-settings *{box-sizing:border-box}
  #hmtc-sheet button,#hmtc-settings button{
    min-height:42px;min-width:42px;border:1px solid #ffffff25;
    border-radius:11px;background:#354155;color:#eff8ff;padding:8px 12px;
    cursor:pointer;touch-action:manipulation;font:600 13px system-ui}
  #hmtc-sheet button:active,#hmtc-settings button:active{background:#51627e}
  #hmtc-sheet .head,#hmtc-settings .head{display:flex;align-items:center;gap:10px}
  #hmtc-sheet .title,#hmtc-settings .title{
    font-weight:730;flex:1;min-width:0;white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis;font-size:16px}
  #hmtc-sheet .hmtc-dismiss-zone{cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
  #hmtc-sheet .hmtc-dismiss-zone .metric{cursor:pointer}
  #hmtc-sheet .eyebrow{color:#91cbd9;font:700 11px system-ui;letter-spacing:.09em;
    margin-bottom:5px;cursor:pointer;min-height:23px;display:flex;align-items:center;justify-content:center}
  #hmtc-sheet .head{min-height:43px;cursor:pointer}
  #hmtc-sheet .head button{cursor:pointer}
  #hmtc-sheet .net{
    padding:17px 16px 15px;background:linear-gradient(135deg,#17454b,#193450 86%);
    border-radius:17px;border:1px solid #7fe4e038;margin-top:14px;
    box-shadow:inset 0 1px 0 #ffffff13}
  #hmtc-sheet .speed{font-size:clamp(30px,8vw,39px);line-height:1.16;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.02em;margin:5px 0}
  #hmtc-sheet .unit{font-size:14px;font-weight:600;color:#b2e9e7;margin-left:5px}
  #hmtc-sheet .sub{font-size:11px;color:#b7d1db;line-height:1.5;overflow-wrap:anywhere}
  #hmtc-sheet .grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:11px}
  #hmtc-sheet .metric{padding:13px 12px;border-radius:14px;
    background:rgba(255,255,255,.065);border:1px solid #ffffff16;min-width:0}
  #hmtc-sheet .metric label{display:block;font-size:11px;color:#b8c7d7;margin-bottom:5px}
  #hmtc-sheet .metric strong{font-size:16px;font-weight:700;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
  #hmtc-sheet .volume{display:flex;gap:9px;align-items:center;margin:14px 0 11px}
  #hmtc-sheet .volume input{flex:1;width:100%;min-width:0;height:40px;accent-color:#61d7d1;touch-action:pan-x}
  #hmtc-sheet .value{min-width:50px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
  #hmtc-sheet .actions{display:flex;gap:7px;margin-top:9px}
  #hmtc-sheet .actions button{flex:1}
  #hmtc-sheet .note{font-size:11px;color:#adbdc9;line-height:1.5;margin-top:12px}
  #hmtc-sheet .footer{display:flex;gap:8px;margin-top:13px}
  #hmtc-sheet .footer button{flex:1;background:#26354c}
  #hmtc-sheet .footer button[data-action="settings"]{flex:0 0 auto}
  #hmtc-settings .setting{margin-top:18px}
  #hmtc-settings label{display:block;font-size:13px;font-weight:650;color:#d9e5ed;margin-bottom:9px}
  #hmtc-settings .setting-summary{font-size:11px;color:#aabbc9;margin-top:6px}
  #hmtc-settings input[type=range]{width:100%;accent-color:#61d7d1;height:36px;touch-action:pan-x}
  #hmtc-settings select{width:100%;border:1px solid #ffffff3a;border-radius:11px;
    min-height:46px;background:#29384b;color:#fff;font:600 14px system-ui;padding:8px}
  #hmtc-settings .presets{display:flex;gap:6px}
  #hmtc-settings .presets button{flex:1}
  #hmtc-settings .setting b{color:#84e4df}
  @media(orientation:landscape){
    #hmtc-sheet,#hmtc-settings{left:auto;right:9px;bottom:8px;margin:0;
      max-width:min(390px,68vw);max-height:calc(100vh - 16px);padding:13px;border-radius:16px}
    #hmtc-sheet .net{margin-top:8px;padding:12px}
    #hmtc-sheet .grid{gap:6px;margin-top:7px}
    #hmtc-sheet .metric{padding:8px 10px}
    #hmtc-sheet .volume{margin:7px 0}
  }

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

    // Multiview-wide autoplay runs in the site realm so it can call the
    // existing YouTube IFrame API without crossing an iframe touch boundary.
    // Configure it from the userscript; do not start any video until configured.
    const autoCfg={enabled:false,onReturn:true,respectPause:true,muteFallback:false};
    const AUTO_MANUAL_KEY='hmtc_autoplay_manual_pause_v1';
    const AUTO_MANUAL_AGE=12*60*60*1000;
    const attempts=new Map(),manualPauses=new Map(),wasPlayingHidden=new Set();
    try {
      const cached=JSON.parse(win.sessionStorage?.getItem(AUTO_MANUAL_KEY)||'{}');
      for(const [key,at] of Object.entries(cached)){
        if(/^[^:]{1,80}:[\w-]{11}$/.test(key)&&Number.isFinite(at)&&
           Date.now()-at>=0&&Date.now()-at<AUTO_MANUAL_AGE)
          manualPauses.set(key,at);
      }
    }catch{}
    function saveManual(){
      try {
        win.sessionStorage?.setItem(AUTO_MANUAL_KEY,
          JSON.stringify(Object.fromEntries(manualPauses)));
      }catch{}
    }
    function markManual(key){
      if(!manualPauses.has(key)){manualPauses.set(key,Date.now());saveManual();}
    }
    function unmarkManual(key){
      if(manualPauses.delete(key))saveManual();
    }
    const cellKey=(vm)=>String(vm.item?.i??'')+':'+vm.video?.id;
    function autoplayCells(){
      const roots=doc.querySelectorAll('.multiview .mv-cell > .cell-content');
      const result=[];
      for(const root of roots){
        if(!root.querySelector('.mv-frame'))continue;
        const vm=findCell(root);
        if(!vm||!valid(vm.video?.id)||vm.isTwitchVideo)continue;
        const key=cellKey(vm);
        if(!key.startsWith(':'))result.push({key,vm});
      }
      return result;
    }
    function getPlaybackState(player){
      if(typeof player?.getPlayerState!=='function')return null;
      try {
        const state=Number(player.getPlayerState());
        return Number.isFinite(state)?state:null;
      }catch{return null;}
    }
    let nextGestureCheck=0, lastAutoSummary=null;
    function autoScan(mode='tick'){
      const manualRun=mode==='force', gesture=mode==='gesture';
      const result={playing:0,attempted:0,protected:0,blocked:0,waiting:0,ended:0};
      if(!doc.querySelector('.multiview')||doc.hidden||
         (!autoCfg.enabled&&!manualRun))return result;
      const now=Date.now(),current=new Set();
      for(const {key,vm} of autoplayCells()){
        current.add(key);
        const player=vm.ytPlayer;
        const state=getPlaybackState(player);
        if(state===null){result.waiting++;continue;}
        let track=attempts.get(key);
        if(!track||track.player!==player){
          track={player,lastState:null,lastTry:0,tries:0,gestureTries:0,
            returned:false,suppressed:false};
          attempts.set(key,track);
        }
        // 1 = playing, 3 = buffering. Neither should ever be restarted.
        if(state===1||state===3){
          result.playing++;
          track.lastState=state;track.tries=0;track.gestureTries=0;
          track.returned=false;track.suppressed=false;
          unmarkManual(key);
          continue;
        }
        if(state===0){track.lastState=state;result.ended++;continue;}
        // Observe a foreground transition from playback to pause. Since the
        // IFrame API does not attribute pauses to a user, treat any visible
        // playing->paused transition as intentionally paused (conservative).
        if(state===2&&(track.lastState===1||track.lastState===3)&&
           !track.returned){
          markManual(key);
        }
        track.lastState=state;
        if(![-1,2,5].includes(state)){result.waiting++;continue;}
        if(manualRun){
          unmarkManual(key);track.tries=0;track.gestureTries=0;
          track.suppressed=false;
        }
        if(track.suppressed&&!manualRun){result.protected++;continue;}
        if(autoCfg.respectPause&&manualPauses.has(key)&&!manualRun){
          result.protected++;continue;
        }
        if(!manualRun&&track.tries>=4){
          if(!gesture||track.gestureTries>=2||now-track.lastTry<1600){
            result.blocked++;continue;
          }
          track.gestureTries++;
        }else if(!manualRun&&track.tries>0&&
                 now-track.lastTry<Math.min(5200,650*2**(track.tries-1))){
          result.waiting++;continue;
        }
        if(typeof player.playVideo!=='function'){result.waiting++;continue;}
        try{
          // By default do not change any existing volume or muted setting.
          // Muting is an opt-in final fallback only after repeated failures.
          if(autoCfg.muteFallback&&track.tries>=2&&
             typeof player.isMuted==='function'&&!player.isMuted()){
            if(typeof vm.setMuted==='function')vm.setMuted(true);
            else player.mute?.();
          }
          player.playVideo();
          track.lastTry=now;track.tries++;
          result.attempted++;
        }catch{
          track.lastTry=now;track.tries++;
          result.blocked++;
        }
      }
      // Do not reuse an old attempt record if Holodex removed/replaced its cell.
      for(const key of attempts.keys()){
        if(!current.has(key)){attempts.delete(key);unmarkManual(key);}
      }
      lastAutoSummary=result;
      return result;
    }
    function autoConfigure(msg){
      for(const name of ['enabled','onReturn','respectPause','muteFallback'])
        if(typeof msg[name]==='boolean')autoCfg[name]=msg[name];
      if(!autoCfg.enabled)return {...autoCfg,ready:true};
      autoScan('config');
      return {...autoCfg,ready:true};
    }
    function autoResumeFromHidden(){
      if(!autoCfg.enabled||!autoCfg.onReturn)return;
      // Browser background throttling may pause a video without user action.
      // Suppress manual-pause inference on that first foreground sample.
      for(const key of wasPlayingHidden){
        const track=attempts.get(key);
        if(track){track.returned=true;track.lastState=null;track.tries=0;}
      }
      wasPlayingHidden.clear();
      autoScan('return');
    }
    doc.addEventListener('visibilitychange',()=>{
      if(doc.hidden){
        wasPlayingHidden.clear();
        for(const [key,t] of attempts)
          if(t.lastState===1||t.lastState===3)wasPlayingHidden.add(key);
      }else if(autoCfg.onReturn){
        autoResumeFromHidden();
      }else {
        // Preserve background-interrupted videos, but don't resume them.
        for(const key of wasPlayingHidden){
          const t=attempts.get(key);
          if(t){t.returned=true;t.suppressed=true;t.lastState=null;}
        }
        wasPlayingHidden.clear();
      }
    });
    win.addEventListener('pageshow',()=>{if(!doc.hidden&&autoCfg.onReturn)autoResumeFromHidden();});
    win.addEventListener('focus',()=>{if(!doc.hidden&&autoCfg.onReturn)autoResumeFromHidden();});
    // A real user gesture may allow an otherwise blocked autoplay, but never
    // lets this module override a remembered manual pause. Strict retry caps.
    const gestureRetry=()=>{
      const now=Date.now();
      if(!autoCfg.enabled||now<nextGestureCheck||doc.hidden)return;
      nextGestureCheck=now+1800;
      autoScan('gesture');
    };
    doc.addEventListener('pointerdown',gestureRetry,{passive:true});
    doc.addEventListener('touchend',gestureRetry,{passive:true});
    // Observe user pauses and newly added videos. Bounded retries per video.
    const autoTimer=win.setInterval(()=>autoScan(),1050);
    win.addEventListener('pagehide',()=>win.clearInterval(autoTimer));

    doc.addEventListener(channel+':request',async ev=>{
      let msg;try{msg=JSON.parse(ev.detail);}catch{return;}
      if(!Number.isSafeInteger(msg?.seq))return;
      const reply=payload=>doc.dispatchEvent(new win.CustomEvent(channel+':reply',{
        detail:JSON.stringify({seq:msg.seq,...payload})
      }));
      try{
        if(!doc.querySelector('.multiview'))return reply({ok:false,error:'不在多视图页面'});
        if(msg.action==='list')return reply({ok:true,data:enumerate()});
        if(msg.action==='autoConfig')
          return reply({ok:true,data:autoConfigure(msg)});
        if(msg.action==='autoKick')
          return reply({ok:true,data:autoScan('force')});
        if(msg.action==='autoStatus')
          return reply({ok:true,data:{
            ...autoCfg,summary:lastAutoSummary,manualPaused:manualPauses.size
          }});
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
    if(!['stats','nativeToggle','monitorStart','monitorStop'].includes(action))
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
      volumeToast.innerHTML='<span class="hmtc-toast-label">音量 VOL</span>'+
        '<strong class="hmtc-toast-number">—</strong>'+
        '<div class="hmtc-toast-track"><div class="hmtc-toast-fill"></div></div>';
      document.body.appendChild(volumeToast);
    }
    const rect=frame.getBoundingClientRect();
    volumeToast.style.left=Math.max(62,Math.min(innerWidth-62,rect.left+rect.width*.66))+'px';
    volumeToast.style.top=Math.max(53,Math.min(innerHeight-53,rect.top+rect.height*.48))+'px';
    volumeToast.querySelector('.hmtc-toast-number').textContent=value+'%';
    volumeToast.querySelector('.hmtc-toast-fill').style.width=value+'%';
    volumeToast.hidden=false;
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{if(volumeToast)volumeToast.hidden=true;},1050);
  }
  function changedTouch(event,identifier){
    return [...(event.changedTouches||[])].find(t=>t.identifier===identifier)||null;
  }
  function attachEdges(root,row){
    const frame=root?.querySelector('.mv-frame');
    if(!frame)return;
    const key=row.layoutId+':'+row.videoId;
    const HOLD_MS=600, TAP_SLOP=13, SWIPE_SLOP=9;

    function clearHold(gesture){
      if(gesture?.timer){clearTimeout(gesture.timer);gesture.timer=null;}
    }
    function armHold(zone,gesture){
      if(!allowsHold())return;
      gesture.timer=setTimeout(()=>{
        if(zone._gesture!==gesture||gesture.moved||gesture.held||
           gesture.key!==zone.dataset.key||!zone.isConnected)return;
        const target=rowMap.get(gesture.key);
        if(!target)return;
        gesture.held=true;
        zone._lastTap=Date.now();
        openSheet(target);
      },HOLD_MS);
    }
    function point(event,id){
      return [...(event.touches||[])].find(t=>t.identifier===id)||null;
    }
    for(const side of ['left','right']){
      let zone=frame.querySelector('.hmtc-edge--'+side);
      if(!zone){
        zone=document.createElement('div');
        zone.className='hmtc-edge hmtc-edge--'+side;
        zone.dataset.side=side;
        zone.setAttribute('aria-label',side==='left'
          ? '轻点或长按查看当前视频播放统计'
          : '上下滑动调整当前视频音量，可选择长按查看统计');
        frame.appendChild(zone);
        zone._lastTap=0;
        let gesture=null;

        function reset(){
          clearHold(gesture);
          gesture=null;zone._gesture=null;zone._drag=null;
        }
        zone.addEventListener('touchstart',event=>{
          reset();
          if(event.touches?.length!==1)return;
          const target=rowMap.get(zone.dataset.key);
          if(!target)return;
          const t=event.touches[0];
          gesture={
            id:t.identifier,key:zone.dataset.key,at:Date.now(),
            x:t.clientX,y:t.clientY,moved:false,held:false,cancelled:false,
            base:target.volume,value:target.volume,
            range:Math.max(95,frame.getBoundingClientRect().height*.65)/getSensitivity(),
            lastSent:0,timer:null
          };
          zone._gesture=gesture;
          if(side==='right')zone._drag=gesture;
          armHold(zone,gesture);
          // Right edge owns vertical gestures: do not let Android scroll Holodex.
          if(side==='right'){
            if(event.cancelable)event.preventDefault();
            event.stopPropagation();
          }
        },{passive:side==='left'});

        zone.addEventListener('touchmove',event=>{
          const g=gesture;
          if(!g)return;
          if(event.touches?.length!==1||g.key!==zone.dataset.key){
            reset();return;
          }
          const t=point(event,g.id);
          if(!t)return;
          const dx=t.clientX-g.x, dy=g.y-t.clientY;
          if(Math.abs(dx)>12||Math.abs(dy)>12){
            g.moved=true;clearHold(g);
          }
          if(side==='left'||g.held)return;
          if(event.cancelable)event.preventDefault();
          event.stopPropagation();
          if(Math.abs(dx)>Math.abs(dy)*1.4&&Math.abs(dx)>18){
            g.cancelled=true;return;
          }
          if(g.cancelled)return;
          if(Math.abs(dy)<SWIPE_SLOP)return;
          g.value=clamp(g.base+dy/g.range*100);
          showVolumeToast(frame,g.value);
          const target=rowMap.get(g.key);
          const now=Date.now();
          if(target&&now-g.lastSent>=90&&(target.volume!==g.value||target.muted)){
            g.lastSent=now;
            volume(target,g.value);
          }
        },{passive:side==='left'});

        zone.addEventListener('touchend',event=>{
          const g=gesture;
          if(!g)return;
          const t=changedTouch(event,g.id);
          reset();
          if(!t||g.key!==zone.dataset.key)return;
          if(side==='right'){
            if(event.cancelable)event.preventDefault();
            event.stopPropagation();
            if(g.held||g.cancelled||Math.abs(g.y-t.clientY)<SWIPE_SLOP)return;
            const target=rowMap.get(g.key);
            if(!target)return;
            const value=clamp(g.base+(g.y-t.clientY)/g.range*100);
            if(target.volume!==value||target.muted)volume(target,value);
            showVolumeToast(frame,value);
          }else if(!g.held&&!g.moved&&allowsTap()&&
                   Date.now()-g.at<=550&&Math.abs(t.clientX-g.x)<TAP_SLOP&&
                   Math.abs(t.clientY-g.y)<TAP_SLOP){
            const target=rowMap.get(g.key);
            if(!target)return;
            if(event.cancelable)event.preventDefault();
            event.stopPropagation();
            zone._lastTap=Date.now();
            openSheet(target);
          }
        },{passive:false});

        zone.addEventListener('touchcancel',reset,{passive:true});
        zone.addEventListener('contextmenu',e=>{
          if(allowsHold()){e.preventDefault();e.stopPropagation();}
        });
        zone.addEventListener('click',e=>{
          e.preventDefault();e.stopPropagation();
          if(side!=='left'||!allowsTap()||Date.now()-zone._lastTap<650)return;
          // Click fallback for devices which synthesize click but not touchend.
          const target=rowMap.get(zone.dataset.key);
          if(target)openSheet(target);
        });

        // Stylus fallback; never grab mouse clicks on the video.
        if(side==='right'){
          zone.addEventListener('pointerdown',e=>{
            if(e.pointerType!=='pen'||e.button!==0)return;
            reset();
            const target=rowMap.get(zone.dataset.key);
            if(!target)return;
            e.preventDefault();
            gesture={pointer:e.pointerId,key:zone.dataset.key,at:Date.now(),
              x:e.clientX,y:e.clientY,base:target.volume,value:target.volume,
              range:Math.max(95,frame.getBoundingClientRect().height*.65)/getSensitivity(),
              moved:false,held:false,lastSent:0};
            zone._gesture=gesture;zone._drag=gesture;
            armHold(zone,gesture);
            try{zone.setPointerCapture(e.pointerId);}catch{}
          });
          zone.addEventListener('pointermove',e=>{
            const g=gesture;
            if(e.pointerType!=='pen'||g?.pointer!==e.pointerId||g.key!==zone.dataset.key)return;
            if(Math.abs(e.clientY-g.y)>12||Math.abs(e.clientX-g.x)>12){
              g.moved=true;clearHold(g);
            }
            if(g.held)return;
            if(!g.moved)return;
            const target=rowMap.get(g.key);
            if(!target)return;
            g.value=clamp(g.base+(g.y-e.clientY)/g.range*100);
            showVolumeToast(frame,g.value);
            const now=Date.now();
            if(now-g.lastSent>=90&&(target.volume!==g.value||target.muted)){
              g.lastSent=now;volume(target,g.value);
            }
          });
          zone.addEventListener('pointerup',e=>{
            const g=gesture;
            if(e.pointerType!=='pen'||g?.pointer!==e.pointerId)return;
            reset();
            const target=rowMap.get(g.key);
            if(target&&!g.held&&g.moved){
              const value=clamp(g.base+(g.y-e.clientY)/g.range*100);
              if(target.volume!==value||target.muted)volume(target,value);
              showVolumeToast(frame,value);
            }
          });
          zone.addEventListener('pointercancel',reset);
        }
      }
      zone.dataset.key=key;
    }
  }

  let backdrop=null;
  function makeSheet(){
    if(sheet?.isConnected)return;
    backdrop=document.createElement('div');
    backdrop.id='hmtc-backdrop';
    backdrop.hidden=true;
    backdrop.setAttribute('aria-hidden','true');
    backdrop.addEventListener('click',()=>{
      if(settings?.hidden===false)closeSettings();
      else closeSheet();
    });
    document.body.appendChild(backdrop);
    sheet=document.createElement('section');
    sheet.id='hmtc-sheet';sheet.hidden=true;
    sheet.setAttribute('role','dialog');
    sheet.setAttribute('aria-label','YouTube 当前视频控制和详细统计');
    sheet.innerHTML=[
      '<div class="hmtc-dismiss-zone" data-action="dismissHeader" title="轻点任意统计数据收起">',
      '<div class="eyebrow">HOLODEX · LIVE MONITOR　⌄ 轻点收起</div>',
      '<div class="head" data-action="dismissHeader" title="轻点标题收起">',
      '<div class="title" data-field="title">YouTube</div>',
      '<button type="button" data-action="close" aria-label="关闭">✕</button></div>',
      '<div class="net"><div class="sub">YouTube 当前视频 · Connection Speed</div>',
      '<div><span class="speed" data-field="speed">—</span><span class="unit">Mbps</span></div>',
      '<div class="sub" data-field="network">正在读取 YouTube 原生详细统计…</div></div>',
      '<div class="grid">',
      '<div class="metric"><label>缓冲健康度 · Buffer</label><strong data-field="health">—</strong></div>',
      '<div class="metric"><label>直播延迟 · Latency</label><strong data-field="latency">—</strong></div>',
      '<div class="metric"><label>播放时间</label><strong data-field="position">—</strong></div>',
      '<div class="metric"><label>当前 / 推荐分辨率</label><strong data-field="resolution">—</strong></div>',
      '</div></div>',
      '<div class="volume"><button type="button" data-action="mute" aria-label="静音">🔊</button>',
      '<input type="range" data-field="slider" aria-label="当前视频音量" min="0" max="100" step="1">',
      '<span class="value" data-field="volume">—</span></div>',
      '<div class="actions">',
      '<button type="button" data-action="minus">−10</button>',
      '<button type="button" data-action="plus">＋10</button>',
      '<button type="button" data-action="full">100%</button></div>',
      '<div class="footer">',
      '<button type="button" data-action="native">YouTube 原版统计</button>',
      '<button type="button" data-action="settings" aria-label="触控设置">⚙ 设置</button></div>',
      '<div class="note" data-field="note">',
      '连接速度与直播延迟来自 YouTube 内部统计，字段缺失时显示 —，不是 0。</div>'
    ].join('');
    document.body.appendChild(sheet);
    const slider=sheet.querySelector('[data-field="slider"]');
    slider.addEventListener('input',()=>{
      const row=active&&rowMap.get(active.layoutId+':'+active.videoId);
      if(row)volume(row,Number(slider.value));
    });
    sheet.addEventListener('click',async e=>{
      const btn=e.target.closest('button[data-action]');
      if(!btn){
        if(e.target.closest('[data-action="dismissHeader"]'))closeSheet();
        return;
      }
      const action=btn.dataset.action;
      if(action==='close'){closeSheet();return;}
      if(action==='settings'){openSettings();return;}
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
            ? 'YouTube 原版统计已请求显示在小播放器内。'
            : '已请求隐藏 YouTube 原版统计。');
          stats();
        }catch(error){field('note',error.message);}
      }
    });
    document.addEventListener('keydown',e=>{
      if(e.key!=='Escape')return;
      if(settings?.hidden===false)closeSettings();
      else if(!sheet.hidden)closeSheet();
    });
    // Full-screen transparent backdrop captures taps above the sheet even
    // when the underlying content is a cross-origin YouTube iframe.
  }
  let settings=null;
  function makeSettings(){
    if(settings?.isConnected)return settings;
    settings=document.createElement('section');
    settings.id='hmtc-settings';settings.hidden=true;
    settings.setAttribute('role','dialog');
    settings.setAttribute('aria-label','Holodex 触控手势设置');
    settings.innerHTML=[
      '<div class="head"><span class="title">⚙ 触控手势设置</span>',
      '<button type="button" data-action="close" aria-label="关闭设置">✕</button></div>',
      '<div class="setting"><label>音量滑动灵敏度：<b data-value="sensitivity">1.0×</b></label>',
      '<input type="range" min="0.4" max="2.5" step="0.1" data-control="sensitivity">',
      '<div class="presets">',
      '<button type="button" data-preset="0.6">精细</button>',
      '<button type="button" data-preset="1">标准</button>',
      '<button type="button" data-preset="1.6">快速</button></div>',
      '<div class="setting-summary">系数越大，相同滑动距离改变的音量越多；设置立即生效。</div></div>',
      '<div class="setting"><label for="hmtc-stats-mode">打开统计的触控方式</label>',
      '<select id="hmtc-stats-mode" data-control="statsMode">',
      '<option value="tap">左侧轻点（默认）</option>',
      '<option value="hold">左右侧长按（600ms）</option>',
      '<option value="both">左侧轻点＋左右侧长按</option>',
      '</select>',
      '<div class="setting-summary">长按识别前滑动超过 12px 会取消；右侧纵向滑动继续调节音量。</div></div>',
      '<div class="setting-summary" style="margin-top:16px">',
      '触控区域左右各宽 36%，最大 112px，纵向覆盖 11%–89%。',
      '可从油猴菜单显示边界或关闭边缘手势。</div>'
    ].join('');
    document.body.appendChild(settings);
    settings.querySelector('[data-action="close"]').addEventListener('click',closeSettings);
    const slider=settings.querySelector('[data-control="sensitivity"]');
    const updateSensitivity=value=>{
      const n=Math.max(.4,Math.min(2.5,Number(value)||1));
      set(SENS_KEY,Math.round(n*10)/10);
      slider.value=String(getSensitivity());
      settings.querySelector('[data-value="sensitivity"]').textContent=getSensitivity().toFixed(1)+'×';
    };
    slider.addEventListener('input',()=>updateSensitivity(slider.value));
    settings.querySelectorAll('[data-preset]').forEach(b=>{
      b.addEventListener('click',()=>updateSensitivity(b.dataset.preset));
    });
    settings.querySelector('[data-control="statsMode"]').addEventListener('change',e=>{
      if(['tap','hold','both'].includes(e.target.value))set(STATS_MODE_KEY,e.target.value);
    });
    return settings;
  }
  function openSettings(){
    makeSettings();
    settings.querySelector('[data-control="sensitivity"]').value=String(getSensitivity());
    settings.querySelector('[data-value="sensitivity"]').textContent=getSensitivity().toFixed(1)+'×';
    settings.querySelector('[data-control="statsMode"]').value=getStatsMode();
    settings.hidden=false;
  }
  function closeSettings(){if(settings)settings.hidden=true;}

  // Track only the currently selected iframe. If the modal changes videos or
  // closes, stop the private diagnostics and restore the original YouTube state.
  let nativeCollector=null;
  function collectorKey(row,target){
    return row.layoutId+':'+row.videoId+':'+row.index;
  }
  function stopNativeCollector(){
    const previous=nativeCollector;
    nativeCollector=null;
    if(!previous)return;
    // Send directly to the original WindowProxy rather than re-locating by
    // layout index: Holodex may already have rearranged its video cells.
    try {
      previous.win.postMessage({
        tag:NATIVE_TAG,seq:++nativeSequence,
        videoId:previous.row.videoId,action:'monitorStop'
      },previous.origin);
    }catch{ /* The original frame was navigated or closed. */ }
  }
  function ensureNativeCollector(row){
    const target=nativeFrame(row);
    if(!target)return Promise.resolve(false);
    const key=collectorKey(row,target);
    if(nativeCollector &&
       (nativeCollector.key!==key || nativeCollector.win!==target.frame.contentWindow))
      stopNativeCollector();
    if(!nativeCollector){
      nativeCollector={key,win:target.frame.contentWindow,origin:target.origin,
        row:{index:row.index,layoutId:row.layoutId,videoId:row.videoId},
        enabled:false,pending:null,retryAfter:0};
    }
    const state=nativeCollector;
    if(state.enabled)return Promise.resolve(true);
    if(state.pending)return state.pending;
    if(Date.now()<state.retryAfter)return Promise.resolve(false);
    state.pending=nativeRequest(state.row,'monitorStart',1500).then(result=>{
      if(nativeCollector!==state)return false;
      state.enabled=!!result?.enabled;
      if(!state.enabled)state.retryAfter=Date.now()+6500;
      return state.enabled;
    }).catch(()=>{
      if(nativeCollector===state)state.retryAfter=Date.now()+6500;
      return false;
    }).finally(()=>{state.pending=null;});
    return state.pending;
  }

  function renderYouTubeStats(data,reason) {
    if(!data?.available){
      field('speed','—');
      field('network',reason||data?.reason||'YouTube 原生连接统计不可用');
    }else {
      const kbps=data.bandwidthKbps;
      field('speed',typeof kbps==='number'&&Number.isFinite(kbps)&&kbps>0
        ? '≈ '+(kbps/1000).toFixed(2):'—');
      field('network',kbps!=null
        ? '当前视频 · YouTube '+(data.source||'原生统计')
        : '已连接 YouTube，但本播放器未提供带宽数值');
    }
    field('health',typeof data?.bufferSeconds==='number'
      ? data.bufferSeconds.toFixed(1)+' s':'—');
    field('resolution',data?.resolution||'—');
    field('latency',Number.isFinite(data?.liveLatencySeconds)
      ? data.liveLatencySeconds.toFixed(2)+' s':'—');
  }
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
    const stillActive=()=>!!active&&!sheet.hidden&&active.layoutId+':'+active.videoId===key;
    // Do not delay reliable playback time while optional YouTube private stats
    // wait for an inaccessible third-party iframe and eventually time out.
    const playback=rpc('stats',{
      layoutId:row.layoutId,videoId:row.videoId
    },3500).then(v=>{
      if(!stillActive())return;
      field('position',v.ready
        ? timestamp(v.position)+(v.live?' · 直播':' / '+timestamp(v.duration))
        : '尚未就绪');
    }).catch(error=>{
      if(stillActive())field('position','暂时无法读取');
    });
    const native=ensureNativeCollector(row).then(()=>{
      if(!stillActive())return;
      return nativeRequest(row,'stats',1750);
    }).then(v=>{
      if(v&&stillActive())renderYouTubeStats(v);
    }).catch(error=>{
      if(stillActive())renderYouTubeStats(null,error.message||'YouTube iframe 未响应');
    });
    try {await Promise.allSettled([playback,native]);}
    finally {statsBusy=false;}
  }
  function openSheet(row){
    makeSheet();
    if(active&&(active.layoutId!==row.layoutId||active.videoId!==row.videoId))
      stopNativeCollector();
    active={layoutId:row.layoutId,videoId:row.videoId};
    sheet.hidden=false;
    if(backdrop)backdrop.hidden=false;
    field('title',row.title||row.videoId);
    renderVolume(row);
    renderYouTubeStats(null,'正在读取 YouTube 嵌入播放器…');
    field('position','读取中…');
    stats();
    clearInterval(statsInterval);statsInterval=setInterval(stats,1800);
  }
  function closeSheet(){
    active=null;
    if(sheet)sheet.hidden=true;
    if(backdrop)backdrop.hidden=true;
    if(settings?.hidden===false)closeSettings();
    clearInterval(statsInterval);statsInterval=null;
    stopNativeCollector();
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
        const frame=roots[row.index]?.querySelector('.mv-frame');
        const ongoing=frame?.querySelector('.hmtc-edge--right')?._drag;
        if(ongoing && old){row.volume=old.volume;row.muted=old.muted;}
        rowMap.set(key,row);
        if(get(EDGE_KEY,true))attachEdges(roots[row.index],row);
        if(active&&active.layoutId+':'+active.videoId===key)renderVolume(row);
      }
      for(const key of rowMap.keys())if(!validKeys.has(key))rowMap.delete(key);
      // Remove obsolete v0.2.x icon and any edge area disabled or recycled.
      for(const root of roots){
        const frame=root.querySelector('.mv-frame');
        frame?.querySelector('.hmtc-zone')?.remove();
        for(const edge of frame?.querySelectorAll('.hmtc-edge')||[]){
          if(!get(EDGE_KEY,true)||!validKeys.has(edge.dataset.key)||
             !root.querySelector('.hmtc-edge--'+edge.dataset.side)?.isConnected)
            edge.remove();
        }
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
    document.documentElement.classList.toggle('hmtc-debug',!!get(DEBUG_KEY,false));
    GM_registerMenuCommand('启用/禁用透明边缘手势',()=>{
      const next=!get(EDGE_KEY,true);
      set(EDGE_KEY,next);
      if(!next)document.querySelectorAll('.hmtc-edge').forEach(e=>e.remove());
      else refresh();
      alert('触摸手势已'+(next?'启用':'禁用')+'；播放统计仍可通过脚本菜单查看。');
    });
    GM_registerMenuCommand('触控手势设置（灵敏度／长按）',openSettings);
    GM_registerMenuCommand('显示/隐藏边缘触控区域（调试）',()=>{
      const next=!get(DEBUG_KEY,false);
      set(DEBUG_KEY,next);
      document.documentElement.classList.toggle('hmtc-debug',next);
    });
    installBridge();
    let last=location.href;
    setInterval(()=>{
      if(!document.body)return;
      if(location.href!==last){last=location.href;if(!isMulti()){closeSheet();rowMap.clear();}}
      if(isMulti()){if(!installed)installBridge();else refresh();}
    },1700);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    GM_registerMenuCommand('Touch Controls 操作说明',()=>alert('v0.4.0：左右两侧各宽 36%、高 78% 的透明控制区。右侧上下滑调节音量，左侧轻点打开统计。通过「触控手势设置」配置 0.4–2.5× 灵敏度或左右长按 600ms 查看统计；YouTube 原生连接速度和直播延迟依赖第三方 iframe 读取。')); 
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
