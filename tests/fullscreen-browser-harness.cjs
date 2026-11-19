// Optional real-browser fixture: node tests/fullscreen-browser-harness.cjs
// Native menu roles/glyphs were inspected on Holodex, 2026-11-05.
// This is NOT Holodex, Android, a userscript-manager or a real video player.
const fs=require('node:fs');
const http=require('node:http');
const source=fs.readFileSync('userscripts/holodex-touch-controls.user.js','utf8');
let moduleSource=source.slice(source.indexOf('  const isMulti=()=>'),source.indexOf('  const token='));
// Exercise the mobile-only branch in desktop Chromium, without mocking the
// Fullscreen API, user activation, fullscreenchange events or DOM methods.
moduleSource=moduleSource.replace(/const isMobileFullscreenDevice=\(\)=>\{[\s\S]*?\n  \};/,
  'const isMobileFullscreenDevice=()=>true;');
const paths=[...moduleSource.matchAll(/const NATIVE_(?:FULLSCREEN|MORE)_PATH='([^']+)'/g)].map(m=>m[1]);
const page=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Touch Controls 浏览器验证</title><style>
body{margin:0;background:#17202a;color:#eef3f8;font:16px system-ui}.multiview{height:100vh;display:flex;flex-direction:column}header{flex:none;height:64px;background:#282828;display:flex;align-items:center;padding:0 8px}.mv-toolbar-btn{display:flex;justify-content:flex-end;box-sizing:border-box;align-items:center}.mv-toolbar-btn button{flex:none;width:36px;height:44px;padding:0;margin:0;border:0;background:transparent;font-size:30px}.nav{flex:none;width:48px;height:48px;padding:0;margin:0;border:0;background:transparent}
button{background:#384c62;color:white;border:1px solid #8295a9;border-radius:8px;padding:12px;margin:4px;cursor:pointer}svg{width:24px;height:24px;fill:currentColor}
.v-menu__content{position:absolute;right:16px;top:60px;background:#282828;z-index:2;padding:8px}.v-menu__content[hidden]{display:none}.v-list-item{padding:10px;cursor:pointer;display:flex;align-items:center;gap:8px}
main{padding:16px}.mv-frame{height:96px;border:1px solid #597c9d;display:grid;place-items:center;background:#223d53}#hmtc-settings{padding-top:12px}pre{white-space:pre-wrap;font-size:12px}
</style><div class="multiview"><header class="mv-toolbar"><button class="nav" aria-label="菜单">☰</button><div class="mv-toolbar-btn justify-start" style="flex:1;min-width:0"><button aria-label="添加视频" style="width:44px">⊞</button></div><div class="mv-toolbar-btn justify-end"><button aria-label="布局" style="color:#f06292">▦</button><button aria-label="添加布局" style="color:#4caf50">⊞</button><button aria-label="调整" style="color:#ff9800">☷</button><button aria-label="交换" style="color:#5c6bc0">⇵</button><button aria-label="链接">↗</button><button aria-label="更多" aria-haspopup="true" aria-expanded="false"><svg><path d="${paths[1]}"></path></svg></button><button aria-label="收起">⌃</button></div></header>
<div class="v-menu__content" role="menu" hidden><div class="v-list"><div tabindex="0" role="menuitem" class="v-list-item"><svg><path d="${paths[0]}"></path></svg><span>全屏显示</span></div></div></div>
<main><div class="mv-frame">视频区域占位（没有全屏悬浮入口）</div>
<section id="hmtc-settings"><label><input type="checkbox" data-control="fullscreenAuto">横屏自动尝试全屏／竖屏自动恢复</label><br>
<button data-action="landscapeFullscreen">进入网页全屏</button><p data-field="fullscreenState" role="status"></p></section>
<p>本页验证与工具栏同排的全屏图标和真实浏览器 API；不代表安卓 Vivaldi 实测。</p><pre id="evidence"></pre></main></div>
<script>
const evidence={fixture:true,mobileGateForced:true,requestCount:0,nativeDefaultCalls:0,toolbarChildMutations:0,activationAtRequest:[],events:[]};
const request=document.documentElement.requestFullscreen?.bind(document.documentElement);
if(request)document.documentElement.requestFullscreen=(options)=>{evidence.requestCount++;evidence.activationAtRequest.push(navigator.userActivation?.isActive);return request(options);};
new MutationObserver(records=>{evidence.toolbarChildMutations+=records.filter(r=>r.type==='childList').length;}).observe(document.querySelector('.mv-toolbar'),{childList:true,subtree:true});
const saved=new Map();const get=(k,d)=>saved.has(k)?saved.get(k):d;const set=(k,v)=>saved.set(k,v);
${moduleSource}
installMultiviewFullscreenButton();
const more=document.querySelector('.mv-toolbar button[aria-haspopup]'),menu=document.querySelector('.v-menu__content');
more.addEventListener('click',()=>{menu.hidden=!menu.hidden;more.setAttribute('aria-expanded',String(!menu.hidden));});
menu.querySelector('[role="menuitem"]').addEventListener('click',()=>{evidence.nativeDefaultCalls++;});
document.querySelector('[data-action="landscapeFullscreen"]').addEventListener('click',toggleMultiviewFullscreen);
document.querySelector('[data-control="fullscreenAuto"]').addEventListener('change',e=>setLandscapeAutoFullscreen(e.target.checked,true));
document.addEventListener('fullscreenchange',()=>evidence.events.push(document.fullscreenElement?'entered':'exited'));
setInterval(()=>{reconcileLandscapeFullscreen();document.querySelector('#evidence').textContent=JSON.stringify({...evidence,fullscreen:document.fullscreenElement?.tagName||null,fullscreenEnabled:document.fullscreenEnabled,pending:autoFullscreenPending,suppressed:autoFullscreenSuppressed},null,2);},150);
</script>`;
http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(page);})
  .listen(8956,'127.0.0.1',()=>console.log('Browser fixture: http://127.0.0.1:8956/multiview'));
