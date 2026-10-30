'use strict';
// 黑盒加载交付脚本：虚拟时钟、窗口、DOM、Vue 与 YouTube API，不向生产脚本注入测试导出。
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const path = require('node:path');
const scriptPath = process.env.HOLODEX_RECOVERY_SCRIPT ||
  path.resolve(__dirname, '../userscripts/holodex-embed-recovery.user.js');
const SOURCE = fs.readFileSync(scriptPath, 'utf8');
const CHANNEL = 'holodex-embed-recovery';
const HOLODEX = 'https://holodex.net';
const YOUTUBE = 'https://www.youtube.com';
const ID = 'abcdefghijk';
const msg = data => ({ channel: CHANNEL, version: 2, ...data });

class Clock {
  now = 0; seq = 0; tasks = new Map();
  set = (fn, delay = 0) => { const id = ++this.seq; this.tasks.set(id, { at: this.now + delay, fn }); return id; };
  clear = id => this.tasks.delete(id);
  async advance(ms) {
    const end = this.now + ms;
    for (let n = 0; n < 100000; n++) {
      const next = [...this.tasks.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { this.now = end; await this.flush(); return; }
      this.now = next[1].at; this.tasks.delete(next[0]); next[1].fn(); await this.flush();
    }
    throw Error('定时器循环失控');
  }
  async flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
}
function shared() {
  const data = new Map(); const locked = new Set();
  return {
    data,
    localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) },
    locks: { async request(key, _options, action) {
      if (locked.has(key)) return action(null);
      locked.add(key);
      try { return await action({ name: key }); } finally { locked.delete(key); }
    } }
  };
}
function environment({ child = false, config = {}, legacy = {}, clock = new Clock(), store = shared(), userAgent = 'Firefox/140' } = {}) {
  const listeners = new Map(); const sent = []; const warnings = []; const intervalsCleared = []; const menus = [];
  const values = new Map(Object.entries(legacy));
  if (config !== null) values.set('RECOVERY_CONFIG_V2', { schema: 2, startupSeconds: 0, ...config });
  const origin = child ? YOUTUBE : HOLODEX;
  let reloads = 0;
  const location = { origin, hostname: new URL(origin).hostname, pathname: child ? `/embed/${ID}` : '/multiview', reload() { reloads++; } };
  const doc = { frames: [], video: null, ytState: undefined, ytData: undefined,
    querySelectorAll: selector => selector === 'iframe' ? doc.frames : [],
    querySelector: selector => selector === 'video' ? doc.video : null,
    getElementById: id => id === 'movie_player' ? { getPlayerState: () => doc.ytState, getVideoData: () => doc.ytData } : null
  };
  const page = {
    document: doc, localStorage: store.localStorage,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    clearInterval: id => intervalsCleared.push(id)
  };
  page.parent = child ? { postMessage: (data, target) => sent.push({ data, target, at: clock.now }) } : page;
  page.top = child ? page.parent : page;
  const context = vm.createContext({
    window: page, unsafeWindow: page, document: doc, location,
    navigator: { onLine: true, locks: store.locks, userAgent }, performance: { now: () => clock.now },
    Date: class extends Date { static now() { return 1800000000000 + clock.now; } },
    crypto: webcrypto, URL, Uint32Array,
    setTimeout: clock.set, clearTimeout: clock.clear,
    GM_getValue: (k, fallback) => values.has(k) ? values.get(k) : fallback,
    GM_setValue: (k, v) => values.set(k, v), GM_registerMenuCommand: (...args) => menus.push(args),
    console: { warn: (...args) => warnings.push(args) }
  });
  function emit(type, data = {}) { for (const fn of [...(listeners.get(type) || [])]) fn(data); }
  function start() { vm.runInContext(SOURCE, context, { filename: 'holodex-embed-recovery-zh.user.js' }); }
  function message(source, data, originOverride = child ? HOLODEX : YOUTUBE) {
    emit('message', { source, data, origin: originOverride });
  }
  return { page, doc, context, clock, sent, values, warnings, intervalsCleared, menus, emit, start, message, store,
    get reloads() { return reloads; } };
}
function video(overrides = {}) {
  return { currentTime: 1, readyState: 4, paused: false, ended: false, seeking: false,
    error: null, currentSrc: 'blob:example', src: '', volume: 0.37, muted: false, ...overrides };
}
function child(options = {}) {
  const env = environment({ child: true, ...options }); env.doc.video = video();
  env.start();
  env.message(env.page.parent, msg({ type: 'challenge', videoId: ID, token: 'a'.repeat(32) }));
  env.status = () => env.sent.filter(m => m.data.type === 'status');
  env.stalls = () => env.status().filter(m => m.data.status === 'stalled');
  return env;
}
function addCell(env, { id = ID, readyDelay = 0, throws = false } = {}) {
  const cell = { refreshes: 0, setTimers: 0, players: [], audioCalls: [], frames: [] };
  const root = { isConnected: true, parentElement: null, contains: f => cell.frames.includes(f),
    querySelector: () => cell.frame };
  const comp = { $options: { name: 'VideoCell' }, $data: { uniqueId: 1, volume: 0 },
    $el: root, cellContent: { id }, muted: true, timer: 77,
    setTimer() { cell.setTimers++; comp.timer = 88; },
    refresh() {
      cell.refreshes++;
      if (throws) throw Error('模拟刷新失败');
      const oldFrame = cell.frame;
      env.clock.set(() => {
        if (!root.isConnected) return;
        oldFrame.isConnected = false;
        env.doc.frames = env.doc.frames.filter(f => f !== oldFrame);
        makeFrame(); comp.ytPlayer = cell.players.at(-1);
      }, readyDelay);
    }
  };
  function makeFrame() {
    const contentWindow = { postMessage(data, target) { cell.replies.push({ data, target }); } };
    const f = { tagName: 'IFRAME', src: `${YOUTUBE}/embed/${id}?autoplay=0&origin=https%3A%2F%2Fholodex.net`,
      contentWindow, isConnected: true, parentElement: root };
    const player = { getIframe: () => f, getPlayerState: () => 1,
      setVolume: n => cell.audioCalls.push(['volume', n]),
      mute() { assert.equal(comp.muted, true); cell.audioCalls.push(['muted', true]); },
      unMute() { assert.equal(comp.muted, false); cell.audioCalls.push(['muted', false]); },
      playVideo: () => cell.audioCalls.push(['play'])
    };
    cell.frames.push(f); env.doc.frames.push(f); cell.frame = f; cell.players.push(player);
    return f;
  }
  cell.replies = [];
  root.__vue__ = comp; cell.comp = comp; cell.root = root;
  makeFrame(); comp.ytPlayer = cell.players[0]; comp.$refs = { player: { player: comp.ytPlayer } };
  cell.hello = () => {
    env.message(cell.frame.contentWindow, msg({ type: 'hello', videoId: id }));
    return cell.replies.at(-1)?.data.token;
  };
  cell.status = (status = 'stalled', extra = {}) => {
    const token = cell.hello();
    env.message(cell.frame.contentWindow, msg({ type: 'status', videoId: id, token,
      status, reason: 'frozen', volume: 0.37, muted: false, ...extra }));
  };
  return cell;
}
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('计时按真实秒数：500ms 采样在 3 秒前不触发', async () => {
  const e = child(); await e.clock.advance(2500); assert.equal(e.stalls().length, 0);
  await e.clock.advance(500); assert.equal(e.stalls().length, 1); assert.equal(e.stalls()[0].at, 3000);
});
test('低 readyState 持续缓冲 12 秒后可识别', async () => {
  const e = child(); e.doc.video.readyState = 1;
  await e.clock.advance(11500); assert.equal(e.stalls().length, 0);
  await e.clock.advance(500); assert.equal(e.stalls().length, 1); assert.equal(e.stalls()[0].data.reason, 'buffering');
});
test('YouTube state=3 且 video.paused 时仍识别缓冲', async () => {
  const e = child({ config: { bufferSeconds: 3 } }); e.doc.video.paused = true; e.doc.ytState = 3;
  await e.clock.advance(3000); assert.equal(e.stalls().length, 1);
});
test('用户暂停、拖动、结束、错误及离线不自动恢复', async () => {
  for (const property of ['paused', 'seeking', 'ended', 'error', 'offline']) {
    const e = child();
    if (property === 'offline') e.context.navigator.onLine = false;
    else e.doc.video[property] = true;
    await e.clock.advance(60000); assert.equal(e.stalls().length, 0, property);
  }
});
test('正常推进与低速推进不被误报', async () => {
  for (const increment of [0.5, 0.025]) {
    const e = child();
    for (let i = 0; i < 60; i++) { e.doc.video.currentTime += increment; await e.clock.advance(500); }
    assert.equal(e.stalls().length, 0);
  }
});
test('换媒体节点/来源后重新计时', async () => {
  const e = child(); await e.clock.advance(2500);
  e.doc.video = video({ currentSrc: 'blob:new' }); await e.clock.advance(500);
  await e.clock.advance(2500); assert.equal(e.stalls().length, 0);
  await e.clock.advance(500); assert.equal(e.stalls().length, 1);
});
test('后台长时间停调度后不把休眠时间计作卡死', async () => {
  const e = child(); await e.clock.advance(1000); e.clock.now += 60000;
  const pending = [...e.clock.tasks.values()][0]; e.clock.tasks.clear(); pending.fn();
  assert.equal(e.stalls().length, 0); await e.clock.advance(2500); assert.equal(e.stalls().length, 0);
});
test('初始加载宽限生效', async () => {
  const e = child({ config: { startupSeconds: 10 } }); await e.clock.advance(9500);
  assert.equal(e.stalls().length, 0); await e.clock.advance(500); assert.equal(e.stalls().length, 1);
});
test('子框拒绝错误来源、伪造父窗口与非法挑战', async () => {
  const e = environment({ child: true }); e.doc.video = video(); e.start();
  const good = msg({ type: 'challenge', videoId: ID, token: 'b'.repeat(32) });
  e.message(e.page.parent, good, 'https://holodex.net.evil.test');
  e.message({}, good); e.message(e.page.parent, { ...good, token: 'bad' });
  await e.clock.advance(5000); assert.equal(e.sent.filter(m => m.data.type === 'status').length, 0);
  assert.ok(e.sent.every(m => m.target !== '*'));
});
test('旧配置迁移保留 false、0，旧键保持不动', () => {
  const e = environment({ config: null, legacy: { AUTOPLAY_ON_RECOVER: false,
    STALL_TICKS: 7, REPLACE_COOLDOWN: 0, PLAY_RETRY_ATTEMPTS: 4 } }); e.start();
  const c = e.values.get('RECOVERY_CONFIG_V2');
  assert.equal(c.autoplay, false); assert.equal(c.stallSeconds, 7); assert.equal(c.cooldownSeconds, 0);
  assert.equal(c.readyAttempts, 4); assert.equal(e.values.get('STALL_TICKS'), 7);
});
test('配置损坏/越界时回退并限制范围，不在子框写迁移', () => {
  const e = environment({ config: null, legacy: { STALL_TICKS: NaN, REPLACE_COOLDOWN: -5,
    PLAY_RETRY_ATTEMPTS: Infinity, AUTOPLAY_ON_RECOVER: 'false' } }); e.start();
  const c = e.values.get('RECOVERY_CONFIG_V2'); assert.equal(c.stallSeconds, 3);
  assert.equal(c.cooldownSeconds, 0); assert.equal(c.readyAttempts, 8); assert.equal(c.autoplay, true);
  const f = environment({ child: true, config: null }); f.start(); assert.equal(f.values.has('RECOVERY_CONFIG_V2'), false);
});
test('新配置优先，重复初始化不覆盖', () => {
  const e = environment({ config: { stallSeconds: 9 }, legacy: { STALL_TICKS: 1 } }); e.start();
  assert.equal(e.values.get('RECOVERY_CONFIG_V2').stallSeconds, 9);
});
test('父框拒绝伪域名、空 origin、未知窗口、非法字段、过期 token 和 ID 不匹配', async () => {
  const e = environment(); const c = addCell(e); e.start(); const token = c.hello();
  const good = msg({ type: 'status', token, videoId: ID, status: 'stalled', volume: 0.4, muted: true });
  for (const origin of ['', 'null', 'https://www.youtube.com.evil.test', 'https://evil.youtube.com'])
    e.message(c.frame.contentWindow, good, origin);
  e.message({}, good);
  for (const bad of [{ token: 'expired' }, { volume: 2 }, { volume: NaN }, { muted: 0 },
    { videoId: 'XXXXXXXXXXX' }, { version: 1 }, { channel: 'other' }, { type: 'ytfix-wedged' }])
    e.message(c.frame.contentWindow, { ...good, ...bad });
  e.message(c.frame.contentWindow, '{'); e.message(c.frame.contentWindow, 'x'.repeat(2050));
  await e.clock.flush(); assert.equal(c.refreshes, 0);
  e.message(c.frame.contentWindow, JSON.stringify(good)); await e.clock.advance(500);
  assert.equal(c.refreshes, 1);
});
test('伪 iframe URL 与移除的 iframe 均不接受', async () => {
  for (const url of ['https://www.youtube.com.evil/embed/abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk']) {
    const e = environment(); const c = addCell(e); e.start(); c.frame.src = url;
    c.status(); await e.clock.flush(); assert.equal(c.refreshes, 0);
  }
  const e = environment(); const c = addCell(e); e.start(); c.frame.isConnected = false;
  c.status(); await e.clock.flush(); assert.equal(c.refreshes, 0);
});
test('Vue 查找越过中间组件；清理旧 timer，等待全新播放器并恢复音量静音', async () => {
  const e = environment(); const c = addCell(e, { readyDelay: 1000 });
  c.frame.__vue__ = { $parent: { $parent: c.comp } };
  e.start(); c.status('stalled', { volume: 0, muted: true }); await e.clock.flush();
  assert.deepEqual(e.intervalsCleared, [77]); assert.equal(c.comp.ytPlayer, null);
  await e.clock.advance(500); assert.equal(c.setTimers, 0);
  await e.clock.advance(500); assert.equal(c.setTimers, 1);
  assert.deepEqual(c.audioCalls, [['volume', 0], ['muted', true], ['play']]);
  assert.equal(c.frame.src.includes('autoplay=0&origin='), true);
});
test('Vue 父链成环仍能从另一 DOM 入口找到正确组件', async () => {
  const e = environment(); const c = addCell(e); const loop = {}; loop.$parent = loop;
  c.frame.__vue__ = loop; e.start(); c.status(); await e.clock.advance(500); assert.equal(c.refreshes, 1);
});
test('Vue 深度上限耗尽不调用任意祖先 refresh', async () => {
  const e = environment(); const c = addCell(e);
  let chain = c.comp;
  for (let i = 0; i < 40; i++) chain = { $parent: chain, refresh() { throw Error('错误组件'); } };
  c.root.__vue__ = null; c.frame.__vue__ = chain;
  e.start(); c.status(); await e.clock.flush(); assert.equal(c.refreshes, 0);
});
test('不符合 VideoCell 合约时不刷新，也不直接替换 iframe', async () => {
  const e = environment(); const c = addCell(e); c.comp.$options.name = 'Other';
  const original = c.frame; e.start(); c.status(); await e.clock.flush();
  assert.equal(c.refreshes, 0); assert.equal(c.frame, original);
});
test('异步等待前占位，同格密集消息只刷新一次', async () => {
  const e = environment(); const c = addCell(e); e.start();
  for (let i = 0; i < 20; i++) c.status(); await e.clock.advance(500);
  assert.equal(c.refreshes, 1); assert.equal(c.audioCalls.filter(c => c[0] === 'play').length, 1);
});
test('同页多个格子独立恢复，包括两个相同视频', async () => {
  const e = environment(); const a = addCell(e); const b = addCell(e); e.start();
  a.status(); await e.clock.advance(500); b.status(); await e.clock.advance(500);
  assert.equal(a.refreshes, 1); assert.equal(b.refreshes, 1);
});
test('跨窗口同视频冷却，另一个视频不受阻', async () => {
  const clock = new Clock(), store = shared();
  const a = environment({ clock, store }), b = environment({ clock, store });
  const x = addCell(a), y = addCell(b), z = addCell(b, { id: '12345678901' }); a.start(); b.start();
  x.status(); await clock.advance(500); y.status(); z.status(); await clock.advance(500);
  assert.equal(x.refreshes, 1); assert.equal(y.refreshes, 0); assert.equal(z.refreshes, 1);
  await clock.advance(14000); y.status(); await clock.advance(500); assert.equal(y.refreshes, 1);
});
test('跨窗口同时申请时互斥，零冷却可关闭', async () => {
  for (const cooldownSeconds of [15, 0]) {
    const clock = new Clock(), store = shared();
    const a = environment({ clock, store, config: { cooldownSeconds } });
    const b = environment({ clock, store, config: { cooldownSeconds } });
    const x = addCell(a), y = addCell(b); a.start(); b.start(); x.status(); y.status();
    await clock.advance(500); assert.equal(x.refreshes + y.refreshes, cooldownSeconds ? 1 : 2);
  }
});
test('缺失 Web Locks 或存储不可用时仍受本页预算限制', async () => {
  for (const mode of ['no-locks', 'no-storage']) {
    const e = environment(); const c = addCell(e);
    if (mode === 'no-locks') e.context.navigator.locks = undefined;
    else e.page.localStorage = { getItem() { throw Error('禁止'); }, setItem() { throw Error('禁止'); } };
    e.start(); c.status(); await e.clock.advance(500); c.status(); await e.clock.advance(500);
    assert.equal(c.refreshes, 1);
  }
});
test('自动播放关闭仍保留音频状态，不调用 playVideo', async () => {
  const e = environment({ config: { autoplay: false } }); const c = addCell(e); e.start();
  c.status(); await e.clock.advance(500);
  assert.deepEqual(c.audioCalls, [['volume', 37], ['muted', false]]);
});
test('等待次数有上限，轮询按 0.5/1/2 秒退避且不会使用旧 player', async () => {
  const e = environment({ config: { readyAttempts: 3 } }); const c = addCell(e, { readyDelay: 999999 });
  e.start(); c.status(); await e.clock.advance(1999); assert.equal(e.warnings.length, 0);
  await e.clock.advance(1); assert.equal(e.warnings.length, 1); assert.equal(c.setTimers, 0);
  assert.deepEqual(c.audioCalls, []); await e.clock.advance(10000); assert.equal(e.warnings.length, 1);
});
test('有限恢复与指数退避，换 iframe 不会重置预算', async () => {
  const e = environment({ config: { cooldownSeconds: 0, backoffSeconds: 5, maxRecoveries: 3 } });
  const c = addCell(e); e.start(); c.status(); await e.clock.advance(500);
  c.status(); await e.clock.flush(); assert.equal(c.refreshes, 1);
  await e.clock.advance(4500); c.status(); await e.clock.advance(500); assert.equal(c.refreshes, 2);
  await e.clock.advance(9000); c.status(); await e.clock.flush(); assert.equal(c.refreshes, 2);
  await e.clock.advance(500); c.status(); await e.clock.advance(500); assert.equal(c.refreshes, 3);
  await e.clock.advance(100000); c.status(); await e.clock.flush(); assert.equal(c.refreshes, 3);
});
test('持续正常播放后才重置恢复预算，中断心跳不能冒充稳定', async () => {
  const e = environment({ config: { cooldownSeconds: 0, maxRecoveries: 1, stableSeconds: 5 } });
  const c = addCell(e); e.start(); c.status(); await e.clock.advance(500);
  c.status('playing'); await e.clock.advance(10000); c.status('playing'); c.status();
  await e.clock.flush(); assert.equal(c.refreshes, 1);
  for (let i = 0; i < 6; i++) { c.status('playing'); await e.clock.advance(1000); }
  c.status(); await e.clock.advance(500); assert.equal(c.refreshes, 2);
});
test('换视频/销毁组件/退出页面后撤销旧恢复任务', async () => {
  for (const mode of ['changed', 'destroyed', 'removed', 'pagehide']) {
    const e = environment(); const c = addCell(e, { readyDelay: 1000 }); e.start();
    c.status(); await e.clock.flush();
    if (mode === 'changed') c.comp.cellContent.id = '12345678901';
    if (mode === 'destroyed') c.comp._isDestroyed = true;
    if (mode === 'removed') c.root.isConnected = false;
    if (mode === 'pagehide') e.emit('pagehide');
    await e.clock.advance(5000); assert.deepEqual(c.audioCalls, [], mode);
    if (mode === 'pagehide') assert.equal(e.clock.tasks.size, 0);
  }
});
test('刷新抛错受预算限制，异步协调异常不重复执行', async () => {
  const e = environment({ config: { cooldownSeconds: 0, maxRecoveries: 1 } });
  const c = addCell(e, { throws: true }); e.start(); c.status(); await e.clock.flush();
  await e.clock.advance(60000); c.status(); await e.clock.flush(); assert.equal(c.refreshes, 1);
  assert.equal(e.warnings.length, 1);
});
test('过期和未来跨窗口记录不永久阻塞，记录集合有上限', async () => {
  const store = shared(); const records = {};
  for (let i = 0; i < 200; i++) records[String(i).padStart(11, '0')] = { at: 1800000000000, owner: 'old' };
  records[ID] = { at: 1900000000000, owner: 'other' };
  store.data.set('holodex-recovery-cooldowns-v2', JSON.stringify(records));
  const e = environment({ store }); const c = addCell(e); e.start(); c.status(); await e.clock.advance(500);
  assert.equal(c.refreshes, 1);
  assert.ok(Object.keys(JSON.parse(store.data.get('holodex-recovery-cooldowns-v2'))).length <= 128);
});
test('移除后旧窗口/旧 token 的报告不能影响新 iframe', async () => {
  const e = environment(); const c = addCell(e); e.start(); const oldWindow = c.frame.contentWindow;
  const token = c.hello(); c.status(); await e.clock.advance(500);
  await e.clock.advance(30000);
  e.message(oldWindow, msg({ type: 'status', token, videoId: ID, status: 'stalled', volume: 1, muted: false }));
  await e.clock.flush(); assert.equal(c.refreshes, 1);
});
test('初次 pageshow 不移除 BFCache 恢复处理器，退出后子框停止发送', async () => {
  const e = child(); e.emit('pageshow', { persisted: false });
  e.emit('pagehide'); const sentBefore = e.sent.length;
  await e.clock.advance(60000); assert.equal(e.sent.length, sentBefore);
  assert.equal(e.clock.tasks.size, 0);
  e.emit('pageshow', { persisted: true }); assert.equal(e.reloads, 1);
});
test('单调时钟不受系统时钟倒退影响', async () => {
  const e = child(); e.context.Date.now = () => -100000;
  await e.clock.advance(3000); assert.equal(e.stalls().length, 1);
});
test('旧播放器即使继续挂在 refs 上也不能通过就绪检查', async () => {
  const e = environment({ config: { readyAttempts: 2 } });
  const c = addCell(e, { readyDelay: 999999 }); const old = c.comp.ytPlayer;
  e.start(); c.status(); await e.clock.flush(); c.comp.ytPlayer = old;
  await e.clock.advance(1000); assert.equal(c.setTimers, 0); assert.deepEqual(c.audioCalls, []);
  assert.equal(e.warnings.length, 1);
});
test('等待中 ready API 暂时抛错可有限重试成功', async () => {
  const e = environment(); const c = addCell(e); e.start(); c.status(); await e.clock.advance(0);
  const player = c.players.at(-1); let calls = 0;
  player.getPlayerState = () => { if (++calls === 1) throw Error('未就绪'); return 1; };
  await e.clock.advance(500); assert.equal(c.setTimers, 0);
  await e.clock.advance(500); assert.equal(c.setTimers, 1); assert.equal(e.warnings.length, 0);
});
test('重建 iframe 需要新握手，不能沿用旧 token', async () => {
  const e = environment(); const c = addCell(e); e.start(); const token = c.hello();
  c.status(); await e.clock.advance(20000);
  e.message(c.frame.contentWindow, msg({ type: 'status', token, videoId: ID, status: 'stalled', volume: 1, muted: false }));
  await e.clock.flush(); assert.equal(c.refreshes, 1);
  c.status(); await e.clock.advance(500); assert.equal(c.refreshes, 2);
});
test('端到端：子框检测→握手→父框重建→新播放器恢复音频', async () => {
  const clock = new Clock(); const host = environment({ clock }); const cell = addCell(host);
  const embed = environment({ child: true, clock }); embed.doc.video = video({ volume: 0.64, muted: true });
  embed.page.parent = host.page;
  cell.frame.contentWindow = embed.page;
  host.page.postMessage = (data, target) => {
    if (target === HOLODEX) clock.set(() => host.message(embed.page, data), 0);
  };
  embed.page.postMessage = (data, target) => {
    if (target === YOUTUBE) clock.set(() => embed.message(host.page, data), 0);
  };
  host.start(); embed.start(); await clock.advance(3500);
  assert.equal(cell.refreshes, 1);
  assert.deepEqual(cell.audioCalls, [['volume', 64], ['muted', true], ['play']]);
  host.emit('pagehide'); embed.emit('pagehide');
  await clock.advance(0); assert.equal(clock.tasks.size, 0);
});

async function playLive(e) {
  e.doc.ytData = { video_id: ID, isLive: true };
  e.doc.ytState = 1;
  e.doc.video.currentTime += 0.5;
  await e.clock.advance(500);
}
test('直播播放后意外变为结束/重播界面：默认持续12秒后报告恢复', async () => {
  const e = child(); await playLive(e); e.doc.video.ended = true; e.doc.video.paused = true; e.doc.ytState = 0;
  await e.clock.advance(12000); assert.equal(e.stalls().length, 0);
  await e.clock.advance(500); assert.equal(e.stalls().length, 1);
  assert.equal(e.stalls()[0].data.reason, 'live-ended');
  assert.equal(e.stalls()[0].data.volume, 0.37); assert.equal(e.stalls()[0].data.muted, false);
});
test('直播结束界面移除媒体节点后仍使用保存的音频状态报告', async () => {
  const e = child({ config: { bufferSeconds: 3 } }); e.doc.video.volume = 0; e.doc.video.muted = true;
  await playLive(e); e.doc.video = null; e.doc.ytState = 0;
  await e.clock.advance(3500); assert.equal(e.stalls().length, 1);
  assert.equal(e.stalls()[0].data.volume, 0); assert.equal(e.stalls()[0].data.muted, true);
});
test('直播播放后媒体错误也纳入有限恢复检测', async () => {
  const e = child({ config: { bufferSeconds: 3 } }); await playLive(e); e.doc.video.error = { code: 2 };
  e.doc.video.paused = true; e.doc.ytState = -1;
  await e.clock.advance(3500); assert.equal(e.stalls().length, 1); assert.equal(e.stalls()[0].data.reason, 'live-error');
});
test('直播主动暂停不因曾播放过而触发恢复', async () => {
  const e = child(); await playLive(e); e.doc.video.paused = true; e.doc.ytState = 2;
  await e.clock.advance(60000); assert.equal(e.stalls().length, 0);
});
test('普通视频、直播存档、尚未播放或ID不符时不恢复结束界面', async () => {
  for (const kind of ['vod', 'archive', 'unplayed', 'wrong-id']) {
    const e = child();
    if (kind === 'archive') e.doc.ytData = { video_id: ID, isLive: false, isLiveContent: true };
    if (kind === 'unplayed') e.doc.ytData = { video_id: ID, isLive: true };
    if (kind === 'wrong-id') e.doc.ytData = { video_id: '12345678901', isLive: true };
    if (kind !== 'unplayed') { e.doc.video.currentTime += 0.5; await e.clock.advance(500); }
    e.doc.video.ended = true; e.doc.video.paused = true; e.doc.ytState = 0;
    await e.clock.advance(60000); assert.equal(e.stalls().length, 0, kind);
  }
});
test('直播假结束短暂出现后自行恢复，不立即刷新', async () => {
  const e = child(); await playLive(e); e.doc.ytState = 0; e.doc.video.ended = true;
  await e.clock.advance(5000); e.doc.video.ended = false; e.doc.ytState = 1;
  for (let i = 0; i < 30; i++) { e.doc.video.currentTime += 0.5; await e.clock.advance(500); }
  assert.equal(e.stalls().length, 0);
});
test('直播意外结束期间离线或后台休眠，不计入连续故障时间', async () => {
  const e = child({ config: { bufferSeconds: 3 } }); await playLive(e);
  e.doc.ytState = 0; e.doc.video.ended = true; e.context.navigator.onLine = false;
  await e.clock.advance(30000); assert.equal(e.stalls().length, 0);
  e.context.navigator.onLine = true; await e.clock.advance(500);
  e.clock.now += 60000; const pending = [...e.clock.tasks.values()][0]; e.clock.tasks.clear(); pending.fn();
  assert.equal(e.stalls().length, 0); await e.clock.advance(3000); assert.equal(e.stalls().length, 1);
});

test('直播故障重建后传递上下文，后续重试保留首次音量与静音', async () => {
  const e = environment({ config: { cooldownSeconds: 0, backoffSeconds: 1 } }); const c = addCell(e); e.start();
  c.status('stalled', { reason: 'live-ended', volume: 0.23, muted: true }); await e.clock.advance(1000);
  c.hello(); const challenge = c.replies.at(-1).data;
  assert.equal(challenge.resumeInterruptedLive, true);
  assert.equal(challenge.audio.volume, 0.23); assert.equal(challenge.audio.muted, true);
  c.status('stalled', { reason: 'live-error', volume: 1, muted: false }); await e.clock.advance(500);
  assert.equal(c.refreshes, 2);
  assert.deepEqual(c.audioCalls.slice(-3), [['volume', 23], ['muted', true], ['play']]);
});
test('新直播 iframe 立即报结束时继承可信上下文，不被默认音量覆盖', async () => {
  const e = environment({ child: true, config: { bufferSeconds: 3 } });
  e.doc.video = video({ ended: true, paused: true, volume: 1 }); e.doc.ytState = 0; e.start();
  e.message(e.page.parent, msg({ type: 'challenge', videoId: ID, token: 'c'.repeat(32),
    resumeInterruptedLive: true, audio: { volume: 0, muted: true } }));
  await e.clock.advance(3500);
  const reports = e.sent.filter(m => m.data.status === 'stalled'); assert.equal(reports.length, 1);
  assert.equal(reports[0].data.volume, 0); assert.equal(reports[0].data.muted, true);
});
test('伪造直播恢复上下文仍必须通过父窗口与来源校验', async () => {
  const e = environment({ child: true, config: { bufferSeconds: 3 } });
  e.doc.video = video({ ended: true, paused: true }); e.doc.ytState = 0; e.start();
  const fake = msg({ type: 'challenge', videoId: ID, token: 'c'.repeat(32),
    resumeInterruptedLive: true, audio: { volume: 0.4, muted: false } });
  e.message({}, fake); e.message(e.page.parent, fake, 'https://evil.test');
  await e.clock.advance(30000); assert.equal(e.sent.filter(m => m.data.status === 'stalled').length, 0);
});

function edge(options = {}) {
  const e = environment({ userAgent: 'Mozilla Edg/156.0.0.0', ...options });
  const c = addCell(e), other = addCell(e, { id: '12345678901' });
  const p = c.comp.ytPlayer;
  c.loads = 0; c.cues = 0; c.volume = 37; c.mute = false; c.state = 1; c.progress = true;
  p.getVolume = () => c.volume;
  p.isMuted = () => c.mute;
  p.getCurrentTime = () => c.progress ? e.clock.now / 1000 : 10;
  p.getVideoData = () => ({ video_id: c.comp.cellContent.id });
  p.getPlayerState = () => c.state;
  p.setVolume = n => { c.volume = n; c.audioCalls.push(['volume', n]); };
  p.mute = () => { c.mute = true; c.audioCalls.push(['muted', true]); };
  p.unMute = () => { c.mute = false; c.audioCalls.push(['muted', false]); };
  p.loadVideoById = id => { assert.equal(id, ID); c.loads++; };
  p.cueVideoById = id => { assert.equal(id, ID); c.cues++; c.state = 5; };
  c.click = (kind = 'secondary', overrides = {}) => {
    const button = { classList: { contains: name => name === kind }, closest: () => c.root };
    const result = { prevented: false, stopped: false };
    e.emit('click', { target: { closest: () => button }, preventDefault: () => result.prevented = true,
      stopImmediatePropagation: () => result.stopped = true, ...overrides });
    return result;
  };
  c.intent = () => e.message(c.frame.contentWindow, msg({ type: 'intent', token: c.hello(), videoId: ID, action: 'cancel' }));
  e.start(); return { e, c, p, other };
}
test('Edge默认复用：保持对象、iframe、Vue引用、站点timer，其他格不受操作', async () => {
  const {e,c,p,other} = edge(); const frame=c.frame; c.status(); await e.clock.advance(1500);
  assert.equal(c.loads,1);assert.equal(c.refreshes,0);assert.equal(c.comp.ytPlayer,p);assert.equal(c.frame,frame);
  assert.equal(c.comp.timer,77);assert.equal(c.setTimers,0);assert.deepEqual(e.intervalsCleared,[]);
  assert.deepEqual(other.audioCalls,[]);assert.equal(other.refreshes,0);
  assert.ok(!e.warnings.some(w=>String(w).includes('已观察到播放进度')));
});
test('蓝色刷新与自动恢复共用互斥、冷却和次数预算', async () => {
  const {e,c}=edge(); const result=c.click();assert.equal(result.prevented,true);assert.equal(result.stopped,true);
  c.status();c.click();await e.clock.advance(1500);assert.equal(c.loads,1);
  c.click();await e.clock.flush();assert.equal(c.loads,1);
});
test('Edge静音false与音量0都保留', async () => {
  const {e,c}=edge();c.volume=0;c.mute=false;c.status();await e.clock.advance(1500);
  assert.equal(c.volume,0);assert.equal(c.mute,false);assert.ok(c.audioCalls.some(a=>a[0]==='volume'&&a[1]===0));
});
test('Edge缺少必要观测接口时显示提示，绝不重建', async () => {
  const {e,c,p}=edge();delete p.getCurrentTime;c.click();await e.clock.advance(10000);
  assert.equal(c.loads,0);assert.equal(c.refreshes,0);assert.equal(c.comp.timer,77);
  assert.ok(e.warnings.some(w=>String(w).includes('缺少安全复用接口')));
});
test('Edge加载抛错改用cue补救，没有重建回退', async () => {
  const {e,c,p}=edge();p.loadVideoById=()=>{throw Error('模拟失败');};c.click();await e.clock.advance(10000);
  assert.equal(c.refreshes,0);assert.equal(c.cues,1);assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,1);
});
test('Edge接口返回但没有进度，不能判定成功，超时不重建', async () => {
  const {e,c}=edge({config:{readyAttempts:3}});c.progress=false;c.status();await e.clock.advance(12000);
  assert.equal(c.loads,1);assert.equal(c.refreshes,0);
  assert.ok(e.warnings.some(w=>String(w).includes('未确认持续播放')));
  assert.ok(!e.warnings.some(w=>String(w).includes('已观察到播放进度')));
});
test('用户嵌入框操作取消后续音频恢复，暂停不被重新启动', async () => {
  const {e,c}=edge();c.status();await e.clock.flush();c.intent();c.state=2;
  await e.clock.advance(10000);c.status();await e.clock.flush();assert.equal(c.loads,1);assert.deepEqual(c.audioCalls,[]);
});
test('父页面用户音量操作取消恢复', async () => {
  const {e,c}=edge();c.status();await e.clock.flush();
  e.emit('input',{isTrusted:true,target:{closest:()=>c.root}});c.volume=22;
  await e.clock.advance(5000);assert.equal(c.volume,22);assert.deepEqual(c.audioCalls,[]);
});
test('音量被用户改动后不再次覆盖', async () => {
  const {e,c}=edge();c.progress=false;c.status();await e.clock.advance(500);const count=c.audioCalls.length;
  c.volume=18;await e.clock.advance(5000);assert.equal(c.volume,18);assert.equal(c.audioCalls.length,count);
});
test('持久暂停状态取消任务，不能误判持续成功', async () => {
  const {e,c}=edge();c.progress=false;c.status();await e.clock.advance(500);c.state=2;await e.clock.advance(10000);
  assert.ok(!e.warnings.some(w=>String(w).includes('已观察到播放进度')));assert.equal(c.loads,1);
});
test('等待中换视频、移除、销毁、换播放器都停止旧操作', async () => {
  for(const mode of ['video','frame','destroy','player']) {
    const {e,c}=edge();c.status();await e.clock.flush();
    if(mode==='video')c.comp.cellContent.id='12345678901';if(mode==='frame')c.frame.isConnected=false;
    if(mode==='destroy')c.comp._isDestroyed=true;if(mode==='player')c.comp.ytPlayer={};
    await e.clock.advance(5000);assert.deepEqual(c.audioCalls,[],mode);assert.equal(c.refreshes,0);
  }
});
test('用户在跨窗口锁等待期间操作，不再开始过期恢复', async () => {
  const {e,c}=edge();let release;
  e.context.navigator.locks.request=(_key,_options,fn)=>new Promise(resolve=>release=()=>resolve(fn({})));
  c.status();c.intent();release();await e.clock.advance(5000);assert.equal(c.loads,0);
});
test('黄色返回和垃圾桶放行原生行为，不显示拦截提示', async () => {
  const {e,c}=edge();for(const k of ['return-btn','deep-orange']){const result=c.click(k);assert.equal(result.stopped,false);assert.equal(result.prevented,false);}
  assert.equal(c.loads,0);assert.equal(c.refreshes,0);assert.equal(c.frame.isConnected,true);assert.deepEqual(c.audioCalls,[]);
  assert.ok(!e.warnings.some(w=>String(w).includes('未执行清空／删除')));
});
test('不拦截未知按钮、未知组件、Twitch或其他页面控件', async () => {
  const {c}=edge();assert.equal(c.click('primary').prevented,false);
  c.comp.isTwitchVideo=true;assert.equal(c.click().prevented,false);c.comp.isTwitchVideo=false;
  c.comp.$options.name='Other';assert.equal(c.click().prevented,false);
});
test('Edge可显式关闭复用，非Edge默认仍保留原行为', async () => {
  const {e,c}=edge({config:{edgeReuse:false}});assert.equal(c.click().prevented,false);
  c.status();await e.clock.advance(500);assert.equal(c.refreshes,1);assert.equal(c.loads,0);
});
test('自动播放关闭时cue待播；手动蓝色刷新仍用load', async () => {
  const {e,c}=edge({config:{autoplay:false}});c.status();await e.clock.advance(1000);
  assert.equal(c.cues,1);assert.equal(c.loads,0);assert.equal(c.state,5);
  const next=edge({config:{autoplay:false}});next.c.click();await next.e.clock.advance(1000);assert.equal(next.c.loads,1);
});
test('新配置Edge开关迁移不改旧键、不覆盖既有false及0',()=>{
  const e=environment({userAgent:'Edg/156',config:null,legacy:{AUTOPLAY_ON_RECOVER:false,REPLACE_COOLDOWN:0}});e.start();
  const cfg=e.values.get('RECOVERY_CONFIG_V2');assert.equal(cfg.edgeReuse,true);assert.equal(cfg.autoplay,false);assert.equal(cfg.cooldownSeconds,0);
});
test('用户操作消息也必须满足窗口、origin及token校验', async()=>{
  const {e,c}=edge();c.status();await e.clock.flush();e.message({},msg({type:'intent',token:c.hello(),videoId:ID,action:'cancel'}));
  await e.clock.advance(1500);assert.ok(c.audioCalls.length>0);
});
test('复用次数上限不能被密集蓝色点击绕过',async()=>{
  const {e,c}=edge({config:{maxRecoveries:1,cooldownSeconds:0}});c.click();await e.clock.advance(10000);c.click();await e.clock.advance(10000);assert.equal(c.loads,1);
});
test('页面退出后停止Edge复用任务且不再操作媒体',async()=>{
  const {e,c}=edge();c.status();await e.clock.flush();e.emit('pagehide');await e.clock.advance(10000);assert.deepEqual(c.audioCalls,[]);
});

test('中文设置中的Edge模式是复选框，保存保留false和0',()=>{
  const {e}=edge({config:{autoplay:false,cooldownSeconds:0}});
  const make=tag=>({tag,children:[],style:{setProperty(){}},handlers:{},appendChild(x){this.children.push(x);},
    setAttribute(){},addEventListener(k,f){this.handlers[k]=f;},showModal(){},remove(){}});
  const body=make('body');e.doc.body=body;e.doc.createElement=make;
  e.menus[0][1]();const nodes=[];function visit(n){nodes.push(n);for(const c of n.children)visit(c);}visit(body);
  const mode=nodes.find(n=>n.id==='ytfix-edgeReuse');assert.equal(mode.type,'checkbox');assert.equal(mode.checked,true);
  mode.checked=false;nodes.find(n=>n.textContent==='保存并刷新').handlers.click();
  const config=e.values.get('RECOVERY_CONFIG_V2');assert.equal(config.edgeReuse,false);assert.equal(config.autoplay,false);assert.equal(config.cooldownSeconds,0);assert.equal(e.reloads,1);
});
test('复用保护firstPlay避免站点首次播放静音其他格，取消时恢复原标记',async()=>{
  const first=edge();first.c.comp.firstPlay=true;first.c.status();await first.e.clock.flush();assert.equal(first.c.comp.firstPlay,false);
  await first.e.clock.advance(1500);assert.equal(first.c.comp.firstPlay,false);
  const second=edge();second.c.comp.firstPlay=true;second.c.status();await second.e.clock.flush();second.c.intent();assert.equal(second.c.comp.firstPlay,true);
});
test('getIframe异常显示明确提示且无重建',async()=>{
  const {e,c,p}=edge();p.getIframe=()=>{throw Error('接口异常');};c.click();await e.clock.advance(5000);
  assert.equal(c.refreshes,0);assert.equal(c.loads,0);assert.ok(e.warnings.some(w=>String(w).includes('无法安全访问')));
});

test('load有持续进度时不触发cue或额外play',async()=>{
  const {e,c}=edge();c.click();await e.clock.advance(65000);
  assert.equal(c.loads,1);assert.equal(c.cues,0);assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,0);
});
test('load无进度后cue就绪再自动play，确认进度后静默结束',async()=>{
  const {e,c,p,other}=edge({config:{readyAttempts:3,maxRecoveries:1}});const frame=c.frame;
  c.progress=false;c.state=3;let playedAt;
  p.playVideo=()=>{assert.equal(c.state,5);playedAt=e.clock.now;c.state=1;c.progress=true;c.audioCalls.push(['play']);};
  c.status();await e.clock.advance(1900);assert.equal(c.cues,0);
  await e.clock.advance(7000);assert.equal(c.loads,1);assert.equal(c.cues,1);assert.ok(playedAt>=2500);
  assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,1);assert.equal(c.comp.ytPlayer,p);assert.equal(c.frame,frame);
  assert.equal(c.refreshes,0);assert.equal(c.comp.timer,77);assert.equal(c.setTimers,0);assert.deepEqual(e.intervalsCleared,[]);
  assert.equal(other.refreshes,0);assert.deepEqual(other.audioCalls,[]);assert.deepEqual(e.warnings,[]);
});
test('cue等待封面未就绪前绝不调用play，准备超时只失败一次',async()=>{
  const {e,c,p}=edge({config:{readyAttempts:3}});c.progress=false;c.state=3;
  p.cueVideoById=()=>{c.cues++;};c.click();await e.clock.advance(65000);
  assert.equal(c.cues,1);assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,0);assert.equal(c.refreshes,0);
  assert.equal(e.warnings.filter(w=>String(w).includes('准备视频后仍未就绪')).length,1);
});
test('cue的陈旧播放状态和进度不能充当待播就绪',async()=>{
  const {e,c,p}=edge({config:{readyAttempts:3}});c.progress=false;
  p.cueVideoById=()=>{c.cues++;c.progress=true;c.state=1;};c.click();await e.clock.advance(12000);
  assert.equal(c.cues,1);assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,0);
  assert.ok(e.warnings.some(w=>String(w).includes('准备视频后仍未就绪')));
});
test('cue就绪play返回但无进度时停止，不循环补救或播放',async()=>{
  const {e,c}=edge({config:{readyAttempts:3}});c.progress=false;c.click();await e.clock.advance(65000);
  assert.equal(c.cues,1);assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,1);assert.equal(c.loads,1);
  assert.ok(e.warnings.some(w=>String(w).includes('未确认持续播放')));
});
test('load异常cue自动播放也可恢复，不等待完整load检查预算',async()=>{
  const {e,c,p}=edge({config:{readyAttempts:3}});c.progress=false;
  p.loadVideoById=()=>{c.loads++;throw Error('load');};p.playVideo=()=>{c.progress=true;c.state=1;c.audioCalls.push(['play']);};
  c.click();await e.clock.advance(2000);assert.equal(c.cues,1);assert.equal(c.loads,1);assert.deepEqual(e.warnings,[]);
});
test('补救缺少cue或play接口有具体提示且绝不重建',async()=>{
  for(const method of ['cueVideoById','playVideo']){
    const {e,c,p}=edge({config:{readyAttempts:3}});delete p[method];c.progress=false;c.click();await e.clock.advance(12000);
    assert.equal(c.cues,0);assert.equal(c.refreshes,0);assert.ok(e.warnings.some(w=>String(w).includes('缺少准备视频或播放接口')));
  }
});
test('cue与play分别抛错都停止且不退回重建',async()=>{
  for(const method of ['cueVideoById','playVideo']){
    const {e,c,p}=edge({config:{readyAttempts:3}});c.progress=false;p[method]=()=>{throw Error(method);};
    c.click();await e.clock.advance(65000);assert.equal(c.refreshes,0);
    assert.ok(e.warnings.some(w=>String(w).includes(method==='playVideo'?'自动播放调用失败':'准备视频补救调用失败')));
  }
});
test('cue完成前用户暂停取消，封面后来就绪也不自动播放',async()=>{
  const {e,c,p}=edge({config:{readyAttempts:3}});c.progress=false;c.state=3;
  p.cueVideoById=()=>{c.cues++;};c.click();await e.clock.advance(3500);assert.equal(c.cues,1);
  c.intent();c.state=5;await e.clock.advance(12000);assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,0);
});
test('cue期间音量或静音改变会取消，不覆盖用户音频',async()=>{
  for(const kind of ['volume','mute']){
    const {e,c}=edge({config:{readyAttempts:3}});c.progress=false;c.click();await e.clock.advance(2000);
    if(kind==='volume')c.volume=0;else c.mute=true;
    const count=c.audioCalls.length;await e.clock.advance(12000);assert.equal(c.audioCalls.length,count);
    assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,0);
  }
});
test('补救保留音量0和静音false，其他格未受操作',async()=>{
  const {e,c,p,other}=edge({config:{readyAttempts:3}});c.volume=0;c.mute=false;c.progress=false;
  p.playVideo=()=>{assert.equal(c.volume,0);assert.equal(c.mute,false);c.progress=true;c.state=1;};
  c.click();await e.clock.advance(6500);assert.equal(c.cues,1);assert.equal(c.volume,0);assert.equal(c.mute,false);
  assert.deepEqual(other.audioCalls,[]);assert.equal(other.refreshes,0);
});
test('补救中换视频、iframe、播放器、销毁或页面退出不再调用play',async()=>{
  for(const mode of ['video','frame','player','destroy','pagehide']){
    const {e,c}=edge({config:{readyAttempts:3}});c.progress=false;c.click();await e.clock.advance(2000);
    if(mode==='video')c.comp.cellContent.id='12345678901';if(mode==='frame')c.frame.isConnected=false;
    if(mode==='player')c.comp.ytPlayer={};if(mode==='destroy')c.comp._isDestroyed=true;if(mode==='pagehide')e.emit('pagehide');
    await e.clock.advance(12000);assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,0,mode);
  }
});
test('补救全程保持互斥，共用一次恢复预算',async()=>{
  const {e,c}=edge({config:{readyAttempts:3,maxRecoveries:1,cooldownSeconds:0}});c.progress=false;
  c.click();await e.clock.advance(3500);for(let i=0;i<10;i++){c.click();c.status();}
  await e.clock.advance(12000);c.click();await e.clock.flush();assert.equal(c.loads,1);assert.equal(c.cues,1);
});
test('自动播放关闭时只cue待播，不自动play；手动蓝色刷新仍执行补救自动播放',async()=>{
  const first=edge({config:{autoplay:false,readyAttempts:3}});first.c.status();await first.e.clock.advance(12000);
  assert.equal(first.c.loads,0);assert.equal(first.c.cues,1);assert.equal(first.c.audioCalls.filter(a=>a[0]==='play').length,0);
  const second=edge({config:{autoplay:false,readyAttempts:3}});second.c.progress=false;second.c.click();await second.e.clock.advance(12000);
  assert.equal(second.c.loads,1);assert.equal(second.c.cues,1);assert.equal(second.c.audioCalls.filter(a=>a[0]==='play').length,1);
});
test('接口暂时缺失可有限重新查找，恢复后只加载一次',async()=>{
  const {e,c,p}=edge();const load=p.loadVideoById;delete p.loadVideoById;c.click();await e.clock.advance(1000);
  assert.equal(c.loads,0);p.loadVideoById=load;await e.clock.advance(3000);assert.equal(c.loads,1);assert.deepEqual(e.warnings,[]);
});
test('接口永久缺失有具体缺失方法提示且有限停止',async()=>{
  const {e,c,p}=edge({config:{readyAttempts:3}});delete p.loadVideoById;delete p.cueVideoById;c.click();await e.clock.advance(65000);
  assert.equal(c.loads,0);assert.equal(c.cues,0);assert.equal(c.refreshes,0);
  assert.equal(e.warnings.filter(w=>String(w).includes('缺少 loadVideoById')).length,1);
});
test('接口等待中用户操作、换视频、移除或退出取消重新查找',async()=>{
  for(const mode of ['user','video','frame','exit']){
    const {e,c,p}=edge();const load=p.loadVideoById;delete p.loadVideoById;c.click();await e.clock.flush();
    if(mode==='user')c.intent();if(mode==='video')c.comp.cellContent.id='12345678901';
    if(mode==='frame')c.frame.isConnected=false;if(mode==='exit')e.emit('pagehide');p.loadVideoById=load;
    await e.clock.advance(10000);assert.equal(c.loads,0,mode);assert.deepEqual(c.audioCalls,[],mode);
  }
});
test('主引用失效可使用匹配当前iframe的现有ref，不改Vue引用',async()=>{
  const {e,c,p}=edge();const stale={};c.comp.ytPlayer=stale;c.click();await e.clock.advance(1500);
  assert.equal(c.loads,1);assert.equal(c.comp.ytPlayer,stale);assert.equal(c.comp.$refs.player.player,p);assert.equal(c.refreshes,0);
});
test('接口等待允许同一格出现就绪引用，但不使用其他iframe播放器',async()=>{
  const {e,c,p,other}=edge();c.comp.ytPlayer=other.comp.ytPlayer;c.comp.$refs.player.player=null;
  c.click();await e.clock.advance(500);assert.equal(c.loads,0);c.comp.ytPlayer=p;
  await e.clock.advance(2000);assert.equal(c.loads,1);assert.deepEqual(other.audioCalls,[]);
});
test('cue延迟就绪只在状态5出现后play，不根据调用返回提前播放',async()=>{
  const {e,c,p}=edge({config:{readyAttempts:3}});c.progress=false;c.state=3;
  p.cueVideoById=()=>{c.cues++;e.clock.set(()=>c.state=5,800);};
  p.playVideo=()=>{assert.equal(c.state,5);c.audioCalls.push(['play']);c.state=1;c.progress=true;};
  c.click();await e.clock.advance(2900);assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,0);
  await e.clock.advance(3000);assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,1);assert.deepEqual(e.warnings,[]);
});
test('默认8次load检查约20秒后才开始一次cue补救',async()=>{
  const {e,c}=edge();c.progress=false;c.state=3;c.click();await e.clock.advance(19999);assert.equal(c.cues,0);
  await e.clock.advance(1);assert.equal(c.cues,1);await e.clock.advance(65000);
  assert.equal(c.cues,1);assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,1);
});
test('准备后自动播放被阻止时有限停止，提示手动播放而不取消静音',async()=>{
  const {e,c,p}=edge({config:{readyAttempts:3}});c.progress=false;c.volume=100;c.mute=true;
  p.playVideo=()=>{c.audioCalls.push(['play']);c.state=2;};c.click();await e.clock.advance(65000);
  assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,1);assert.equal(c.mute,true);assert.equal(c.volume,100);
  assert.ok(e.warnings.some(w=>String(w).includes('自动播放仍处于暂停')));assert.equal(c.refreshes,0);
});
test('load永久缺失但cue/play完整时，有限等待后直接补救自动播放',async()=>{
  const {e,c,p}=edge({config:{readyAttempts:3}});delete p.loadVideoById;
  p.playVideo=()=>{c.state=1;c.progress=true;c.audioCalls.push(['play']);};
  c.click();await e.clock.advance(999);assert.equal(c.cues,0);await e.clock.advance(3000);
  assert.equal(c.cues,1);assert.equal(c.loads,0);assert.equal(c.audioCalls.filter(a=>a[0]==='play').length,1);
  assert.equal(c.refreshes,0);assert.deepEqual(e.warnings,[]);
});

(async () => {
  let failures = 0;
  console.log(`Node ${process.version} | 黑盒模拟测试 | ${new Date().toISOString()}`);
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.log(`FAIL ${name}\n${error.stack}`); }
  }
  console.log(`RESULT ${tests.length - failures}/${tests.length} passed; ${failures} failed`);
  console.log('范围：脚本真实执行 + 虚拟时间/DOM/Vue/播放器/双窗口；尚未验证真实网站、浏览器自动播放及脚本管理器隔离环境。');
  process.exitCode = failures ? 1 : 0;
})();
