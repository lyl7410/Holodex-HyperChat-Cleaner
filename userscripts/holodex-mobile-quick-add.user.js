// ==UserScript==
// @name         Holodex Mobile Quick Add（精简手机版）
// @namespace    holodex-mobile-quick-add
// @version      0.1.1
// @description  当前 YouTube 视频一键跳转 Holodex 并自动添加；不包含聊天、频道名修复或收藏功能。
// @match        https://youtube.com/*
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://youtu.be/*
// @match        https://holodex.net/*
// @match        https://www.holodex.net/*
// @run-at       document-end
// @noframes
// @grant        none
// @inject-into  page
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self) return;
  const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;
  const ADD_KEY = 'hma_add';
  const REQUEST_KEY = 'hma_request';
  const IS_HD = /^(www\.)?holodex\.net$/.test(location.hostname);
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  let button, notice, busy = false, completed = false;

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

  function openHolodex() {
    // Read again at click time: YouTube navigation may have changed the video.
    const id = videoIdFromURL(location.href);
    if (!id) return showNotice('当前页面没有有效的视频 ID，请打开具体视频。');
    const target = new URL('https://holodex.net/multiview/');
    target.searchParams.set(ADD_KEY, id);
    const random = new Uint32Array(2);
    crypto.getRandomValues(random);
    target.searchParams.set(REQUEST_KEY, `${Date.now()}-${random[0]}-${random[1]}`);
    try {
      // No GM grants: run in the website realm, including ScriptCat on Android.
      // Open synchronously within the click gesture to avoid popup blocking.
      const opened = window.open(target.href, '_blank');
      if (!opened) throw new Error('浏览器阻止新标签页');
      try { opened.opener = null; } catch { /* Cross-origin access may be restricted. */ }
      showNotice('已打开 Holodex，接收页将自动添加。若未切换，请打开新标签页。');
    } catch {
      // A direct user action may safely navigate the current tab as a fallback.
      location.assign(target.href);
    }
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

  async function cleanRequest(vm) {
    const url = new URL(location.href);
    url.searchParams.delete(ADD_KEY);
    url.searchParams.delete(REQUEST_KEY);
    // Keep Vue Router and address bar in sync, preserving other query parameters.
    if (vm.$router && vm.$route) {
      const query = { ...vm.$route.query };
      delete query[ADD_KEY];
      delete query[REQUEST_KEY];
      try {
        await vm.$router.replace(pageValue({ path: vm.$route.path, query, hash: vm.$route.hash }));
        return;
      } catch (error) { console.info('[HMA] 路由参数清理失败', error); }
    }
    history.replaceState(history.state, '', url.href);
  }

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function receive() {
    if (busy || completed) return;
    const url = new URL(location.href);
    const id = url.searchParams.get(ADD_KEY);
    if (!/^\/multiview\/?$/.test(url.pathname) || !id) return;
    const btn = makeButton();
    btn.onclick = receive;
    if (!VIDEO_RE.test(id)) {
      btn.textContent = '无效的视频链接';
      btn.disabled = true;
      return showNotice('接收参数无效：需要 11 位 YouTube 视频 ID。');
    }
    busy = true;
    btn.disabled = true;
    btn.textContent = '正在添加…';
    showNotice('正在等待 Holodex 多视图加载，请保持此页面在前台。');
    try {
      let context;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (location.pathname !== url.pathname || new URL(location.href).searchParams.get(ADD_KEY) !== id) {
          throw new Error('页面已切换，请返回原接收链接重试');
        }
        context = findContext();
        if (context) break;
        await delay(300);
      }
      if (!context) {
        const hasLayout = !!page.document.querySelector('.multiview');
        throw new Error(hasLayout
          ? 'E_VUE：分屏已显示，但脚本无法访问 Vuex；请提供浏览器和脚本管理器名称'
          : 'E_LOAD：30 秒内未出现分屏，请确认 Holodex 页面本身已正常加载');
      }
      // Let the mounted component finish its initial synchronous layout restoration.
      await delay(400);
      if (new URL(location.href).searchParams.get(ADD_KEY) !== id ||
          context.vm._isMounted === false || context.vm._isDestroyed ||
          !page.document.querySelector('.multiview')) throw new Error('接收页面已变化');
      const result = appendVideo(context.store, id);
      completed = true;
      btn.textContent = result === 'already' ? '此视频已在布局中' : '已加入多视图';
      showNotice(result === 'already' ? '此视频已存在，没有重复添加。' : '已加入多视图。若未自动播放，请点一下播放器；频道名称稍后由 Holodex 加载。');
      await cleanRequest(context.vm);
      setTimeout(() => { button?.remove(); notice?.remove(); }, 7000);
    } catch (error) {
      btn.textContent = '添加失败，点此重试';
      showNotice(`Quick Add 0.1.1 未完成添加：${error.message}。可点击按钮重试；接收参数会保留。`);
      console.warn('[HMA]', error);
    } finally {
      busy = false;
      btn.disabled = completed;
    }
  }

  function refreshYouTubeButton() {
    if (!document.body) return;
    const id = videoIdFromURL(location.href);
    if (!id) { button?.remove(); notice?.remove(); return; }
    const btn = makeButton();
    btn.textContent = '＋ 加入 Holodex';
    btn.setAttribute('aria-label', '将当前视频加入 Holodex 多视图');
    btn.onclick = openHolodex;
  }

  if (IS_HD) {
    receive();
    // Also support navigation into the receive URL without a document reload.
    let lastURL = location.href;
    setInterval(() => {
      if (location.href === lastURL) return;
      lastURL = location.href;
      if (!busy && new URL(location.href).searchParams.has(ADD_KEY)) {
        completed = false;
        receive();
      }
    }, 1000);
  } else {
    refreshYouTubeButton();
    document.addEventListener('yt-navigate-finish', refreshYouTubeButton);
    window.addEventListener('popstate', refreshYouTubeButton);
    // Mobile YouTube does not consistently emit the desktop navigation event.
    setInterval(() => { if (!document.hidden) refreshYouTubeButton(); }, 1000);
  }
})();
