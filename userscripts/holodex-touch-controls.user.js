// ==UserScript==
// @name         Holodex Touch Controls（手势音量、播放统计与智能自动播放）
// @namespace    https://github.com/lyl7410/Holodex-HyperChat-Cleaner
// @version      0.6.25
// @description  左上角透明彩色信息标签靠近视频边缘，缓存速度以小圆点提示；保留紧凑统计与播放控制。
// @match        https://holodex.net/*
// @match        https://www.holodex.net/*
// @match        https://www.youtube.com/embed/*
// @match        https://youtube.com/embed/*
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://www.youtube.com/live/*
// @match        https://youtube.com/live/*
// @match        https://m.youtube.com/live/*
// @match        https://www.youtube-nocookie.com/embed/*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_addValueChangeListener
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/lyl7410/Holodex-HyperChat-Cleaner/main/userscripts/holodex-touch-controls.user.js
// @downloadURL  https://raw.githubusercontent.com/lyl7410/Holodex-HyperChat-Cleaner/main/userscripts/holodex-touch-controls.user.js
// ==/UserScript==

(function HolodexTouchControls() {
  'use strict';

  // Broad transparent zones are safe only when no precise pointing device exists.
  // Do not infer input mode from maxTouchPoints: touch laptops also have a mouse.
  let mouseInputSeen=false;
  function touchZonesAllowed(){
    return !mouseInputSeen&&matchMedia('(pointer:coarse)').matches&&
      !matchMedia('(any-pointer:fine)').matches;
  }
  // Some desktop browsers report coarse input despite a real mouse. Observe
  // pointer entry before the next button press, without cancelling any event.
  function observeMouseInput(event){
    if(event.pointerType!=='mouse'||mouseInputSeen)return;
    mouseInputSeen=true;
    document.documentElement.classList.add('hmtc-mouse-input');
    document.dispatchEvent(new Event('hmtc:input-policy-change'));
  }
  document.addEventListener('pointerover',observeMouseInput,{capture:true,passive:true});
  document.addEventListener('pointerdown',observeMouseInput,{capture:true,passive:true});
  function watchTouchZonePolicy(refresh){
    document.addEventListener('hmtc:input-policy-change',refresh);
    for(const query of ['(pointer:coarse)','(any-pointer:fine)']){
      const media=matchMedia(query);
      if(media.addEventListener)media.addEventListener('change',refresh);
      else media.addListener?.(refresh);
    }
  }
  // Shared and persisted by YouTube and Holodex. Tapping the HUD cycles
  // time → native speed → both → compact (off). The compact control can
  // restore the display without opening the settings sheet.
  const DESKTOP_TAG='hmtc-desktop-panel-v1';
  const DESKTOP_EXCLUDE='button,a,input,select,textarea,[contenteditable]:not([contenteditable="false"]),'+
    '[role="button"],[role="slider"],[role="dialog"],.ytp-chrome-top,.ytp-chrome-bottom,.ytp-popup,'+
    '.ytp-settings-menu,.ytp-contextmenu,.ytp-panel,.ytp-ce-element,.ytp-progress-bar-container,'+
    '.html5-video-info-panel,.html5-video-info-panel-content,.ytp-stats-for-nerds,'+
    '.hmtc-corner-hud,#hmtc-sheet,#hmtc-settings,#hmtc-yt-panel';
  let desktopLastPoint=null;
  const desktopPanels=new Map();
  function desktopMountAllowed(){
    return !['IFRAME','VIDEO'].includes(document.fullscreenElement?.tagName);
  }
  function desktopVideoAnchor(element){
    if(!element)return null;
    const r=element.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2,center:true,element};
  }
  function desktopVideoTarget(target,player){
    if(player.contains(target))return true;
    // New embedded-player controls can live in a body-level sibling portal.
    // Only accept this known portal for the current movie_player, never a
    // generic outside element; the geometric and control exclusions still run.
    return player.id==='movie_player'&&!!target?.closest?.('#player-controls,.ytPlayerControlsContainerHost');
  }
  function desktopContextPoint(event,player){
    if(touchZonesAllowed()||event.button!==2||event.ctrlKey||event.altKey||
       event.shiftKey||event.metaKey||!player||!desktopMountAllowed()||
       event.target?.closest?.(DESKTOP_EXCLUDE)||!desktopVideoTarget(event.target,player))return null;
    const r=player.getBoundingClientRect();
    if(!(r.width>0&&r.height>0))return null;
    const x=(event.clientX-r.left)/r.width,y=(event.clientY-r.top)/r.height;
    return x>=1/6&&x<=5/6&&y>=0&&y<=1?
      {x:event.clientX,y:event.clientY}:null;
  }
  function desktopPanelCoordinates(anchor,width,height,viewportWidth,viewportHeight){
    const gap=8,offset=10;
    let x=anchor?(anchor.center?anchor.x-width/2:anchor.x+offset):(viewportWidth-width)/2;
    let y=anchor?(anchor.center?anchor.y-height/2:anchor.y+offset):(viewportHeight-height)/2;
    if(anchor&&!anchor.center&&x+width>viewportWidth-gap)x=anchor.x-offset-width;
    if(anchor&&!anchor.center&&y+height>viewportHeight-gap)y=anchor.y-offset-height;
    return {x:Math.max(gap,Math.min(viewportWidth-gap-width,x)),
      y:Math.max(gap,Math.min(viewportHeight-gap-height,y))};
  }
  function positionDesktopPanel(panel){
    const state=desktopPanels.get(panel);
    if(!state||panel.hidden)return;
    const r=panel.getBoundingClientRect();
    const anchor=state.anchor?.center&&state.anchor.element?.isConnected?
      desktopVideoAnchor(state.anchor.element):state.anchor;
    const point=desktopPanelCoordinates(anchor,r.width,r.height,innerWidth,innerHeight);
    panel.style.left=point.x+'px';panel.style.top=point.y+'px';
  }
  function presentPanel(panel,anchor){
    const desktop=!touchZonesAllowed();
    for(const el of panel.querySelectorAll?.('[data-action="dismissHeader"]')||[])
      el.title=desktop?'':'轻点收起';
    panel.classList.toggle('hmtc-desktop-panel',desktop);
    prepareDesktopMetrics(panel,desktop);
    const layer=document.fullscreenElement||document.body;
    if(desktopMountAllowed()&&panel.parentNode!==layer)layer.appendChild(panel);
    if(!desktop){
      desktopPanels.delete(panel);panel.style.removeProperty('left');panel.style.removeProperty('top');return;
    }
    // Menu managers pass a click event; only explicit x/y points are anchors.
    const point=anchor&&Number.isFinite(anchor.x)&&Number.isFinite(anchor.y)?
      {x:anchor.x,y:anchor.y,center:anchor.center===true,element:anchor.element}:desktopLastPoint;
    desktopPanels.set(panel,{anchor:point?{...point}:null});
    if(!panel._hmtcSizeObserver&&typeof ResizeObserver==='function'){
      panel._hmtcSizeObserver=new ResizeObserver(()=>positionDesktopPanel(panel));
      panel._hmtcSizeObserver.observe(panel);
    }
    positionDesktopPanel(panel);
  }
  // Move the existing readings, never duplicate bindings. Comments restore the
  // exact mobile DOM when the same panel is opened with touch input later.
  function prepareDesktopMetrics(panel,desktop){
    let compact=panel._hmtcCompact;
    if(!desktop&&compact){
      for(const [node,marker] of compact.originals)marker.replaceWith(node);
      compact.root.remove();delete panel._hmtcCompact;
    }else if(desktop&&!compact){
      const latency=panel.querySelector?.('[data-hmtc-latency-metric]');
      if(!latency)return;
      const reading=(field,id)=>panel.querySelector('[data-field="'+field+'"], [data-id="'+id+'"]');
      const items={latency,speed:reading('speed','speed')?.closest('.net,.metric'),
        time:reading('position','time')?.closest('.metric'),
        resolution:reading('resolution','resolution')?.closest('.metric'),
        buffer:reading('health','buffer')?.closest('.metric')};
      const head=panel.querySelector('.head');
      if(!head||Object.values(items).some(node=>!node))return;
      const root=document.createElement('div');root.className='hmtc-compact-stats';
      const rows=Array.from({length:3},()=>{
        const row=document.createElement('div');row.className='hmtc-compact-row';root.appendChild(row);return row;
      });
      const originals=Object.values(items).map(node=>{
        const marker=document.createComment('hmtc-mobile-metric');node.before(marker);return [node,marker];
      });
      panel._hmtcCompact={root,rows,items,originals};head.after(root);
    }
    const kind=panel.querySelector?.('[data-hmtc-latency-metric]')?.dataset.kind;
    if(kind)renderMediaKind(panel,{live:kind==='live'?true:kind==='vod'?false:null});
  }
  function syncDesktopMetrics(panel){
    const compact=panel?._hmtcCompact;if(!compact)return;
    const {items,rows}=compact,vod=items.latency.dataset.kind==='vod';
    const groups=vod?[[items.speed,items.buffer],[items.time],[items.resolution]]:
      [[items.speed,items.latency],[items.time,items.buffer],[items.resolution]];
    // Keep the hidden latency attached so querySelector bindings stay valid.
    if(vod)compact.root.appendChild(items.latency);
    groups.forEach((group,i)=>{
      for(const node of group)if(node.parentNode!==rows[i])rows[i].appendChild(node);
      rows[i].hidden=!group.length;
    });
    for(const value of compact.root.querySelectorAll('strong,b,.speed')){
      const text=value.textContent;
      value.classList.toggle('hmtc-reading-pending',/^(?:—|未提供|暂未提供|待确认|识别中|读取中…|暂时无法读取)$/.test(text));
      const unit=text.match(/^(.*?)(\s+(?:Mbps|s))$/);
      if(unit){
        value.textContent=unit[1];
        const span=document.createElement('span');span.className='hmtc-reading-unit';span.textContent=unit[2];value.appendChild(span);
      }
    }
  }
  function desktopPanelReflow(){
    for(const panel of desktopPanels.keys()){
      if(panel.hidden)continue;
      const layer=document.fullscreenElement||document.body;
      if(desktopMountAllowed()&&panel.parentNode!==layer)layer.appendChild(panel);
      if(desktopMountAllowed())positionDesktopPanel(panel);
    }
  }
  document.addEventListener('pointermove',e=>{
    if(e.pointerType==='mouse')desktopLastPoint={x:e.clientX,y:e.clientY};
  },{passive:true});
  window.addEventListener('resize',desktopPanelReflow,{passive:true});
  window.visualViewport?.addEventListener('resize',desktopPanelReflow,{passive:true});
  document.addEventListener('fullscreenchange',desktopPanelReflow);
  document.addEventListener('scroll',desktopPanelReflow,{capture:true,passive:true});
  function installDesktopDismiss(dismiss){
    document.addEventListener('pointerdown',e=>{
      if(touchZonesAllowed()||e.button!==0||e.target?.closest?.(
        '#hmtc-sheet,#hmtc-settings,#hmtc-yt-panel'))return;
      dismiss(); // Observe only: do not consume the underlying click.
    },{capture:true,passive:true});
  }
  GM_addStyle(`
    #hmtc-sheet.hmtc-desktop-panel,#hmtc-settings.hmtc-desktop-panel,
    #hmtc-yt-panel.hmtc-desktop-panel{
      position:fixed;width:320px;min-width:0;max-width:calc(100vw - 16px);
      max-height:min(520px,calc(100vh - 16px));right:auto;bottom:auto;margin:0;
      padding:10px;border-radius:10px;font:12px/1.3 system-ui;overflow:auto}
    .hmtc-desktop-panel .hmtc-dismiss-zone,.hmtc-desktop-panel .hmtc-dismiss-zone .metric{cursor:default!important}
    .hmtc-desktop-panel .head{min-height:26px!important;gap:5px!important}
    .hmtc-desktop-panel .title,.hmtc-desktop-panel .head strong{font-size:13px!important}
    .hmtc-desktop-panel button,.hmtc-desktop-panel select{
      min-height:28px!important;min-width:28px!important;padding:3px 5px!important;
      border-radius:6px!important;font-size:12px!important}
    .hmtc-desktop-panel .net{display:flex;align-items:center;gap:8px;
      padding:5px 6px!important;margin-top:4px!important;border-radius:6px!important}
    .hmtc-desktop-panel .speed{font-size:18px!important;margin:0!important}
    .hmtc-desktop-panel .unit{font-size:11px!important}
    .hmtc-desktop-panel .grid{gap:4px!important;margin:4px 0!important}
    .hmtc-desktop-panel .metric{padding:5px 6px!important;border-radius:6px!important}
    .hmtc-desktop-panel .metric label{font-size:10px!important;margin-bottom:2px!important}
    .hmtc-desktop-panel .metric strong,.hmtc-desktop-panel .metric b{
      font-size:13px!important;line-height:1.2!important}
    .hmtc-desktop-panel .hmtc-play-controls{padding:4px 5px!important;margin-top:4px!important}
    .hmtc-desktop-panel .row,.hmtc-desktop-panel .hmtc-play-row{margin:4px 0!important;gap:4px!important}
    .hmtc-desktop-panel .hmtc-rate-presets,.hmtc-desktop-panel .hmtc-quality-presets,
    .hmtc-desktop-panel .hmtc-yt-rates,.hmtc-desktop-panel .hmtc-yt-qualities{
      gap:4px!important;margin:4px 0 6px!important;grid-template-columns:repeat(5,minmax(0,1fr))}
    .hmtc-desktop-panel .hmtc-rate-presets button,.hmtc-desktop-panel .hmtc-quality-presets button,
    .hmtc-desktop-panel .hmtc-yt-rates button,.hmtc-desktop-panel .hmtc-yt-qualities button{
      min-width:0!important;font-size:11px!important}
    .hmtc-desktop-panel .volume{gap:5px!important;margin:5px 0!important}
    .hmtc-desktop-panel input[type=range]{height:28px!important}
    .hmtc-desktop-panel .value{min-width:34px!important}
    .hmtc-desktop-panel .actions,.hmtc-desktop-panel .footer{gap:4px!important;margin-top:5px!important}
    .hmtc-desktop-panel .hmtc-youtube-quality-link{padding:5px!important;font-size:11px!important}
    .hmtc-desktop-panel .setting{margin-top:8px!important}
    .hmtc-desktop-panel .setting label{font-size:12px!important;margin-bottom:4px!important}
  `);
  function installDesktopFrameBridge(videoId,getPlayer,allowedOrigins){
    let config=null,lastMove=0,lastHello=0,lastContext='尚未收到右键';
    const paired=()=>config&&Date.now()<config.until;
    const requestConfig=()=>{
      const now=Date.now();if(now-lastHello<500)return;lastHello=now;
      let origin=null;
      try{origin=new URL(document.referrer).origin;}catch{}
      if(!allowedOrigins.has(origin))origin=location.ancestorOrigins?.[0];
      if(!allowedOrigins.has(origin))return;
      window.parent.postMessage({tag:DESKTOP_TAG,type:'ready',videoId},origin);
    };
    const send=(type,point)=>{
      if(!paired())return;
      window.parent.postMessage({tag:DESKTOP_TAG,type,videoId,
        ...(point?{x:point.x/innerWidth,y:point.y/innerHeight}:{})},config.origin);
    };
    document.addEventListener('contextmenu',event=>{
      if(!paired()){lastContext='未配对或租约过期';requestConfig();return;}
      if(!config.enabled){lastContext='父页面未启用';return;}
      if(document.fullscreenElement){lastContext='独立视频全屏';return;}
      const p=getPlayer();
      let actualId;try{actualId=p?.getVideoData?.()?.video_id;}catch{return;}
      if(actualId&&actualId!==videoId){lastContext='视频已切换';return;}
      const point=desktopContextPoint(event,p);
      if(!point){lastContext='非中央画面或交互控件';return;}
      lastContext='已发送打开请求';
      event.preventDefault();event.stopPropagation();send('open',point);
    },{capture:true});
    document.addEventListener('pointerdown',event=>{
      if(!paired())requestConfig();
      if(config?.enabled&&event.button===0)send('dismiss');
    },{capture:true,passive:true});
    document.addEventListener('keydown',event=>{
      if(config?.enabled&&event.key==='Escape')send('escape');
    });
    document.addEventListener('pointerover',event=>{
      if(event.pointerType==='mouse'){if(!paired())requestConfig();send('mouse');}
    },{passive:true});
    document.addEventListener('pointermove',event=>{
      if(!config?.enabled||event.pointerType!=='mouse'||Date.now()-lastMove<200)return;
      lastMove=Date.now();send('move',{x:event.clientX,y:event.clientY});
    },{passive:true});
    requestConfig();
    const pairingTimer=setInterval(()=>{if(!paired())requestConfig();},1800);
    window.addEventListener('pagehide',event=>{if(!event.persisted)clearInterval(pairingTimer);});
    return {status:()=>({paired:!!paired(),enabled:config?.enabled===true,lastContext}),configure(event,message){
      if(event.source!==window.parent||!allowedOrigins.has(event.origin)||
         message.videoId!==videoId||typeof message.enabled!=='boolean')return false;
      config={origin:event.origin,enabled:message.enabled,until:Date.now()+5000};
      return true;
    }};
  }
  GM_addStyle('.hmtc-media-kind{flex:none;font:600 10px/1.4 system-ui;padding:2px 5px;border-radius:4px;background:#ffffff18;color:#d4e3ed}.hmtc-media-kind[data-kind="live"]{color:#ffb7b7}.hmtc-media-kind[data-kind="vod"]{color:#b9e5df}');
  GM_addStyle(`
    #hmtc-sheet .hmtc-live-status,#hmtc-yt-panel .hmtc-live-status{
      display:flex;align-items:center;gap:7px;margin:6px 0;padding:7px 8px;
      border:1px solid #ffffff20;border-radius:7px;background:#ffffff08;color:#c4d0db;font:12px/1.4 system-ui}
    #hmtc-sheet .hmtc-live-status[hidden],#hmtc-yt-panel .hmtc-live-status[hidden]{display:none!important}
    #hmtc-sheet .hmtc-live-status strong,#hmtc-yt-panel .hmtc-live-status strong{
      margin-left:auto;font:700 15px/1.4 system-ui;font-variant-numeric:tabular-nums;color:#d1dbe4}
    #hmtc-sheet .hmtc-live-status[data-state="available"] strong,
    #hmtc-yt-panel .hmtc-live-status[data-state="available"] strong{color:#a7ebe0}
    .hmtc-live-status .hmtc-media-kind[data-kind="live"]::before{content:'●';margin-right:4px;font-size:8px}
    #hmtc-sheet .hmtc-playtime-metric{grid-column:1/-1}
    #hmtc-sheet .head .title,#hmtc-yt-panel .head>strong{
      white-space:normal!important;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  `);
  GM_addStyle(`
    :is(#hmtc-sheet,#hmtc-yt-panel,#hmtc-settings).hmtc-desktop-panel{
      --hmtc-label:#9EC5E5;--hmtc-value:#F5FAFF;--hmtc-live:#FF9B9B;
      --hmtc-latency:#81E6D9;--hmtc-pending:#F2CA7A;color:var(--hmtc-value)}
    .hmtc-desktop-panel :is(label,.sub,[data-hmtc-latency-label],.hmtc-toggle>span,
      .hmtc-yt-preferences>summary){color:var(--hmtc-label)!important;font-size:11px!important;font-weight:600!important}
    .hmtc-desktop-panel :is(.title,.head>strong){color:var(--hmtc-value)!important;font-size:13px!important}
    :is(#hmtc-sheet,#hmtc-yt-panel,#hmtc-settings).hmtc-desktop-panel :is(button,select){
      color:var(--hmtc-value)!important;font-size:12px!important}
    .hmtc-desktop-panel :is(.value,[data-id="vol"],[data-id="senseText"],.setting b){
      color:var(--hmtc-value)!important;font-size:13px!important}
    .hmtc-desktop-panel :is(.note,.hint,.hmtc-yt-quality-tip,.speedFreshness){color:var(--hmtc-pending)!important}
    .hmtc-desktop-panel .setting-summary{color:var(--hmtc-label)!important;font-size:11px!important}
    .hmtc-desktop-panel button:disabled{opacity:.55;cursor:default}
    .hmtc-desktop-panel .hmtc-compact-stats{padding:6px;margin:4px 0;background:#ffffff08;border-radius:6px}
    .hmtc-desktop-panel .hmtc-compact-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:baseline;gap:1px 4px}
    .hmtc-desktop-panel .hmtc-compact-row+.hmtc-compact-row{margin-top:0}
    .hmtc-desktop-panel .hmtc-compact-row[hidden],
    .hmtc-desktop-panel .hmtc-compact-stats>[hidden],
    .hmtc-desktop-panel .grid:empty{display:none!important}
    .hmtc-desktop-panel .hmtc-compact-row>:is(.metric,.net,.hmtc-live-status){
      --hmtc-metric-label-width:44px;
      display:grid!important;grid-template-columns:var(--hmtc-metric-label-width) minmax(0,1fr);align-items:baseline;gap:4px!important;
      min-width:0;max-width:100%;min-height:19px;padding:0!important;margin:0!important;
      border:0!important;background:none!important;box-shadow:none!important;border-radius:0!important;line-height:20px}
    .hmtc-desktop-panel .hmtc-compact-row>:only-child{grid-column:1/-1}
    .hmtc-desktop-panel .hmtc-compact-row>.hmtc-playtime-metric:not(:only-child){grid-column:auto!important}
    .hmtc-desktop-panel .hmtc-compact-row>:nth-child(2){--hmtc-metric-label-width:22px}
    .hmtc-desktop-panel .hmtc-compact-row>.hmtc-live-status{
      grid-template-columns:var(--hmtc-metric-label-width) max-content max-content;justify-content:start}
    .hmtc-desktop-panel .hmtc-compact-stats :is(label,.sub,[data-hmtc-latency-label]){
      display:inline!important;margin:0!important;min-width:0;width:var(--hmtc-metric-label-width);order:1}
    .hmtc-desktop-panel .hmtc-compact-stats .hmtc-live-status strong{order:2}
    .hmtc-desktop-panel .hmtc-compact-stats .metric>:is(b,strong),
    .hmtc-desktop-panel .hmtc-compact-stats .net>div:last-child{order:2}
    .hmtc-desktop-panel .hmtc-compact-stats .hmtc-media-kind{order:3}
    .hmtc-desktop-panel .hmtc-compact-stats .net>div:last-child{display:inline-flex;align-items:baseline;gap:3px;flex-wrap:wrap}
    .hmtc-desktop-panel .hmtc-compact-stats :is(strong,b,.speed){
      color:var(--hmtc-value)!important;font-size:13px!important;line-height:20px!important;
      margin:0!important;min-width:0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .hmtc-desktop-panel .hmtc-compact-stats :is(.unit,.hmtc-reading-unit){
      color:inherit!important;font-size:11px!important;margin:0!important;font-weight:600}
    .hmtc-desktop-panel .hmtc-compact-stats .hmtc-media-kind{
      color:var(--hmtc-live)!important;padding:0;background:none;font-size:11px;font-weight:600;flex:none}
    .hmtc-desktop-panel .hmtc-compact-stats [data-state="available"] strong{color:var(--hmtc-value)!important}
    .hmtc-desktop-panel .hmtc-compact-stats :is(.hmtc-reading-pending,[data-state="pending"] strong){
      color:var(--hmtc-pending)!important}
  `);
  function currentResolution(value){
    if(typeof value!=='string')return '';
    const m=value.match(/(\d{2,5})\s*[x×]\s*(\d{2,5})(?:\s*@\s*(\d+(?:\.\d+)?))?/i);
    return m?m[1]+'×'+m[2]+(m[3]?'@'+m[3]:''):'';
  }
  const LATENCY_SECONDS_KEYS=new Set(['live_latency_seconds','liveLatencySeconds','live_latency_sec',
    'live_latency_secs','latency_to_live_seconds','latencyToLiveEdgeSeconds']);
  const LATENCY_MS_KEYS=new Set(['live_latency_ms','liveLatencyMs','latency_to_live_ms']);
  function nativeLatencySeconds(raw){
    const numeric=value=>{
      if(value==null||typeof value==='boolean'||typeof value==='object'||
         typeof value==='string'&&!value.trim())return null;
      const n=Number(typeof value==='string'?value.replace(/,/g,''):value);
      return Number.isFinite(n)&&n>=0?n:null;
    };
    const unitValue=(value,isMillis)=>{
      if(typeof value!=='string')return numeric(value)==null?null:numeric(value)/(isMillis?1000:1);
      const match=value.trim().match(/^([+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+\-]?\d+)?)\s*(milliseconds?|ms|毫秒|seconds?|secs?|s|秒)?$/i);
      if(!match)return null;
      const n=numeric(match[1]);if(n==null)return null;
      const millis=match[2]?/^(?:ms|millisecond|毫秒)/i.test(match[2]):isMillis;
      return millis?n/1000:n;
    };
    const seconds=LATENCY_SECONDS_KEYS,millis=LATENCY_MS_KEYS;
    let decoded=raw;
    if(typeof raw==='string')try{decoded=JSON.parse(raw);}catch{}
    const queue=[{value:decoded,depth:0}],seen=new Set();let visited=0;
    while(queue.length&&visited++<80){
      const {value,depth}=queue.shift();
      if(!value||typeof value!=='object'||seen.has(value))continue;
      seen.add(value);
      for(const [key,v] of Object.entries(value)){
        if(seconds.has(key)||millis.has(key)){
          const n=typeof v==='string'&&!/[a-z秒]/i.test(v)?unitValue(v.replace(/,/g,''),millis.has(key)):unitValue(v,millis.has(key));
          if(n!=null)return n;
        }
        if(v&&typeof v==='object'&&depth<4)queue.push({value:v,depth:depth+1});
      }
    }
    if(typeof raw==='string'){
      const m=raw.match(/(?:Live Latency|Latency to Live Edge|直播延迟|直播延遲|ライブ遅延)\s*(?:\((s|ms)\))?\s*[:：]?\s*([\d,.]+)\s*(milliseconds?|ms|毫秒|seconds?|secs?|s|秒)?(?![a-z])/i);
      if(m&&(m[1]||m[3])){const n=numeric(m[2]);if(n!=null)return /^(?:ms|millisecond|毫秒)/i.test(m[3]||m[1])?n/1000:n;}
    }
    return null;
  }
  function latencyFieldNames(raw){
    let value=raw;
    if(typeof raw==='string')try{value=JSON.parse(raw);}catch{
      return /(?:live latency|latency to live|直播延迟)/i.test(raw)?['原生延迟文字']:[];
    }
    const queue=[{value,path:'',depth:0}],seen=new Set(),names=[];let count=0;
    while(queue.length&&count++<60&&names.length<16){
      const {value,path,depth}=queue.shift();
      if(!value||typeof value!=='object'||seen.has(value))continue;seen.add(value);
      for(const [key,v] of Object.entries(value)){
        const name=path?path+'.'+key:key;
        if(/latency/i.test(key))names.push(name.slice(0,90));
        if(v&&typeof v==='object'&&depth<3)queue.push({value:v,path:name,depth:depth+1});
      }
    }
    return names;
  }
  // Diagnostic-only: never serialize the full stats payload or invoke accessors.
  function latencyValueDetails(raw){
    if(typeof raw==='string')try{raw=JSON.parse(raw);}catch{return [];}
    const queue=[{value:raw,depth:0}],seen=new Set(),details=[];let visited=0;
    while(queue.length&&visited++<60&&details.length<16){
      const {value,depth}=queue.shift();
      if(!value||typeof value!=='object'||seen.has(value))continue;seen.add(value);
      let keys;try{keys=Object.getOwnPropertyNames(value).slice(0,100);}catch{continue;}
      for(const key of keys){
        if(details.length>=16)break;
        let descriptor;try{descriptor=Object.getOwnPropertyDescriptor(value,key);}catch{continue;}
        if(!descriptor)continue;
        const known=LATENCY_SECONDS_KEYS.has(key)||LATENCY_MS_KEYS.has(key);
        if(!('value' in descriptor)){
          if(known)details.push({field:key,type:'accessor',preview:'未读取 getter'});
          continue;
        }
        const v=descriptor.value;
        if(known){
          const type=v===null?'null':Array.isArray(v)?'array':typeof v;
          let preview;
          if(type==='string'){
            // Preserve numeric/unit syntax; suppress URLs and arbitrary text/tokens.
            preview=/^\s*(?:[+\-]?(?:[\d.,]+(?:e[+\-]?\d+)?|NaN|Infinity)\s*(?:ms|s|secs?|seconds?|milliseconds?|毫秒|秒)?)?\s*$/i.test(v)&&v.length<=80?
              JSON.stringify(v):'[文本已省略；长度 '+v.length+']';
          }else if(type==='number'||type==='boolean'||type==='undefined'||type==='null')preview=String(v);
          else if(type==='array')preview='[数组；内容未展开]';
          else preview='[非标量；内容未展开]';
          details.push({field:key,type,preview});
        }
        if(v&&typeof v==='object'&&depth<3)queue.push({value:v,depth:depth+1});
      }
    }
    return details;
  }
  function bindPanelRightClose(panel,close){
    panel.addEventListener('contextmenu',event=>{
      if(touchZonesAllowed()||event.button!==2||event.ctrlKey||event.altKey||event.shiftKey||event.metaKey)return;
      event.preventDefault();event.stopPropagation();close();
    },{capture:true});
  }
  const HUD_KEY='hmtc_corner_hud_mode_v1';
  const HUD_MODES=['time','speed','both','off'];
  const hudMode=()=>{
    const value=GM_getValue(HUD_KEY,'time');
    return HUD_MODES.includes(value)?value:'time';
  };
  const hudWantsSpeed=()=>hudMode()==='speed'||hudMode()==='both';
  const hudWantsTime=()=>hudMode()==='time'||hudMode()==='both';
  function cycleHudMode(){
    const mode=hudMode();
    GM_setValue(HUD_KEY,HUD_MODES[(HUD_MODES.indexOf(mode)+1)%HUD_MODES.length]);
    document.dispatchEvent(new Event('hmtc:corner-hud-change'));
  }
  function createCornerHud(){
    const button=document.createElement('button');
    button.type='button';
    button.className='hmtc-corner-hud';
    button.setAttribute('aria-label','切换视频左上角信息');
    const line=(name,text)=>{
      const span=document.createElement('span');span.className=name;span.textContent=text;return span;
    };
    const time=line('hmtc-hud-line hmtc-hud-time','—');
    const speed=line('hmtc-hud-line hmtc-hud-speed','');
    const value=line('hmtc-hud-speed-value','—');
    const dot=line('hmtc-hud-cache-dot','');dot.setAttribute('aria-hidden','true');
    const off=line('hmtc-hud-off-label','···');
    speed.append(value,dot);button.append(time,speed,off);
    button._hmtcHudParts={time,speed,value,dot,off};
    button.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();cycleHudMode();
    });
    for(const type of ['pointerdown','pointerup','touchstart','touchend'])
      button.addEventListener(type,e=>e.stopPropagation(),{passive:true});
    return button;
  }
  function hudSpeedReading(kbps,stale=false,sampledAt=Date.now()){
    const age=Date.now()-sampledAt;
    if(!Number.isFinite(kbps)||kbps<=0||stale&&(!Number.isFinite(age)||age<0||age>6000))
      return {text:'—',stale:false,sampledAt:null};
    return {text:(kbps/1000).toFixed(2)+' Mbps',stale:!!stale,sampledAt};
  }
  function displayCornerHud(button,time,speed){
    if(!button)return;
    clearTimeout(button._hmtcHudTimer);button._hmtcHudTimer=null;
    const mode=hudMode(),parts=button._hmtcHudParts;
    const age=speed?.stale?Date.now()-speed.sampledAt:0;
    const expired=speed?.stale&&(!Number.isFinite(age)||age<0||age>6000);
    const value=expired?'—':typeof speed==='object'?speed?.text||'—':speed||'—';
    const cached=!expired&&speed?.stale&&(mode==='speed'||mode==='both');
    button.classList.toggle('hmtc-hud-off',mode==='off');
    button.classList.toggle('hmtc-hud-cached',!!cached);
    parts.time.hidden=mode!=='time'&&mode!=='both';
    parts.speed.hidden=mode!=='speed'&&mode!=='both';parts.off.hidden=mode!=='off';
    parts.time.textContent=time||'—';parts.value.textContent=value;
    const cacheNote=cached?'最近一次读取，距今 '+(age/1000).toFixed(1)+' 秒':'';
    button.title='轻点切换：时间 → 连接速度 → 同时 → 隐藏'+(cacheNote?'\n'+cacheNote:'');
    button.setAttribute('aria-label',mode==='off'?'显示左上角信息':
      '切换左上角信息（目前'+({time:'播放时间',speed:'连接速度',both:'两项'}[mode])+'）'+
      ((mode==='speed'||mode==='both')?'，连接速度 '+value:'')+(cacheNote?'，'+cacheNote:''));
    // A pending iframe request must not keep an old reading visible beyond its lease.
    if(cached&&button.isConnected)button._hmtcHudTimer=setTimeout(
      ()=>displayCornerHud(button,time,speed),Math.min(1000,6001-age));
  }
  GM_addStyle([
    '@media (pointer:fine),(pointer:none),(any-pointer:fine){',
    '.hmtc-edge,.hmtc-yt-edge,#hmtc-backdrop,#hmtc-yt-backdrop{',
    'display:none!important;pointer-events:none!important}}',
    'html.hmtc-mouse-input .hmtc-edge,html.hmtc-mouse-input .hmtc-yt-edge,',
    'html.hmtc-mouse-input #hmtc-backdrop,html.hmtc-mouse-input #hmtc-yt-backdrop{',
    'display:none!important;pointer-events:none!important}',
    '.hmtc-corner-hud{position:fixed!important;z-index:2147482700!important;',
    'display:block!important;box-sizing:border-box!important;max-width:240px;',
    'border:0!important;border-radius:0!important;',
    'padding:1px 2px!important;margin:0!important;',
    'background:transparent!important;color:#B9DEFF!important;',
    'font:600 12px/1.3 system-ui,-apple-system,sans-serif!important;',
    'font-variant-numeric:tabular-nums!important;white-space:pre-line!important;',
    'text-align:left!important;overflow:hidden!important;text-overflow:ellipsis!important;',
    'box-shadow:none!important;text-shadow:0 1px 2px #000,0 0 1px #000a;',
    '-webkit-tap-highlight-color:transparent;opacity:.85!important;',
    'transition:opacity .18s ease!important;',
    'touch-action:manipulation!important;pointer-events:auto!important;cursor:pointer!important}',
    '.hmtc-corner-hud:hover,.hmtc-corner-hud:focus-visible,.hmtc-corner-hud:active{',
    'opacity:1!important}',
    '.hmtc-corner-hud .hmtc-hud-line{display:block;color:#B9DEFF}',
    '.hmtc-corner-hud .hmtc-hud-time{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.hmtc-corner-hud .hmtc-hud-speed{display:flex;align-items:center;gap:4px;color:#A8E6D8}',
    '.hmtc-corner-hud .hmtc-hud-speed-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.hmtc-corner-hud .hmtc-hud-cache-dot{flex:0 0 5px;width:5px;height:5px;border-radius:50%;',
    'background:#F2CA7A;visibility:hidden}',
    '.hmtc-corner-hud.hmtc-hud-cached .hmtc-hud-cache-dot{visibility:visible}',
    '.hmtc-corner-hud .hmtc-hud-line[hidden],.hmtc-corner-hud .hmtc-hud-off-label[hidden]{display:none!important}',
    '.hmtc-corner-hud.hmtc-hud-off{width:24px!important;min-width:24px!important;',
    'height:20px!important;padding:1px 2px!important;',
    'text-align:center!important;opacity:.85!important}',
    '.hmtc-corner-hud.hmtc-hud-off:hover,.hmtc-corner-hud.hmtc-hud-off:focus-visible,',
    '.hmtc-corner-hud.hmtc-hud-off:active{opacity:1!important}',
    '.hmtc-corner-hud[hidden]{display:none!important}'
  ].join(''));
  // Common touch-sized, fixed rate presets shown on Holodex and YouTube.
  const COMMON_RATES=[1,1.25,1.5,1.75,2];
  // Shared with embedded YouTube players and ordinary YouTube watch pages.
  // YouTube removed setPlaybackQuality/getAvailableQualityLevels support in
  // 2019: NEVER call them or claim that a requested quality was applied.
  // Quality changes use the real, visible YouTube settings menu instead.
  function youtubePlaybackTools(pageDoc,getPlayer){
    const rates=[.25,.5,.75,1,1.25,1.5,1.75,2];
    const video=()=>{
      const selected=getPlayer();
      // After Shorts/swipe/SPA navigation there may be old <video> elements.
      // Prefer the video INSIDE the same player used by gestures and speed.
      const attached=selected?.querySelector?.('video.html5-main-video, video');
      return attached||pageDoc.querySelector('video.html5-main-video')||
        selected?.querySelector?.('video')||pageDoc.querySelector('video');
    };
    const allowedRates=()=>{
      const p=getPlayer();
      let options=[];
      try{
        if(typeof p?.getAvailablePlaybackRates==='function')
          options=p.getAvailablePlaybackRates()||[];
      }catch{}
      options=options.filter(v=>Number.isFinite(Number(v))&&Number(v)>.1&&Number(v)<=4)
        .map(Number);
      return options.length?[...new Set(options)].sort((a,b)=>a-b):rates;
    };
    function snapshot(){
      const p=getPlayer(),v=video();
      let rate=Number.NaN;
      try{rate=Number(p?.getPlaybackRate?.());}catch{}
      if(!Number.isFinite(rate)||rate<=0)rate=Number(v?.playbackRate)||1;
      const w=Number(v?.videoWidth)||0,h=Number(v?.videoHeight)||0;
      return {ready:!!(p||v),rate,rates:allowedRates(),
        resolution:w&&h?w+'×'+h:'—',
        nativeQualityAvailable:!!p?.querySelector?.('.ytp-settings-button')};
    }
    function setRate(value){
      const wanted=Number(value),available=allowedRates();
      if(!Number.isFinite(wanted)||!COMMON_RATES.some(n=>Math.abs(n-wanted)<.001))
        throw Error('播放速度不在允许的快捷档位内');
      const p=getPlayer(),v=video();
      if(typeof p?.setPlaybackRate==='function')p.setPlaybackRate(wanted);
      else if(v)v.playbackRate=wanted;
      else throw Error('YouTube 播放器尚未就绪');
      return snapshot();
    }
    // The public IFrame quality setter was deprecated in 2019. For desktop
    // menus keep the native fallback; for mobile try the undocumented native
    // YouTube webpage player methods, and verify instead of claiming success.
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const settingButton=()=>getPlayer()?.querySelector?.('.ytp-settings-button');
    const settingMenu=()=>getPlayer()?.querySelector?.('.ytp-settings-menu');
    const visible=el=>!!el&&!!el.getClientRects?.().length&&
      pageDoc.defaultView?.getComputedStyle?.(el)?.visibility!=='hidden';
    const menuLabel=el=>String(el?.querySelector?.('.ytp-menuitem-label')?.textContent||
      el?.getAttribute?.('aria-label')||el?.textContent||'')
      .replace(/\s+/g,' ').trim();
    const qualityTitle=/(?:quality|画质|畫質|清晰度|解像度|品質)/i;
    const qualityOption=/(?:auto|自动|自動|automático|automatique|\d{3,4}p\b)/i;
    async function enterQualityMenu(){
      const p=getPlayer(),button=settingButton();
      if(!button||typeof button.click!=='function')
        throw Error('当前播放器没有可用的原生画质设置');
      if(!visible(settingMenu()))button.click();
      await pause(140);
      const menuItems=[...(p.querySelectorAll('.ytp-settings-menu .ytp-menuitem')||[])];
      const item=menuItems.find(el=>qualityTitle.test(menuLabel(el)));
      if(item){item.click();await pause(140);}
      if(!visible(settingMenu()))throw Error('YouTube 原生设置菜单没有打开');
      const choices=[...(p.querySelectorAll('.ytp-settings-menu .ytp-menuitem')||[])]
        .map(el=>({name:menuLabel(el),element:el}))
        .filter(x=>qualityOption.test(x.name)&&x.name.length<=90&&
          // Root "Quality Auto" is a submenu launcher, not a resolution.
          !qualityTitle.test(x.name));
      return {choices,submenu:!!item};
    }
    function closeQualityMenu(){
      if(visible(settingMenu()))settingButton()?.click?.();
    }

    // Undocumented page-world YouTube API; not the removed IFrame API.
    // Based on independent implementations (yt4k, yt-force-max, Leta).
    const QUALITY_HEIGHT={hd4320:4320,hd2880:2880,hd2160:2160,
      hd1440:1440,hd1080:1080,hd720:720,large:480,medium:360,
      small:240};
    function qualityCatalog(){
      const p=getPlayer();
      if(!p)return {choices:[],selected:'',enumerated:false,
        method:'none',reason:'播放器尚未加载'};
      let levels=[],data=[],selected='';
      try{levels=p.getAvailableQualityLevels?.()||[];}catch{}
      try{data=p.getAvailableQualityData?.()||[];}catch{}
      try{selected=String(p.getPlaybackQuality?.()||'');}catch{}
      if(!Array.isArray(levels))levels=[];
      if(!Array.isArray(data))data=[];
      const keys=[...new Set([...levels,...data.map(x=>x?.quality)]
        .filter(x=>typeof x==='string'&&Object.hasOwn(QUALITY_HEIGHT,x)))];
      keys.sort((x,y)=>QUALITY_HEIGHT[y]-QUALITY_HEIGHT[x]);
      const canSet=typeof p.setPlaybackQualityRange==='function';
      const choices=keys.map(value=>{
        const formats=data.filter(x=>x?.quality===value);
        const standard=formats.find(x=>!x?.paygatedQualityDetails);
        return {value,label:QUALITY_HEIGHT[value]+'p',
          formatId:standard?.formatId==null?null:String(standard.formatId),
          trial:false};
      });
      if(!choices.length&&canSet){
        // Explicitly labelled trials; no claim the video supports these.
        for(const value of ['hd1080','hd720','large'])
          choices.push({value,label:QUALITY_HEIGHT[value]+'p（尝试）',
            formatId:null,trial:true});
      }
      return {choices,selected,enumerated:keys.length>0,
        method:canSet?'internal-range':'native-menu',
        reason:keys.length?'':canSet?
          '没有公开画质列表，以下仅为尝试档位':
          '当前播放器没有开放内部画质接口'};
    }
    async function qualityOptions(){return qualityCatalog();}
    async function setQuality(name){
      if(typeof name!=='string'||!Object.hasOwn(QUALITY_HEIGHT,name))
        throw Error('无效的画质档位');
      const p=getPlayer(),catalog=qualityCatalog();
      if(!p)throw Error('播放器未就绪');
      const item=catalog.choices.find(x=>x.value===name);
      if(!item)throw Error('这个视频没有列出该档位，请刷新列表');
      if(typeof p.setPlaybackQualityRange!=='function')
        throw Error('内部画质 API 不可用，请尝试原生设置');
      try{
        if(item.formatId)p.setPlaybackQualityRange(name,name,item.formatId);
        else p.setPlaybackQualityRange(name,name);
      }catch(error){
        throw Error('播放器拒绝画质请求：'+String(error?.message||error));
      }
      // Never report success simply because an undocumented setter returned.
      let actual='',format='';
      for(let n=0;n<4;n++){
        await pause(350);
        try{actual=String(p.getPlaybackQuality?.()||'');}catch{}
        try{format=String(p.getVideoStats?.()?.fmt||'');}catch{}
        if(actual===name||(item.formatId&&format===item.formatId))break;
      }
      const confirmed=actual===name||!!(item.formatId&&format===item.formatId);
      return {requested:name,confirmed,reported:actual,
        actualResolution:snapshot().resolution,
        message:confirmed?'已切换 '+QUALITY_HEIGHT[name]+'p':
          '已请求 '+QUALITY_HEIGHT[name]+'p，但播放器尚未确认；可能被 YouTube 忽略'};
    }
    async function openQualityMenu(){
      const menu=await enterQualityMenu();
      return {opened:true,submenu:menu.submenu,
        message:menu.submenu?'已展开真实 YouTube 画质选项，请选择清晰度':
          '已打开 YouTube 设置，请选择画质 / Quality'};
    }
    return {snapshot,setRate,qualityOptions,setQuality,openQualityMenu,video,getPlayer};
  }


  // Restore the SAME measurement strategy previously used by Holodex's
  // iframe stats collector on a standalone YouTube watch/live page:
  // On touch-only devices, native diagnostics can be sampled silently for
  // the panel/HUD. Desktop reads existing fields only: other extensions own
  // the native Stats for nerds visibility. No inferred/download-test speeds.
  function youtubeWatchBandwidth(pageDoc,getPlayer,allowSilent=touchZonesAllowed){
    const CLASS='hmtc-yt-native-bandwidth-silent';
    const STYLE_ID='hmtc-yt-bandwidth-style';
    const monitor={player:null,forced:false,active:false,lastArm:0,
      lastSample:null};
    const playerInfoVisible=p=>{
      try{
        return typeof p?.isVideoInfoVisible==='function'?
          !!p.isVideoInfoVisible():null;
      }catch{return null;}
    };
    const css=enabled=>{
      if(enabled&&!pageDoc.getElementById(STYLE_ID)){
        const style=pageDoc.createElement('style');
        style.id=STYLE_ID;
        const nonce=pageDoc.querySelector('script[nonce],style[nonce]')?.nonce;
        if(nonce)style.nonce=nonce;
        style.textContent='html.'+CLASS+
          ' .html5-video-info-panel,html.'+CLASS+
          ' .ytp-stats-for-nerds{opacity:0!important;pointer-events:none!important;'+
          'transition:none!important}';
        (pageDoc.head||pageDoc.documentElement).appendChild(style);
      }
      pageDoc.documentElement.classList.toggle(CLASS,!!enabled);
    };
    function stop(){
      const original=monitor.player;
      if(monitor.forced&&original&&
         typeof original.hideVideoInfo==='function'){
        // We enabled the original stats panel; put it back the way it was.
        try{original.hideVideoInfo();}catch{}
      }
      css(false);
      monitor.player=null;monitor.active=false;
      monitor.forced=false;monitor.lastArm=0;monitor.lastSample=null;
    }
    function start(){
      if(!allowSilent()){
        // Desktop extensions (e.g. Tweaks for YouTube) toggle the same panel.
        // Never silently enable, re-arm or hide their diagnostic UI.
        if(monitor.forced)stop();
        else css(false);
        return {started:false,hidden:false,passive:true};
      }
      const p=getPlayer();
      if(monitor.player&&monitor.player!==p)stop();
      if(!p)return {started:false,reason:'播放器尚未就绪'};
      if(!monitor.active){
        monitor.player=p;
        monitor.active=true;
        monitor.forced=false;
      }
      // In mobile YouTube, isVideoInfoVisible() may be absent even when
      // native showVideoInfo() works and the original stats DOM exists.
      const apiVisibility=playerInfoVisible(p);
      const existing=pageDoc.querySelector(
        '.html5-video-info-panel-content, .html5-video-info-panel, .ytp-stats-for-nerds');
      const rect=existing?.getClientRects?.();
      const visible=apiVisibility===null?!!rect?.length:apiVisibility;
      if(!visible&&typeof p.showVideoInfo!=='function')
        return {started:false,reason:'播放器未开放原生统计显示接口'};
      if(!visible&&!monitor.forced){
        // The user may already have hidden their own native stats since the
        // custom panel opened. Only take ownership on the first activation.
        const now=Date.now();
        if(monitor.lastArm&&now-monitor.lastArm<2000)
          return {started:false,reason:'等待原生统计更新'};
        monitor.lastArm=now;
        css(true);
        try{
          p.showVideoInfo();
          monitor.forced=true;
        }catch(error){
          css(false);
          return {started:false,reason:String(error?.message||error)};
        }
      }else if(!visible&&monitor.forced){
        const now=Date.now();
        if(now-monitor.lastArm>=2000){
          monitor.lastArm=now;
          css(true);
          try{p.showVideoInfo();}catch{}
        }
      }
      return {started:visible||monitor.forced,hidden:monitor.forced};
    }
    const asNumber=value=>{
      if(typeof value==='number')return Number.isFinite(value)?value:null;
      if(typeof value!=='string')return null;
      const n=value.replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);
      return n?Number(n[0]):null;
    };
    function parse(raw){
      // YouTube's own Stats for nerds can return a plain-text report, a
      // JSON string, or an object. Some builds label speed "connection_speed"
      // or "bandwidth" rather than "bandwidth_kbps".
      let decoded=raw;
      if(typeof raw==='string'&&raw.trim().startsWith('{')){
        try{decoded=JSON.parse(raw);}catch{}
      }
      const normalize=(value,implicitKbps)=>{
        if(typeof value==='number')
          return implicitKbps&&Number.isFinite(value)&&value>0?value:null;
        if(typeof value!=='string')return null;
        const str=value.trim().replace(/,/g,'');
        const match=str.match(/(\d+(?:\.\d+)?)\s*(Gbps|Gbit\/s|Mbps|Mbit\/s|Kbps|Kbit\/s|kb\/s|mb\/s)\b/i);
        if(match){
          const n=Number(match[1]),unit=match[2].toLowerCase();
          return n*(unit.startsWith('g')?1000000:unit.startsWith('m')?1000:1);
        }
        if(implicitKbps&&/^\d+(?:\.\d+)?$/.test(str))return Number(str);
        return null;
      };
      const textSpeed=value=>{
        if(typeof value!=='string')return null;
        const match=value.match(
          /(?:Connection\s*Speed|连接速度|連線速度|接続速度|连接速率)\s*[:：]?\s*([\d,.]+)\s*(Gbps|Gbit\/s|Mbps|Mbit\/s|Kbps|Kbit\/s|kb\/s|mb\/s)\b/i);
        if(match)return normalize(match[1]+' '+match[2],false);
        // Official native stats sometimes omit the unit suffix on a
        // connection-speed line; only this named diagnostic field is Kbps.
        const unitless=value.match(
          /(?:Connection\s*Speed|连接速度|連線速度|接続速度)\s*[:：]?\s*([\d,.]+)(?![.\d])/i);
        return unitless?normalize(unitless[1],true):null;
      };
      let speed=textSpeed(typeof raw==='string'?raw:'');
      let source=speed!=null?'native-text':'';
      const queue=[decoded],seen=new Set();
      let checked=0;
      while(queue.length&&checked<40&&speed==null){
        const obj=queue.shift();
        if(!obj||typeof obj!=='object'||seen.has(obj))continue;
        checked++;seen.add(obj);
        for(const [key,value] of Object.entries(obj).slice(0,90)){
          const plain=key.replace(/[^a-z]/gi,'').toLowerCase();
          const named=/^(?:bandwidthkbps|connectionspeedkbps|connectionspeedinkbps|connectionspeed|bandwidth)$/.test(plain);
          if(named){
            const candidate=normalize(value,true);
            if(candidate!=null&&candidate>0){speed=candidate;source=key;break;}
          }
          if(typeof value==='string'&&
             /(?:Connection\s*Speed|连接速度|連線速度|接続速度)/i.test(value)){
            const candidate=textSpeed(value);
            if(candidate!=null&&candidate>0){
              speed=candidate;source='stats-text';break;
            }
          }
          if(value&&typeof value==='object'&&queue.length<70)
            queue.push(value);
        }
      }
      return {bandwidthKbps:speed!=null&&Number.isFinite(speed)&&speed>0?
        speed:null,source};
    }
    function read(){
      const p=getPlayer();
      if(!p)return {available:false,bandwidthKbps:null,reason:'播放器尚未就绪'};
      if(monitor.player&&monitor.player!==p)stop();
      let bandwidthKbps=null,source='';
      for(const [method,args] of [
        ['getStatsForNerdsData',[]],
        ['getStatsForNerds',[]],
        ['getStatsForNerds',[0]],
        ['getDebugText',[]]
      ]){
        if(typeof p[method]!=='function')continue;
        try{
          const raw=p[method](...args),sample=parse(raw);
          if(sample.bandwidthKbps!=null){
            bandwidthKbps=sample.bandwidthKbps;
            source=method;break;
          }
        }catch{}
      }
      // Mobile YouTube often has no isVideoInfoVisible() API. Use real
      // native diagnostic DOM while our monitoring session is active,
      // or while the user is visibly showing YouTube's own statistics.
      const panelEls=[...(pageDoc.querySelectorAll?.(
        '.html5-video-info-panel-content, .html5-video-info-panel,'+
        ' .ytp-stats-for-nerds, [class*="video-info-panel"]')||[])];
      const nativeVisible=panelEls.some(el=>{
        const style=pageDoc.defaultView?.getComputedStyle?.(el);
        return !!el.getClientRects?.().length &&
          style?.display!=='none'&&style?.visibility!=='hidden';
      });
      if(monitor.active||playerInfoVisible(p)===true||nativeVisible){
        for(const panel of panelEls){
          const result=parse(panel.textContent||'');
          if(result.bandwidthKbps!=null){
            bandwidthKbps=result.bandwidthKbps;
            source='native-panel-dom';break;
          }
        }
      }
      // Brief outages in native stats should not blank a value which was
      // just sampled. Preserve the last VERIFIED reading for <= 6 seconds,
      // clearly mark it as historical, and never reuse it for another video.
      let videoId=null;
      try{videoId=p.getVideoData?.()?.video_id||null;}catch{}
      const now=Date.now();
      if(bandwidthKbps!=null){
        monitor.lastSample={bandwidthKbps,source,at:now,player:p,videoId};
      }else if(monitor.lastSample){
        const old=monitor.lastSample;
        const sameVideo=old.player===p&&
          (old.videoId===videoId||!old.videoId&&!videoId);
        const age=now-old.at;
        if(sameVideo&&age>=0&&age<=6000){
          bandwidthKbps=old.bandwidthKbps;source=old.source;
          return {available:true,bandwidthKbps,source,
            monitoring:monitor.active,hidden:monitor.forced,
            stale:true,sampleAgeSeconds:Math.max(0,age/1000),
            sampledAt:old.at};
        }
        monitor.lastSample=null;
      }
      return {available:bandwidthKbps!=null,bandwidthKbps,source,
        monitoring:monitor.active,hidden:monitor.forced,stale:false,
        reason:bandwidthKbps==null?
          'YouTube 当前尚未提供实时 Connection Speed 数值':'',
        sampledAt:now};
    }
    function diagnose(){
      const p=getPlayer();
      const methods=['getStatsForNerds','getStatsForNerdsData',
        'getDebugText','showVideoInfo','isVideoInfoVisible']
        .filter(name=>typeof p?.[name]==='function');
      const panels=[...(pageDoc.querySelectorAll?.(
        '.html5-video-info-panel, .html5-video-info-panel-content,'+
        ' .ytp-stats-for-nerds')||[])];
      return {
        playerReady:!!p,
        methods,
        nativePanelFound:panels.length>0,
        visibility:playerInfoVisible(p),
        monitoring:monitor.active,
        ...read()
      };
    }
    return {start,stop,read,diagnose};
  }

  // HTMLMediaElement.duration is often a rolling DVR-window length for
  // YouTube LIVE (e.g. precisely 1:00:00), NOT the stream's total duration.
  // Prefer YouTube's explicit live flags and visible live-badge state.
  function readFrameClock(pageDoc,getPlayer,getVideo,mainPage,expectedVideoId,statusHint){
    const p=getPlayer();
    if(!p)return {ready:false,live:null};
    const safe=(fn)=>{try{return fn();}catch{return null;}};
    const actualId=safe(()=>p.getVideoData?.()?.video_id);
    if(expectedVideoId&&actualId&&actualId!==expectedVideoId)return {ready:false,live:null};
    const v=getVideo();
    const number=value=>value==null||typeof value==='string'&&!value.trim()||typeof value==='boolean'?null:
      Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
    const state=resolvePlaybackState(youtubeWatchLiveState(pageDoc,getPlayer,getVideo,mainPage),statusHint);
    let position=number(v?.currentTime);
    if(position==null||v?.readyState===0)position=number(safe(()=>p.getCurrentTime?.()))??position;
    let duration=number(v?.duration),durationSource=duration>0?'media':'';
    if(!(duration>0)){duration=number(safe(()=>p.getDuration?.()));if(duration>0)durationSource='player-api';}
    if(!(duration>0)&&state.durationSeconds>0){duration=state.durationSeconds;durationSource='video-details';}
    return {ready:!!v&&v.readyState>=1||position!=null&&(duration>0||state.live===true),
      position,duration:duration>0?duration:null,live:state.live,liveReason:state.reason,durationSource};
  }
  function resolvePlaybackState(state,statusHint){
    if(state?.live===true||state?.live===false)return {...state,reason:state.reason||state.liveReason||
      (statusHint==='past'?'holodex-past':statusHint==='live'?'holodex-live':'reported-live-state')};
    if(statusHint==='past')return {...state,live:false,reason:'holodex-past'};
    if(statusHint==='live')return {...state,live:true,reason:'holodex-live'};
    return {...state,live:null,reason:state?.reason||'unknown'};
  }
  function playbackKindLabel(value){
    return value?.live===true?'直播':value?.live===false?'录像':'待确认';
  }
  function renderMediaKind(panel,state){
    const badge=panel?.querySelector('[data-hmtc-media-kind]');
    if(!badge)return;
    badge.textContent=playbackKindLabel(state);
    badge.dataset.kind=state?.live===true?'live':state?.live===false?'vod':'unknown';
    const compact=!!panel._hmtcCompact;
    badge.hidden=compact&&state?.live==null;
    const metric=panel.querySelector('[data-hmtc-latency-metric]');
    if(metric){
      metric.hidden=state?.live===false;
      metric.dataset.kind=badge.dataset.kind;
    }
    const label=panel.querySelector('[data-hmtc-latency-label]');
    if(label)label.textContent=state?.live===true?(compact?'延迟':'直播延迟'):(compact?'状态':'视频状态');
    const timeLabel=panel.querySelector('[data-hmtc-time-label]');
    if(timeLabel)timeLabel.textContent=state?.live===false?(compact?'录像时间':'录像 · 播放时间'):'播放时间';
    if(state?.live!==true)renderLatency(panel,null);
    else if(compact)syncDesktopMetrics(panel);
  }
  function renderLatency(panel,data){
    const metric=panel?.querySelector('[data-hmtc-latency-metric]');
    const value=panel?.querySelector('[data-hmtc-latency-value]');
    if(!metric||!value)return;
    const available=metric.dataset.kind==='live'&&Number.isFinite(data?.liveLatencySeconds)&&data.liveLatencySeconds>=0;
    value.textContent=metric.dataset.kind!=='live'?(panel._hmtcCompact?'待确认':'识别中'):
      available?data.liveLatencySeconds.toFixed(2)+' s':panel._hmtcCompact?'未提供':'暂未提供';
    metric.dataset.state=available?'available':'pending';
    value.title=available?'YouTube 原生返回值；0.00 s 表示原接口报告为零':data?.latencyReason||'等待播放器提供有效延迟';
    if(panel._hmtcCompact)syncDesktopMetrics(panel);
  }
  function readPlayerLatency(player){
    for(const [method,args] of [['getLiveLatency',[]],['getStatsForNerdsData',[]],
      ['getStatsForNerds',[]],['getStatsForNerds',[0]],['getDebugText',[]],['getVideoStats',[]]]){
      try{
        if(typeof player?.[method]!=='function')continue;
        const raw=player[method](...args);
        const seconds=nativeLatencySeconds(method==='getLiveLatency'?{liveLatencySeconds:raw}:raw);
        if(seconds!=null)return {liveLatencySeconds:seconds};
      }catch{}
    }
    return {liveLatencySeconds:null,latencyReason:'播放器暂未提供有效延迟'};
  }
  function youtubeWatchLiveState(pageDoc,getPlayer,getVideo,mainPage){
    const player=getPlayer();
    if(!player)return {live:null,reason:'no-player'};
    const safe=(fn,fallback=null)=>{try{return fn()??fallback;}catch{return fallback;}};
    const data=safe(()=>player.getVideoData?.(),{})||{};
    const playerId=data.video_id||data.videoId||'';
    let response=safe(()=>player.getPlayerResponse?.());
    if(response?.videoDetails?.videoId&&playerId&&response.videoDetails.videoId!==playerId)response=null;
    if(!response){
      const candidate=mainPage?.ytInitialPlayerResponse;
      if(playerId&&candidate?.videoDetails?.videoId===playerId)response=candidate;
    }
    const details=response?.videoDetails||{};
    const liveInfo=response?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails;
    const durationSeconds=Number.isFinite(Number(details.lengthSeconds))&&Number(details.lengthSeconds)>0?Number(details.lengthSeconds):null;
    const state=(live,reason)=>({live,reason,durationSeconds});
    if(liveInfo?.isLiveNow===false||liveInfo?.endTimestamp)return state(false,'past-broadcast');
    if(liveInfo?.isLiveNow===true)return state(true,'broadcast-details');
    if(data.isLive===true||details.isLive===true)return state(true,'player-live');
    if(data.isLive===false||details.isLive===false)return state(false,'player-not-live');
    const apiLive=safe(()=>player.isLive?.());
    if(typeof apiLive==='boolean')return state(apiLive,'player-is-live');
    if(player.classList?.contains?.('ytp-live')||player.classList?.contains?.('ytp-live-streaming'))
      return state(true,'player-live-class');
    // Only inspect this player's own badge. A recommended live video elsewhere
    // on the page says nothing about the video currently being watched.
    for(const selector of ['.ytp-live-badge','.ytm-live-badge','.ytp-live']){
      const node=player.querySelector?.(selector);
      const rect=safe(()=>node?.getBoundingClientRect?.());
      const style=safe(()=>mainPage?.getComputedStyle?.(node));
      if(rect?.width>0&&rect.height>0&&style?.display!=='none'&&style?.visibility!=='hidden')
        return state(true,'visible-player-live-badge');
    }
    const video=getVideo();
    if(video?.readyState>=1&&video.duration===Infinity)return state(true,'infinite-media');
    if(data.isLiveContent===false||details.isLiveContent===false)return state(false,'vod-details');
    // isLiveContent is historical: archived live streams retain this flag.
    // Never use it alone as evidence of a broadcast happening now.
    return state(null,data.isLiveContent===true||details.isLiveContent===true?'historic-live-flag-only':'unknown');
  }

  // YouTube's own watch/live/shorts interface: no Holodex Vue bridge and no
  // persistent floating icon. Invisible edges exist only on touch devices.
  function youtubeWatchControls(){
    const page=typeof unsafeWindow!=='undefined'?unsafeWindow:window;
    const supported=()=>/^\/(?:watch(?:\/|$)|live\/|shorts\/)/.test(location.pathname);
    const p=()=>{
      const primary=page.document.querySelector('#movie_player.html5-video-player');
      if(!/\/shorts\//.test(location.pathname)&&primary)return primary;
      const candidates=[...page.document.querySelectorAll('.html5-video-player')];
      if(!candidates.length)return primary||null;
      const inViewport=el=>{
        const r=el.getBoundingClientRect?.();
        const h=page.innerHeight||innerHeight,w=page.innerWidth||innerWidth;
        return !!r&&r.width>60&&r.height>60&&
          r.top<h*.92&&r.bottom>h*.08&&r.left<w*.95&&r.right>w*.05;
      };
      const visible=candidates.filter(inViewport);
      return visible.find(el=>{
        try{return el.getPlayerState?.()===1;}catch{return false;}
      })||visible[0]||primary||null;
    };
    const controls=youtubePlaybackTools(page.document,p);
    const bandwidth=youtubeWatchBandwidth(page.document,p);
    const watchLive=()=>youtubeWatchLiveState(page.document,p,
      controls.video,page);
    const enabledKey='hmtc_youtube_edges_v1';
    const setting=(key,def)=>GM_getValue(key,def);
    const mode=()=>setting('hmtc_stats_trigger_v1','tap');
    const sense=()=>Math.max(.4,Math.min(2.5,Number(setting('hmtc_volume_sensitivity_v1',1))||1));
    const video=()=>controls.video();
    let sheet=null,backdrop=null,left=null,right=null,root=null,toast=null,toastTimeout=null;
    const muted=()=>{
      try{if(typeof p()?.isMuted==='function')return !!p().isMuted();}catch{}
      return !!video()?.muted;
    };
    const vol=()=>{
      let n=Number.NaN;
      try{n=Number(p()?.getVolume?.());}catch{}
      if(!Number.isFinite(n))n=(Number(video()?.volume)||0)*100;
      return Math.max(0,Math.min(100,Math.round(n)));
    };
    function volume(n){
      const value=Math.max(0,Math.min(100,Math.round(Number(n)||0)));
      const player=p(),v=video();
      if(typeof player?.setVolume==='function')player.setVolume(value);
      else if(v)v.volume=value/100;
      if(value>0){if(typeof player?.unMute==='function')player.unMute();else if(v)v.muted=false;}
      if(value===0){if(typeof player?.mute==='function')player.mute();else if(v)v.muted=true;}
      return value;
    }
    function toggleMute(){
      const player=p(),v=video();
      if(muted()){if(typeof player?.unMute==='function')player.unMute();else if(v)v.muted=false;}
      else if(typeof player?.mute==='function')player.mute();else if(v)v.muted=true;
    }
    GM_addStyle([
      '.hmtc-yt-edge{position:fixed!important;z-index:2147481600!important;',
      'background:transparent!important;pointer-events:auto!important;',
      'box-sizing:border-box!important;-webkit-tap-highlight-color:transparent!important}',
      '.hmtc-yt-left{touch-action:pan-y!important}',
      '.hmtc-yt-right{touch-action:none!important}',
      'html.hmtc-yt-quality-mode .hmtc-yt-edge{pointer-events:none!important}',
      'html.hmtc-yt-debug .hmtc-yt-left{background:#328bff33!important;outline:1px dashed #82c5ff}',
      'html.hmtc-yt-debug .hmtc-yt-right{background:#40cfa533!important;outline:1px dashed #82f5da}',
      '#hmtc-yt-backdrop{position:fixed;inset:0;z-index:2147482990;background:transparent}',
      '#hmtc-yt-backdrop[hidden],#hmtc-yt-panel[hidden],#hmtc-yt-toast[hidden]{display:none!important}',
      '#hmtc-yt-panel{position:fixed;bottom:calc(8px + env(safe-area-inset-bottom,0px));',
      'left:8px;right:8px;z-index:2147482991;max-width:460px;max-height:88vh;margin:0 auto;',
      'overflow:auto;padding:12px;border-radius:17px;background:linear-gradient(135deg,#20334b,#131b2a);',
      'border:1px solid #83ced43d;box-shadow:0 18px 58px #000b;color:#f3f9ff;',
      'font:14px/1.5 system-ui,-apple-system,sans-serif;box-sizing:border-box;',
      'touch-action:pan-y;overscroll-behavior:contain}',
      '#hmtc-yt-panel *{box-sizing:border-box}',
      '#hmtc-yt-panel button,#hmtc-yt-panel select{border:1px solid #ffffff35;',
      'border-radius:10px;min-height:42px;padding:7px 9px;background:#36495e;',
      'color:#f2f9ff;font:650 13px system-ui;touch-action:manipulation}',
      '#hmtc-yt-panel .head{display:flex;gap:10px;align-items:center}',
      '#hmtc-yt-panel .head strong{flex:1;min-width:0;white-space:nowrap;',
      'overflow:hidden;text-overflow:ellipsis;font-size:16px}',
      '#hmtc-yt-panel .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0}',
      '#hmtc-yt-panel .metric{padding:8px;border-radius:11px;background:#ffffff0b;min-width:0}',
      '#hmtc-yt-panel .metric label{display:block;font-size:11px;color:#afc2d1}',
      '#hmtc-yt-panel .metric b{font-size:15px;overflow-wrap:anywhere}',
      '#hmtc-yt-panel .hmtc-yt-time-metric b{font-size:clamp(15px,3.9vw,21px);',
      'font-variant-numeric:tabular-nums;line-height:1.35;color:#fcffff}',
      '#hmtc-yt-panel .row{display:flex;gap:7px;align-items:center;margin-top:8px}',
      '#hmtc-yt-panel .row label{min-width:45px;font-weight:700}',
      '#hmtc-yt-panel .row select,#hmtc-yt-panel .row input{flex:1;min-width:0}',
      '#hmtc-yt-panel .hmtc-yt-qualities{display:grid;',
      'grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;margin:6px 0 8px}',
      '#hmtc-yt-panel .hmtc-yt-qualities button{min-width:0;min-height:44px;',
      'padding:6px 1px;white-space:nowrap;font-size:clamp(10px,2.6vw,12px)}',
      '#hmtc-yt-panel .hmtc-yt-qualities button.hmtc-yt-quality-active{',
      'background:#12766c!important;border-color:#78ead5!important;color:#fff!important}',
      '#hmtc-yt-panel .hmtc-yt-rates{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));',
      'gap:5px;margin:6px 0 8px}',
      '#hmtc-yt-panel .hmtc-yt-rates button{min-width:0;min-height:44px;',
      'padding:6px 1px;white-space:nowrap;font-size:clamp(10px,2.6vw,12px)}',
      '#hmtc-yt-panel .hmtc-yt-rates button.hmtc-yt-rate-active{',
      'background:#12766c!important;border-color:#78ead5!important;color:white!important}',
      '#hmtc-yt-panel .row input{height:36px;accent-color:#66dad1;touch-action:pan-x}',
      '#hmtc-yt-panel .hmtc-yt-quality-tip{font-size:11px;line-height:1.35;',
      'margin:4px 0 0;color:#b8d5df;overflow-wrap:anywhere}',
      '#hmtc-yt-panel .hmtc-yt-quality-tip[hidden]{display:none!important}',
      '#hmtc-yt-panel .actions{display:flex;gap:6px;margin:7px 0}',
      '#hmtc-yt-panel .actions button{flex:1}',
      '#hmtc-yt-panel .hint{font-size:11px;color:#bdd0db;margin-top:6px}',
      '#hmtc-yt-panel .hint[hidden]{display:none!important}',
      '#hmtc-yt-panel details{margin-top:8px;border-top:1px solid #ffffff20;padding-top:7px}',
      '#hmtc-yt-panel details summary{cursor:pointer;font-size:12px;font-weight:650;color:#b9dfdf}',
      '#hmtc-yt-panel details .row input{accent-color:#66dad1}',
      '#hmtc-yt-toast{position:fixed;z-index:2147482992;pointer-events:none;',
      'transform:translate(-50%,-50%);background:#1a2c41f5;border-radius:12px;',
      'padding:11px 15px;color:#eff;font:800 22px system-ui}',
      '#hmtc-yt-panel{max-height:calc(100vh - 16px);cursor:auto}'
    ].join(''));
    let hintHideTimer=null;
    const text=(key,value)=>{const el=sheet?.querySelector('[data-id="'+key+'"]');
      if(!el)return;
      el.textContent=String(value);
      if(key==='hint'){
        el.hidden=!value;
        clearTimeout(hintHideTimer);
        if(value)hintHideTimer=setTimeout(()=>{if(el.isConnected)el.hidden=true;},3200);
      }
    };
    const clock=n=>{
      if(!Number.isFinite(n)||n<0)return '—';
      const a=Math.floor(n);return Math.floor(a/3600)+':'+
        String(Math.floor(a%3600/60)).padStart(2,'0')+':'+
        String(a%60).padStart(2,'0');
    };

    // Same live/DVR-aware clock feeds both the detailed sheet and compact HUD.
    function readWatchClock(){
      let id=null;try{id=p()?.getVideoData?.()?.video_id;}catch{}
      const data=readFrameClock(page.document,p,video,page,id);
      return {time:playbackTimeText(data),state:data};
    }
    let watchHud=null;
    function refreshWatchHud(player){
      if(!player){
        clearTimeout(watchHud?._hmtcHudTimer);
        watchHud?.remove();watchHud=null;
        if(!sheet||sheet.hidden)bandwidth.stop();
        return;
      }
      const layer=document.fullscreenElement||document.body;
      if(!watchHud?.isConnected)watchHud=createCornerHud();
      if(watchHud.parentNode!==layer)layer.appendChild(watchHud);
      const rect=player.getBoundingClientRect();
      const visible=rect.width>75&&rect.height>55&&rect.bottom>0&&
        rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth;
      watchHud.hidden=!visible;
      if(!visible){
        if(!sheet||sheet.hidden)bandwidth.stop();
        return;
      }
      watchHud.style.left=Math.max(0,rect.left+2)+'px';
      watchHud.style.top=Math.max(0,rect.top+2)+'px';
      watchHud.style.maxWidth=Math.max(1,Math.min(240,rect.width-4,innerWidth-Math.max(0,rect.left+2)-2))+'px';
      const time=hudWantsTime()?readWatchClock().time:'—';
      let speed='—';
      if(hudWantsSpeed()){
        bandwidth.start();
        const net=bandwidth.read();
        if(net.available)
          speed=hudSpeedReading(net.bandwidthKbps,net.stale,net.sampledAt);
      }else if(!sheet||sheet.hidden)bandwidth.stop();
      displayCornerHud(watchHud,time,speed);
    }
    function refreshSheet(){
      if(!sheet||sheet.hidden)return;
      const v=video(),snapshot=controls.snapshot();
      text('title',(document.querySelector('h1.ytd-watch-metadata')?.textContent||
        document.querySelector('h1.title')?.textContent||document.title||'YouTube')
        .replace(/\s*-\s*YouTube\s*$/,'').trim().slice(0,120));
      text('resolution',snapshot.resolution);
      const currentClock=readWatchClock();
      text('timeLabel','播放时间');
      renderMediaKind(sheet,currentClock.state);
      if(currentClock.state.live===true)renderLatency(sheet,readPlayerLatency(p()));
      text('time',currentClock.time);
      text('vol',vol()+'%');text('mute',muted()?'🔇':'🔊');
      const vslider=sheet.querySelector('[data-id="slider"]');
      if(vslider&&document.activeElement!==vslider)vslider.value=String(vol());
      for(const btn of sheet.querySelectorAll('[data-action="ratePreset"]')){
        const active=Math.abs(Number(btn.dataset.rate)-snapshot.rate)<.001;
        btn.classList.toggle('hmtc-yt-rate-active',active);
        btn.setAttribute('aria-pressed',active?'true':'false');
      }
      // Reuse the proven Holodex native collector strategy. The old watch
      // view read only a few object keys and never enabled the underlying
      // Stats-for-nerds engine, so speed stayed "—" while time/buffer worked.
      const net=bandwidth.read();
      text('speed',net.available?
        (net.bandwidthKbps/1000).toFixed(2)+' Mbps'+
        (net.stale?' · 上次':''):'—');
      const speedValue=sheet.querySelector('[data-id="speed"]');
      if(speedValue)speedValue.title=net.available?
        (net.stale?'最近一次真实连接速度（非实时）':'实时连接速度')+
        ' · YouTube '+net.source:net.reason;
      let buffer=NaN;
      try{
        const time=Number(v.currentTime),ranges=v.buffered;
        for(let i=0;i<ranges.length;i++)
          if(ranges.start(i)<=time&&time<=ranges.end(i))
            buffer=Math.max(0,ranges.end(i)-time);
      }catch{}
      text('buffer',Number.isFinite(buffer)?buffer.toFixed(1)+' s':'—');
      if(sheet._hmtcCompact)syncDesktopMetrics(sheet);
    }
    // Mobile YouTube builds a different control tree from desktop
    // .ytp-settings-button; some variants put the gear outside #movie_player.
    // Only click a control spatially overlapping the current video, never the
    // site's account/settings button. No deprecated quality APIs.
    async function openYoutubeNativeQuality(){
      const d=page.document,player=p();
      if(!player)throw Error('当前视频播放器未就绪');
      const selector=[
        '.ytp-settings-button','.ytm-player-settings-button',
        'button[aria-label="Settings"]','button[aria-label="设置"]',
        'button[aria-label*="Player settings"]',
        'button[aria-label*="播放设置"]',
        'button[aria-label*="画质"]','button[aria-label*="Quality"]',
        '[role="button"][aria-label*="Settings"]',
        '[role="button"][aria-label*="设置"]'
      ].join(',');
      const bounds=player.getBoundingClientRect();
      const isVisible=el=>{
        const r=el?.getBoundingClientRect?.();
        if(!r||r.width<=0||r.height<=0)return false;
        const css=page.getComputedStyle?.(el);
        if(css?.visibility==='hidden'||css?.display==='none')return false;
        // The gear should overlap (or be immediately adjacent to) the
        // playing video, never a site-wide account preference control.
        const midX=r.left+r.width/2,midY=r.top+r.height/2;
        return midX>=bounds.left-45&&midX<=bounds.right+45&&
          midY>=bounds.top-45&&midY<=bounds.bottom+45;
      };
      const findGear=()=>{
        const scopes=[player,player.parentElement,
          player.closest?.('ytm-player'),
          player.closest?.('#player-container'),
          player.closest?.('#player'),
          d.querySelector?.('ytm-player'),
          d.querySelector?.('#player-container')].filter(Boolean);
        const visited=new Set();
        for(const scope of scopes){
          if(visited.has(scope))continue;visited.add(scope);
          for(const el of scope.querySelectorAll?.(selector)||[]){
            if(isVisible(el))return el;
          }
        }
        return null;
      };
      let gear=findGear();
      if(!gear){
        // Do not synthesize a tap (which may pause playback). Desktop-style
        // controls can appear on a harmless mousemove over the player.
        try{
          const Mouse=page.MouseEvent||MouseEvent;
          player.dispatchEvent(new Mouse('mousemove',{bubbles:true}));
        }catch{}
        await new Promise(resolve=>setTimeout(resolve,160));
        gear=findGear();
      }
      if(!gear)throw Error('未发现当前视频的播放器设置按钮');
      document.documentElement.classList.add('hmtc-yt-quality-mode');
      close();
      try{
        gear.click();
        await new Promise(resolve=>setTimeout(resolve,160));
        // Desktop YouTube offers a Quality submenu. Mobile layouts may use
        // a bottom sheet outside the player, whose item names are localized.
        const itemSelector=[
          '.ytp-settings-menu .ytp-menuitem',
          'ytm-bottom-sheet-renderer [role="button"]',
          'ytm-bottom-sheet-renderer button',
          'ytm-menu-item','[role="dialog"] [role="menuitem"]',
          '.bottom-sheet-container [role="button"]'
        ].join(',');
        const qualityTitle=/(?:^|[\s·:])(?:quality|画质|畫質|清晰度|品質|解像度)(?:$|\b|[\s·:])/i;
        for(const el of d.querySelectorAll(itemSelector)){
          const raw=String(el.getAttribute?.('aria-label')||el.textContent||'')
            .replace(/\s+/g,' ').trim();
          if(raw.length>75||!qualityTitle.test(raw)||!isVisible(el))continue;
          el.click();
          break;
        }
        setTimeout(()=>document.documentElement.classList.remove(
          'hmtc-yt-quality-mode'),15000);
        return {opened:true,message:'已点击 YouTube 原生设置，请在菜单中选择画质'};
      }catch(error){
        document.documentElement.classList.remove('hmtc-yt-quality-mode');
        throw error;
      }
    }

    function close(){
      if(!hudWantsSpeed())bandwidth.stop();
      if(sheet)sheet.hidden=true;
      if(backdrop)backdrop.hidden=true;
    }



    let qualitySwitching=false;
    let qualityFeedbackTimer=null;
    let qualityChosen='';
    function showQualityFeedback(message,hold=false){
      const el=sheet?.querySelector('[data-id="qualityTip"]');
      if(!el)return;
      clearTimeout(qualityFeedbackTimer);
      el.textContent=message||'';
      el.hidden=!message;
      if(message&&!hold)qualityFeedbackTimer=setTimeout(()=>{
        if(el.isConnected)el.hidden=true;
      },2600);
    }
    function highlightQuality(value){
      for(const button of sheet?.querySelectorAll('[data-action="qualityPreset"]')||[]){
        const active=!!value&&button.dataset.quality===value;
        button.classList.toggle('hmtc-yt-quality-active',active);
        button.setAttribute('aria-pressed',active?'true':'false');
      }
    }
    async function refreshQualityChoices(){
      const grid=sheet?.querySelector('.hmtc-yt-qualities');
      if(!grid||qualitySwitching)return;
      grid.replaceChildren();
      try{
        const catalog=await controls.qualityOptions();
        if(!grid.isConnected)return;
        const available=catalog.choices.filter(x=>x.value!=='tiny');
        if(!available.length||catalog.method!=='internal-range'){
          const empty=document.createElement('span');
          empty.textContent='暂不可选';
          grid.appendChild(empty);
          showQualityFeedback(catalog.reason||'画质接口不可用',true);
          return;
        }
        for(const choice of available){
          const button=document.createElement('button');
          button.type='button';
          button.dataset.action='qualityPreset';
          button.dataset.quality=choice.value;
          button.textContent=choice.label;
          button.setAttribute('aria-pressed','false');
          grid.appendChild(button);
        }
        // Only highlight a confirmed player level, not a guessed preference.
        qualityChosen=catalog.selected;
        highlightQuality(qualityChosen);
        showQualityFeedback('',false);
      }catch(error){
        showQualityFeedback('画质读取失败：'+error.message,true);
      }
    }
    async function applyQualitySelection(requested){
      if(qualitySwitching||!requested)return;
      const grid=sheet?.querySelector('.hmtc-yt-qualities');
      const button=[...(grid?.querySelectorAll('[data-action="qualityPreset"]')||[])]
        .find(el=>el.dataset.quality===requested);
      if(!button||button.disabled)return;
      qualitySwitching=true;
      for(const el of grid.querySelectorAll('button'))el.disabled=true;
      showQualityFeedback('',false);
      try{
        const result=await controls.setQuality(requested);
        if(result.confirmed){
          qualityChosen=requested;
          highlightQuality(qualityChosen);
          // Successful selection should not expand the compact layout.
        }else{
          if(result.reported)qualityChosen=result.reported;
          highlightQuality(qualityChosen);
          showQualityFeedback('未确认 '+button.textContent,true);
        }
        refreshSheet();setTimeout(refreshSheet,700);
      }catch(error){
        showQualityFeedback('画质失败：'+error.message,true);
      }finally{
        qualitySwitching=false;
        for(const el of grid.querySelectorAll('button'))el.disabled=false;
      }
    }
    function makePanel(){
      if(sheet?.isConnected)return;
      backdrop=document.createElement('div');backdrop.id='hmtc-yt-backdrop';
      backdrop.hidden=true;backdrop.addEventListener('click',close);
      document.body.appendChild(backdrop);
      sheet=document.createElement('section');sheet.id='hmtc-yt-panel';
      bindPanelRightClose(sheet,close);
      sheet.hidden=true;sheet.setAttribute('role','dialog');
      sheet.setAttribute('aria-label','YouTube 视频音量、倍速、画质和统计');
      sheet.innerHTML=[
        '<div class="head"><strong data-id="title">YouTube</strong>',
        '<button data-action="close" aria-label="关闭面板">✕</button></div>',
        '<div class="hmtc-live-status" data-hmtc-latency-metric data-kind="unknown">',
        '<span class="hmtc-media-kind" data-hmtc-media-kind>待确认</span>',
        '<span data-hmtc-latency-label>视频状态</span><strong data-hmtc-latency-value>识别中</strong></div>',
        '<div class="grid">',
        '<div class="metric hmtc-yt-time-metric"><label data-id="timeLabel" data-hmtc-time-label>播放时间</label>',
        '<b data-id="time" aria-live="off">—</b></div>',
        '<div class="metric"><label>分辨率</label><b data-id="resolution">—</b></div>',
        '<div class="metric"><label>连接速度</label><b data-id="speed">—</b></div>',
        '<div class="metric"><label>缓冲</label><b data-id="buffer">—</b></div></div>',
        '<div class="row"><label>播放速度</label></div>',
        '<div class="hmtc-yt-rates" role="group" aria-label="常用播放倍速">',
        '<button type="button" data-action="ratePreset" data-rate="1">1×</button>',
        '<button type="button" data-action="ratePreset" data-rate="1.25">1.25×</button>',
        '<button type="button" data-action="ratePreset" data-rate="1.5">1.5×</button>',
        '<button type="button" data-action="ratePreset" data-rate="1.75">1.75×</button>',
        '<button type="button" data-action="ratePreset" data-rate="2">2×</button></div>',
        '<div class="row"><label>画质</label></div>',
        '<div class="hmtc-yt-qualities" role="group" aria-label="画质快捷档位"></div>',
        '<div class="hmtc-yt-quality-tip" data-id="qualityTip"',
        ' role="status" aria-live="polite" hidden></div>',
        '<div class="row"><button data-action="mute" data-id="mute">🔊</button>',
        '<input type="range" data-id="slider" min="0" max="100" step="1">',
        '<strong data-id="vol">—</strong></div>',
        '<div class="actions"><button data-action="minus">−10</button>',
        '<button data-action="plus">＋10</button><button data-action="full">100%</button></div>',
        '<div class="hint" data-id="hint" hidden></div>',
        '<details class="hmtc-yt-preferences"><summary>⚙ 手势设置</summary>',
        '<div class="row"><label>统计</label><select data-id="mode">',
        '<option value="tap">左侧轻点打开</option>',
        '<option value="hold">长按 600ms 打开</option>',
        '<option value="both">轻点或长按</option></select></div>',
        '<div class="row"><label>灵敏度</label>',
        '<input type="range" data-id="sense" min="0.4" max="2.5" step="0.1">',
        '<strong data-id="senseText">1.0×</strong></div>',
        '</details>'
      ].join('');
      document.body.appendChild(sheet);
      const modeSelect=sheet.querySelector('[data-id="mode"]');
      modeSelect.value=['tap','hold','both'].includes(mode())?mode():'tap';
      modeSelect.addEventListener('change',event=>{
        if(['tap','hold','both'].includes(event.target.value))
          GM_setValue('hmtc_stats_trigger_v1',event.target.value);
      });
      const senseInput=sheet.querySelector('[data-id="sense"]');
      senseInput.value=String(sense());
      text('senseText',sense().toFixed(1)+'×');
      senseInput.addEventListener('input',event=>{
        const n=Math.max(.4,Math.min(2.5,Number(event.target.value)||1));
        GM_setValue('hmtc_volume_sensitivity_v1',Math.round(n*10)/10);
        text('senseText',n.toFixed(1)+'×');
      });
      sheet.querySelector('[data-id="slider"]').addEventListener('input',e=>{
        try{volume(e.target.value);refreshSheet();}catch(error){text('hint',error.message);}
      });
      sheet.addEventListener('click',async e=>{
        if(touchZonesAllowed()&&(e.target.closest('.metric')||e.target.closest('.head strong'))){
          close();return;
        }
        const action=e.target.closest('button[data-action]')?.dataset.action;
        if(!action)return;
        if(action==='close'){close();return;}
        try{

          if(action==='qualityPreset'){
            await applyQualitySelection(e.target.closest('button[data-action]').dataset.quality);
            return;
          }
          if(action==='mute')toggleMute();
          if(action==='minus')volume(vol()-10);
          if(action==='plus')volume(vol()+10);
          if(action==='full')volume(100);
          if(action==='ratePreset'){
            const wanted=Number(e.target.closest('button[data-action]').dataset.rate);
            if(!COMMON_RATES.includes(wanted))return;
            const actual=controls.setRate(wanted).rate;
            text('hint',Math.abs(actual-wanted)<.001?
              '播放速度已设置为 '+actual+'×':
              '已请求 '+wanted+'×，实际仍为 '+actual+'×');
            refreshSheet();
            setTimeout(refreshSheet,450);
            return;
          }
          refreshSheet();
        }catch(error){text('hint',error.message);}
      });
      document.addEventListener('keydown',e=>{
        if(e.key==='Escape'&&sheet&&!sheet.hidden)close();
      });
    }
    function open(anchor){
      if(!supported()||!p()||!desktopMountAllowed())return;
      makePanel();sheet.hidden=false;backdrop.hidden=!touchZonesAllowed();
      presentPanel(sheet,touchZonesAllowed()?anchor:desktopVideoAnchor(p()));
      bandwidth.start();
      refreshSheet();
      refreshQualityChoices();
    }
    function toastVolume(n){
      if(!toast?.isConnected){toast=document.createElement('div');
        toast.id='hmtc-yt-toast';document.body.appendChild(toast);}
      const rect=p()?.getBoundingClientRect();
      toast.style.left=Math.max(58,Math.min(innerWidth-58,
        (rect?.left||0)+(rect?.width||innerWidth)*.67))+'px';
      toast.style.top=Math.max(48,Math.min(innerHeight-48,
        (rect?.top||0)+(rect?.height||innerHeight)*.5))+'px';
      toast.textContent='🔊 '+n+'%';toast.hidden=false;
      clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>{toast.hidden=true;},750);
    }
    function edge(player,side){
      const el=document.createElement('div');
      el.className='hmtc-yt-edge hmtc-yt-'+side;
      el.setAttribute('aria-label',side==='left'?
        '轻点打开 YouTube 控制面板':'上下滑动调音量');
      // Do not attach inside .html5-video-player: playing videos may add
      // higher-z-index overlays and replace its DOM, hiding our touch zones.
      // Keep zones in a top-level portal, positioned over the player bounds.
      (document.fullscreenElement||document.body).appendChild(el);
      let gesture=null,lastTap=0;
      const reset=()=>{if(gesture?.timer)clearTimeout(gesture.timer);gesture=null;};
      el.addEventListener('touchstart',e=>{
        reset();if(e.touches.length!==1)return;
        const t=e.touches[0];
        gesture={id:t.identifier,x:t.clientX,y:t.clientY,at:Date.now(),
          base:vol(),moved:false,held:false,
          range:Math.max(90,player.getBoundingClientRect().height*.65)/sense()};
        if(['hold','both'].includes(mode()))gesture.timer=setTimeout(()=>{
          if(gesture&&!gesture.moved&&el.isConnected&&touchZonesAllowed()){
            gesture.held=true;lastTap=Date.now();open();
          }
        },600);
        if(side==='right'&&e.cancelable)e.preventDefault();
      },{passive:side==='left'});
      el.addEventListener('touchmove',e=>{
        const g=gesture;if(!g||e.touches.length!==1)return;
        const t=[...e.touches].find(x=>x.identifier===g.id);if(!t)return;
        const dx=t.clientX-g.x,dy=g.y-t.clientY;
        if(Math.abs(dx)>12||Math.abs(dy)>12){
          g.moved=true;if(g.timer)clearTimeout(g.timer);
        }
        if(side==='right'&&!g.held){
          if(e.cancelable)e.preventDefault();
          if(Math.abs(dx)>Math.abs(dy)*1.5||Math.abs(dy)<9)return;
          toastVolume(volume(g.base+dy/g.range*100));
        }
      },{passive:side==='left'});
      el.addEventListener('touchend',e=>{
        if(!gesture)return;
        const t=[...e.changedTouches].find(x=>x.identifier===gesture.id);
        const g=gesture;reset();if(!t)return;
        if(side==='right'){
          if(e.cancelable)e.preventDefault();
          if(g.moved&&Math.abs(t.clientX-g.x)<=Math.abs(t.clientY-g.y)*1.5)
            toastVolume(volume(g.base+(g.y-t.clientY)/g.range*100));
        }else if(!g.held&&!g.moved&&['tap','both'].includes(mode())&&
          Date.now()-g.at<=550&&Math.abs(t.clientX-g.x)<18&&
          Math.abs(t.clientY-g.y)<18){
          if(e.cancelable)e.preventDefault();lastTap=Date.now();open();
        }
      },{passive:false});
      el.addEventListener('touchcancel',reset,{passive:true});
      el.addEventListener('click',e=>{
        if(touchZonesAllowed()&&e.button===0&&side==='left'&&['tap','both'].includes(mode())&&Date.now()-lastTap>650){
          e.preventDefault();e.stopPropagation();lastTap=Date.now();open();
        }
      });
      return el;
    }
    // Fixed-position edge portals survive YouTube's play/pause overlays,
    // dynamic control rebuilding and SPA video changes. Reposition rather
    // than relying on child stacking order inside #movie_player.
    function placeEdge(el,rect,side){
      if(!el)return;
      const winWidth=innerWidth||document.documentElement.clientWidth;
      const winHeight=innerHeight||document.documentElement.clientHeight;
      const intersects=rect&&rect.width>=80&&rect.height>=65&&
        rect.right>0&&rect.bottom>0&&rect.left<winWidth&&rect.top<winHeight;
      el.style.display=intersects?'block':'none';
      if(!intersects)return;
      const w=Math.min(112,Math.max(20,rect.width*.36));
      const h=rect.height*.78;
      const leftPos=side==='left'?rect.left:rect.right-w;
      const x=Math.max(0,Math.min(winWidth,leftPos));
      const y=Math.max(0,Math.min(winHeight,rect.top+rect.height*.11));
      el.style.left=x+'px';
      el.style.top=y+'px';
      el.style.width=Math.max(0,Math.min(w,winWidth-x))+'px';
      el.style.height=Math.max(0,Math.min(h,winHeight-y))+'px';
    }
    function refresh(){
      if(!document.body)return;
      const player=supported()?p():null;
      if(backdrop)backdrop.hidden=!sheet||sheet.hidden||!touchZonesAllowed();
      if(!player||!touchZonesAllowed()||!setting(enabledKey,true)){
        left?.remove();right?.remove();left=right=root=null;
        if(!player)close();
      }else{
        const layer=document.fullscreenElement||document.body;
        if(root!==player||!left?.isConnected||!right?.isConnected||
           left.parentNode!==layer||right.parentNode!==layer){
          left?.remove();right?.remove();root=player;
          left=edge(player,'left');right=edge(player,'right');
        }
        // Fixed portals are above YouTube's dynamically added controls but
        // still below our stats sheet. Native settings menus opt out.
        const rect=player.getBoundingClientRect();
        placeEdge(left,rect,'left');
        placeEdge(right,rect,'right');
      }
      if(sheet&&!sheet.hidden){
        if(!player)close();
        else {
          bandwidth.start();
          refreshSheet();
        }
      }
      refreshWatchHud(player);
    }
    installDesktopDismiss(()=>{if(sheet&&!sheet.hidden)close();});
    document.addEventListener('contextmenu',event=>{
      const point=desktopContextPoint(event,supported()?p():null);
      if(!point)return;
      event.preventDefault();event.stopPropagation();open(point);
    },{capture:true});
    document.addEventListener('hmtc:corner-hud-change',refresh);
    watchTouchZonePolicy(()=>{
      if(!touchZonesAllowed())bandwidth.stop();
      refresh();
    });
    GM_registerMenuCommand('YouTube：打开快捷控制面板',open);
    GM_registerMenuCommand('YouTube：画质接口诊断',async()=>{
      const c=await controls.qualityOptions();
      alert(['YouTube 画质诊断 · v0.6.8','可用方式：'+c.method,
        '真实档位：'+(c.enumerated?'已读取':'未公开'),
        '当前报告：'+(c.selected||'未知'),
        '档位：'+(c.choices.map(x=>x.label).join('、')||'无'),
        c.reason||'切换后需核对播放器反馈'].join('\n'));
    });
    GM_registerMenuCommand('YouTube：连接速度诊断',()=>{
      const info=bandwidth.diagnose();
      alert([
        '连接速度诊断 · v0.6.5',
        '播放器：'+(info.playerReady?'已识别':'未识别'),
        '原生统计接口：'+(info.methods.join('、')||'未开放'),
        '原版统计面板：'+(info.nativePanelFound?'已发现':'未发现'),
        '统计采集：'+(info.monitoring?'开启':'未开启'),
        '当前读取：'+(info.available?
          (info.bandwidthKbps/1000).toFixed(2)+' Mbps':'无数值'),
        '数据来源：'+(info.source||'—'),
        info.available?'':('原因：'+(info.reason||'YouTube 未返回连接速度'))
      ].filter(Boolean).join('\n'));
    });
    GM_registerMenuCommand('YouTube：启用／禁用透明触控区',()=>{
      const next=!setting(enabledKey,true);GM_setValue(enabledKey,next);refresh();
      alert('YouTube 边缘触控区已'+(next?'启用':'关闭'));
    });
    GM_registerMenuCommand('YouTube：打开触控设置',()=>{
      open();sheet?.querySelector('.hmtc-yt-preferences')?.setAttribute('open','');
    });
    GM_registerMenuCommand('YouTube：显示／隐藏手势区（调试）',()=>{
      document.documentElement.classList.toggle('hmtc-yt-debug');
    });
    setInterval(refresh,600);
    // Keep the transparent overlay aligned while the player scrolls,
    // resizes, enters fullscreen or switches between Shorts.
    document.addEventListener('scroll',refresh,{passive:true,capture:true});
    window.addEventListener('resize',refresh,{passive:true});
    document.addEventListener('fullscreenchange',refresh);
    window.addEventListener('orientationchange',refresh,{passive:true});
    window.addEventListener('pagehide',()=>bandwidth.stop(),{passive:true});
    refresh();
  }

  // Run a minimal, read-only stats bridge inside YouTube's actual embedded iframe.
  // The Holodex UI remains in the top page. No extra downloads or network tests.
  function youtubeFrameBridge(videoId) {
    const TAG = 'hmtc-youtube-stats-v1';
    const origins = new Set(['https://holodex.net','https://www.holodex.net']);
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const player = () => page.document.getElementById('movie_player');
    const controls=youtubePlaybackTools(page.document,player);
    const desktopBridge=installDesktopFrameBridge(videoId,player,origins);
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
      const sourceResolution = s.current_resolution || s.currentResolution ||
        s.resolution || s.current_optimal_resolution || '';
      const fromStatsText = body.match(
        /(?:Current\s*\/\s*Optimal\s*Res|当前\s*\/\s*最佳分辨率|当前.*分辨率)\s*[:：]?\s*(\d{3,5}\s*[x×]\s*\d{3,5}(?:@\d+)?(?:\s*\/\s*\d{3,5}\s*[x×]\s*\d{3,5}(?:@\d+)?)?)/i
      )?.[1] || '';
      const resolution = currentResolution(sourceResolution)||currentResolution(fromStatsText);
      const sourceCodecs = s.codecs || '';
      const codecs = typeof sourceCodecs === 'string' ? sourceCodecs.slice(0,120) : '';
      const viewportFrames = String(s.viewport || s.frames || '').slice(0,100);
      const dropped = getNumber(s.dropped_frames, s.droppedFrames,
        metric(/(\d+)\s+dropped\s+of\s+\d+/i));
      const liveLatencySeconds=nativeLatencySeconds(raw)??nativeLatencySeconds(body);
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
      if(!touchZonesAllowed()){
        if(monitor.active)stopMonitor();
        else silent(false);
        return {enabled:false,hidden:false,passive:true};
      }
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
      if(monitor.active&&monitor.forced&&!monitor.manual&&typeof p?.hideVideoInfo==='function'){
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
    watchTouchZonePolicy(()=>{
      if(!touchZonesAllowed())stopMonitor();
    });
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

    function readStats(statusHint,diagnose=false) {
      const p=player();
      if(!p)return {available:false, reason:'YouTube 播放器尚未就绪'};
      let actualId=null;
      try{actualId=p.getVideoData?.()?.video_id||null;}catch{}
      if(actualId&&actualId!==videoId)
        return {available:false,reason:'播放视频已切换'};
      let source='none';
      const data=parse(null),sources=[];let rawLatencyFields=false,rawExplicitLatencyField=false,availableSourceCount=0;
      const getter={supported:typeof p.getLiveLatency==='function',status:'未查询'};
      // Prefer fresh API output; previous versions wrongly read old panel DOM first.
      // Combine compatible fields instead of stopping at an API which happens
      // to return resolution but not the more important Connection Speed.
      for(const [name,args] of [
        ['getStatsForNerdsData',[]],
        ['getStatsForNerds',[]],
        ['getStatsForNerds',[0]],
        ['getDebugText',[]],
        ['getVideoStats',[]]
      ]) {
        if(typeof p[name]!=='function'){if(diagnose)sources.push({method:name,available:false});continue;}
        availableSourceCount++;
        try{
          const raw=p[name](...args);
          if(!raw || (typeof raw!=='string'&&typeof raw!=='object')){
            if(diagnose)sources.push({method:name,available:true,error:'未返回数据'});continue;
          }
          const sample=parse(raw),fields=latencyFieldNames(raw);
          if(fields.length)rawLatencyFields=true;
          if(fields.some(path=>{const key=path.split('.').pop();return LATENCY_SECONDS_KEYS.has(key)||LATENCY_MS_KEYS.has(key);}))rawExplicitLatencyField=true;
          if(diagnose)sources.push({method:name+(args.length?'(0)':''),available:true,fields,
            values:latencyValueDetails(raw),latencySeconds:sample.liveLatencySeconds});
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
          // Continue: later APIs may expose latency even when other metrics are complete.
        }catch{if(diagnose)sources.push({method:name,available:true,error:'调用失败'});}
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
      const liveState=resolvePlaybackState(youtubeWatchLiveState(page.document,player,controls.video,page),statusHint);
      data.live=liveState.live;data.liveReason=liveState.reason;
      if(data.live===false){
        data.liveLatencySeconds=null;data.latencyReason='非直播';data.latencyReasonCode='not-live';getter.status='录像不查询';
      }else if(data.live==null){
        data.liveLatencySeconds=null;data.latencyReason='状态未确认';data.latencyReasonCode='media-type-unknown';getter.status='类型未确认';
      }else {
        if(data.liveLatencySeconds==null&&getter.supported){
          try{
            data.liveLatencySeconds=nativeLatencySeconds({liveLatencySeconds:p.getLiveLatency()});
            getter.status=data.liveLatencySeconds==null?'未返回有效秒值':'返回有效秒值';
          }catch{getter.status='调用失败';}
        }
        data.latencyReason=data.liveLatencySeconds==null?'未提供':'';
        data.latencyReasonCode=data.liveLatencySeconds!=null?'available':rawExplicitLatencyField?'latency-value-invalid':rawLatencyFields?'unrecognized-latency-units':
          availableSourceCount===0&&!getter.supported?'no-latency-api':'latency-field-absent';
      }
      if(diagnose)data.latencyDiagnostics={sources,getter,nativePanelVisible:isNativeVisible(p),
        liveReason:liveState.reason,reasonCode:data.latencyReasonCode};
      if(!data.resolution) {
        // HTMLVideoElement intrinsic dimensions reflect the decoded video
        // frame; label them explicitly rather than inventing optimal resolution.
        const video=p.querySelector?.('video') || page.document.querySelector('video.html5-main-video');
        if(video?.videoWidth>0 && video?.videoHeight>0)
          data.resolution=video.videoWidth+'×'+video.videoHeight;
      }
      const meaningful=data.bandwidthKbps!=null||data.bufferSeconds!=null||
        data.liveLatencySeconds!=null||!!data.resolution||!!data.codecs;
      return {available:meaningful,source,
        monitoring:monitor.active, silent:monitor.active&&monitor.forced&&!monitor.manual,
        reason:meaningful?'':'嵌入播放器未提供原生详细统计',...data};
    }

    window.addEventListener('message',async event=>{
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
      if(message.action==='statsDiagnostics'){
        respond({ok:true,data:readStats(message.status,true)});return;
      }
      if(message.action==='desktopPanelStatus'){
        respond({ok:true,data:{version:'0.6.25',...desktopBridge.status()}});return;
      }
      if(message.action==='desktopPanelConfig'){
        desktopBridge.configure(event,message);return;
      }
      if(message.action==='stats') {
        // A YouTube playback change can turn its statistics off again.
        // Re-arm only if this script owns a silent monitoring session.
        if(monitor.active&&monitor.forced&&!monitor.manual&&
           isNativeVisible(player())===false)startMonitor();
        respond({ok:true,data:readStats(message.status)});
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
      if(['playbackClock','playbackInfo','playbackRate','qualityMenu','qualityOptions','selectQuality'].includes(message.action)){
        try{
          if(!player())throw Error('YouTube 播放器尚未就绪');
          let info;
          if(message.action==='playbackClock')info=readFrameClock(
            page.document,player,controls.video,page,videoId,message.status);
          if(message.action==='playbackInfo')info=controls.snapshot();
          if(message.action==='playbackRate')info=controls.setRate(message.rate);
          if(message.action==='qualityMenu')info=await controls.openQualityMenu();
          if(message.action==='qualityOptions')info=await controls.qualityOptions();
          if(message.action==='selectQuality')info=await controls.setQuality(message.quality);
          respond({ok:true,data:info});
        }catch(error){
          respond({ok:false,error:String(error?.message||error).slice(0,150)});
        }
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
  if(window.top===window.self&&/^(?:www\.|m\.)?youtube\.com$/.test(location.hostname)){
    youtubeWatchControls();return;
  }
  if(window.top!==window.self || !/^(www\.)?holodex\.net$/.test(location.hostname))return;

  const VERSION='0.6.25', KEY='hmtc_enabled_v1';
  const EDGE_KEY='hmtc_edge_gestures_enabled_v1';
  const DEBUG_KEY='hmtc_show_edge_zones_v1';
  const SENS_KEY='hmtc_volume_sensitivity_v1';
  const STATS_MODE_KEY='hmtc_stats_trigger_v1';
  const AUTO_ENABLED_KEY='hmtc_autoplay_enabled_v1';
  const AUTO_RETURN_KEY='hmtc_autoplay_return_v1';
  const AUTO_PAUSE_KEY='hmtc_autoplay_respect_pause_v1';
  const AUTO_MUTE_KEY='hmtc_autoplay_mute_fallback_v1';
  const get=(key,def)=>GM_getValue(key,def);
  const set=(key,value)=>GM_setValue(key,value);
  if(!get(KEY,true)){
    GM_registerMenuCommand('启用 Holodex Touch Controls',()=>{set(KEY,true);location.reload();});
    return;
  }
  GM_registerMenuCommand('暂停 Holodex Touch Controls',()=>{set(KEY,false);location.reload();});
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
  // Tampermonkey has both synchronous GM_getValue/GM_setValue and modern
  // promise-based GM.getValue/GM.setValue. Keep a canonical manager-owned
  // record; verify writes, and hydrate from the modern API BEFORE enabling
  // the in-page autoplay engine. localStorage is just a fallback.
  const AUTO_BACKUP_KEY='hmtc.touch-controls.autoplay-preferences.v1';
  const AUTO_RECORD_KEY='hmtc.autoplay.settings.canonical.v2';
  const AUTO_KEYS=[AUTO_ENABLED_KEY,AUTO_RETURN_KEY,AUTO_PAUSE_KEY,AUTO_MUTE_KEY];
  const autoLocalValues=new Map();
  let prefRevision=0,prefInteractionEpoch=0,prefUpdatedAt=0;
  let autoStorageAvailable=true,autoLastWriteError='';
  let preferenceSource='默认/原有 GM 设置';
  let autoGmRecordValid=false,autoGmSyncVerified=false,autoGmAsyncVerified=false;
  let autoHydrationComplete=false;

  function readAutoBackup(){
    try{
      const raw=window.localStorage.getItem(AUTO_BACKUP_KEY);
      if(!raw)return {};
      const record=JSON.parse(raw);
      if(record?.schema!==1||!record.values||typeof record.values!=='object')
        return {};
      const clean={};
      for(const key of AUTO_KEYS)
        if(typeof record.values[key]==='boolean')clean[key]=record.values[key];
      autoStorageAvailable=true;
      return clean;
    }catch(error){
      autoStorageAvailable=false;
      autoLastWriteError=String(error?.message||error).slice(0,120);
      return {};
    }
  }
  const previousBackup=readAutoBackup();
  for(const key of AUTO_KEYS)
    if(typeof previousBackup[key]==='boolean')autoLocalValues.set(key,previousBackup[key]);
  if(AUTO_KEYS.some(key=>typeof previousBackup[key]==='boolean'))
    preferenceSource='Holodex 本地备份（旧版）';
  function saveAutoBackup(){
    try{
      const values=readAutoBackup();
      for(const key of AUTO_KEYS)
        if(autoLocalValues.has(key))values[key]=autoLocalValues.get(key);
      window.localStorage.setItem(AUTO_BACKUP_KEY,
        JSON.stringify({schema:1,updatedAt:Date.now(),values}));
      autoStorageAvailable=true;
      return true;
    }catch(error){
      autoStorageAvailable=false;
      autoLastWriteError=String(error?.message||error).slice(0,120);
      return false;
    }
  }
  const autoValue=(key,def)=>autoLocalValues.has(key)?
    autoLocalValues.get(key):get(key,def);
  const autoplaySettings=()=>({
    enabled:!!autoValue(AUTO_ENABLED_KEY,true),
    onReturn:!!autoValue(AUTO_RETURN_KEY,true),
    respectPause:!!autoValue(AUTO_PAUSE_KEY,true),
    muteFallback:!!autoValue(AUTO_MUTE_KEY,false)
  });
  function validateAutoRecord(record){
    if(!record||typeof record!=='object'||record.schema!==2||
       !record.values||typeof record.values!=='object')return null;
    const result={};
    for(const key of AUTO_KEYS){
      if(typeof record.values[key]!=='boolean')return null;
      result[key]=record.values[key];
    }
    return {
      schema:2,revision:Number.isInteger(record.revision)?record.revision:0,
      updatedAt:Number.isFinite(record.updatedAt)?record.updatedAt:0,
      values:result
    };
  }
  function acceptAutoRecord(record,source){
    const valid=validateAutoRecord(record);
    if(!valid)return false;
    if(prefRevision>0&&valid.revision<prefRevision)return false;
    for(const key of AUTO_KEYS)autoLocalValues.set(key,valid.values[key]);
    prefRevision=Math.max(prefRevision,valid.revision);
    prefUpdatedAt=valid.updatedAt;
    preferenceSource=source;
    autoGmRecordValid=true;
    return true;
  }
  function getAutoRecordSync(){
    try{return validateAutoRecord(get(AUTO_RECORD_KEY,null));}
    catch(error){autoLastWriteError=String(error?.message||error);return null;}
  }
  const syncRecord=getAutoRecordSync();
  if(syncRecord){
    acceptAutoRecord(syncRecord,'Tampermonkey GM 主记录（同步）');
    autoGmSyncVerified=true; // Read a well-formed persisted record at boot.
  }
  function buildAutoRecord(){
    return {
      schema:2,revision:++prefRevision,updatedAt:Date.now(),
      values:{
        [AUTO_ENABLED_KEY]:autoplaySettings().enabled,
        [AUTO_RETURN_KEY]:autoplaySettings().onReturn,
        [AUTO_PAUSE_KEY]:autoplaySettings().respectPause,
        [AUTO_MUTE_KEY]:autoplaySettings().muteFallback
      }
    };
  }
  function verifyRecordMatches(candidate,desired){
    const valid=validateAutoRecord(candidate);
    return !!valid&&valid.revision===desired.revision &&
      AUTO_KEYS.every(k=>valid.values[k]===desired.values[k]);
  }
  // This promise resolves even on storage failure; error details are available
  // via diagnostics. Interactions begun before it resolves take precedence.
  const autoPrefsReady=(async()=>{
    const before=prefInteractionEpoch;
    try{
      if(typeof GM!=='undefined'&&typeof GM?.getValue==='function'){
        const modern=await GM.getValue(AUTO_RECORD_KEY,null);
        if(before!==prefInteractionEpoch)return;
        const parsed=validateAutoRecord(modern);
        if(parsed){
          autoGmAsyncVerified=true; // Modern GM read verified persisted data.
          if(!autoGmRecordValid||parsed.revision>=prefRevision)
            acceptAutoRecord(parsed,'Tampermonkey GM 主记录（异步）');
        }
        if(!autoGmRecordValid){
          // For existing users without the canonical record, probe the modern
          // API's legacy values; prefer a previously saved origin backup.
          const values=await Promise.all(
            AUTO_KEYS.map(key=>GM.getValue(key,null)));
          if(before!==prefInteractionEpoch)return;
          AUTO_KEYS.forEach((key,index)=>{
            const raw=values[index];
            if(typeof raw==='boolean'&&!autoLocalValues.has(key))
              autoLocalValues.set(key,raw);
          });
          if(!AUTO_KEYS.some(k=>typeof previousBackup[k]==='boolean'))
            preferenceSource='Tampermonkey GM 历史设置';
        }
      }
    }catch(error){
      autoLastWriteError='读取 GM 存储失败：'+String(error?.message||error).slice(0,110);
    }finally{
      autoHydrationComplete=true;
    }
  })();
  function setAutoValue(key,value){
    if(!AUTO_KEYS.includes(key)||typeof value!=='boolean')
      return Promise.reject(new TypeError('不支持的自动播放设置'));
    prefInteractionEpoch++;
    autoLocalValues.set(key,value);
    const backupOk=saveAutoBackup();
    const record=buildAutoRecord();
    let legacyOk=false,canonicalSyncOk=false;
    const failures=[];
    // Always use the explicitly granted Tampermonkey synchronous API first.
    try{
      set(key,value);
      legacyOk=get(key,null)===value;
      if(!legacyOk)failures.push('GM 旧键读回不一致');
    }catch(error){failures.push('GM 旧键写入失败：'+String(error?.message||error));}
    try{
      set(AUTO_RECORD_KEY,record);
      canonicalSyncOk=verifyRecordMatches(get(AUTO_RECORD_KEY,null),record);
      if(!canonicalSyncOk)failures.push('GM 主记录同步读回不一致');
    }catch(error){failures.push('GM 主记录写入失败：'+String(error?.message||error));}
    autoGmSyncVerified=canonicalSyncOk;
    if(canonicalSyncOk){
      autoGmRecordValid=true;
      preferenceSource='Tampermonkey GM 主记录（同步已校验）';
    }else if(legacyOk)preferenceSource='Tampermonkey GM 旧键（已校验）';
    else if(backupOk)preferenceSource='Holodex 本地备份';
    const mirror=(async()=>{
      let verifiedAsync=false;
      try{
        if(typeof GM!=='undefined'&&typeof GM?.setValue==='function'&&
           typeof GM?.getValue==='function'){
          await GM.setValue(AUTO_RECORD_KEY,record);
          const readBack=await GM.getValue(AUTO_RECORD_KEY,null);
          verifiedAsync=verifyRecordMatches(readBack,record);
          if(!verifiedAsync)failures.push('GM 主记录异步读回不一致');
        }
      }catch(error){
        failures.push('GM 异步保存/校验失败：'+String(error?.message||error));
      }
      // Newer clicks win: an older save finishing last must not change local
      // runtime state or the preference source reported by diagnostics.
      if(record.revision===prefRevision){
        autoGmAsyncVerified=verifiedAsync;
        if(verifiedAsync){
          autoGmRecordValid=true;
          preferenceSource='Tampermonkey GM 主记录（异步已校验）';
        }
        autoLastWriteError=failures.join('；').slice(0,350);
      }
      if(!canonicalSyncOk&&!legacyOk&&!backupOk&&!verifiedAsync)
        throw new Error('没有任何一种存储方式能够确认设置已保存：'+failures.join('；'));
      return {canonicalSyncOk,legacyOk,backupOk,verifiedAsync};
    })();
    return mirror;
  }
  function autoPreferenceSource(){
    const backup=readAutoBackup();
    const record=getAutoRecordSync();
    const gmLegacy=get(AUTO_ENABLED_KEY,null);
    return {
      source:preferenceSource,
      enabledBacked:typeof backup[AUTO_ENABLED_KEY]==='boolean',
      backupAvailable:autoStorageAvailable,
      canonicalValid:!!record,
      syncVerified:autoGmSyncVerified,
      asyncVerified:autoGmAsyncVerified,
      hydrationComplete:autoHydrationComplete,
      gmEnabled:typeof gmLegacy==='boolean'?gmLegacy:null,
      gmRecordEnabled:record?.values[AUTO_ENABLED_KEY]??null,
      savedEnabled:autoplaySettings().enabled,
      revision:prefRevision,backupError:autoLastWriteError
    };
  }
  // Keep different Holodex tabs consistent using the GM record rather than
  // relying on a website storage event (which may be sandboxed).
  if(typeof GM_addValueChangeListener==='function'){
    try{
      GM_addValueChangeListener(AUTO_RECORD_KEY,(key,oldValue,newValue,remote)=>{
        if(!remote)return;
        const latest=validateAutoRecord(newValue);
        if(!latest||latest.revision<=prefRevision)return;
        if(acceptAutoRecord(latest,'Tampermonkey GM 主记录（其他标签页）'))
          autoPrefsReady.then(()=>syncAutoSettings().catch(()=>{}));
      });
    }catch(error){
      autoLastWriteError='跨标签页监听不可用：'+String(error?.message||error);
    }
  }
  window.addEventListener('storage',event=>{
    if(event.key!==AUTO_BACKUP_KEY||!event.newValue)return;
    if(autoGmRecordValid)return; // Manager storage is authoritative.
    const latest=readAutoBackup();
    let changed=false;
    for(const key of AUTO_KEYS){
      if(typeof latest[key]==='boolean'&&autoLocalValues.get(key)!==latest[key]){
        autoLocalValues.set(key,latest[key]);changed=true;
      }
    }
    if(changed)autoPrefsReady.then(()=>syncAutoSettings().catch(()=>{}));
  });
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
  .mv-frame.hmtc-native-menu .hmtc-edge{pointer-events:none!important}
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
    padding:10px 12px 9px;background:linear-gradient(135deg,#17454b,#193450 86%);
    border-radius:13px;border:1px solid #7fe4e038;margin-top:8px;
    box-shadow:inset 0 1px 0 #ffffff13}
  #hmtc-sheet .speed{font-size:clamp(24px,7vw,32px);line-height:1.12;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.02em;margin:3px 0}
  #hmtc-sheet .unit{font-size:13px;font-weight:600;color:#b2e9e7;margin-left:5px}
  #hmtc-sheet .speedFreshness{font-size:10px;color:#b2e9e7;margin-left:7px}
  #hmtc-sheet .sub{font-size:11px;color:#b7d1db;line-height:1.5;overflow-wrap:anywhere}
  #hmtc-sheet .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
  #hmtc-sheet .metric{padding:9px 10px;border-radius:11px;
    background:rgba(255,255,255,.065);border:1px solid #ffffff16;min-width:0}
  #hmtc-sheet .metric label{display:block;font-size:11px;color:#b8c7d7;margin-bottom:5px}
  #hmtc-sheet .metric strong{font-size:16px;font-weight:700;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
  #hmtc-sheet .hmtc-playtime-metric strong{font-size:clamp(16px,4vw,21px);
    line-height:1.35;color:#f4ffff}
  #hmtc-sheet .hmtc-play-controls{margin-top:8px;padding:9px 10px;border-radius:12px;
    background:#243549b8;border:1px solid #ffffff22}
  #hmtc-sheet .hmtc-play-row{display:flex;gap:6px;align-items:center;margin:5px 0}
  #hmtc-sheet .hmtc-play-row label{color:#cbd8e6;font-size:12px;min-width:64px;font-weight:650}
  #hmtc-sheet .hmtc-rate-presets,#hmtc-sheet .hmtc-quality-presets{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));
    gap:5px;margin:8px 0 12px}
  #hmtc-sheet .hmtc-rate-presets button,#hmtc-sheet .hmtc-quality-presets button{min-width:0;min-height:44px;padding:6px 3px;
    font-size:clamp(10px,2.6vw,13px);white-space:nowrap}
  #hmtc-sheet .hmtc-rate-presets button.hmtc-rate-selected,
  #hmtc-sheet .hmtc-quality-presets button.hmtc-quality-selected{
    background:#15796f!important;border-color:#80e8d2!important;
    color:#fff!important;box-shadow:inset 0 0 0 1px #a1eee766}
  #hmtc-sheet .hmtc-youtube-quality-link{display:block;width:100%;
    border:1px solid #63d8c763;background:#225065b0;color:#dbfdfa;
    text-decoration:none;text-align:center;border-radius:11px;
    padding:11px 8px;font:700 12px system-ui}
  #hmtc-sheet .hmtc-play-row select{color:#f1f9ff;background:#17283b;border:1px solid #8296a64a;
    min-height:42px;min-width:75px;flex:1;border-radius:10px;padding:8px;font:650 13px system-ui}
  #hmtc-sheet .hmtc-youtube-quality-link[hidden]{display:none!important}
  #hmtc-sheet .volume{display:flex;gap:9px;align-items:center;margin:14px 0 11px}
  #hmtc-sheet .volume input{flex:1;width:100%;min-width:0;height:40px;accent-color:#61d7d1;touch-action:pan-x}
  #hmtc-sheet .value{min-width:50px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
  #hmtc-sheet .actions{display:flex;gap:7px;margin-top:9px}
  #hmtc-sheet .actions button{flex:1}
  #hmtc-sheet .note{font-size:11px;color:#adbdc9;line-height:1.5;margin-top:6px}
  #hmtc-sheet .note[hidden]{display:none!important}
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
  #hmtc-settings .hmtc-toggle{display:flex;gap:10px;align-items:center;
    padding:8px 0;margin-bottom:0;font-size:13px;font-weight:500;cursor:pointer}
  #hmtc-settings .hmtc-toggle input{width:18px;height:18px;accent-color:#62d7d0;flex:none}
  #hmtc-settings .hmtc-toggle span{flex:1}
  @media(orientation:landscape){
    #hmtc-sheet,#hmtc-settings{left:auto;right:9px;bottom:8px;margin:0;
      max-width:min(390px,68vw);max-height:calc(100vh - 16px);padding:13px;border-radius:16px}
    #hmtc-sheet .net{margin-top:6px;padding:10px}
    #hmtc-sheet .grid{gap:6px;margin-top:7px}
    #hmtc-sheet .metric{padding:8px 10px}
    #hmtc-sheet .volume{margin:7px 0}
  }

  `);

  // This function is serialized into the real Holodex page world.
  // It only interacts with the already present Vue VideoCell / YoutubePlayer.
  function pageAgent(channel,win,bootConfig) {
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
          muted:!!vm.muted,ready:!!vm.ytPlayer,status:String(vm.video?.status||''),live:vm.video?.status==='live'?true:vm.video?.status==='past'?false:null
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
        Promise.resolve().then(()=>typeof p[x]==='function'?p[x]():null)));
      const status=String(vm.video?.status||'');
      const data={ready:true,status,live:status==='live'?true:status==='past'?false:null};
      values.forEach((v,i)=>{if(v.status==='fulfilled'&&v.value!=null)data[fields[i]]=v.value;});
      return data;
    }

    // Multiview-wide autoplay runs in the site realm so it can call the
    // existing YouTube IFrame API without crossing an iframe touch boundary.
    // The agent must NOT start from hard-coded "disabled" when Tampermonkey's
    // persisted preference says enabled. The saved config is passed at agent
    // creation time, after the userscript's GM hydration has completed.
    // Subsequent RPC updates remain supported but are no longer required for
    // the first autoplay attempt after page refresh.
    const autoCfg={
      enabled:bootConfig?.enabled===true,
      onReturn:bootConfig?.onReturn!==false,
      respectPause:bootConfig?.respectPause!==false,
      muteFallback:bootConfig?.muteFallback===true
    };
    const agentBoot={received:!!bootConfig,initialEnabled:autoCfg.enabled,
      configuredAt:Date.now(),lastRpcConfigAt:0,lastRpcEnabled:null};
    // v2 deliberately ignores v0.5.0's stored false-positive pause markers.
    const AUTO_MANUAL_KEY='hmtc_autoplay_manual_pause_v2';
    const AUTO_MANUAL_AGE=12*60*60*1000;
    const attempts=new Map(),manualPauses=new Map(),wasPlayingHidden=new Set();
    const activeCallbacks=new Map();
    let blockedListenerSerial=0;
    const knownAutoCells=new Set();
    let lastForegroundRetry=0;
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
    // Holodex VideoCell.updatePausedState() calls muteOthers() on first play.
    // For an automatic startup, prevent a newly started cell from muting
    // streams that the user was already watching. Restore the native flag if
    // autoplay never starts, so later explicit native playback works as usual.
    function protectExistingAudio(vm,track){
      if(vm?.firstPlay===true&&typeof vm.muteOthers==='function'){
        vm.firstPlay=false;
        track.firstPlayGuarded=true;
        track.vm=vm;
      }
    }
    function restoreFirstPlay(track){
      if(track?.firstPlayGuarded&&!track.everPlaying&&track.vm?.firstPlay===false)
        track.vm.firstPlay=true;
      if(track)track.firstPlayGuarded=false;
    }
    // YouTube's documented onAutoplayBlocked event may identify policy denial.
    // The IFrame API requires a globally named callback string, not a function.
    function subscribeAutoplayBlocked(key,player,track){
      if(typeof player?.addEventListener!=='function')return;
      const callback='__hmtcBlocked_'+(++blockedListenerSerial);
      try{
        win[callback]=()=>{
          if(attempts.get(key)!==track)return;
          track.blockedAt=Date.now();
          track.lastFailure='浏览器拒绝了自动播放';
        };
        player.addEventListener('onAutoplayBlocked',callback);
        activeCallbacks.set(key,{player,callback});
      }catch{
        try{delete win[callback];}catch{}
      }
    }
    function removeAutoplayListener(key){
      const entry=activeCallbacks.get(key);
      if(!entry)return;
      activeCallbacks.delete(key);
      try{entry.player.removeEventListener?.('onAutoplayBlocked',entry.callback);}catch{}
      try{delete win[entry.callback];}catch{}
    }
    function nextRetryCampaign(){
      for(const [key,track] of attempts){
        if(track.tries>=4&&track.campaigns<2&&
           (!autoCfg.respectPause||!manualPauses.has(key))){
          track.tries=0;track.gestureTries=0;track.lastTry=0;
          track.campaigns++;
        }
      }
    }
    let nextGestureCheck=0, lastAutoSummary=null;
    function autoScan(mode='tick'){
      const manualRun=mode==='force', gesture=mode==='gesture';
      const result={playing:0,attempted:0,protected:0,blocked:0,waiting:0,ended:0,mutedStart:0};
      if((win.location?.pathname&&!/^\/multiview(?:\/|$)/.test(win.location.pathname))||
         !doc.querySelector('.multiview')||doc.hidden||
         (!autoCfg.enabled&&!manualRun))return result;
      const now=Date.now(),current=new Set();
      const cells=autoplayCells();
      // Holodex / Quick Add may append multiple videos. Give old blocked
      // videos a bounded second chance when the layout actually changes.
      if(knownAutoCells.size&&cells.some(({key})=>!knownAutoCells.has(key)))
        nextRetryCampaign();
      knownAutoCells.clear();
      for(const {key} of cells)knownAutoCells.add(key);
      for(const {key,vm} of cells){
        current.add(key);
        const player=vm.ytPlayer;
        const state=getPlaybackState(player);
        if(state===null){result.waiting++;continue;}
        let track=attempts.get(key);
        if(!track||track.player!==player){
          if(track){restoreFirstPlay(track);removeAutoplayListener(key);}
          track={player,lastState:null,lastTry:0,tries:0,gestureTries:0,
            returned:false,suppressed:false,everPlaying:false,campaigns:0,
            playingSince:0,blockedAt:0,lastFailure:'',firstSeen:now,
            muteAppliedAt:0,mutedStarts:0,pendingMutedPlay:false};
          attempts.set(key,track);
          subscribeAutoplayBlocked(key,player,track);
        }
        // 1 = playing, 3 = buffering. Neither should ever be restarted.
        if(state===1||state===3){
          result.playing++;
          if(state===1){
            if(!track.playingSince)track.playingSince=now;
            track.everPlaying=true;track.blockedAt=0;track.lastFailure='';
          }
          track.lastState=state;track.tries=0;track.gestureTries=0;
          track.returned=false;track.suppressed=false;
          // First play has succeeded: native muteOthers() must remain skipped.
          track.firstPlayGuarded=false;
          unmarkManual(key);
          continue;
        }
        if(state===0){restoreFirstPlay(track);track.lastState=state;result.ended++;continue;}
        // Do not persist autoplay denial as a user pause. YouTube may report
        // PLAYING fleetingly, then pause because the browser blocks sound.
        // Only a sufficiently established playback followed by pause can be
        // reasonably classified as intentional without event attribution.
        if(state===2&&(track.lastState===1||
             (track.lastState===3&&track.everPlaying))&&!track.returned&&
           track.playingSince>0&&now-track.playingSince>=6500&&
           (!track.lastTry||now-track.lastTry>=7000)&&
           (!track.blockedAt||now-track.blockedAt>=12000)){
          markManual(key);
        }
        track.lastState=state;
        if(![-1,2,5].includes(state)){result.waiting++;continue;}
        // On a fresh reload Holodex first creates its YouTube Player, then
        // cues the media asynchronously. Spending all retries during the
        // initial -1 state can leave every video stopped after it becomes ready.
        if(state===-1&&!manualRun&&now-track.firstSeen<3200){
          result.waiting++;continue;
        }
        if(manualRun){
          unmarkManual(key);track.tries=0;track.gestureTries=0;
          track.suppressed=false;
        }
        if(track.suppressed&&!manualRun){result.protected++;continue;}
        if(autoCfg.respectPause&&manualPauses.has(key)&&!manualRun){
          restoreFirstPlay(track);
          result.protected++;continue;
        }
        if(!manualRun&&track.tries>=4){
          if(!gesture||track.gestureTries>=2||now-track.lastTry<1600){
            if(track.campaigns>=2&&track.gestureTries>=2)restoreFirstPlay(track);
            result.blocked++;continue;
          }
          track.gestureTries++;
        }else if(!manualRun&&track.tries>0&&
                 now-track.lastTry<Math.min(5200,650*2**(track.tries-1))){
          result.waiting++;continue;
        }
        if(typeof player.playVideo!=='function'){result.waiting++;continue;}
        if(track.pendingMutedPlay){result.waiting++;continue;}
        try{
          // Default mode preserves all current audio. An explicitly enabled
          // mute fallback only affects paused/unstarted cells (never 1/3).
          const useMute=autoCfg.muteFallback&&
            (track.blockedAt>0||track.tries>=2);
          let justMuted=false;
          if(useMute){
            const wasMuted=typeof player.isMuted==='function'?
              !!player.isMuted():!!vm.muted;
            if(!wasMuted){
              // Holodex's vm.setMuted() propagates through Vue's watcher,
              // potentially AFTER a same-tick playVideo(). Send the mute
              // directly to YouTube and give it time to process before play.
              if(typeof player.mute==='function')player.mute();
              if(typeof vm.setMuted==='function')vm.setMuted(true);
              if(typeof player.mute==='function'||
                 typeof vm.setMuted==='function'){
                justMuted=true;track.muteAppliedAt=now;
              }else{
                track.lastFailure='播放器不支持静音，无法执行回退';
              }
            }
          }
          protectExistingAudio(vm,track);
          if(track.lastFailure!=='播放器不支持静音，无法执行回退')
            track.lastFailure='';
          const issuePlay=()=>{
            const stateNow=getPlaybackState(player);
            if(stateNow===1||stateNow===3)return false;
            player.playVideo();
            const after=getPlaybackState(player);
            if(after===1){
              track.lastState=after;track.everPlaying=true;
              if(!track.playingSince)track.playingSince=Date.now();
            }else if(after===3)track.lastState=after;
            return true;
          };
          if(justMuted){
            track.pendingMutedPlay=true;
            track.lastTry=now;track.tries++;
            result.attempted++;result.mutedStart++;
            win.setTimeout(()=>{
              track.pendingMutedPlay=false;
              // The user could have navigated or started this stream meanwhile.
              if(attempts.get(key)!==track||doc.hidden||
                 !autoCfg.enabled||!autoCfg.muteFallback||
                 (autoCfg.respectPause&&manualPauses.has(key))||
                 (win.location?.pathname &&
                  !win.location.pathname.startsWith('/multiview')))return;
              try{
                if(issuePlay())track.mutedStarts++;
              }catch(error){
                track.lastFailure=String(error?.message||
                  '静音播放被浏览器拒绝').slice(0,100);
              }
            },220);
          }else{
            const issued=issuePlay();
            track.lastTry=now;track.tries++;
            if(issued){result.attempted++;if(useMute){result.mutedStart++;track.mutedStarts++;}}
          }
        }catch(error){
          track.lastTry=now;track.tries++;
          track.lastFailure=String(error?.message||'播放器拒绝播放').slice(0,100);
          result.blocked++;
        }
      }
      // Do not reuse an old attempt record if Holodex removed/replaced its cell.
      for(const key of attempts.keys()){
        if(!current.has(key)){
          restoreFirstPlay(attempts.get(key));
          removeAutoplayListener(key);
          attempts.delete(key);unmarkManual(key);
        }
      }
      lastAutoSummary=result;
      return result;
    }
    function autoDiagnostics(){
      const rows=[];
      for(const {key,vm} of autoplayCells()){
        const state=getPlaybackState(vm.ytPlayer);
        const track=attempts.get(key);
        const protectedPause=autoCfg.respectPause&&manualPauses.has(key);
        const reasons={
          '-1':'尚未开始','0':'已结束','1':'播放中',
          '2':'已暂停','3':'缓冲中','5':'已加载待播放'
        };
        let issue=state===null?'等待播放器初始化':
          state===1?'正在播放':state===3?'正在缓冲':
          state===0?'播放已结束（不自动重播）':
          protectedPause?'受保护的手动暂停':
          track?.lastFailure||(
            state===-1&&track&&Date.now()-track.firstSeen<3200?
              '等待 YouTube 播放器完成初次加载':
            track?.tries>=4&&track?.gestureTries>=2?'自动尝试已用尽':
            track?.tries>=4?'普通自动尝试已用尽，可在页面点一下':
            state===2||state===5||state===-1?'等待下一次自动尝试':
            '播放器状态待确认');
        // Configuration is authoritative. Don't report stale autoplay-blocked
        // events or "waiting to try" while the feature is explicitly off.
        if(!autoCfg.enabled){
          issue=state===1?'正在播放（智能自动播放已关闭）':
            state===3?'正在缓冲（智能自动播放已关闭）':
            '智能自动播放已关闭；此时不会尝试启动';
        }else if(state!==1&&state!==3&&
                 track?.blockedAt&&Date.now()-track.blockedAt<60000){
          issue=autoCfg.muteFallback?
            '浏览器拦截了播放；已允许静音回退，正在检查是否启动':
            '浏览器拦截有声自动播放；可开启静音启动回退';
        }
        rows.push({
          key,title:String(vm.video?.title||vm.video?.id||key).slice(0,48),
          state,description:reasons[String(state)]||'未知状态',
          issue,tries:track?.tries||0,campaigns:track?.campaigns||0,
          muted:typeof vm.ytPlayer?.isMuted==='function'?
            !!vm.ytPlayer.isMuted():!!vm.muted,
          mutedStartAttempts:track?.mutedStarts||0,
          mutePending:!!track?.pendingMutedPlay,
          playerReady:!!vm.ytPlayer
        });
      }
      return {version:'0.5.6',enabled:autoCfg.enabled,
        onReturn:autoCfg.onReturn,respectPause:autoCfg.respectPause,
        muteFallback:autoCfg.muteFallback,hidden:!!doc.hidden,
        boot:{...agentBoot},detected:rows.length,rows,
        manualPaused:manualPauses.size};
    }

    function autoConfigure(msg){
      const wasEnabled=autoCfg.enabled;
      const muteJustEnabled=!autoCfg.muteFallback&&msg.muteFallback===true;
      agentBoot.lastRpcConfigAt=Date.now();
      for(const name of ['enabled','onReturn','respectPause','muteFallback'])
        if(typeof msg[name]==='boolean')autoCfg[name]=msg[name];
      agentBoot.lastRpcEnabled=autoCfg.enabled;
      if(!autoCfg.enabled){
        for(const track of attempts.values())restoreFirstPlay(track);
        return {...autoCfg,ready:true};
      }
      if(muteJustEnabled&&autoCfg.enabled){
        // Explicit consent to muting should unblock previously exhausted
        // audible playback attempts without overriding manual pauses.
        for(const [key,track] of attempts){
          if(track.blockedAt>0||track.tries>=2){
            if(autoCfg.respectPause&&manualPauses.has(key))continue;
            track.tries=0;track.lastTry=0;track.gestureTries=0;
          }
        }
      }
      if(!wasEnabled){
        // An explicit enable is a fresh user-requested playback campaign.
        // Clear attempts made by the manual command while auto mode was off,
        // so a just-enabled player isn't stuck waiting on old cooldowns.
        for(const track of attempts.values()){
          track.tries=0;track.gestureTries=0;track.lastTry=0;
          track.campaigns=0;track.blockedAt=0;track.lastFailure='';
        }
      }
      autoScan('config');
      return {...autoCfg,ready:true};
    }
    function autoResumeFromHidden(){
      if(!autoCfg.enabled||!autoCfg.onReturn)return;
      // Tab visibility / focus provides a new user-visible opportunity.
      // Cap these retries so frequent focus changes cannot cause an
      // unbounded storm of playVideo() calls.
      if(Date.now()-lastForegroundRetry>12000){
        lastForegroundRetry=Date.now();
        nextRetryCampaign();
      }
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
    // Page teardown releases its interval; BFCache restores it on pageshow.

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
        if(msg.action==='autoDiagnose')
          return reply({ok:true,data:autoDiagnostics()});
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
        if(msg.action==='playback'){
          const p=vm.ytPlayer;
          if(!p)throw Error('播放器尚未就绪');
          let rate=1,options=[];
          try{rate=Number(p.getPlaybackRate?.())||1;}catch{}
          try{options=p.getAvailablePlaybackRates?.()||[];}catch{}
          options=options.filter(x=>Number.isFinite(Number(x))&&Number(x)>0)
            .map(Number);
          return reply({ok:true,data:{rate,rates:options.length?options:[1],
            ready:true}});
        }
        if(msg.action==='setPlaybackRate'){
          const p=vm.ytPlayer,r=Number(msg.rate);
          if(!p||typeof p.setPlaybackRate!=='function')
            throw Error('此视频播放器不支持变速');
          // An embed can temporarily report only [1] while still loading.
          // Accept a bounded fixed preset; confirm actual application by
          // reading getPlaybackRate() instead of trusting a stale list.
          if(!Number.isFinite(r)||![1,1.25,1.5,1.75,2].some(x=>Math.abs(x-r)<.001))
            throw Error('无效的播放速度快捷档位');
          p.setPlaybackRate(r);
          const applied=Number(p.getPlaybackRate?.());
          return reply({ok:true,data:{rate:Number.isFinite(applied)?applied:1,
            requested:r,confirmed:Number.isFinite(applied)&&Math.abs(applied-r)<.001}});
        }
        return reply({ok:false,error:'操作不支持'});
      }catch(error){return reply({ok:false,error:String(error?.message||error).slice(0,140)});}
    });
    // A correctly hydrated "enabled" setting initiates autoplay at creation.
    // Normal scans continue to catch videos whose iframe is not ready yet.
    if(autoCfg.enabled)autoScan('boot');
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
    // Do not instantiate the page agent until the persisted GM settings have
    // finished loading. Previously the page agent booted disabled and only a
    // second RPC could enable it; Android reloads sometimes missed that RPC.
    const start=()=>{
      if(installed)return;
      if(!isMulti()){installing=false;return;}
      const bootConfig=autoplaySettings();
      const ready=()=>{
        installed=true;installing=false;
        document.removeEventListener(token+':ready',ready);
        refresh();
        // Idempotent verification after direct boot: GM and the page agent
        // should now agree. This is not needed for initial playback to start.
        syncAutoSettings().catch(error=>
          console.warn('[Holodex Touch Controls] 自动播放配置校验失败',error));
      };
      document.addEventListener(token+':ready',ready);
      const tag=document.createElement('script');
      const nonce=document.querySelector('script[nonce]')?.nonce;
      if(nonce)tag.nonce=nonce;
      tag.textContent='('+pageAgent.toString()+')('+
        JSON.stringify(token)+',window,'+JSON.stringify(bootConfig)+');';
      try{(document.head||document.documentElement).appendChild(tag);tag.remove();}catch{}
      setTimeout(()=>{
        if(installed)return;
        try{
          if(page.document?.querySelector('.multiview'))
            pageAgent(token,page,bootConfig);
        }catch(error){console.warn('[Holodex Touch Controls] 页面桥接失败',error);}
        if(!installed){
          installing=false;
          document.removeEventListener(token+':ready',ready);
        }
      },800);
    };
    autoPrefsReady.then(start).catch(error=>{
      console.warn('[Holodex Touch Controls] GM 设置读取失败，使用当前已知值',error);
      start();
    });
  }

  function syncAutoSettings(){
    if(!installed||!isMulti())return Promise.resolve(null);
    return autoPrefsReady.then(async()=>{
      const expected=autoplaySettings();
      const actual=await rpc('autoConfig',expected,3200);
      if(!actual||['enabled','onReturn','respectPause','muteFallback']
        .some(key=>actual[key]!==expected[key]))
        throw new Error('Holodex 播放器返回的自动播放设置与 GM 配置不一致');
      return actual;
    });
  }
  let agentHealthBusy=false;
  let lastAgentHealthCheck=0;
  async function verifyAgentAutoplayState(){
    if(agentHealthBusy||!installed||!isMulti()||document.hidden)return;
    agentHealthBusy=true;
    try{
      await autoPrefsReady;
      const current=autoplaySettings();
      const state=await rpc('autoStatus',{},2500);
      if(!state||['enabled','onReturn','respectPause','muteFallback']
        .some(key=>state[key]!==current[key])){
        await syncAutoSettings();
        console.warn('[Holodex Touch Controls] 检测到播放器自动播放状态失同步，已自动恢复设置');
      }
    }catch(error){
      console.warn('[Holodex Touch Controls] 播放器状态校验失败',error);
    }finally{agentHealthBusy=false;}
  }

  async function setAutoEnabled(enabled){
    // Start player control immediately; persist+verify GM record in parallel.
    const saving=setAutoValue(AUTO_ENABLED_KEY,!!enabled);
    if(settings?.isConnected){
      settings.querySelector('[data-control="autoEnabled"]').checked=!!enabled;
      const indicator=settings.querySelector('[data-field="autoState"]');
      if(indicator)indicator.textContent=enabled?
        '当前已开启：进入／刷新多视图会自动尝试播放':
        '当前已关闭：刷新后不会自动尝试播放';
    }
    const tasks=[
      (!isMulti()||!installed?
        Promise.resolve({enabled:!!enabled,ready:false}):syncAutoSettings()),
      Promise.resolve(saving)
    ];
    const [synced,persisted]=await Promise.allSettled(tasks);
    if(synced.status==='rejected')
      throw new Error('播放器同步失败：'+synced.reason?.message);
    if(synced.value?.enabled!==!!enabled)
      throw new Error('播放器返回的自动播放状态与设置不一致');
    if(persisted.status==='rejected')
      throw new Error('已应用到播放器，但未能确认跨刷新保存：'+persisted.reason?.message);
    return {...synced.value,persistence:persisted.value};
  }
  async function enableMutedRecovery(){
    if(!isMulti()||!installed)
      throw new Error('请先打开 Holodex 多视图并确认播放器已就绪');
    if(!autoplaySettings().enabled)
      throw new Error('请先开启智能自动播放总开关');
    // Explicit user opt-in: all currently PLAYING cells are skipped by the
    // page agent. Only a still-paused/blocked stream may be newly muted.
    const saving=setAutoValue(AUTO_MUTE_KEY,true);
    if(settings?.isConnected)
      settings.querySelector('[data-control="autoMute"]').value='mute';
    const [synced,persisted]=await Promise.allSettled([
      syncAutoSettings(),Promise.resolve(saving)
    ]);
    if(synced.status==='rejected')
      throw new Error('播放器设置同步失败：'+synced.reason?.message);
    if(synced.value?.muteFallback!==true)
      throw new Error('播放器未确认启用静音回退');
    if(persisted.status==='rejected')
      throw new Error('当前已开启静音回退，但保存失败：'+
        persisted.reason?.message);
    return synced.value;
  }

  function diagnoseAutoPlay(resynced=false){
    if(!isMulti())return alert('请先进入 Holodex 多视图。');
    if(!installed)return alert('播放器页面桥接尚未就绪。请确认脚本启用并完整刷新多视图页面。');
    autoPrefsReady.then(()=>rpc('autoDiagnose',{},4200)).then(data=>{
      const saved=autoplaySettings();
      if(saved.enabled!==data.enabled&&!resynced){
        // A delayed GM write or page bridge startup may leave the in-page
        // playback engine out of sync. Repair once without changing the
        // user's explicit preference.
        syncAutoSettings()
          .then(()=>diagnoseAutoPlay(true))
          .catch(error=>alert('自动播放配置尚未同步：'+error.message));
        return;
      }
      const rows=data.rows||[];
      const pref=autoPreferenceSource();
      const versionConflict=pref.canonicalValid&&
        pref.gmRecordEnabled!==pref.savedEnabled?
        '（警告：主记录与本页值不同）':'';
      const agentBoot=data.boot?.received?
        (data.boot.initialEnabled?'创建时已启用':'创建时已关闭'):
        '未收到初始配置';
      const configAgreement=saved.enabled===data.enabled?'一致':'不一致';
      const prefix='智能自动播放 v'+(data.version||'0.5.6')+
        '\n状态：'+(data.enabled?'已启用':'已关闭')+
        '｜识别：'+(data.detected||0)+' 路'+
        '\n代理启动：'+agentBoot+
        '｜状态匹配：'+configAgreement+
        '｜RPC 配置：'+(data.boot?.lastRpcConfigAt?'已收到':'待校验')+
        '\n设置来源：'+pref.source+versionConflict+
        '\nGM 主记录：'+(pref.canonicalValid?
          (pref.gmRecordEnabled?'已启用':'已关闭'):'未找到／读取无效')+
        '｜GM 旧键：'+(pref.gmEnabled===null?'未知':
          pref.gmEnabled?'已启用':'已关闭')+
        '\n存储校验：同步 '+(pref.syncVerified?'通过':'未验证')+
        '／异步 '+(pref.asyncVerified?'通过':'未验证')+
        '／初始化 '+(pref.hydrationComplete?'完成':'进行中')+
        (!pref.backupAvailable?'\n注意：Holodex 网站存储不可用':'')+
        (pref.backupError?'\n存储提示：'+pref.backupError.slice(0,120):'')+
        '\n声音策略：'+(data.muteFallback?'失败后允许静音':'保留原有音量（静音回退关闭）');
      const lines=rows.slice(0,16).map((row,i)=>
        (i+1)+'. '+row.title.slice(0,30)+
        '\n   '+row.description+'｜'+row.issue+
        '｜尝试 '+row.tries+' 次'+
        (row.mutePending?'｜静音指令已发出，等待播放':'')+
        (row.mutedStartAttempts?'｜静音回退请求 '+row.mutedStartAttempts+' 次':''));
      const entries=rows.length?lines.join('\n')+
        (rows.length>16?'\n……另有 '+(rows.length-16)+' 路':''):
        '没有找到有效的 YouTube 视频格子；请等待布局加载，确认不是 Twitch／聊天格子。';
      const report=prefix+'\n\n'+entries;
      if(!data.enabled){
        // If the saved preference is ON but the page agent still says OFF,
        // this is a transport/initialization failure, not a user preference.
        // Do not ask the user to "enable" something already enabled.
        if(saved.enabled){
          alert(report+'\n\n异常：GM 设置已启用，但播放器代理仍关闭。'+
            '后台核对会尝试恢复。若持续出现，请保留本诊断中的代理启动信息。');
          return;
        }
        if(confirm(report+
          '\n\n当前智能自动播放已关闭，因此不会自动启动。'+
          '\n\n点击「确定」立即开启并尝试播放；点击「取消」保持关闭。')){
          setAutoEnabled(true)
            .then(()=>diagnoseAutoPlay(true))
            .catch(error=>alert('启用失败：'+error.message));
        }
        return;
      }
      const hasBlocked=rows.some(row=>
        /浏览器拦截|浏览器拒绝|阻止自动播放|浏览器已阻止/.test(row.issue));
      if(hasBlocked&&!data.muteFallback){
        if(confirm(report+
          '\n\n两路或更多视频可能都被浏览器的有声自动播放策略阻止。'+
          '点击「确定」允许【仅对未播放的视频】静音后再次尝试；'+
          '已经正常播放的视频不会被静音或重启。'+
          '\n点击「取消」保留当前声音策略。')){
          enableMutedRecovery()
            .then(()=>setTimeout(()=>diagnoseAutoPlay(true),650))
            .catch(error=>alert('静音回退启用失败：'+error.message));
        }
        return;
      }
      alert(report+'\n\n如果仍显示浏览器拦截，即使静音后也无法自动播放，'+
        '需要浏览器许可或在页面内直接操作播放器。');
    }).catch(error=>alert('播放诊断未完成：'+error.message));
  }
  function manualAutoPlay(){
    if(!isMulti())return alert('请先进入 Holodex 多视图页面。');
    if(!installed)return alert('多视图播放器尚未就绪，请刷新页面再试。');
    rpc('autoKick',{},4200).then(result=>{
      alert('已尝试启动 '+(result.attempted||0)+' 路；正在播放 '+
        (result.playing||0)+' 路；等待初始化 '+(result.waiting||0)+
        ' 路。若浏览器禁止有声自动播放，请在页面内点一下，再尝试播放。');
    }).catch(error=>alert('播放请求未完成：'+error.message));
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
  function nativeRequest(row,action,timeout=1800,extra={}) {
    if(!['stats','nativeToggle','monitorStart','monitorStop','desktopPanelStatus','statsDiagnostics',
          'playbackClock','playbackInfo','playbackRate','qualityMenu',
          'qualityOptions','selectQuality'].includes(action))
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
          {tag:NATIVE_TAG,seq,videoId:row.videoId,action,status:row.status,...extra},
          target.origin
        );
      }catch(error){
        clearTimeout(timer);
        nativePending.delete(seq);
        reject(error);
      }
    });
  }
  function configureDesktopFrame(row){
    const target=nativeFrame(row);
    if(!target)return;
    try{target.frame.contentWindow.postMessage({tag:NATIVE_TAG,seq:++nativeSequence,
      videoId:row.videoId,action:'desktopPanelConfig',
      enabled:!touchZonesAllowed()&&desktopMountAllowed()&&isMulti()},target.origin);}catch{}

  }
  function receiveDesktopFrameMessage(event){
    const message=event.data;
    if(message?.tag!==DESKTOP_TAG||!YT_ORIGINS.has(event.origin))return false;
    if(!['open','move','dismiss','escape','mouse','ready'].includes(message.type)||!isMulti())return true;
    let matched=null;
    for(const row of rowMap.values()){
      if(row.videoId!==message.videoId)continue;
      const target=nativeFrame(row);
      if(target&&target.origin===event.origin&&target.frame.contentWindow===event.source){matched={row,...target};break;}
    }
    if(!matched)return true;
    if(message.type==='ready'){configureDesktopFrame(matched.row);return true;}
    if(message.type==='mouse'){
      observeMouseInput({pointerType:'mouse'});configureDesktopFrame(matched.row);return true;
    }
    if(touchZonesAllowed()||!desktopMountAllowed())return true;
    if(message.type==='dismiss'||message.type==='escape'){
      if(settings?.hidden===false)closeSettings();else if(sheet&&!sheet.hidden)closeSheet();
      return true;
    }
    if(typeof message.x!=='number'||typeof message.y!=='number'||
       !Number.isFinite(message.x)||!Number.isFinite(message.y)||
       message.x<0||message.x>1||message.y<0||message.y>1)return true;
    const r=matched.frame.getBoundingClientRect();
    if(!(r.width>0&&r.height>0))return true;
    const point={x:r.left+message.x*r.width,y:r.top+message.y*r.height};
    desktopLastPoint=point;
    if(message.type==='open'){closeSettings();openSheet(matched.row,point);}
    return true;
  }
  window.addEventListener('message',event=>{
    if(receiveDesktopFrameMessage(event))return;
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
    if(el){
      el.textContent=String(text);
      if(name==='note')el.hidden=!text;
    }
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
        if(!touchZonesAllowed()||zone._gesture!==gesture||gesture.moved||gesture.held||
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
          // Only suppress a menu belonging to our active touch/pen hold.
          if(touchZonesAllowed()&&gesture&&allowsHold()&&
             (gesture.held||gesture.timer)){e.preventDefault();e.stopPropagation();}
        });
        zone.addEventListener('click',e=>{
          if(!touchZonesAllowed()||e.button!==0)return;
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
    bindPanelRightClose(sheet,closeSheet);
    sheet.setAttribute('role','dialog');
    sheet.setAttribute('aria-label','YouTube 当前视频控制和详细统计');
    sheet.innerHTML=[
      '<div class="hmtc-dismiss-zone" data-action="dismissHeader" title="轻点任意统计数据收起">',
      '<div class="head" data-action="dismissHeader" title="轻点标题收起">',
      '<div class="title" data-field="title">YouTube</div>',
      '<button type="button" data-action="close" aria-label="关闭">✕</button></div>',
      '<div class="hmtc-live-status" data-hmtc-latency-metric data-kind="unknown">',
      '<span class="hmtc-media-kind" data-hmtc-media-kind>待确认</span>',
      '<span data-hmtc-latency-label>视频状态</span><strong data-field="latency" data-hmtc-latency-value>识别中</strong></div>',
      '<div class="net"><div class="sub">连接速度</div>',
      '<div><span class="speed" data-field="speed">—</span><span class="unit">Mbps</span>',
      '<span class="speedFreshness" data-field="speedFreshness"></span></div></div>',
      '<div class="grid">',
      '<div class="metric hmtc-playtime-metric"><label data-field="positionLabel" data-hmtc-time-label>播放时间</label>',
      '<strong data-field="position">—</strong></div>',
      '<div class="metric"><label>缓冲</label><strong data-field="health">—</strong></div>',
      '<div class="metric"><label>分辨率</label><strong data-field="resolution">—</strong></div>',
      '</div></div>',
      '<div class="hmtc-play-controls">',
      '<div class="hmtc-play-row"><label>播放速度</label></div>',
      '<div class="hmtc-rate-presets" role="group" aria-label="常用播放速度">',
      '<button type="button" data-action="ratePreset" data-rate="1">1×</button>',
      '<button type="button" data-action="ratePreset" data-rate="1.25">1.25×</button>',
      '<button type="button" data-action="ratePreset" data-rate="1.5">1.5×</button>',
      '<button type="button" data-action="ratePreset" data-rate="1.75">1.75×</button>',
      '<button type="button" data-action="ratePreset" data-rate="2">2×</button></div>',
      '<div class="hmtc-play-row"><label>画质</label></div>',
      '<div class="hmtc-quality-presets" role="group" aria-label="画质快捷档位"></div>',
      '<a class="hmtc-youtube-quality-link"',
      ' data-field="youtubeQualityLink" target="_blank" rel="noopener noreferrer"',
      ' href="https://www.youtube.com/" hidden>在 YouTube 调整画质</a>',
      '</div>',
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
      '<div class="note" data-field="note" hidden></div>'
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
        if(touchZonesAllowed()&&e.target.closest('[data-action="dismissHeader"]'))closeSheet();
        return;
      }
      const action=btn.dataset.action;
      if(action==='close'){closeSheet();return;}
      if(action==='settings'){openSettings();return;}
      const row=active&&rowMap.get(active.layoutId+':'+active.videoId);
      if(!row)return;
      if(action==='qualityPreset'){
        await applyHolodexQuality(row,btn);
        return;
      }
      if(action==='ratePreset'){
        const requested=Number(btn.dataset.rate);
        if(!COMMON_RATES.includes(requested))return;
        btn.disabled=true;
        try{
          const result=await rpc('setPlaybackRate',{
            layoutId:row.layoutId,videoId:row.videoId,rate:requested
          },3200);
          updateSheetRate(result);
          field('note',result.confirmed?
            '播放速度已切换为 '+result.rate+'×':
            '已请求 '+requested+'×，但当前实际倍速仍为 '+result.rate+'×');
          setTimeout(()=>{
            if(active?.layoutId===row.layoutId&&active?.videoId===row.videoId)stats();
          },450);
        }catch(error){field('note','倍速暂不可用：'+error.message);}
        finally{btn.disabled=false;}
        return;
      }
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
    bindPanelRightClose(settings,closeSettings);
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
      '<div class="setting" style="padding-top:12px;border-top:1px solid #ffffff26">',
      '<label>智能自动播放 · 适用于 PC 和安卓</label>',
      '<div class="setting-summary" data-field="autoState">当前状态读取中…</div>',
      '<label class="hmtc-toggle"><input type="checkbox" data-control="autoEnabled">',
      '<span>进入/刷新多视图时启动未播放的视频</span></label>',
      '<label class="hmtc-toggle"><input type="checkbox" data-control="autoReturn">',
      '<span>切回标签页时检查并恢复</span></label>',
      '<label class="hmtc-toggle"><input type="checkbox" data-control="autoRespectPause">',
      '<span>尊重已识别的手动暂停</span></label>',
      '<div class="setting-summary">播放中与缓冲中的视频不会重启；结束的录像不自动从头播放。',
      '前台观察到从播放转为暂停时视作手动暂停，当前标签页刷新后仍记住。</div>',
      '<label for="hmtc-auto-mute" style="margin-top:12px">播放被限制时的声音策略</label>',
      '<select id="hmtc-auto-mute" data-control="autoMute">',
      '<option value="keep">保持原有静音和音量（默认）</option>',
      '<option value="mute">检测到浏览器拦截后，先静音再重试（推荐）</option>',
      '</select>',
      '<div class="setting-summary">仅未播放的格子可静音回退；先向 YouTube 发送静音，再延时播放，避免静音尚未生效就重试。已在播放的格子不会更改音量。</div>',
      '<button type="button" data-action="autoNow" style="width:100%;margin-top:12px">立即尝试播放未播放视频</button>',
      '<button type="button" data-action="autoDiagnose" style="width:100%;margin-top:7px">查看每路自动播放状态与失败原因</button>',
      '</div>',
      '<div class="setting-summary" style="margin-top:16px">',
      '安卓触控区域左右各宽 36%，最大 112px，纵向覆盖 11%–89%。',
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
    const autoInputs=[
      ['autoEnabled',AUTO_ENABLED_KEY],
      ['autoReturn',AUTO_RETURN_KEY],
      ['autoRespectPause',AUTO_PAUSE_KEY]
    ];
    for(const [name,key] of autoInputs){
      settings.querySelector('[data-control="'+name+'"]').addEventListener('change',e=>{
        const status=settings.querySelector('[data-field="autoState"]');
        if(name==='autoEnabled'&&status)
          status.textContent=e.target.checked?
            '当前已开启：进入／刷新多视图会自动尝试播放':
            '当前已关闭：刷新后不会自动尝试播放';
        Promise.resolve(setAutoValue(key,!!e.target.checked))
          .catch(error=>console.warn('[HMTC] 自动播放设置持久镜像',error));
        syncAutoSettings().catch(error=>
          console.warn('[HMTC] 自动播放设置同步',error));
      });
    }
    settings.querySelector('[data-control="autoMute"]').addEventListener('change',e=>{
      Promise.resolve(setAutoValue(AUTO_MUTE_KEY,e.target.value==='mute'))
        .catch(error=>console.warn('[HMTC] 自动播放静音设置持久镜像',error));
      syncAutoSettings().catch(error=>
        console.warn('[HMTC] 自动播放静音设置同步',error));
    });
    settings.querySelector('[data-action="autoNow"]').addEventListener('click',manualAutoPlay);
    settings.querySelector('[data-action="autoDiagnose"]').addEventListener('click',diagnoseAutoPlay);
    return settings;
  }
  function openSettings(){
    makeSettings();
    settings.querySelector('[data-control="sensitivity"]').value=String(getSensitivity());
    settings.querySelector('[data-value="sensitivity"]').textContent=getSensitivity().toFixed(1)+'×';
    settings.querySelector('[data-control="statsMode"]').value=getStatsMode();
    const config=autoplaySettings();
    settings.querySelector('[data-control="autoEnabled"]').checked=config.enabled;
    settings.querySelector('[data-field="autoState"]').textContent=config.enabled?
      '当前已开启：进入／刷新多视图会自动尝试播放':
      '当前已关闭：刷新后不会自动尝试播放';
    settings.querySelector('[data-control="autoReturn"]').checked=config.onReturn;
    settings.querySelector('[data-control="autoRespectPause"]').checked=config.respectPause;
    settings.querySelector('[data-control="autoMute"]').value=config.muteFallback?'mute':'keep';
    settings.hidden=false;
    presentPanel(settings,sheet&&!sheet.hidden?desktopPanels.get(sheet)?.anchor:undefined);
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

  // The actual Connection Speed field can disappear for one iframe sample
  // even while YouTube's network estimator is running. Hold a genuine
  // reading for <= 6s, with an explicit stale label; never estimate Mbps.
  let lastHolodexSpeed=null;
  function renderYouTubeStats(data,reason) {
    const key=active?active.layoutId+':'+active.videoId:'';
    const now=Date.now();
    const kbps=Number(data?.bandwidthKbps);
    const measured=!!data?.available&&Number.isFinite(kbps)&&kbps>0;
    if(measured){
      lastHolodexSpeed={key,kbps,source:data.source||'原生统计',at:now};
      field('speed',(kbps/1000).toFixed(2));
      field('speedFreshness','');
    }else if(lastHolodexSpeed&&lastHolodexSpeed.key===key&&
             now-lastHolodexSpeed.at>=0&&now-lastHolodexSpeed.at<=6000){
      const age=Math.round((now-lastHolodexSpeed.at)/1000);
      field('speed',(lastHolodexSpeed.kbps/1000).toFixed(2));
      field('speedFreshness','上次 '+age+'s');
    }else{
      field('speed','—');
      field('speedFreshness','');
    }
    field('health',typeof data?.bufferSeconds==='number'
      ? data.bufferSeconds.toFixed(1)+' s':'—');
    field('resolution',currentResolution(data?.resolution)||'—');
    if(typeof data?.live==='boolean')renderMediaKind(sheet,data);
    renderLatency(sheet,data);
  }
  function updateSheetRate(data){
    if(!sheet||sheet.hidden||!data)return;
    const actual=Number(data.rate)||1;
    for(const btn of sheet.querySelectorAll('[data-action="ratePreset"]')){
      const selected=Math.abs(Number(btn.dataset.rate)-actual)<.001;
      btn.classList.toggle('hmtc-rate-selected',selected);
      btn.setAttribute('aria-pressed',selected?'true':'false');
    }
  }

  function timestamp(n){
    if(n==null||n===''||typeof n==='boolean'||!Number.isFinite(Number(n))||Number(n)<0)return '—';
    n=Math.floor(Number(n));
    return String(Math.floor(n/3600)).padStart(2,'0')+':'+
      String(Math.floor(n%3600/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  }
  function playbackTimeText(v){
    if(!v?.ready)return '—';
    const position=timestamp(v.position),duration=timestamp(v.duration);
    if(position==='—')return '—';
    if(v.live===true)return position;
    if(v.live!==false)return Number(v.position)===0&&!(Number(v.duration)>0)?'—':position+' / —';
    // IFrame API returns 0/0 before media metadata is available. That is not
    // a verified playback position or a real zero-length video.
    if(!(Number(v.duration)>0))return '—';
    return position+' / '+duration;
  }
  function mergePlaybackClock(primary,fallback,row){
    const hint=row?.status||fallback?.status;
    let state=resolvePlaybackState(primary||{},hint);
    if(state.live==null)state=resolvePlaybackState(fallback||{},hint);
    const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
    const duration=valid(primary?.duration)&&primary.duration>0?primary.duration:
      valid(fallback?.duration)&&fallback.duration>0?fallback.duration:null;
    const position=valid(primary?.position)?primary.position:valid(fallback?.position)?fallback.position:null;
    return {...primary,ready:primary?.ready===true||fallback?.ready===true,
      live:state.live,liveReason:state.reason,duration,position,
      durationSource:primary?.duration>0?primary.durationSource:duration>0?'holodex-api':''};
  }
  async function readMultiviewClock(row){
    const fallback=rpc('stats',{layoutId:row.layoutId,videoId:row.videoId},2200).then(v=>v,()=>null);
    let primary=null;
    try{
      primary=await nativeRequest(row,'playbackClock',1300);
      const value=mergePlaybackClock(primary,null,row);
      if(value.live!=null&&playbackTimeText(value)!=='—'&&(value.live||value.duration>0))return value;
    }catch{}
    return mergePlaybackClock(primary,await fallback,row);
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
    const playback=readMultiviewClock(row).then(v=>{
      if(!stillActive())return;
      // Live must NOT hide time. getDuration() on a live YouTube player can
      // be a sliding DVR window, so don't mislabel it as total stream length.
      field('positionLabel','播放时间');
      field('position',playbackTimeText(v));
      renderMediaKind(sheet,v);
    }).catch(error=>{
      if(stillActive())field('position','暂时无法读取');
    });
    const rate=rpc('playback',{
      layoutId:row.layoutId,videoId:row.videoId
    },2600).then(data=>{
      if(stillActive())updateSheetRate(data);
    }).catch(error=>{
      if(stillActive())field('note','播放速度暂不可用：'+error.message);
    });
    const native=ensureNativeCollector(row).then(()=>{
      if(!stillActive())return;
      return nativeRequest(row,'stats',1750);
    }).then(v=>{
      if(v&&stillActive())renderYouTubeStats(v);
    }).catch(error=>{
      if(stillActive())renderYouTubeStats(null,error.message||'YouTube iframe 未响应');
    });
    try {await Promise.allSettled([playback,rate,native]);}
    finally {statsBusy=false;}
  }

  // Read current video's levels through the iframe bridge; keep a small
  // fallback link if the browser disallows injection into the embed.
  let qualityRenderEpoch=0,qualityBusy=false;
  function markHolodexQuality(value){
    for(const button of sheet?.querySelectorAll('[data-action="qualityPreset"]')||[]){
      const selected=!!value&&button.dataset.quality===value;
      button.classList.toggle('hmtc-quality-selected',selected);
      button.setAttribute('aria-pressed',selected?'true':'false');
    }
  }
  async function renderHolodexQualities(row){
    const epoch=++qualityRenderEpoch,key=row.layoutId+':'+row.videoId;
    const grid=sheet?.querySelector('.hmtc-quality-presets');
    const link=sheet?.querySelector('[data-field="youtubeQualityLink"]');
    if(!grid||!link)return;
    grid.replaceChildren();
    link.hidden=true;
    const same=()=>!!active&&!sheet.hidden&&qualityRenderEpoch===epoch&&
      active.layoutId+':'+active.videoId===key;
    const showLink=()=>{grid.replaceChildren();link.hidden=false;};
    try{
      const catalog=await nativeRequest(row,'qualityOptions',2700);
      if(!same())return;
      const choices=(catalog?.choices||[]).filter(x=>x.value!=='tiny');
      if(catalog?.method!=='internal-range'||!choices.length){
        showLink();return;
      }
      for(const choice of choices){
        const button=document.createElement('button');
        button.type='button';
        button.dataset.action='qualityPreset';
        button.dataset.quality=choice.value;
        button.textContent=choice.label;
        button.setAttribute('aria-pressed','false');
        grid.appendChild(button);
      }
      markHolodexQuality(catalog.selected);
    }catch{
      if(same())showLink();
    }
  }
  async function applyHolodexQuality(row,button){
    if(qualityBusy||!button?.dataset.quality)return;
    const grid=sheet?.querySelector('.hmtc-quality-presets');
    if(!grid)return;
    const key=row.layoutId+':'+row.videoId;
    qualityBusy=true;
    for(const item of grid.querySelectorAll('button'))item.disabled=true;
    const still=()=>!!active&&!sheet.hidden&&active.layoutId+':'+active.videoId===key;
    try{
      const result=await nativeRequest(row,'selectQuality',4300,{quality:button.dataset.quality});
      if(!still())return;
      if(result.confirmed)markHolodexQuality(button.dataset.quality);
      else{
        markHolodexQuality(result.reported);
        field('note','画质未确认');
      }
    }catch(error){
      if(still())field('note','画质失败：'+error.message);
    }finally{
      qualityBusy=false;
      if(still())for(const item of grid.querySelectorAll('button'))item.disabled=false;
    }
  }
  function openSheet(row,anchor){
    if(!desktopMountAllowed())return;
    if(settings?.hidden===false)closeSettings();
    makeSheet();
    if(active&&(active.layoutId!==row.layoutId||active.videoId!==row.videoId))
      stopNativeCollector();
    active={layoutId:row.layoutId,videoId:row.videoId};
    sheet.hidden=false;
    const videoFrame=nativeFrame(row)?.frame||
      document.querySelectorAll('.multiview .mv-cell > .cell-content')[row.index]?.querySelector('.mv-frame');
    presentPanel(sheet,touchZonesAllowed()?anchor:desktopVideoAnchor(videoFrame));
    if(backdrop)backdrop.hidden=!touchZonesAllowed();
    field('title',row.title||row.videoId);
    renderMediaKind(sheet,resolvePlaybackState({},row.status));
    field('note','');
    renderVolume(row);
    renderYouTubeStats(null,'正在读取 YouTube 嵌入播放器…');
    updateSheetRate({rate:1,rates:[.5,1,1.5,2]});
    field('position','读取中…');
    const qualityLink=sheet.querySelector('[data-field="youtubeQualityLink"]');
    if(qualityLink&&/^[\w-]{11}$/.test(row.videoId||'')){
      qualityLink.href='https://www.youtube.com/watch?v='+encodeURIComponent(row.videoId);
    }
    renderHolodexQualities(row);
    stats();
    clearInterval(statsInterval);statsInterval=setInterval(stats,1800);
  }
  function closeSheet(){
    ++qualityRenderEpoch;
    active=null;
    if(sheet)sheet.hidden=true;
    if(backdrop)backdrop.hidden=true;
    if(settings?.hidden===false)closeSettings();
    clearInterval(statsInterval);statsInterval=null;
    stopNativeCollector();
  }

  // Fixed overlay portals let each multiview video show its own clock/speed
  // without touching cross-origin frames or the existing edge gestures.
  const hudCells=new Map();
  let hudBusy=false;
  function hudSessionStop(cell){
    if(!cell?.monitorWin)return;
    if(active&&(active.layoutId+':'+active.videoId)===cell.key)return;
    try{
      cell.monitorWin.postMessage({tag:NATIVE_TAG,seq:++nativeSequence,
        videoId:cell.videoId,action:'monitorStop'},cell.monitorOrigin);
    }catch{}
    cell.monitorWin=null;cell.monitorOrigin=null;
  }
  function hudCellDispose(cell){
    if(!cell)return;
    clearTimeout(cell.button._hmtcHudTimer);
    hudSessionStop(cell);cell.button.remove();
  }
  function clearHudCells(){
    for(const cell of hudCells.values())hudCellDispose(cell);
    hudCells.clear();
  }
  function attachCornerHud(root,row){
    const frame=root?.querySelector('.mv-frame');
    if(!frame)return;
    const rect=frame.getBoundingClientRect();
    const key=row.layoutId+':'+row.videoId;
    let cell=hudCells.get(key);
    if(cell?.frame!==frame){
      if(cell)hudCellDispose(cell);
      cell={key,frame,videoId:row.videoId,button:createCornerHud(),
        time:'—',speed:'—',lastSpeed:null,monitorWin:null,monitorOrigin:null};
      hudCells.set(key,cell);
    }
    const layer=document.fullscreenElement||document.body;
    if(cell.button.parentNode!==layer)layer.appendChild(cell.button);
    cell.button.hidden=rect.width<65||rect.height<45||rect.bottom<=0||
      rect.top>=innerHeight||rect.right<=0||rect.left>=innerWidth;
    cell.button.style.left=Math.max(0,rect.left+2)+'px';
    cell.button.style.top=Math.max(0,rect.top+2)+'px';
    cell.button.style.maxWidth=Math.max(1,Math.min(240,rect.width-4,innerWidth-Math.max(0,rect.left+2)-2))+'px';
    displayCornerHud(cell.button,cell.time,cell.speed);

  }
  function hudSpeedValue(cell,kbps){
    const now=Date.now();
    if(Number.isFinite(kbps)&&kbps>0){
      cell.lastSpeed={kbps,at:now};
      return hudSpeedReading(kbps);
    }
    const last=cell.lastSpeed;
    return last?hudSpeedReading(last.kbps,true,last.at):hudSpeedReading(NaN);
  }
  async function pollCornerHuds(){
    if(hudBusy||!installed||!isMulti()||document.hidden)return;
    const wantTime=hudWantsTime(),wantSpeed=hudWantsSpeed();
    hudBusy=true;
    try{
      const cells=[...hudCells.values()].filter(cell=>!cell.button.hidden).slice(0,12);
      await Promise.allSettled(cells.map(async cell=>{
        const row=rowMap.get(cell.key);
        if(!row)return;
        const instance=cell;
        const stillHere=()=>hudCells.get(cell.key)===instance&&
          rowMap.has(cell.key)&&isMulti();
        const jobs=[];
        if(wantTime)jobs.push(
          readMultiviewClock(row)
            .then(v=>{
              if(!stillHere())return;
              cell.time=playbackTimeText(v);
            }).catch(()=>{if(stillHere())cell.time='—';})
        );
        if(wantSpeed)jobs.push((async()=>{
          try{
            const target=nativeFrame(row);
            if(!target)throw Error('No iframe');
            if(cell.monitorWin&&cell.monitorWin!==target.frame.contentWindow){
              hudSessionStop(cell);cell.lastSpeed=null;
            }
            cell.monitorWin=target.frame.contentWindow;
            cell.monitorOrigin=target.origin;
            // Idempotent; recovers after a sheet closes or player reloads.
            await nativeRequest(row,'monitorStart',1500);
            const data=await nativeRequest(row,'stats',1700);
            if(stillHere())cell.speed=hudSpeedValue(cell,
              data?.available?Number(data.bandwidthKbps):NaN);
          }catch{
            if(stillHere())cell.speed=hudSpeedValue(cell,NaN);
          }
        })());
        else hudSessionStop(cell);
        await Promise.allSettled(jobs);
        if(stillHere())displayCornerHud(cell.button,cell.time,cell.speed);
      }));
    }finally{hudBusy=false;}
  }
  function hudModeChanged(){
    if(!hudWantsSpeed())
      for(const cell of hudCells.values())hudSessionStop(cell);
    for(const cell of hudCells.values())
      displayCornerHud(cell.button,cell.time,cell.speed);
    pollCornerHuds();
  }
  document.addEventListener('hmtc:corner-hud-change',hudModeChanged);
  async function refresh(){
    if(!installed||listing||!isMulti()||document.hidden)return;
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
        if(touchZonesAllowed()&&get(EDGE_KEY,true))attachEdges(roots[row.index],row);
        attachCornerHud(roots[row.index],row);
        configureDesktopFrame(row);
        if(active&&active.layoutId+':'+active.videoId===key)renderVolume(row);
      }
      for(const key of rowMap.keys())if(!validKeys.has(key))rowMap.delete(key);
      for(const [key,cell] of hudCells)if(!validKeys.has(key)){
        hudCellDispose(cell);hudCells.delete(key);
      }
      // Remove obsolete v0.2.x icon and any edge area disabled or recycled.
      for(const root of roots){
        const frame=root.querySelector('.mv-frame');
        frame?.querySelector('.hmtc-zone')?.remove();
        for(const edge of frame?.querySelectorAll('.hmtc-edge')||[]){
          if(!touchZonesAllowed()||!get(EDGE_KEY,true)||!validKeys.has(edge.dataset.key)||
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

    // Stats/settings are available on every device; only broad gesture zones
    // are gated to touch-only input. Hybrid PCs keep the normal mouse target.
    installDesktopDismiss(()=>{if(settings?.hidden===false)closeSettings();else if(sheet&&!sheet.hidden)closeSheet();});
    document.addEventListener('contextmenu',event=>{
      if(!isMulti())return;
      const frame=event.target?.closest?.('.mv-frame');
      const point=desktopContextPoint(event,frame);
      if(!point)return;
      const roots=[...document.querySelectorAll('.multiview .mv-cell > .cell-content')];
      const row=[...rowMap.values()].find(r=>roots[r.index]?.querySelector('.mv-frame')===frame);
      if(!row)return;
      event.preventDefault();event.stopPropagation();closeSettings();openSheet(row,point);
    },{capture:true});
    GM_registerMenuCommand('左上角信息：切换时间／速度／隐藏',cycleHudMode);
    setInterval(pollCornerHuds,2200);
    window.addEventListener('pagehide',clearHudCells,{passive:true});
    setInterval(()=>{
      if(isMulti()&&!document.hidden)for(const row of rowMap.values())configureDesktopFrame(row);
    },1800);
    GM_registerMenuCommand('诊断视频类型／时长／延迟',async()=>{
      const selected=active&&rowMap.get(active.layoutId+':'+active.videoId);
      const rows=selected?[selected]:[...rowMap.values()].slice(0,12);
      if(!rows.length)return alert('请先打开多视图视频。');
      const reasons={'not-live':'已识别为录像，没有直播延迟','media-type-unknown':'当前直播／录像状态未确认',
        'no-latency-api':'未开放直播延迟读取接口','latency-field-absent':'可用接口未返回明确的延迟字段',
        'unrecognized-latency-units':'返回了延迟字段或文字，但单位无法确认','latency-value-invalid':'有明确单位的延迟字段，但值为空、无效或为负数','available':'已读取实际延迟'};
      const typeReasons={'player-not-live':'播放器明确标记为非直播','past-broadcast':'直播结束标记',
        'broadcast-details':'正在直播标记','player-live':'播放器明确标记直播','player-is-live':'播放器直播状态接口',
        'player-live-class':'当前播放器直播界面','visible-player-live-badge':'当前播放器直播徽标',
        'infinite-media':'直播媒体流','vod-details':'普通点播元数据','holodex-past':'Holodex录像状态',
        'holodex-live':'Holodex直播状态','historic-live-flag-only':'只有历史直播标记，当前状态未确认',
        'reported-live-state':'播放器类型返回值','unknown':'缺少判断依据'};
      const durationSources={'media':'视频媒体','player-api':'播放器接口','video-details':'视频元数据','holodex-api':'Holodex接口'};
      const reports=await Promise.all(rows.map(async row=>{
        try{
          const [clock,data]=await Promise.all([readMultiviewClock(row),nativeRequest(row,'statsDiagnostics',2200)]);
          const d=data.latencyDiagnostics||{};
          return [(row.title||row.videoId).slice(0,60),
            '类型：'+playbackKindLabel(clock)+'；依据：'+(typeReasons[clock.liveReason]||clock.liveReason||'缺少判断依据'),
            '播放时间：'+playbackTimeText(clock)+'；总时长来源：'+(durationSources[clock.durationSource]||'未读到'),
            '延迟：'+(data.liveLatencySeconds!=null?data.liveLatencySeconds+' s':data.latencyReason)+'；'+(reasons[d.reasonCode]||'诊断未返回'),
            'getLiveLatency：'+(d.getter?.supported?d.getter.status:'不存在'),
            '原版统计：'+(d.nativePanelVisible===true?'开启':d.nativePanelVisible===false?'关闭':'状态不可读'),
            ...(d.sources||[]).map(x=>x.method+'：'+(!x.available?'不存在':x.error||
              (x.latencySeconds!=null?'延迟 '+x.latencySeconds+' s':'没有可解析延迟')+(x.fields?.length?'；字段 '+x.fields.join(','):'；无延迟字段'))+
              (x.values||[]).map(v=>'\n  '+v.field+'：类型 '+v.type+'；原值 '+v.preview).join(''))
          ].join('\n');
        }catch(error){return (row.title||row.videoId)+'：'+String(error?.message||error);}
      }));
      alert('数据诊断 · v0.6.25\n'+reports.join('\n\n'));
    });
    GM_registerMenuCommand('诊断多视图右键面板',async()=>{
      const rows=[...rowMap.values()];
      if(!rows.length)return alert('尚未识别多视图视频，请刷新页面后重试。');
      const reports=await Promise.all(rows.map(async row=>{
        try{
          const d=await nativeRequest(row,'desktopPanelStatus',1800);
          return (row.title||row.videoId).slice(0,36)+'：iframe '+d.version+
            '，'+(d.paired?'已配对':'未配对')+'，'+(d.enabled?'已启用':'未启用')+'，'+d.lastContext;
        }catch(error){return (row.title||row.videoId).slice(0,36)+'：iframe 未响应或仍为旧版；'+String(error?.message||error).slice(0,100)+'；请刷新多视图并允许内嵌脚本运行';}
      }));
      alert('右键面板诊断 · v0.6.25\n'+reports.join('\n'));
    });
    GM_registerMenuCommand('智能自动播放设置（PC／安卓）',openSettings);
    GM_registerMenuCommand('立即尝试播放未播放的视频',manualAutoPlay);
    GM_registerMenuCommand('诊断多视图自动播放状态',diagnoseAutoPlay);
    GM_registerMenuCommand('▶ 允许被拦截的视频静音启动',()=>{
      if(confirm('允许尚未播放的视频在被浏览器拦截后静音重试？\n'+
        '已经正常播放的视频不会被静音或重启。')){
        enableMutedRecovery()
          .then(()=>alert('已允许对被拦截的视频静音后重试。'+
            '\n设置已保存；目前正在播放的视频音量不受影响。'))
          .catch(error=>alert('静音启动设置失败：'+error.message));
      }
    });
    GM_registerMenuCommand('▶ 开启智能自动播放（刷新后自动启动）',()=>{
      setAutoEnabled(true).then(data=>{
        alert('智能自动播放已开启；'+
          (data.persistence?.canonicalSyncOk||data.persistence?.verifiedAsync?
            '篡改猴主记录已校验。':'已写入可用的备份。')+
          '进入或刷新多视图会尝试播放未播放的视频。');
      }).catch(error=>alert('自动播放保存/启用未完全成功：'+error.message));
    });
    GM_registerMenuCommand('⏸ 关闭智能自动播放',()=>{
      setAutoEnabled(false).then(()=>{
        alert('智能自动播放已关闭，已检查存储。当前正在播放的视频不受影响。');
      }).catch(error=>alert('关闭设置未完全成功：'+error.message));
    });

    document.addEventListener('fullscreenchange',()=>{
      for(const row of rowMap.values())configureDesktopFrame(row);
    });
    watchTouchZonePolicy(()=>{
      for(const row of rowMap.values())configureDesktopFrame(row);
      // Remove immediately even if the asynchronous player refresh is busy.
      if(!touchZonesAllowed())document.querySelectorAll('.hmtc-edge').forEach(e=>e.remove());
      if(backdrop)backdrop.hidden=!sheet||sheet.hidden||!touchZonesAllowed();
      refresh();
    });
    {
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
      GM_registerMenuCommand('选择视频查看统计（PC／触屏）',()=>{
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
    GM_registerMenuCommand('Touch Controls v0.6.25 说明',()=>
      alert('v0.6.25：左上角透明信息标签采用浅蓝时间、浅青绿速度；距视频左上角2px，琥珀色小点表示6秒内旧数值。'));

    installBridge();
    let last=location.href,previousMulti=isMulti();
    setInterval(()=>{
      if(!document.body)return;
      const nowMulti=isMulti();
      if(location.href!==last){
        last=location.href;
        if(!nowMulti){
          for(const row of rowMap.values())configureDesktopFrame(row);
          closeSheet();rowMap.clear();clearHudCells();
        }
      }
      if(nowMulti){
        if(!installed)installBridge();
        else {
          refresh();
          if(!previousMulti)syncAutoSettings().catch(()=>{});
          // Reconcile rare startup races, Vue app reinitialization or another
          // extension overwriting the page-agent state. This does not create
          // playVideo loops: the page agent enforces bounded retries.
          const now=Date.now();
          if(now-lastAgentHealthCheck>=6500){
            lastAgentHealthCheck=now;
            verifyAgentAutoplayState();
          }
        }
      }
      previousMulti=nowMulti;
    },1700);
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden){
        for(const row of rowMap.values())configureDesktopFrame(row);
        refresh();pollCornerHuds();
      }
      else for(const cell of hudCells.values())hudSessionStop(cell);
      // The player-world agent independently handles return-to-tab autoplay.
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();

