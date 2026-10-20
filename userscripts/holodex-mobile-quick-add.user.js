// ==UserScript==
// @name         Holodex Mobile Quick Add（精简手机版）
// @namespace    holodex-mobile-quick-add
// @version      0.2.1
// @description  当前 YouTube 视频一键跳转 Holodex 并自动添加；不包含聊天、频道名修复或收藏功能。
// @match        https://youtube.com/*
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://youtu.be/*
// @match        https://holodex.net/*
// @match        https://www.holodex.net/*
// @run-at       document-end
// @noframes
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self) return;
  const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;
  const ADD_KEY = 'hma_add';
  const REQUEST_KEY = 'hma_request';
  const TARGET_KEY = 'hma_v2_target';
  const PREFIX = 'hma_v2_request_';
  const WAKE_KEY = 'hma_v2_wake';
  const TTL = 12 * 60 * 60 * 1000;
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Array.from(crypto.getRandomValues(new Uint32Array(3))).join('-');
  const read = (key, fallback) => Promise.resolve(GM_getValue(key, fallback));
  // ScriptCat's legacy GM_setValue returns void before background persistence.
  // Await the real async API before navigating or announcing a queued request.
  const write = (key, value) => {
    if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') return GM.setValue(key, value);
    throw new Error('E_STORAGE：需要脚本猫 GM.setValue 权限，请重新安装当前版本并确认授权');
  };
  let sourcePending = null, targetSession = null, draining = false;
  const receiverToken = uid();
  const incoming = new Map();
  let receiverStarted = false;
  let failedRequest = null;
  let hideTimer;
  const IS_HD = /^(www\.)?holodex\.net$/.test(location.hostname);
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  let button, notice, busy = false;

  function videoIdFromURL(input) {
    try {
      const url = new URL(input);
      if (url.protocol !== 'https:') return null;
      let id;
      if (url.hostname === 'youtu.be') id = url.pathname.split('/')[1];
      else if (/^(www\.|m\.)?youtube\.com$/.test(url.hostname)) {
        if (url.pathname === '/watch') id = url.searchParams.get('v');
        else id = url.pathname.match(/^\/(?:shorts|live)\/([^/]+)\/?$/)?.[1];
      }
      return VIDEO_RE.test(id || '') ? id : null;
    } catch { return null; }
  }

  function makeButton() {
    if (button?.isConnected) return button;
    button = document.createElement('button');
    button.id = 'hma-quick-add-button';
    button.type = 'button';
    button.style.cssText = 'position:fixed;right:12px;bottom:calc(88px + env(safe-area-inset-bottom,0px));z-index:2147483000;min-height:44px;max-width:calc(100vw - 24px);padding:10px 16px;border:1px solid #ffffff55;border-radius:24px;background:#234b83;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 3px 12px #0005;cursor:pointer;touch-action:manipulation';
    document.body.appendChild(button);
    return button;
  }

  function showNotice(text) {
    if (!notice?.isConnected) {
      notice = document.createElement('div');
      notice.id = 'hma-quick-add-notice';
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(148px + env(safe-area-inset-bottom,0px));z-index:2147483001;padding:12px;border-radius:10px;background:#172333;color:white;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere';
      document.body.appendChild(notice);
    }
    notice.textContent = text;
  }

  async function openHolodex(forceNew = false) {
    // Each click reads this tab's current URL, never the previous receive URL.
    const id = videoIdFromURL(location.href);
    if (!id) return showNotice('当前页面没有有效的视频 ID。');
    if (busy) return;
    busy = true;
    const requestId = uid();
    let blank = sourceBlank;
    sourceBlank = null;
    let createdNew = false;
    try {
      let target = await read(TARGET_KEY, null);
      if (forceNew || !target || Date.now() - target.updated > TTL) {
        // The handler pre-opens a blank tab synchronously when a new receiver is needed.
        createdNew = true;
        target = { id: uid(), updated: Date.now() };
        await write(TARGET_KEY, target);
      }
      const request = { requestId, target: target.id, videoId: id, created: Date.now(), status: 'pending' };
      await write(PREFIX + requestId, request);
      await write(WAKE_KEY, request);
      sourcePending = { requestId, videoId: id };
      makeButton().textContent = '已排队：' + id;
      showNotice('视频 ' + id + ' 已保存到队列。请切回 Holodex；若没有“接收中”按钮，点击“使用此分屏接收”。');
      if (createdNew) {
        const url = new URL('https://holodex.net/multiview/');
        url.searchParams.set('hma_session', target.id);
        if (blank) { blank.location.href = url.href; blank = null; }
        else location.assign(url.href);
      } else {
        if (blank) { try { blank.close(); } catch {} blank = null; }
        if (sourceReceiver && !sourceReceiver.closed) {
          try { sourceReceiver.focus(); } catch { /* Android may require switching tabs manually. */ }
        }
      }
      const until = Date.now() + 45000;
      while (Date.now() < until) {
        const result = await read(PREFIX + requestId, null);
        if (result?.status === 'done') {
          showNotice('视频 ' + id + (result.result === 'already' ? ' 已在目标布局中，没有重复添加。' : ' 已加入同一个 Holodex 分屏。'));
          sourcePending = null;
          return;
        }
        if (result?.status === 'error') throw new Error(result.error);
        await delay(700);
      }
      showNotice('视频 ' + id + ' 仍在等待，请切回原 Holodex 页。若接收页已关闭，可点击“新建接收页”。');
      makeButton().textContent = '新建接收页';
      makeButton().onclick = () => startSend(true);
    } catch (error) {
      if (blank) { try { blank.close(); } catch {} }
      showNotice('发送 ' + id + ' 失败：' + error.message);
      sourcePending = null;
    } finally { busy = false; }
  }

  let sourceBlank = null, sourceReceiver = null;
  let knownTarget = null;
  read(TARGET_KEY, null).then(value => { knownTarget = value; });
  try { GM_addValueChangeListener(TARGET_KEY, (_key, _old, value) => { knownTarget = value; }); } catch {}

  function startSend(forceNew = false) {
    if (busy) return;
    const needsNew = forceNew || !knownTarget || Date.now() - knownTarget.updated > TTL;
    sourceBlank = needsNew ? window.open('about:blank', '_blank') : null;
    if (sourceBlank) sourceReceiver = sourceBlank;
    openHolodex(forceNew);
  }

  function findContext() {
    // A DOM root can belong to a child component or have no __vue__ expando.
    // Do not require one exact component name on that one element.
    const doc = page.document;
    if (!doc.querySelector('.multiview')) return null;
    const seeds = [doc.querySelector('#app'), doc.querySelector('.multiview')];
    const queue = [];
    const seen = new Set();
    const unwrap = value => value?.wrappedJSObject || value;
    function enqueueElement(element) {
      const el = unwrap(element);
      if (el?.__vue__) queue.push(unwrap(el.__vue__));
      const app = el?.__vue_app__;
      if (app?.config?.globalProperties?.$store) queue.push(app.config.globalProperties);
    }
    seeds.forEach(enqueueElement);
    // Also find Vue roots below #app when the wrapper itself has no instance.
    for (const el of doc.querySelectorAll('#app *')) enqueueElement(el);
    let fallback = null;
    while (queue.length && seen.size < 5000) {
      const vm = unwrap(queue.shift());
      if (!vm || seen.has(vm)) continue;
      seen.add(vm);
      const store = unwrap(vm.$store);
      const state = store?.state?.multiview;
      if (!vm._isDestroyed && vm._isMounted !== false &&
          Array.isArray(state?.layout) && state.layoutContent && typeof store.commit === 'function') {
        const context = { vm, store };
        if (vm.$options?.name === 'MultiView') return context;
        fallback ||= context;
      }
      if (vm.$parent) queue.push(vm.$parent);
      if (vm.$children) queue.push(...vm.$children);
    }
    return fallback;
  }

  function pageValue(value) {
    // Firefox userscript sandboxes may require a page-compartment object.
    return typeof cloneInto === 'function' ? cloneInto(value, page) : value;
  }

  function appendVideo(store, id) {
    const state = store.state?.multiview;
    if (!Array.isArray(state?.layout) || !state.layoutContent) {
      throw new Error('Holodex 布局接口不可用');
    }
    const contains = () => state.layout.some(cell => {
      const content = state.layoutContent[cell.i];
      return content?.type === 'video' && content.video?.id === id;
    });
    if (contains()) return 'already';
    // Check known mutations before making any changes (Vuex may only log missing ones).
    for (const name of ['addLayoutItem', 'setLayoutContentById']) {
      if (!store._mutations?.[`multiview/${name}`]?.length) {
        throw new Error('Holodex 添加接口已变化，请更新脚本');
      }
    }
    let empty = state.layout.find(cell => !state.layoutContent[cell.i]);
    let createdId;
    if (!empty) {
      const before = new Set(state.layout.map(cell => cell.i));
      store.commit('multiview/addLayoutItem');
      empty = state.layout.find(cell => !before.has(cell.i) && !state.layoutContent[cell.i]);
      createdId = empty?.i;
    }
    if (!empty) throw new Error('没有可用空格，请在 Holodex 中先添加一个空格');
    try {
      store.commit('multiview/setLayoutContentById', pageValue({
        id: empty.i,
        content: { id, type: 'video', video: { id, channel: { id, name: id } } }
      }));
      if (!contains()) throw new Error('未能确认视频已写入布局');
    } catch (error) {
      if (createdId !== undefined && !state.layoutContent[createdId] &&
          store._mutations?.['multiview/removeLayoutItem']?.length) {
        store.commit('multiview/removeLayoutItem', createdId);
      }
      throw error;
    }
    // Native metadata loading is optional; playback insertion is already confirmed.
    // No custom name patch, network scraping, getter proxy or mutation wrapper.
    if (store._actions?.['multiview/fetchVideoData']?.length) {
      try {
        Promise.resolve(store.dispatch('multiview/fetchVideoData')).catch(error => {
          console.info('[HMA] 已添加；原生元数据加载失败，可手动刷新名称。', error);
        });
      } catch (error) { console.info('[HMA] 原生元数据暂不可用', error); }
    }
    return 'added';
  }

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const rpcChannel = 'hma-page-' + uid();
  let bridgeInstalled = false;

  function pageAgent(channel) {
    // This function and the layout helpers run inside the website realm.
    document.addEventListener(channel + '-request', async event => {
      let data;
      try { data = JSON.parse(event.detail); } catch { return; }
      if (!/^[A-Za-z0-9_-]{11}$/.test(data.videoId || '')) return;
      const reply = result => document.dispatchEvent(new CustomEvent(channel + '-reply', {
        detail: JSON.stringify({ requestId: data.requestId, ...result })
      }));
      try {
        let context;
        const end = Date.now() + 30000;
        while (Date.now() < end) {
          context = findContext();
          if (context) break;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        if (!context) throw new Error('E_VUE：未找到可用分屏，请保持 Holodex 页面在前台');
        await new Promise(resolve => setTimeout(resolve, 350));
        if (!document.querySelector('.multiview') || context.vm._isDestroyed) throw new Error('分屏页面已切换');
        reply({ result: appendVideo(context.store, data.videoId) });
      } catch (error) { reply({ error: error.message }); }
    });
    document.dispatchEvent(new CustomEvent(channel + '-ready'));
  }

  async function installBridge() {
    if (bridgeInstalled) return;
    // GM storage stays in the userscript sandbox; only a small layout agent enters MAIN.
    // String event payloads avoid cross-compartment object access on Firefox/ScriptCat.
    const ready = new Promise(resolve => {
      const handler = () => { bridgeInstalled = true; resolve(); };
      document.addEventListener(rpcChannel + '-ready', handler, { once: true });
      setTimeout(() => { document.removeEventListener(rpcChannel + '-ready', handler); resolve(); }, 1200);
    });
    const script = document.createElement('script');
    script.textContent = '(()=>{const page=window;const pageValue=x=>x;' +
      findContext.toString() + ';' + appendVideo.toString() + ';(' +
      pageAgent.toString() + ')(' + JSON.stringify(rpcChannel) + ');})();';
    // Reuse a page nonce when available, without changing the page CSP.
    const nonce = document.querySelector('script[nonce]')?.nonce;
    if (nonce) script.nonce = nonce;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
    await ready;
  }

  async function addViaPage(request) {
    await installBridge();
    if (!bridgeInstalled) {
      // Some managers expose a usable unsafeWindow even when inline injection is blocked.
      const context = findContext();
      if (context) return appendVideo(context.store, request.videoId);
      throw new Error('E_BRIDGE：页面桥接被阻止，请确认脚本猫允许页面注入');
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('E_TIMEOUT：接收超时，请切回 Holodex 后重试')), 35000);
      function finish(error, value) {
        clearTimeout(timer);
        document.removeEventListener(rpcChannel + '-reply', handler);
        error ? reject(error) : resolve(value);
      }
      function handler(event) {
        let result;
        try { result = JSON.parse(event.detail); } catch { return; }
        if (result.requestId !== request.requestId) return;
        finish(result.error ? new Error(result.error) : null, result.result);
      }
      document.addEventListener(rpcChannel + '-reply', handler);
      document.dispatchEvent(new CustomEvent(rpcChannel + '-request', {
        detail: JSON.stringify({ requestId: request.requestId, videoId: request.videoId })
      }));
    });
  }

  async function drain() {
    if (draining || !targetSession || document.hidden) return;
    draining = true;
    try {
      const target = await read(TARGET_KEY, null);
      if (target?.id !== targetSession || (target.owner && target.owner !== receiverToken)) {
        showReceiverButton(false);
        return;
      }
      const keys = await Promise.resolve(GM_listValues());
      const requests = new Map(incoming);
      for (const key of keys) {
        if (!key.startsWith(PREFIX)) continue;
        const request = await read(key, null);
        if (!request) continue;
        if (Date.now() - request.created > TTL) { await Promise.resolve(GM_deleteValue(key)); continue; }
        if (request.target === targetSession && request.status === 'pending' && VIDEO_RE.test(request.videoId)) requests.set(request.requestId, request);
      }
      const latest = await read(WAKE_KEY, null);
      if (latest?.target === targetSession && latest.status === 'pending' && VIDEO_RE.test(latest.videoId)) {
        const saved = await read(PREFIX + latest.requestId, null);
        if (saved?.status === 'pending') requests.set(saved.requestId, saved);
      }
      const pending = [...requests.values()].filter(request => request.target === targetSession && request.status === 'pending' && Date.now() - request.created <= TTL);
      pending.sort((a, b) => a.created - b.created);
      for (const request of pending) {
        const active = await read(TARGET_KEY, null);
        if (active?.id !== targetSession || (active.owner && active.owner !== receiverToken)) break;
        clearTimeout(hideTimer);
        const btn = makeButton();
        btn.textContent = '正在添加 ' + request.videoId;
        btn.disabled = true;
        showNotice('接收视频 ' + request.videoId + '，正在追加到此分屏…');
        try {
          const result = await addViaPage(request);
          await write(PREFIX + request.requestId, { ...request, status: 'done', result });
          incoming.delete(request.requestId);
          failedRequest = null;
          btn.textContent = result === 'already' ? '此视频已存在' : '已加入多视图';
          showNotice('视频 ' + request.videoId + (result === 'already' ? ' 已在此布局中，没有重复添加。' : ' 已加入此分屏。若未播放，请点击播放器。'));
          hideTimer = setTimeout(() => { showReceiverButton(true); notice?.remove(); }, 7000);
        } catch (error) {
          await write(PREFIX + request.requestId, { ...request, status: 'error', error: error.message });
          incoming.delete(request.requestId);
          failedRequest = request;
          btn.textContent = '添加失败，点此重试';
          btn.disabled = false;
          btn.onclick = async () => {
            failedRequest = null;
            await write(PREFIX + request.requestId, { ...request, status: 'pending' });
            drain();
          };
          showNotice('Quick Add 0.2.1：' + request.videoId + ' 添加失败：' + error.message);
          break;
        }
      }
      if (!pending.length && !failedRequest) showReceiverButton(true);
    } catch (error) { showNotice('队列读取失败：' + error.message); }
    finally { draining = false; }
  }

  function showReceiverButton(active) {
    const btn = makeButton();
    btn.disabled = false;
    btn.textContent = active ? '接收中 · 检查队列' : '使用此分屏接收';
    btn.onclick = async () => {
      try {
        if (!active) await claimReceiver();
        showNotice('Quick Add 0.2.1：正在检查待添加视频…');
        await drain();
      } catch (error) { showNotice('接收启动失败：' + error.message); }
    };
  }

  async function claimReceiver() {
    const target = await read(TARGET_KEY, null);
    // Keep the queue's target ID so already queued videos are not stranded.
    targetSession = target?.id || targetSession || uid();
    sessionStorage.setItem('hma_v2_session', targetSession);
    await write(TARGET_KEY, { id: targetSession, owner: receiverToken, updated: Date.now(), ready: true });
    showReceiverButton(true);
  }

  async function initReceiver() {
    if (!/^\/multiview(?:\/|$)/.test(location.pathname)) return;
    if (receiverStarted) return;
    receiverStarted = true;
    const url = new URL(location.href);
    const supplied = url.searchParams.get('hma_session');
    targetSession = supplied || sessionStorage.getItem('hma_v2_session');
    if (targetSession) sessionStorage.setItem('hma_v2_session', targetSession);
    // Remove old request parameters once. The queue, not Vue Router's cached query,
    // is now the only source of video IDs; old 0.1.x IDs can never be replayed.
    url.searchParams.delete(ADD_KEY);
    url.searchParams.delete(REQUEST_KEY);
    url.searchParams.delete('hma_session');
    history.replaceState(history.state, '', url.href);
    const target = await read(TARGET_KEY, null);
    if (targetSession && (!target || target.id === targetSession)) {
      await claimReceiver();
      showNotice('Quick Add 0.2.1：此页正在接收，切回即可处理队列。');
    } else {
      showReceiverButton(false);
      showNotice('Quick Add 0.2.1：点击“使用此分屏接收”，把已排队的视频加入当前布局。');
    }
    try { GM_addValueChangeListener(TARGET_KEY, () => drain()); } catch {}
    try {
      GM_addValueChangeListener(WAKE_KEY, (_key, _old, request) => {
        if (request?.target === targetSession && VIDEO_RE.test(request.videoId) && request.status === 'pending') {
          incoming.set(request.requestId, request);
          drain();
        }
      });
    } catch {}
    document.addEventListener('visibilitychange', () => { if (!document.hidden) drain(); });
    window.addEventListener('focus', drain);
    setInterval(drain, 1200);
    setInterval(async () => {
      try {
        const target = await read(TARGET_KEY, null);
        if (target?.id === targetSession && target.owner === receiverToken) {
          await write(TARGET_KEY, { ...target, updated: Date.now() });
        }
      } catch (error) { showNotice('接收同步失败：' + error.message); }
    }, 15000);
    drain();
  }

  function refreshYouTubeButton() {
    if (!document.body) return;
    const id = videoIdFromURL(location.href);
    if (!id) { button?.remove(); notice?.remove(); return; }
    if (!busy && sourcePending && sourcePending.videoId !== id) sourcePending = null;
    const btn = makeButton();
    if (busy || sourcePending) return;
    btn.textContent = '＋ 加入 Holodex';
    btn.setAttribute('aria-label', '将当前视频加入 Holodex 多视图');
    btn.onclick = () => startSend(false);
  }

  if (IS_HD) {
    const initialize = () => initReceiver().catch(error => {
      receiverStarted = false;
      showReceiverButton(false);
      showNotice('Quick Add 0.2.1 初始化失败：' + error.message);
    });
    initialize();
    setInterval(initialize, 1500);
  } else {
    refreshYouTubeButton();
    document.addEventListener('yt-navigate-finish', refreshYouTubeButton);
    window.addEventListener('popstate', refreshYouTubeButton);
    setInterval(() => { if (!document.hidden) refreshYouTubeButton(); }, 1000);
  }
})();
