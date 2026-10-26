// ==UserScript==
// @name         Holodex Touch Controls（手势音量、播放统计与智能自动播放）
// @namespace    https://github.com/lyl7410/Holodex-HyperChat-Cleaner
// @version      0.6.1
// @description  Holodex／YouTube 固定倍速快捷键、画质可用性判断与原站入口、手势音量和智能自动播放。
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
  // Common touch-sized, fixed rate presets shown on Holodex and YouTube.
  const COMMON_RATES=[0.5,0.75,1,1.25,1.5,1.75,2];
  // Shared with embedded YouTube players and ordinary YouTube watch pages.
  // YouTube removed setPlaybackQuality/getAvailableQualityLevels support in
  // 2019: NEVER call them or claim that a requested quality was applied.
  // Quality changes use the real, visible YouTube settings menu instead.
  function youtubePlaybackTools(pageDoc,getPlayer){
    const rates=[.25,.5,.75,1,1.25,1.5,1.75,2];
    const video=()=>pageDoc.querySelector('video.html5-main-video')||
      getPlayer()?.querySelector?.('video')||pageDoc.querySelector('video');
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
    // YouTube's setPlaybackQuality() was removed (2019): native DOM is the
    // ONLY attempted quality-control path. Verify the available entries;
    // never fabricate a list of resolutions or falsely claim success.
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
    async function qualityOptions(){
      const menu=await enterQualityMenu();
      const choices=[...new Set(menu.choices.map(x=>x.name))];
      closeQualityMenu();
      return {choices,native:true};
    }
    async function setQuality(name){
      if(typeof name!=='string'||name.length>90)throw Error('画质选项无效');
      const menu=await enterQualityMenu();
      const match=menu.choices.find(x=>x.name===name);
      if(!match){closeQualityMenu();throw Error('清晰度已经变化，请重新读取原生菜单');}
      match.element.click();
      return {selectedInNativeMenu:true,requested:name,
        actualResolution:snapshot().resolution,confirmedResolution:false};
    }
    async function openQualityMenu(){
      const menu=await enterQualityMenu();
      return {opened:true,submenu:menu.submenu,
        message:menu.submenu?'已展开真实 YouTube 画质选项，请选择清晰度':
          '已打开 YouTube 设置，请选择画质 / Quality'};
    }
    return {snapshot,setRate,qualityOptions,setQuality,openQualityMenu,video,getPlayer};
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
    const coarse=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0;
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
      '#hmtc-yt-panel{position:fixed;bottom:calc(10px + env(safe-area-inset-bottom,0px));',
      'left:10px;right:10px;z-index:2147482991;max-width:460px;max-height:82vh;margin:0 auto;',
      'overflow:auto;padding:16px;border-radius:20px;background:linear-gradient(135deg,#20334b,#131b2a);',
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
      '#hmtc-yt-panel .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}',
      '#hmtc-yt-panel .metric{padding:10px;border-radius:13px;background:#ffffff0b;min-width:0}',
      '#hmtc-yt-panel .metric label{display:block;font-size:11px;color:#afc2d1}',
      '#hmtc-yt-panel .metric b{font-size:15px;overflow-wrap:anywhere}',
      '#hmtc-yt-panel .row{display:flex;gap:7px;align-items:center;margin-top:10px}',
      '#hmtc-yt-panel .row label{min-width:45px;font-weight:700}',
      '#hmtc-yt-panel .row select,#hmtc-yt-panel .row input{flex:1;min-width:0}',
      '#hmtc-yt-panel .hmtc-yt-rates{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));',
      'gap:7px;margin:7px 0 12px}',
      '#hmtc-yt-panel .hmtc-yt-rates button{min-width:0;min-height:44px;',
      'padding:6px 2px;white-space:nowrap;font-size:12px}',
      '#hmtc-yt-panel .hmtc-yt-rates button.hmtc-yt-rate-active{',
      'background:#12766c!important;border-color:#78ead5!important;color:white!important}',
      '#hmtc-yt-panel .row input{height:36px;accent-color:#66dad1;touch-action:pan-x}',
      '#hmtc-yt-panel .row .quality{flex:1;min-width:0;font-size:12px;color:#9ee3df}',
      '#hmtc-yt-panel .actions{display:flex;gap:6px;margin:10px 0}',
      '#hmtc-yt-panel .actions button{flex:1}',
      '#hmtc-yt-panel .hint{font-size:11px;color:#bdd0db;margin-top:10px}',
      '#hmtc-yt-panel details{margin-top:12px;border-top:1px solid #ffffff20;padding-top:10px}',
      '#hmtc-yt-panel details summary{cursor:pointer;font-size:12px;font-weight:650;color:#b9dfdf}',
      '#hmtc-yt-panel details .row input{accent-color:#66dad1}',
      '#hmtc-yt-toast{position:fixed;z-index:2147482992;pointer-events:none;',
      'transform:translate(-50%,-50%);background:#1a2c41f5;border-radius:12px;',
      'padding:11px 15px;color:#eff;font:800 22px system-ui}',
      '@media(orientation:landscape){#hmtc-yt-panel{left:auto;right:8px;',
      'max-width:min(385px,69vw);max-height:calc(100vh - 16px)}}'
    ].join(''));
    const text=(key,value)=>{const el=sheet?.querySelector('[data-id="'+key+'"]');
      if(el)el.textContent=String(value);};
    const clock=n=>{
      if(!Number.isFinite(n)||n<0)return '—';
      const a=Math.floor(n);return Math.floor(a/3600)+':'+
        String(Math.floor(a%3600/60)).padStart(2,'0')+':'+
        String(a%60).padStart(2,'0');
    };
    function refreshSheet(){
      if(!sheet||sheet.hidden)return;
      const v=video(),snapshot=controls.snapshot();
      text('title',(document.querySelector('h1.ytd-watch-metadata')?.textContent||
        document.querySelector('h1.title')?.textContent||document.title||'YouTube')
        .replace(/\s*-\s*YouTube\s*$/,'').trim().slice(0,120));
      text('resolution',snapshot.resolution+' · 实际帧');
      text('quality',snapshot.resolution);
      text('time',clock(Number(v?.currentTime))+' / '+
        (Number.isFinite(v?.duration)?clock(v.duration):'直播'));
      text('vol',vol()+'%');text('mute',muted()?'🔇':'🔊');
      const vslider=sheet.querySelector('[data-id="slider"]');
      if(vslider&&document.activeElement!==vslider)vslider.value=String(vol());
      for(const btn of sheet.querySelectorAll('[data-action="ratePreset"]')){
        const active=Math.abs(Number(btn.dataset.rate)-snapshot.rate)<.001;
        btn.classList.toggle('hmtc-yt-rate-active',active);
        btn.setAttribute('aria-pressed',active?'true':'false');
      }
      let bandwidth=null;
      try{
        const raw=p()?.getStatsForNerdsData?.()||p()?.getStatsForNerds?.();
        bandwidth=Number(raw?.bandwidth_kbps??raw?.bandwidthKbps??
          raw?.connection_speed_kbps);
      }catch{}
      text('speed',Number.isFinite(bandwidth)&&bandwidth>0?
        (bandwidth/1000).toFixed(2)+' Mbps':'—');
      let buffer=NaN;
      try{
        const time=Number(v.currentTime),ranges=v.buffered;
        for(let i=0;i<ranges.length;i++)
          if(ranges.start(i)<=time&&time<=ranges.end(i))
            buffer=Math.max(0,ranges.end(i)-time);
      }catch{}
      text('buffer',Number.isFinite(buffer)?buffer.toFixed(1)+' s':'—');
    }
    function close(){
      if(sheet)sheet.hidden=true;
      if(backdrop)backdrop.hidden=true;
    }
    function makePanel(){
      if(sheet?.isConnected)return;
      backdrop=document.createElement('div');backdrop.id='hmtc-yt-backdrop';
      backdrop.hidden=true;backdrop.addEventListener('click',close);
      document.body.appendChild(backdrop);
      sheet=document.createElement('section');sheet.id='hmtc-yt-panel';
      sheet.hidden=true;sheet.setAttribute('role','dialog');
      sheet.setAttribute('aria-label','YouTube 视频音量、倍速、画质和统计');
      sheet.innerHTML=[
        '<div class="head"><strong data-id="title">YouTube</strong>',
        '<button data-action="close" aria-label="关闭面板">✕</button></div>',
        '<div class="grid">',
        '<div class="metric"><label>播放时间</label><b data-id="time">—</b></div>',
        '<div class="metric"><label>实际分辨率</label><b data-id="resolution">—</b></div>',
        '<div class="metric"><label>连接速度</label><b data-id="speed">—</b></div>',
        '<div class="metric"><label>已缓冲时长（估计）</label><b data-id="buffer">—</b></div></div>',
        '<div class="row"><label>播放速度</label></div>',
        '<div class="hmtc-yt-rates" role="group" aria-label="常用播放倍速">',
        '<button type="button" data-action="ratePreset" data-rate="0.5">0.5×</button>',
        '<button type="button" data-action="ratePreset" data-rate="0.75">0.75×</button>',
        '<button type="button" data-action="ratePreset" data-rate="1">1×</button>',
        '<button type="button" data-action="ratePreset" data-rate="1.25">1.25×</button>',
        '<button type="button" data-action="ratePreset" data-rate="1.5">1.5×</button>',
        '<button type="button" data-action="ratePreset" data-rate="1.75">1.75×</button>',
        '<button type="button" data-action="ratePreset" data-rate="2">2×</button></div>',
        '<div class="row"><label>画质</label><span class="quality" data-id="quality">—</span>',
        '<button data-action="quality">原生菜单 ↗</button></div>',
        '<div class="row"><label>选择</label>',
        '<select data-id="qualityList" aria-label="原生可用清晰度">',
        '<option value="">读取中…</option></select>',
        '<button data-action="applyQuality">应用</button></div>',
        '<div class="row"><button data-action="mute" data-id="mute">🔊</button>',
        '<input type="range" data-id="slider" min="0" max="100" step="1">',
        '<strong data-id="vol">—</strong></div>',
        '<div class="actions"><button data-action="minus">−10</button>',
        '<button data-action="plus">＋10</button><button data-action="full">100%</button></div>',
        '<div class="hint" data-id="hint">画质通过 YouTube 原生菜单选择；倍速以实际生效值为准。</div>',
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
        if(e.target.closest('.metric')||e.target.closest('.head strong')){
          close();return;
        }
        const action=e.target.closest('button[data-action]')?.dataset.action;
        if(!action)return;
        if(action==='close'){close();return;}
        try{
          if(action==='quality'){
            const result=await controls.openQualityMenu();
            const current=p();
            if(current){
              document.documentElement.classList.add('hmtc-yt-quality-mode');
              // Portal edges are in the top document, not descendants of the
              // player. Leave native YouTube menus touchable for 20 seconds.
              setTimeout(()=>document.documentElement.classList.remove(
                'hmtc-yt-quality-mode'),20000);
            }
            close();console.info('[HMTC]',result.message);return;
          }
          if(action==='applyQuality'){
            const select=sheet.querySelector('[data-id="qualityList"]');
            if(!select?.value){text('hint','没有检测到可用清晰度，请使用原生画质菜单');return;}
            const applied=await controls.setQuality(select.value);
            text('hint',applied.selectedInNativeMenu?
              '已在 YouTube 原生菜单选择 '+applied.requested+'，实际画质可能稍后更新。':
              'YouTube 没有确认画质选择');
            setTimeout(refreshSheet,800);
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
    async function loadWatchQuality(){
      const select=sheet?.querySelector('[data-id="qualityList"]');
      if(!select||sheet.hidden)return;
      select.disabled=true;
      try{
        const result=await controls.qualityOptions();
        if(sheet.hidden)return;
        select.replaceChildren();
        if(result.choices?.length){
          for(const quality of result.choices){
            const option=document.createElement('option');
            option.value=quality;option.textContent=quality;
            select.appendChild(option);
          }
          select.disabled=false;
        }else{
          const option=document.createElement('option');
          option.value='';option.textContent='请使用原生菜单';
          select.appendChild(option);
        }
      }catch(error){
        if(sheet.hidden)return;
        select.replaceChildren();
        const option=document.createElement('option');option.value='';
        option.textContent='画质选项不可读取';
        select.appendChild(option);
      }
    }
    function open(){
      if(!supported()||!p())return;
      makePanel();sheet.hidden=false;backdrop.hidden=false;refreshSheet();
      loadWatchQuality();
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
          if(gesture&&!gesture.moved){gesture.held=true;lastTap=Date.now();open();}
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
        if(side==='left'&&['tap','both'].includes(mode())&&Date.now()-lastTap>650){
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
      if(!player||!coarse||!setting(enabledKey,true)){
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
      if(sheet&&!sheet.hidden){if(!player)close();else refreshSheet();}
    }
    GM_registerMenuCommand('YouTube：打开快捷控制面板',open);
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
      if(['playbackInfo','playbackRate','qualityMenu','qualityOptions','selectQuality'].includes(message.action)){
        try{
          if(!player())throw Error('YouTube 播放器尚未就绪');
          let info;
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

  const VERSION='0.6.1', KEY='hmtc_enabled_v1';
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
  #hmtc-sheet .hmtc-play-controls{margin-top:13px;padding:10px 12px;border-radius:15px;
    background:#243549b8;border:1px solid #ffffff22}
  #hmtc-sheet .hmtc-play-row{display:flex;gap:6px;align-items:center;margin:5px 0}
  #hmtc-sheet .hmtc-play-row label{color:#cbd8e6;font-size:12px;min-width:64px;font-weight:650}
  #hmtc-sheet .hmtc-rate-presets{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
    gap:7px;margin:8px 0 12px}
  #hmtc-sheet .hmtc-rate-presets button{min-width:0;min-height:44px;padding:6px 3px;
    font-size:13px;white-space:nowrap}
  #hmtc-sheet .hmtc-rate-presets button.hmtc-rate-selected{
    background:#15796f!important;border-color:#80e8d2!important;
    color:#fff!important;box-shadow:inset 0 0 0 1px #a1eee766}
  #hmtc-sheet .hmtc-youtube-quality-link{display:block;width:100%;
    border:1px solid #63d8c763;background:#225065b0;color:#dbfdfa;
    text-decoration:none;text-align:center;border-radius:11px;
    padding:11px 8px;font:700 12px system-ui}
  #hmtc-sheet .hmtc-play-row select{color:#f1f9ff;background:#17283b;border:1px solid #8296a64a;
    min-height:42px;min-width:75px;flex:1;border-radius:10px;padding:8px;font:650 13px system-ui}
  #hmtc-sheet .hmtc-play-row .hmtc-quality-current{flex:1;min-width:0;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#8bdedb}
  #hmtc-sheet .hmtc-play-help{font-size:10px;color:#a5bace;line-height:1.5;margin-top:4px}
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
  #hmtc-settings .hmtc-toggle{display:flex;gap:10px;align-items:center;
    padding:8px 0;margin-bottom:0;font-size:13px;font-weight:500;cursor:pointer}
  #hmtc-settings .hmtc-toggle input{width:18px;height:18px;accent-color:#62d7d0;flex:none}
  #hmtc-settings .hmtc-toggle span{flex:1}
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
          if(!Number.isFinite(r)||!COMMON_RATES.some(x=>Math.abs(x-r)<.001))
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
    if(!['stats','nativeToggle','monitorStart','monitorStop',
          'playbackInfo','playbackRate','qualityMenu',
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
          {tag:NATIVE_TAG,seq,videoId:row.videoId,action,...extra},
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
      '<div class="hmtc-play-controls">',
      '<div class="hmtc-play-row"><label>播放速度</label></div>',
      '<div class="hmtc-rate-presets" role="group" aria-label="常用播放速度">',
      '<button type="button" data-action="ratePreset" data-rate="0.5">0.5×</button>',
      '<button type="button" data-action="ratePreset" data-rate="0.75">0.75×</button>',
      '<button type="button" data-action="ratePreset" data-rate="1">1×</button>',
      '<button type="button" data-action="ratePreset" data-rate="1.25">1.25×</button>',
      '<button type="button" data-action="ratePreset" data-rate="1.5">1.5×</button>',
      '<button type="button" data-action="ratePreset" data-rate="1.75">1.75×</button>',
      '<button type="button" data-action="ratePreset" data-rate="2">2×</button></div>',
      '<div class="hmtc-play-row"><label>当前画质</label>',
      '<span class="hmtc-quality-current" data-field="qualityStatus">读取中…</span></div>',
      '<div class="hmtc-play-row"><a class="hmtc-youtube-quality-link"',
      ' data-field="youtubeQualityLink" target="_blank" rel="noopener noreferrer"',
      ' href="https://www.youtube.com/">在 YouTube 打开视频并调整画质 ↗</a></div>',
      '<div class="hmtc-play-help">嵌入播放器未提供可用画质菜单；',
      '跳转 YouTube 原站可选择该视频真实支持的画质。不会在 Holodex 内伪装切换。</div>',
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
    field('qualityStatus','当前：'+(data?.resolution||'—'));
    field('latency',Number.isFinite(data?.liveLatencySeconds)
      ? data.liveLatencySeconds.toFixed(2)+' s':'—');
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
    field('qualityStatus','当前：待读取');
    updateSheetRate({rate:1,rates:[.5,1,1.5,2]});
    field('position','读取中…');
    const qualityLink=sheet.querySelector('[data-field="youtubeQualityLink"]');
    if(qualityLink&&/^[\w-]{11}$/.test(row.videoId||'')){
      qualityLink.href='https://www.youtube.com/watch?v='+encodeURIComponent(row.videoId);
    }
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

    // PC and mobile both get the autonomous playback engine. Touch-only UI
    // remains gated to coarse pointers and is never inserted on a mouse PC.
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

    if(coarse){
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
    GM_registerMenuCommand('Touch Controls v0.5.6 说明',()=>
      alert('v0.5.6：修复浏览器拦截时静音回退发送顺序：先直接给 YouTube 静音，稍后播放，避免同一时刻发出播放请求而被判有声自动播放。诊断可一键允许静音回退，不改变正在播放视频的音量；安卓触控与统计不变。'));

    installBridge();
    let last=location.href,previousMulti=isMulti();
    setInterval(()=>{
      if(!document.body)return;
      const nowMulti=isMulti();
      if(location.href!==last){
        last=location.href;
        if(!nowMulti&&coarse){closeSheet();rowMap.clear();}
      }
      if(nowMulti){
        if(!installed)installBridge();
        else {
          if(coarse)refresh();
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
      if(!document.hidden&&coarse)refresh();
      // The player-world agent independently handles return-to-tab autoplay.
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
