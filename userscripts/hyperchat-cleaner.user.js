// ==UserScript==
// @name         YouTube / Holodex HyperChat Cleaner
// @namespace    https://github.com/lyl7410/Holodex-HyperChat-Cleaner
// @version      2.5.0
// @description  Pure chat, adjustable message spacing and line-height, font size, paid messages and native compose.
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://holodex.net/*
// @match        https://www.holodex.net/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function Cleaner(){
'use strict';
const YT=/^(www\.|m\.)?youtube\.com$/.test(location.hostname),HD=/^(www\.)?holodex\.net$/.test(location.hostname),CHAT=YT&&/^\/live_chat(?:_replay)?\/?$/.test(location.pathname),TOP=top===self;
const KEY={font:'hcc_cleaner_v2_font',gap:'hcc_cleaner_v25_message_gap',leading:'hcc_cleaner_v25_line_height',paid:'hcc_cleaner_v21_show_paid',aa:'hcc_cleaner_v2_aa_visible',compose:'hc_cleaner_compose_enabled',mv:'hc_multiview_clean_enabled'};
const get=(k,d)=>GM_getValue(k,d),set=(k,v)=>GM_setValue(k,v);
let font=Math.max(12,Math.min(40,Number(get(KEY.font,20))||20)),gap=Math.max(0,Math.min(24,Number(get(KEY.gap,4))||0)),leading=Math.max(1,Math.min(1.9,Number(get(KEY.leading,1.25))||1.25)),paid=!!get(KEY.paid,false),aa=!!get(KEY.aa,true),compose=!!get(KEY.compose,true),mv=!!get(KEY.mv,true),button=null,host=null,aaBox=null;
const tag='hcc-v2.5',originAllowed=o=>/^(https:\/\/(?:www\.|m\.)?youtube\.com|https:\/\/(?:www\.)?holodex\.net)$/.test(o);
function style(s){GM_addStyle(s)}
function sync(){const r=document.documentElement;if(!r)return;r.classList.toggle('hcc-clean',YT);r.classList.toggle('hcc-paid',paid);r.classList.toggle('hcc-mv',HD&&mv);r.style.setProperty('--hcc-font',font+'px');r.style.setProperty('--hcc-small',Math.max(11,Math.round(font*.8))+'px');r.style.setProperty('--hcc-leading',String(leading));r.style.setProperty('--hcc-gap-half',gap/2+'px')}
if(YT)style(`
html.hcc-clean:not(.hcc-write) yt-live-chat-header-renderer,
html.hcc-clean:not(.hcc-write) yt-live-chat-renderer #input-panel,
html.hcc-clean:not(.hcc-write) yt-live-chat-message-input-renderer{display:none!important}
html.hcc-clean yt-live-chat-banner-manager,
html.hcc-clean yt-live-chat-pinned-message-renderer,
html.hcc-clean yt-live-chat-poll-renderer,
html.hcc-clean yt-live-chat-ticker-renderer,
html.hcc-clean #live-chat-banner,
html.hcc-clean yt-live-chat-renderer #action-panel{display:none!important}
html.hcc-clean yt-live-chat-membership-item-renderer,
html.hcc-clean yt-live-chat-sponsorships-gift-purchase-announcement-renderer,
html.hcc-clean yt-live-chat-sponsorships-gift-redemption-announcement-renderer{display:none!important}
html.hcc-clean:not(.hcc-paid) yt-live-chat-paid-message-renderer,
html.hcc-clean:not(.hcc-paid) yt-live-chat-paid-sticker-renderer{display:none!important}
html.hcc-clean .hyperchat-root>.relative>.absolute.top-0.w-full,
html.hcc-clean .hyperchat-root>.scroll-on-hover,
html.hcc-clean .hyperchat-root .content>.hover-highlight:not(.flex){display:none!important}
html.hcc-clean .hyperchat-root .content>.hover-highlight:has(>.relative.inline-flex.flex-col.rounded.break-words.w-full){display:none!important}
html.hcc-clean:not(.hcc-paid) .hyperchat-root .content>.hover-highlight:has(>.inline-flex.flex-col.rounded.break-words.w-full:not(.relative)){display:none!important}
html.hcc-clean .hyperchat-root .content>.hover-highlight.flex .context-menu,
html.hcc-clean yt-live-chat-text-message-renderer #menu{display:none!important}
html.hcc-clean .hyperchat-root .content>.hover-highlight{background:transparent!important}
.hyperchat-root,.hyperchat-root .content>.hover-highlight.flex,
yt-live-chat-text-message-renderer #message,
yt-live-chat-text-message-renderer #author-name{font-size:var(--hcc-font)!important;line-height:var(--hcc-leading,1.25)!important}
.hyperchat-root .content .text-xs,yt-live-chat-text-message-renderer #timestamp{font-size:var(--hcc-small)!important}
/* Message spacing is independent from font size and line-height. */
html.hcc-clean .hyperchat-root .content>.hover-highlight.flex{
 margin-top:0!important;margin-bottom:0!important;
 padding-top:var(--hcc-gap-half,2px)!important;
 padding-bottom:var(--hcc-gap-half,2px)!important;row-gap:0!important
}
html.hcc-clean .hyperchat-root .content>.hover-highlight.flex+.hover-highlight.flex{margin-top:0!important}
html.hcc-clean yt-live-chat-item-list-renderer #items>yt-live-chat-text-message-renderer{
 margin-top:0!important;margin-bottom:0!important;
 padding-top:var(--hcc-gap-half,2px)!important;
 padding-bottom:var(--hcc-gap-half,2px)!important
}
html.hcc-clean .hyperchat-root .content>.hover-highlight.flex :is(p,.break-words),
html.hcc-clean yt-live-chat-text-message-renderer #message{line-height:var(--hcc-leading,1.25)!important}
.hcc-chat-anchor{position:relative!important}
.hcc-compose-trigger{position:absolute;top:auto;bottom:50px;right:12px;z-index:9999;width:30px;height:30px;border:1px solid #777;border-radius:7px;background:#252525;color:white;cursor:pointer}
@media(hover:hover){.hcc-chat-anchor:not(:hover):not(:focus-within)>.hcc-compose-trigger:not(.hcc-active){opacity:0;pointer-events:none}}
@media(hover:none){.hcc-compose-trigger:not(.hcc-active){opacity:.45}}
.hcc-compose-trigger.hcc-active{background:#813a59}
`);
if(HD)style(`
html.hcc-mv .multiview .mv-cell>.cell-content:has(>.d-flex.flex-row .tabbed-chat-select)>.d-flex:not(.flex-row){display:none!important;height:0!important;min-height:0!important;margin:0!important;padding:0!important}
.multiview .cell-content{position:relative}
.multiview .cell-content>.d-flex.flex-row:has(.tabbed-chat-select)>button.v-btn{display:none!important}
.multiview .tabbed-chat-select{flex:1 1 0%!important;width:100%!important;min-width:0!important;max-width:100%!important;margin-left:4px!important;margin-right:4px!important}
.multiview .tabbed-chat-select .v-input__append-inner{display:none!important;width:0!important;margin:0!important;padding:0!important}
.multiview .tabbed-chat-select .v-select__selections{flex:1 1 auto!important;min-width:0!important;padding-right:4px!important}
.multiview .tabbed-chat-select .v-select__selection{max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
.multiview .tabbed-chat-select .v-input__slot{cursor:pointer!important}
.hcc-hd-compose{flex:0 0 28px!important;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:#ccc;cursor:pointer;font-size:18px}
#hcc-aa{position:fixed;right:10px;bottom:70px;z-index:2147483000;font:14px system-ui;color:white}
#hcc-aa button{cursor:pointer}
#hcc-aa .ball{width:40px;height:40px;border-radius:50%;background:#292929;color:white;border:1px solid #777;opacity:.75}
#hcc-aa .panel{position:absolute;right:0;bottom:48px;width:min(290px,calc(100vw - 24px));padding:14px;background:#262626;border:1px solid #555;border-radius:12px}
#hcc-aa .panel[hidden]{display:none!important}
#hcc-aa .line{display:flex;gap:6px;align-items:center;margin:11px 0}
#hcc-aa .line label{flex:0 0 62px;font-size:12px;white-space:nowrap}
#hcc-aa .line span{flex:0 0 42px;font-size:12px;text-align:right;font-variant-numeric:tabular-nums}
#hcc-aa input[type=range]{flex:1;min-width:0}
/* Portrait-only toolbar cleanup. Direct children match Holodex's MultiviewToolbar.vue:
   green--text = Add frame; third button from end = Share link,
   followed by the three-dot menu and collapse-toolbar button. */
@media (orientation: portrait) and (max-width: 900px) {
  .multiview .mv-toolbar .mv-toolbar-btn.justify-end > button.v-btn.green--text,
  .multiview .mv-toolbar .mv-toolbar-btn.justify-end > button.v-btn:nth-last-of-type(3) {
    display: none !important;
  }
}
`);
function broadcast(type,value){document.querySelectorAll('iframe[src]').forEach(f=>{try{let o=new URL(f.src,location.href).origin;if(originAllowed(o))f.contentWindow?.postMessage({tag,type,value},o)}catch{}})}
function changeFont(v,save=true){
 font=Math.max(12,Math.min(40,Number(v)||20));sync();if(save)set(KEY.font,font);broadcast('font',font);
 if(aaBox)aaBox.querySelector('.font-val').textContent=font+'px';
}
function changeGap(v,save=true){
 if(!Number.isFinite(Number(v)))return;
 gap=Math.max(0,Math.min(24,Math.round(Number(v))));sync();if(save)set(KEY.gap,gap);broadcast('gap',gap);
 if(aaBox){const r=aaBox.querySelector('input[data-setting="gap"]');
  if(r)r.value=String(gap);aaBox.querySelector('.gap-val').textContent=gap+'px';}
}
function changeLeading(v,save=true){
 if(!Number.isFinite(Number(v)))return;
 leading=Math.round(Math.max(1,Math.min(1.9,Number(v)))*100)/100;
 sync();if(save)set(KEY.leading,leading);broadcast('leading',leading);
 if(aaBox){const r=aaBox.querySelector('input[data-setting="leading"]');
  if(r)r.value=String(leading);aaBox.querySelector('.leading-val').textContent=leading.toFixed(2)+'×';}
}
function changePaid(v,save=true){
 paid=!!v;sync();if(save)set(KEY.paid,paid);broadcast('paid',paid);
 if(aaBox)aaBox.querySelector('input[type=checkbox]').checked=paid;
}
if(typeof GM_addValueChangeListener==='function'){GM_addValueChangeListener(KEY.font,(_,a,b)=>{if(b!==font)changeFont(b,false)});GM_addValueChangeListener(KEY.gap,(_,a,b)=>{if(b!==gap)changeGap(b,false)});GM_addValueChangeListener(KEY.leading,(_,a,b)=>{if(b!==leading)changeLeading(b,false)});GM_addValueChangeListener(KEY.paid,(_,a,b)=>{if(b!==paid)changePaid(b,false)})}
window.addEventListener('message',e=>{if(e.source!==parent||!originAllowed(e.origin)||e.data?.tag!==tag)return;if(e.data.type==='font')changeFont(e.data.value,false);if(e.data.type==='gap')changeGap(e.data.value,false);if(e.data.type==='leading')changeLeading(e.data.value,false);if(e.data.type==='paid')changePaid(e.data.value,false)});
function videoId(u=location.href){try{let x=new URL(u,location.href);let id=x.searchParams.get('v')||x.pathname.match(/^\/(?:live|embed)\/([\w-]{11})/)?.[1];return /^[\w-]{11}$/.test(id||'')?id:null}catch{return null}}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const result=(ok,reason='')=>({ok,reason});
async function native(doc,open){
    const root=doc?.documentElement;
    if(!root)return result(false,'loading');
    if(!open){root.classList.remove('hcc-write');return result(true)}
    const panel=doc.querySelector('yt-live-chat-renderer #input-panel');
    const editor=panel?.querySelector('yt-live-chat-text-input-field-renderer [contenteditable]:not([contenteditable="false" i])')||panel?.querySelector('[contenteditable]:not([contenteditable="false" i])');
    if(!editor){root.classList.remove('hcc-write');return result(false,'no-editor')}
    root.classList.add('hcc-write');
    await pause(100);
    const visibility=doc.defaultView.getComputedStyle(editor).visibility;
    if(!editor.isConnected||!editor.getClientRects().length||visibility==='hidden'||visibility==='collapse'){
        root.classList.remove('hcc-write');return result(false,'hidden-editor');
    }
    try{editor.focus()}catch{root.classList.remove('hcc-write');return result(false,'focus')}
    return result(true);
}
if(CHAT)window.addEventListener('message',async e=>{
    if(e.source!==parent||!originAllowed(e.origin)||e.data?.tag!==tag||e.data.type!=='compose')return;
    const current=videoId();
    const response=current&&current!==e.data.videoId?result(false,'video-mismatch'):await native(document,!!e.data.open);
    e.source?.postMessage({tag,type:'result',id:e.data.id,...response},e.origin);
});
let seq=0;const pending=new Map();
if(TOP)window.addEventListener('message',e=>{
    if(!originAllowed(e.origin)||e.data?.tag!==tag||e.data.type!=='result')return;
    const p=pending.get(e.data.id);
    if(!p||p.frame.contentWindow!==e.source||p.origin!==e.origin)return;
    clearTimeout(p.timer);pending.delete(e.data.id);p.resolve(result(!!e.data.ok,e.data.reason||'no-editor'));
});
async function control(frame,id,open){
    if(!frame?.contentWindow)return result(false,'loading');
    let origin;
    try{origin=new URL(frame.src,location.href).origin;if(!originAllowed(origin))return result(false,'unsupported')}catch{return result(false,'unsupported')}
    try{
        const doc=frame.contentDocument;
        if(doc?.documentElement&&/^https?:/.test(doc.URL)){
            const current=videoId(doc.URL);
            if(current&&current!==id)return result(false,'video-mismatch');
            return await native(doc,open);
        }
    }catch{}
    return new Promise(resolve=>{
        const n=++seq;
        const finish=response=>{clearTimeout(timer);pending.delete(n);resolve(response)};
        const timer=setTimeout(()=>finish(result(false,'timeout')),900);
        pending.set(n,{frame,origin,timer,resolve});
        try{frame.contentWindow.postMessage({tag,type:'compose',id:n,videoId:id,open},origin)}catch{finish(result(false,'loading'))}
    });
}
function hdContext(cell){
    const frame=cell?.querySelector('.embedded-chat iframe')||cell?.querySelector('iframe[src*="/live_chat"]');
    let id=frame&&videoId(frame.src);
    if(!id){
        let vm=cell?.__vue__;
        for(let i=0;vm&&i<20;i++,vm=vm.$parent){
            if(vm.$options?.name==='ChatCell'){id=vm.currentVideo?.id;break}
        }
    }
    return {frame,id:/^[\w-]{11}$/.test(id||'')?id:null};
}
const composeErrors={loading:'聊天 iframe 尚未加载完成，请稍后重试。',timeout:'聊天 iframe 未响应，请等待加载完成，并确认 Cleaner 已在 YouTube iframe 中启用。',unsupported:'当前聊天 iframe 地址不受支持，请切换到 YouTube 原生聊天。','missing-id':'尚未取得当前视频 ID，请等待频道加载完成。','video-mismatch':'聊天正在切换视频，请等待切换完成后重试。','no-editor':'当前聊天没有可用的原生文字输入框。请确认已登录、直播聊天权限，以及是否为聊天回放。','hidden-editor':'原生文字输入框存在但不可见，请检查聊天状态或其他脚本的隐藏规则。',focus:'原生文字输入框无法获得焦点，请刷新聊天后重试。'};
async function toggleCompose(btn,context){
    if(btn.dataset.busy==='1')return;
    btn.dataset.busy='1';btn.disabled=true;
    const open=!btn.classList.contains('hcc-active');
    try{
        let response=result(false,'loading');
        for(let attempt=0;attempt<3;attempt++){
            const {frame,id}=context();
            response=!frame?result(false,'loading'):!id?result(false,'missing-id'):await control(frame,id,open);
            if(response.ok||response.reason==='unsupported')break;
            if(attempt<2)await pause(300);
        }
        if(response.ok){btn.classList.toggle('hcc-active',open);btn.textContent=open?'✓':'✎'}
        else alert(composeErrors[response.reason]||composeErrors['no-editor']);
    }finally{delete btn.dataset.busy;btn.disabled=false}
}
function watchHost(){return document.querySelector('ytd-live-chat-frame')||document.querySelector('ytd-watch-flexy #chat')}
async function clickYT(btn){await toggleCompose(btn,()=>({frame:watchHost()?.querySelector('iframe#chatframe,iframe[src*="/live_chat"],iframe'),id:videoId()}))}
function attachYT(){if(!YT||!TOP)return;let eligible=(location.pathname==='/watch'||/^\/live\/[\w-]{11}/.test(location.pathname))&&compose;let h=eligible?watchHost():null;if(!h){button?.remove();button=null;host=null;return}if(button?.isConnected&&host===h)return;button?.remove();h.classList.add('hcc-chat-anchor');button=document.createElement('button');button.className='hcc-compose-trigger';button.type='button';button.textContent='✎';button.title='临时发言';button.onclick=e=>{e.preventDefault();e.stopPropagation();clickYT(button)};h.append(button);host=h}
function attachHD(){if(!HD||!compose)return;document.querySelectorAll('.multiview .tabbed-chat-select').forEach(sel=>{let header=sel.closest('.d-flex.flex-row');if(!header||header.querySelector('.hcc-hd-compose'))return;let b=document.createElement('button');b.className='hcc-hd-compose';b.textContent='✎';b.title='临时发言';b.onclick=async e=>{e.preventDefault();e.stopPropagation();await toggleCompose(b,()=>hdContext(b.closest('.cell-content')))};header.append(b)})}
function attachAA(){
 if(!HD||!TOP||!document.body)return;
 const allowed=/^\/(?:watch|multiview)(?:\/|$)/.test(location.pathname);
 if(!aa||!allowed){aaBox?.remove();aaBox=null;return}
 if(aaBox?.isConnected)return;
 aaBox=document.createElement('div');aaBox.id='hcc-aa';
 aaBox.innerHTML=[
  '<button class="ball" type="button">Aa</button>',
  '<div class="panel" hidden><strong>聊天显示设置</strong>',
  '<div class="line"><label>字体</label><button class="font-minus" type="button">−</button>',
  '<input data-setting="font" type="range" min="12" max="40" step="1">',
  '<button class="font-plus" type="button">+</button><span class="font-val"></span></div>',
  '<div class="line"><label>消息间距</label>',
  '<input data-setting="gap" type="range" min="0" max="24" step="1">',
  '<span class="gap-val"></span></div>',
  '<div class="line"><label>文字行高</label>',
  '<input data-setting="leading" type="range" min="1" max="1.9" step="0.05">',
  '<span class="leading-val"></span></div>',
  '<label><input type="checkbox"> 显示付费留言（SC / 贴纸）</label></div>'
 ].join('');
 document.body.append(aaBox);
 const panel=aaBox.querySelector('.panel');
 aaBox.querySelector('.ball').onclick=()=>panel.hidden=!panel.hidden;
 const fontRange=aaBox.querySelector('input[data-setting="font"]');
 const gapRange=aaBox.querySelector('input[data-setting="gap"]');
 const leadingRange=aaBox.querySelector('input[data-setting="leading"]');
 fontRange.value=String(font);gapRange.value=String(gap);leadingRange.value=String(leading);
 aaBox.querySelector('.font-minus').onclick=()=>changeFont(font-1);
 aaBox.querySelector('.font-plus').onclick=()=>changeFont(font+1);
 fontRange.oninput=()=>changeFont(fontRange.value,false);
 fontRange.onchange=()=>changeFont(fontRange.value);
 gapRange.oninput=()=>changeGap(gapRange.value,false);
 gapRange.onchange=()=>changeGap(gapRange.value);
 leadingRange.oninput=()=>changeLeading(leadingRange.value,false);
 leadingRange.onchange=()=>changeLeading(leadingRange.value);
 aaBox.querySelector('.font-val').textContent=font+'px';
 aaBox.querySelector('.gap-val').textContent=gap+'px';
 aaBox.querySelector('.leading-val').textContent=leading.toFixed(2)+'×';
 const check=aaBox.querySelector('input[type=checkbox]');
 check.checked=paid;check.onchange=()=>changePaid(check.checked);
}
if(TOP){GM_registerMenuCommand('A+ 放大聊天字体',()=>changeFont(font+2));GM_registerMenuCommand('A− 缩小聊天字体',()=>changeFont(font-2));GM_registerMenuCommand('聊天消息间距（0–24px）',()=>{const v=prompt('消息间距（0–24px），当前 '+gap+'px',String(gap));if(v!==null&&v.trim()!==''&&Number.isFinite(Number(v)))changeGap(v)});GM_registerMenuCommand('聊天文字行高（1.00–1.90）',()=>{const v=prompt('文字行高倍数（1.00–1.90），当前 '+leading.toFixed(2),String(leading));if(v!==null&&v.trim()!==''&&Number.isFinite(Number(v)))changeLeading(v)});GM_registerMenuCommand('显示/隐藏付费留言',()=>changePaid(!paid));GM_registerMenuCommand('临时发言入口开关',()=>{set(KEY.compose,!compose);location.reload()});if(HD)GM_registerMenuCommand('Aa 按钮开关',()=>{set(KEY.aa,!aa);location.reload()})}
sync();
function init(){sync();attachYT();attachHD();attachAA();if(!TOP)return;let last=location.href;let observer=new MutationObserver(()=>{if(YT&&!button?.isConnected)attachYT();if(HD)attachHD()});observer.observe(document.body,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),20000);for(let name of ['yt-navigate-finish','yt-page-data-updated'])document.addEventListener(name,()=>setTimeout(attachYT,200));setInterval(()=>{if(last!==location.href){last=location.href;attachYT();attachHD();attachAA()}if(YT&&!button?.isConnected)attachYT();if(HD)attachHD()},2000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
