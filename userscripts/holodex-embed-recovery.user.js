// ==UserScript==
// @name         Holodex Multiview YouTube Embed Recovery
// @name:zh-CN   Holodex 多视图播放器恢复（中文升级版）
// @namespace    Nep
// @version      0.2.1
// @author       Nep; 中文升级维护
// @description  有限重试恢复卡死或持续缓冲的播放器，保留音量、静音及原始嵌入参数。
// @match        https://holodex.net/*
// @match        https://www.holodex.net/*
// @match        https://www.youtube.com/embed/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  const CHANNEL = 'holodex-embed-recovery';
  const CONFIG_KEY = 'RECOVERY_CONFIG_V2';
  const COOLDOWN_KEY = 'holodex-recovery-cooldowns-v2';
  const HOLODEX = ['https://holodex.net', 'https://www.holodex.net'];
  const YOUTUBE = 'https://www.youtube.com';
  const ID = /^[\w-]{11}$/;
  const page = typeof unsafeWindow === 'object' ? unsafeWindow : window;
  const doc = page.document;
  const number = (x, fallback, min, max) => typeof x === 'number' && Number.isFinite(x)
    ? Math.min(max, Math.max(min, x)) : fallback;
  const bool = (x, fallback) => typeof x === 'boolean' ? x : fallback;
  const read = (key, fallback) => {
    try { return GM_getValue(key, fallback); } catch { return fallback; }
  };
  const write = (key, value) => {
    try { GM_setValue(key, value); return true; } catch { return false; }
  };

  function normalize(raw = {}) {
    if (!raw || typeof raw !== 'object') raw = {};
    return {
      schema: 2,
      autoplay: bool(raw.autoplay, true),
      edgeReuse: bool(raw.edgeReuse, /\bEdg\//.test(navigator.userAgent || '')),
      stallSeconds: number(raw.stallSeconds, 3, 1, 120),
      bufferSeconds: number(raw.bufferSeconds, 12, 3, 180),
      cooldownSeconds: number(raw.cooldownSeconds, 15, 0, 600),
      readyAttempts: Math.floor(number(raw.readyAttempts, 8, 1, 16)),
      maxRecoveries: Math.floor(number(raw.maxRecoveries, 3, 1, 8)),
      backoffSeconds: number(raw.backoffSeconds, 5, 1, 60),
      startupSeconds: number(raw.startupSeconds, 10, 0, 60),
      stableSeconds: number(raw.stableSeconds, 30, 5, 120)
    };
  }

  const oldConfig = read(CONFIG_KEY, null);
  // 保留旧键供回退；STALL_TICKS 按旧设置界面声明的“秒”迁移，而非继续沿用错误的半秒计数。
  let config = normalize(oldConfig?.schema === 2 ? oldConfig : {
    autoplay: read('AUTOPLAY_ON_RECOVER', true),
    stallSeconds: read('STALL_TICKS', 3),
    cooldownSeconds: read('REPLACE_COOLDOWN', 15),
    readyAttempts: read('PLAY_RETRY_ATTEMPTS', 8)
  });
  if (HOLODEX.includes(location.origin) && oldConfig?.schema !== 2) write(CONFIG_KEY, config);

  // 所有脚本自己的定时任务均可撤销；页面退出、组件销毁或换视频后停止恢复。
  const timers = new Set();
  const disposers = [];
  let stopped = false;
  function later(fn, ms) {
    const timer = setTimeout(() => { timers.delete(timer); if (!stopped) fn(); }, ms);
    timers.add(timer);
    return timer;
  }
  function cancel(timer) { clearTimeout(timer); timers.delete(timer); }
  function listen(target, type, fn, capture = false) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn, capture);
    disposers.push(() => target.removeEventListener(type, fn, capture));
  }
  function cleanup() {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const dispose of disposers.splice(0)) dispose();
  }
  listen(page, 'pagehide', cleanup);
  // BFCache 恢复后重新初始化，避免重复监听及留下已停止的监视器。
  page.addEventListener('pageshow', e => { if (e.persisted && stopped) location.reload(); });
  const mono = () => performance.now();
  const nonce = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
  function parse(data) {
    if (typeof data === 'string') {
      if (data.length > 2048) return null;
      try { data = JSON.parse(data); } catch { return null; }
    }
    return data && typeof data === 'object' && !Array.isArray(data)
      && data.channel === CHANNEL && data.version === 2 ? data : null;
  }
  const envelope = data => ({ channel: CHANNEL, version: 2, ...data });
  const validAudio = d => typeof d.volume === 'number' && Number.isFinite(d.volume)
    && d.volume >= 0 && d.volume <= 1 && typeof d.muted === 'boolean';
  function frameInfo(frame) {
    try {
      const u = new URL(frame.src);
      const match = u.pathname.match(/^\/embed\/([\w-]{11})$/);
      return frame.tagName === 'IFRAME' && u.origin === YOUTUBE && match
        ? { id: match[1], origin: u.origin } : null;
    } catch { return null; }
  }

  if (location.origin === YOUTUBE) {
    const videoId = location.pathname.match(/^\/embed\/([\w-]{11})$/)?.[1];
    if (!videoId || page.parent === page) return;
    let parentOrigin = null;
    let token = null;
    let state = null;
    let lastSent = -Infinity;
    let lastHello = -Infinity;
    let lastStatus = null;
    let wasLive = false;
    let wasPlaying = false;
    let terminalAt = null;
    let previousTick = null;
    let lastAudio = null;
    let inheritedLiveAudio = false;
    const born = mono();
    listen(page, 'message', e => {
      if (e.source !== page.parent || !HOLODEX.includes(e.origin)) return;
      const d = parse(e.data);
      if (!d || d.type !== 'challenge' || d.videoId !== videoId || !/^[a-f0-9]{32}$/.test(d.token)) return;
      parentOrigin = e.origin;
      token = d.token;
      // 父页面只对本次直播故障的后续重建传递上下文，防止新 iframe 立即报结束时再次漏检。
      if (d.resumeInterruptedLive === true && validAudio(d.audio)) {
        const alreadyPlaying = wasPlaying;
        wasLive = true;
        wasPlaying = true;
        if (!alreadyPlaying) {
          lastAudio = { volume: d.audio.volume, muted: d.audio.muted };
          inheritedLiveAudio = true;
        }
      }
    });
    // 用户在嵌入播放器里操作时，优先放弃尚未完成的自动控制。
    const userIntent = e => {
      if (e.isTrusted && token) send({ type: 'intent', token, videoId, action: 'cancel' });
    };
    listen(doc, 'pointerdown', userIntent, true);
    listen(doc, 'keydown', userIntent, true);
    function send(data) {
      if (parentOrigin) page.parent.postMessage(envelope(data), parentOrigin);
    }
    function report(status, reason, audio, now) {
      if (token && audio && (status !== lastStatus || now - lastSent >= (status === 'stalled' ? 2000 : 1000))) {
        send({ type: 'status', token, videoId, status, reason, ...audio });
        lastSent = now;
      }
      lastStatus = status;
    }
    function tick() {
      const now = mono();
      if (!token && now - lastHello >= 2000) {
        lastHello = now;
        for (const origin of HOLODEX) page.parent.postMessage(envelope({ type: 'hello', videoId }), origin);
      }
      const video = doc.querySelector('video');
      let ytState;
      try {
        const player = doc.getElementById('movie_player');
        ytState = player?.getPlayerState?.();
        const data = player?.getVideoData?.();
        // isLiveContent 也可能表示已结束的直播存档，不能单凭它启动直播恢复。
        if (data && (!data.video_id || data.video_id === videoId) && data.isLive === true) wasLive = true;
      } catch { /* 嵌入播放器还未就绪；缺少直播信息时不猜测普通结束状态。 */ }
      const gapAfterSleep = previousTick !== null && now - previousTick > 2000;
      previousTick = now;
      if (video && validAudio(video) && !inheritedLiveAudio) lastAudio = { volume: video.volume, muted: video.muted };
      // 直播曾确实播放，之后意外进入重播/结束或媒体错误，不能继续一概按 idle 跳过。
      // 仅覆盖有直播证据的已播放会话；普通视频结束和主动暂停仍保持原行为。
      const liveInterrupted = wasLive && wasPlaying && ytState !== 2 && !video?.seeking
        && navigator.onLine !== false && (ytState === 0 || video?.ended || video?.error);
      if (liveInterrupted) {
        if (terminalAt === null || gapAfterSleep) terminalAt = now;
        const stalled = now - born >= config.startupSeconds * 1000
          && now - terminalAt >= config.bufferSeconds * 1000;
        report(stalled ? 'stalled' : 'waiting', video?.error ? 'live-error' : 'live-ended', lastAudio, now);
        state = null;
        later(tick, 500);
        return;
      }
      terminalAt = null;
      if (video) {
        const src = video.currentSrc || video.src;
        const previous = state;
        if (!state || state.video !== video || state.src !== src) {
          state = { video, src, time: video.currentTime, progressTime: video.currentTime, progressAt: now, sampleAt: now, lastStatus: 'idle' };
        }
        const s = state;
        const gap = now - s.sampleAt;
        const idle = video.ended || video.seeking || video.error || navigator.onLine === false
          || (video.paused && ytState !== 3);
        const advanced = Math.abs(video.currentTime - s.progressTime) >= 0.04;
        if (advanced && !idle && previous === s) {
          wasPlaying = true;
          inheritedLiveAudio = false;
          lastAudio = { volume: video.volume, muted: video.muted };
        }
        const reset = idle || gap > 2000 || previous !== s;
        if (reset || advanced) {
          s.progressAt = now;
          s.progressTime = video.currentTime;
        }
        const buffering = video.readyState < 3 || ytState === 3;
        const threshold = (buffering ? config.bufferSeconds : config.stallSeconds) * 1000;
        const stalled = !idle && now - born >= config.startupSeconds * 1000 && now - s.progressAt >= threshold;
        // playing 只代表时间真正推进；无进度但尚未超时不能重置父页面重试预算。
        const status = idle ? 'idle' : stalled ? 'stalled' : advanced && !reset ? 'playing' : 'waiting';
        report(status, buffering ? 'buffering' : 'frozen', lastAudio, now);
        s.lastStatus = status;
        s.time = video.currentTime;
        s.sampleAt = now;
      } else state = null;
      later(tick, 500);
    }
    tick();
    return;
  }

  if (!HOLODEX.includes(location.origin) || page.top !== page) return;

  function settings() {
    const fields = {
      edgeReuse: {
        label: 'Edge 播放器复用模式（修改后刷新生效）',
        help: 'Edge 默认开启；其他浏览器默认关闭。蓝色刷新和自动恢复会复用当前播放器，避免销毁 iframe。成功不弹提示；失败只提示，不退回重建。\n黄色返回和垃圾桶保留网站原生清空、删除行为，可能再次触发其他格中断。添加视频和布局调整也可能触发网站原生重建，不在本版修复范围。\n请先关闭 Touch Controls 的智能自动播放，只启用一份新版 Recovery。此模式是兼容绕过，Holodex 实际效果仍需验证。'
      },
      autoplay: {
        label: '恢复后自动尝试播放',
        help: '默认：开启。脚本重新加载卡住的视频格后，尝试继续播放，并还原该格的音量和静音状态。\n关闭：仍会重新加载播放器、还原音频设置，但需要你点击播放。\n浏览器可能限制有声自动播放；即使开启，也可能需要手动点一次播放。此开关不负责自动播放你刚添加的视频。'
      },
      stallSeconds: {
        label: '画面卡住多久后恢复（秒）', min: 1, max: 120,
        help: '默认：3 秒；可设置 1～120 秒。视频处于播放状态、没有显示缓冲，但播放进度连续不前进，达到这个时间后尝试恢复。\n调小：更快处理卡死，也更容易把短暂卡顿当成故障。调大：更耐受短暂卡顿，但真正卡死时要多等一会儿。\n偶尔正常卡一下就被重新加载，可改为 5～8 秒；一直转圈的情况主要看下一项。主动暂停、拖动进度条和视频结束不按卡死处理。'
      },
      bufferSeconds: {
        label: '持续转圈多久后恢复（秒）', min: 3, max: 180,
        help: '默认：12 秒；可设置 3～180 秒。播放器一直缓冲、播放进度也没有前进，持续达到这个时间后尝试恢复。已确认是直播且曾正常播放的格子，若意外退回重播/结束界面或媒体报错，也按这个时间尝试恢复。\n调小：转圈后较快恢复，但网络慢时可能反复重新加载。调大：允许播放器多缓冲一会儿，适合网络不稳定的情况。\n经常只是网速慢，可改为 20～30 秒；若只有删除其他视频后才长期转圈，可以先保留默认值。检测到浏览器离线时会暂停故障判定。真实下播与意外中断不一定能区分，因此也可能尝试恢复，但始终受次数上限限制。'
      },
      cooldownSeconds: {
        label: '两次恢复的最短间隔（秒）', min: 0, max: 600,
        help: '默认：15 秒；可设置 0～600 秒。从一次恢复开始计时，同一格再次恢复前至少等这么久，避免频繁重新加载。\n调大：恢复更保守，减少连续加载；调小：可更快再次尝试。设为 0 仅关闭这项冷却，退避等待、次数上限和正在进行的恢复仍然有效。\n同页不同视频格分别计算。同一浏览器存储分区、同一网站地址下的多个窗口，会尽量错开同一视频的恢复；隐私窗口与普通窗口不共享。浏览器不支持协调能力时，只保证本页冷却。'
      },
      readyAttempts: {
        label: '恢复结果的最多检查次数', min: 1, max: 16, integer: true,
        help: '默认：8 次；可设置 1～16 次整数。Edge复用模式检查同一个播放器是否恢复播放且进度推进；其他模式检查新播放器是否就绪。\n这不是“重新加载视频的次数”。检查会逐渐放慢，默认 8 次约等待最多 20 秒；浏览器后台调度变慢时可能更久。\n加载慢、经常提示等待超时，可改为 10～12 次。调小会更早放弃这轮等待，但不一定能更快播放。'
      },
      maxRecoveries: {
        label: '同一格连续恢复的最多次数', min: 1, max: 8, integer: true,
        help: '默认：3 次；可设置 1～8 次整数。同一格一直出问题时，最多自动重新加载这么多次，防止陷入不停刷新。\n调大：允许更多次自动尝试，但可能造成更长时间的反复加载。调小：更早停止自动恢复，需要你手动处理。刷新过程失败也会占用一次次数。\n达到上限后，脚本停止自动重新加载这个格；你可以手动刷新该格或整个页面。如果后来连续正常播放达到最后一项的时长，次数会重新计数。'
      },
      backoffSeconds: {
        label: '连续失败后逐步加长的等待基数（秒）', min: 1, max: 60,
        help: '默认：5 秒；可设置 1～60 秒。同一格连续需要恢复时，下一轮等待会依次按这个值的 1 倍、2 倍、4 倍……加长，避免越卡越频繁地重新加载。\n例如设为 5 秒，退避等待依次是 5、10、20 秒……；实际还要满足上面的“最短间隔”。两者同时生效，取较长的等待，并且要等当前恢复处理结束。\n调大：连续失败后更慢重试；调小：更积极重试。通常保留 5 秒即可；这项不会改变首次卡死或持续转圈的判定时间。'
      },
      startupSeconds: {
        label: '新播放器首次加载的保护时间（秒）', min: 0, max: 60,
        help: '默认：10 秒；可设置 0～60 秒。从新的视频嵌入框开始运行起，在这段时间内不触发故障恢复，给正常加载留出时间。自动恢复产生的新播放器也有这段保护时间。\n调大：慢网络或慢设备不容易刚加载就被重置；调小：新播放器真的卡死时可以更早处理。设为 0 表示不额外保护首次加载。\n保护时间和前面的故障判定时间可以同时计时，不是简单相加；最终还要满足冷却、退避和次数限制，才会尝试恢复。'
      },
      stableSeconds: {
        label: '正常播放多久后重新计算恢复次数（秒）', min: 5, max: 120,
        help: '默认：30 秒；可设置 5～120 秒。同一格持续正常播放、进度不断前进达到这个时间后，之前累计的恢复次数清零，之后出现新故障时可重新自动恢复。\n调小：较快重新获得完整恢复次数，但间歇性卡顿时可能长期反复恢复。调大：更严格确认问题已经消失，减少循环重试。\n只是画面不转圈、暂停不动或等待消息中断，都不算持续正常播放。这项不是“每隔多久刷新视频”。'
      }
    };
    doc.getElementById('ytfix-settings-modal')?.remove();
    const panel = doc.createElement('dialog');
    panel.id = 'ytfix-settings-modal';
    panel.style.cssText = 'background:#202020;color:#f8fafc;color-scheme:dark;width:min(720px,calc(100vw - 32px));max-height:90vh;overflow:auto;box-sizing:border-box;padding:24px;border:1px solid #777;border-radius:12px;';
    const title = doc.createElement('h3');
    title.textContent = 'Holodex 播放器恢复设置';
    panel.appendChild(title);
    function note(text) {
      const p = doc.createElement('p');
      p.textContent = text;
      p.style.cssText = 'font-size:14px;line-height:1.7;white-space:pre-line;margin:10px 0 0;';
      p.style.setProperty('color', '#cbd5e1', 'important');
      p.style.setProperty('-webkit-text-fill-color', '#cbd5e1', 'important');
      return p;
    }
    panel.appendChild(note('不确定怎么调时，先保留默认值即可。以下“恢复”指重新加载出问题的那个视频格。每项下方都说明了用途与调整影响，向下滚动可查看全部设置。'));
    const inputs = {};
    for (const [key, field] of Object.entries(fields)) {
      const group = doc.createElement('section');
      group.style.cssText = 'margin-top:20px;padding-top:16px;border-top:1px solid #475569;';
      const row = doc.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:16px;justify-content:space-between;margin:0;font-weight:600;';
      const labelText = doc.createElement('span');
      labelText.textContent = field.label;
      labelText.style.cssText = 'min-width:0;overflow-wrap:anywhere;';
      labelText.style.setProperty('color', '#f8fafc', 'important');
      row.appendChild(labelText);
      const input = doc.createElement('input');
      input.id = `ytfix-${key}`;
      input.setAttribute('aria-describedby', `ytfix-help-${key}`);
      input.type = ['autoplay', 'edgeReuse'].includes(key) ? 'checkbox' : 'number';
      input.style.cssText = input.type === 'checkbox'
        ? 'flex:0 0 22px;width:22px;height:22px;accent-color:#60a5fa;cursor:pointer;'
        : 'flex:0 0 88px;width:88px;min-height:38px;box-sizing:border-box;border:1px solid #94a3b8;border-radius:6px;padding:6px 10px;font:inherit;line-height:1.4;text-align:right;opacity:1;color-scheme:dark;';
      if (input.type === 'number') {
        // 显式覆盖宿主页的输入框颜色；text-fill-color 也要设置，否则部分浏览器仍显示黑字。
        input.style.setProperty('color', '#f8fafc', 'important');
        input.style.setProperty('-webkit-text-fill-color', '#f8fafc', 'important');
        input.style.setProperty('background-color', '#303846', 'important');
      }
      if (input.type === 'checkbox') input.checked = config[key];
      else {
        input.value = String(config[key]); input.step = field.integer ? '1' : 'any';
        input.min = String(field.min); input.max = String(field.max);
      }
      const help = note(field.help);
      help.id = `ytfix-help-${key}`;
      row.appendChild(input); group.appendChild(row); group.appendChild(help); panel.appendChild(group); inputs[key] = input;
    }
    panel.appendChild(note('保存说明：点击“保存并刷新”会保存设置，并刷新整个 Holodex 页面，所有视频都需要重新加载。点击“取消”不保存。输入框留空会恢复该项默认值；超出允许范围会按边界值保存，次数会取整数。升级脚本会保留你已保存的设置，界面中的默认值只是参考。'));
    const actions = doc.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:12px;margin-top:24px;';
    for (const [label, action] of [
      ['取消', () => panel.remove()],
      ['保存并刷新', () => {
        const raw = {};
        for (const [key, input] of Object.entries(inputs)) raw[key] = input.type === 'checkbox'
          ? input.checked : input.value.trim() === '' ? undefined : Number(input.value);
        config = normalize(raw);
        if (!write(CONFIG_KEY, config)) { page.alert('设置保存失败，请检查脚本管理器权限。'); return; }
        location.reload();
      }]
    ]) {
      const button = doc.createElement('button');
      button.style.cssText = 'font:inherit;line-height:1.4;padding:8px 16px;border:1px solid #94a3b8;border-radius:6px;cursor:pointer;';
      button.style.setProperty('color', '#ffffff', 'important');
      button.style.setProperty('-webkit-text-fill-color', '#ffffff', 'important');
      button.style.setProperty('background-color', label === '取消' ? '#374151' : '#1d4ed8', 'important');
      button.textContent = label; button.addEventListener('click', action); actions.appendChild(button);
    }
    panel.appendChild(actions);
    (doc.body || doc.documentElement).appendChild(panel);
    panel.showModal();
  }
  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('播放器恢复：中文设置', settings);

  // DOM 深度与 Vue 父链深度分别计数；每个入口独立搜索，循环/达到上限均视作未找到。
  function findCell(frame) {
    const seen = new Set();
    let el = frame;
    for (let domDepth = 0; el && domDepth < 32; domDepth++, el = el.parentElement) {
      for (const root of [el.__vue__, el.__vueParentComponent?.proxy]) {
        let vm = root;
        for (let vueDepth = 0; vm && vueDepth < 32 && !seen.has(vm); vueDepth++, vm = vm.$parent) {
          seen.add(vm);
          if (vm.$options?.name === 'VideoCell' && !vm._isDestroyed && !vm._isBeingDestroyed
            && typeof vm.refresh === 'function' && 'uniqueId' in (vm.$data || {})
            && typeof vm.setTimer === 'function' && vm.cellContent?.id === frameInfo(frame)?.id
            && vm.$el?.contains(frame)) return vm;
        }
      }
    }
    return null;
  }
  const sessions = new WeakMap(); // 每个 iframe 各自握手，绝不按视频 ID 猜测消息来源。
  const cells = new WeakMap(); // 同视频的两个格子预算独立；重建 iframe 不会清空预算。
  const jobs = new Set();
  function playerOf(vm) {
    return vm.ytPlayer || vm.$refs?.player?.player || null;
  }
  function alive(job) {
    return !stopped && !job.vm._isDestroyed && !job.vm._isBeingDestroyed
      && job.vm.$el?.isConnected && job.vm.cellContent?.id === job.videoId;
  }
  function finish(job) {
    if (job.timer) cancel(job.timer);
    job.state.busy = false;
    job.state.job = null;
    jobs.delete(job);
    if (job.reuse && job.guardedFirstPlay && !job.progressed && !job.vm._isDestroyed
      && job.vm.cellContent?.id === job.videoId && job.vm.firstPlay === false)
      job.vm.firstPlay = true;
  }
  function fail(job, reason) {
    finish(job);
    console.warn('[Holodex 恢复]', reason, job.videoId);
  }
  function applyAudio(vm, player, audio) {
    // 先同步站点的静音值，再触发 player 事件，避免 setMuted 误判为用户操作并 muteOthers。
    vm.muted = audio.muted;
    player.setVolume(Math.round(audio.volume * 100));
    audio.muted ? player.mute() : player.unMute();
    if (vm.$data && 'volume' in vm.$data) vm.volume = Math.round(audio.volume * 100);
  }
  function waitReady(job) {
    if (!alive(job)) { finish(job); return; }
    job.polls++;
    try {
      const player = playerOf(job.vm);
      const frame = player?.getIframe?.();
      const currentFrame = job.vm.$el.querySelector?.('iframe');
      const valid = player && player !== job.oldPlayer && frame && frame !== job.oldFrame
        && frame === currentFrame && frame.isConnected && frameInfo(frame)?.id === job.videoId
        && typeof player.getPlayerState === 'function' && Number.isFinite(player.getPlayerState())
        && typeof player.setVolume === 'function' && typeof player.mute === 'function'
        && typeof player.unMute === 'function' && typeof player.playVideo === 'function';
      if (valid) {
        applyAudio(job.vm, player, job.audio);
        // 清理旧定时器后，等全新的 player ready 再恢复站点轮询。
        job.vm.setTimer();
        if (config.autoplay) player.playVideo();
        finish(job);
        return;
      }
    } catch { /* 新播放器在 ready 前可能抛错；受次数上限约束。 */ }
    if (job.polls >= config.readyAttempts) { fail(job, '等待新播放器超时，请手动刷新此格'); return; }
    job.timer = later(() => waitReady(job), Math.min(500 * 2 ** (job.polls - 1), 4000));
  }

  // Web Locks 将跨窗口的读/检查/写串行化；不支持时仅保留本页逐格冷却，避免伪装成原子锁。
  const windowId = nonce();
  async function claimWindow(videoId, action) {
    if (!navigator.locks?.request || config.cooldownSeconds === 0) return action();
    try {
      return await navigator.locks.request(`${CHANNEL}:${videoId}`, { ifAvailable: true }, lock => {
        if (!lock || stopped) return false;
        const now = Date.now();
        let records;
        try { records = JSON.parse(page.localStorage.getItem(COOLDOWN_KEY) || '{}'); } catch { records = {}; }
        if (!records || typeof records !== 'object' || Array.isArray(records)) records = {};
        const since = records[videoId];
        if (since?.owner !== windowId && Number.isFinite(since?.at) && since.at <= now
          && now - since.at < config.cooldownSeconds * 1000) return false;
        const entries = Object.entries(records).filter(([id, record]) => ID.test(id)
          && Number.isFinite(record?.at) && record.at <= now && now - record.at < 600000).slice(-127);
        const next = Object.fromEntries(entries);
        next[videoId] = { at: now, owner: windowId };
        try { page.localStorage.setItem(COOLDOWN_KEY, JSON.stringify(next)); }
        catch { /* 禁用存储时降级为 Web Lock 互斥和本页冷却。 */ }
        return action();
      });
    } catch (error) {
      // 不在异常后再次 action，以免 refresh 已执行但抛错导致重复重建。
      console.warn('[Holodex 恢复] 跨窗口协调失败，本次跳过', error?.name);
      return false;
    }
  }

  let toast = null, toastTimer = null;
  function notice(message) {
    console.warn('[Holodex 恢复]', message);
    if (!doc.createElement || !(doc.body || doc.documentElement)) return;
    if (!toast?.isConnected) {
      toast = doc.createElement('div');
      toast.setAttribute('role', 'status');
      toast.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483647;max-width:min(560px,85vw);padding:14px;background:#17202d;color:white;border:1px solid #94a3b8;border-radius:8px;font:15px/1.6 sans-serif;';
      (doc.body || doc.documentElement).appendChild(toast);
    }
    toast.textContent = message;
    if (toastTimer) cancel(toastTimer);
    toastTimer = later(() => toast?.remove(), 8000);
  }
  disposers.push(() => toast?.remove());
  function stateFor(vm, videoId) {
    let state = cells.get(vm);
    if (!state || state.videoId !== videoId) {
      if (state?.job) finish(state.job);
      state = { videoId, attempts: 0, nextAllowed: -Infinity, busy: false, stableAt: null,
        lastSeen: null, job: null, revision: 0, userHold: false };
      cells.set(vm, state);
    }
    return state;
  }
  function cancelForUser(vm) {
    const state = cells.get(vm);
    if (!state) return;
    state.revision++;
    state.userHold = true;
    if (state.job?.reuse) finish(state.job);
  }
  function reuseAlive(job) {
    try {
      return alive(job) && cells.get(job.vm) === job.state && job.state.job === job
        && job.state.revision === job.revision && playerOf(job.vm) === job.oldPlayer
        && job.oldFrame.isConnected && job.oldPlayer.getIframe?.() === job.oldFrame;
    } catch { return false; }
  }
  function pollReuse(job) {
    if (!reuseAlive(job)) { finish(job); return; }
    job.polls++;
    try {
      const p = job.oldPlayer, state = p.getPlayerState();
      const volume = p.getVolume(), muted = p.isMuted(), time = p.getCurrentTime();
      const data = p.getVideoData?.();
      if (data?.video_id && data.video_id !== job.videoId) { finish(job); return; }
      if (job.audioApplied && (Math.abs(volume - job.expectedVolume) > 0.5 || muted !== job.audio.muted)) {
        cancelForUser(job.vm); return;
      }
      if (state === 2 && job.audioApplied && mono() - job.started >= 2000) { cancelForUser(job.vm); return; }
      if (Number.isFinite(state) && Number.isFinite(volume) && typeof muted === 'boolean') {
        if (!job.audioApplied) {
          job.expectedVolume = Math.round(job.audio.volume * 100);
          applyAudio(job.vm, p, job.audio);
          job.audioApplied = true;
        }
        if (state === 1 && Number.isFinite(time)) {
          if (job.playTime === null) job.playTime = time;
          else if (time - job.playTime >= 0.2) {
            job.progressed = true; finish(job); return;
          }
        } else job.playTime = null;
        if (!job.shouldPlay && state === 5) {
          finish(job); notice('已复用当前播放器准备视频，请手动点击播放。'); return;
        }
      }
    } catch { /* 同一播放器加载时可能短暂不可读；只在本次预算内等待。 */ }
    if (job.polls >= config.readyAttempts) {
      finish(job); notice('复用后未确认持续播放；本次已停止等待，没有销毁重建。可手动点击播放，或稍后重试。'); return;
    }
    job.timer = later(() => pollReuse(job), Math.min(500 * 2 ** (job.polls - 1), 4000));
  }
  function startReuse(vm, frame, data, state, manual) {
    const p = playerOf(vm), shouldPlay = manual || config.autoplay;
    const method = shouldPlay ? 'loadVideoById' : 'cueVideoById';
    if (!p || typeof p[method] !== 'function' || typeof p.getIframe !== 'function'
      || p.getIframe() !== frame || !['getPlayerState', 'getCurrentTime', 'getVolume', 'isMuted', 'setVolume', 'mute', 'unMute'].every(k => typeof p[k] === 'function')) {
      notice('当前格缺少安全复用接口，已跳过；没有退回销毁重建。'); return;
    }
    let audio;
    try {
      const volume = p.getVolume(), muted = p.isMuted();
      audio = Number.isFinite(volume) && volume >= 0 && volume <= 100 && typeof muted === 'boolean'
        ? { volume: volume / 100, muted } : { volume: data.volume, muted: data.muted };
    } catch { audio = { volume: data.volume, muted: data.muted }; }
    if (!validAudio(audio)) { notice('无法安全读取当前格音量，已跳过复用。'); return; }
    const job = { vm, state, videoId: data.videoId, audio, reuse: true, revision: state.revision,
      oldPlayer: p, oldFrame: frame, polls: 0, timer: null, playTime: null,
      started: mono(), shouldPlay, audioApplied: false, guardedFirstPlay: vm.firstPlay === true };
    state.job = job; jobs.add(job);
    if (job.guardedFirstPlay) vm.firstPlay = false;
    try {
      p[method](data.videoId);
      job.timer = later(() => pollReuse(job), 500);
    } catch {
      finish(job); notice('当前格复用调用失败；没有销毁或重建播放器。');
    }
  }

  // 捕获阶段拦截站点按钮；只接受确定的 VideoCell/YouTube iframe 及按钮类名。
  function controlTarget(target) {
    const button = target?.closest?.('.cell-control button, .cell-control .v-btn');
    const root = button?.closest?.('.cell-content');
    const frame = root?.querySelector?.('iframe');
    const vm = frame && findCell(frame);
    if (!vm || vm.isTwitchVideo || !frameInfo(frame)) return null;
    const kind = button.classList.contains('return-btn') ? 'back'
      : button.classList.contains('deep-orange') ? 'delete'
        : button.classList.contains('secondary') ? 'refresh' : null;
    return kind ? { button, frame, vm, kind } : null;
  }
  listen(page, 'click', e => {
    if (!config.edgeReuse) return;
    const target = controlTarget(e.target);
    if (!target || target.kind !== 'refresh') return;
    e.preventDefault(); e.stopImmediatePropagation();
    const id = frameInfo(target.frame).id, state = stateFor(target.vm, id);
    state.userHold = false;
    void recover(target.frame, { videoId: id }, state, true).catch(() => notice('复用处理异常；没有退回重建。'));
  }, true);
  function parentUserIntent(e) {
    if (!config.edgeReuse || !e.isTrusted) return;
    const root = e.target?.closest?.('.cell-content');
    const frame = root?.querySelector?.('iframe');
    const vm = frame && findCell(frame);
    if (vm) cancelForUser(vm);
  }
  listen(page, 'pointerdown', parentUserIntent, true);
  listen(page, 'keydown', parentUserIntent, true);
  listen(page, 'input', parentUserIntent, true);
  listen(page, 'change', parentUserIntent, true);

  async function recover(frame, data, state, manual = false) {
    if (state.busy || (!manual && state.userHold) || state.attempts >= config.maxRecoveries || mono() < state.nextAllowed) {
      if (manual) notice('当前格正在恢复、等待冷却或已达次数上限；未重复操作。');
      return;
    }
    const vm = findCell(frame);
    if (!vm) return;
    state.busy = true; // 必须在第一个 await 之前占位。
    const revision = state.revision;
    try {
      await claimWindow(data.videoId, () => {
        if (stopped || !frame.isConnected || findCell(frame) !== vm || state.revision !== revision || cells.get(vm) !== state) return false;
        state.attempts++;
        state.stableAt = null;
        state.nextAllowed = mono() + Math.max(config.cooldownSeconds,
          config.backoffSeconds * 2 ** (state.attempts - 1)) * 1000;
        if (config.edgeReuse) {
          try { startReuse(vm, frame, data, state, manual); }
          catch { if (state.job) finish(state.job); notice('无法安全访问复用接口；没有销毁重建播放器。'); }
          return true;
        }
        const job = { vm, state, videoId: data.videoId, audio: state.liveAudio || { volume: data.volume, muted: data.muted },
          oldPlayer: playerOf(vm), oldFrame: frame, polls: 0, timer: null };
        state.job = job; jobs.add(job);
        try {
          // 站点旧定时器捕获旧 ref；刷新前清理，清空引用以免误把旧 player 当成 ready。
          if (vm.timer != null) { page.clearInterval(vm.timer); vm.timer = null; }
          vm.ytPlayer = null;
          vm.refresh();
          // DOM 更新是异步的；不要立刻使用旧 iframe，也不复制/替换站点托管的 iframe。
          job.timer = later(() => waitReady(job), 500);
          return true;
        } catch { fail(job, '组件刷新失败'); return false; }
      }).then(claimed => { if (manual && !claimed && !stopped) notice('跨窗口冷却或目标格变化，本次未执行恢复。'); });
    } finally { if (!state.job) state.busy = false; }
  }

  listen(page, 'message', e => {
    if (e.origin !== YOUTUBE || !e.source) return;
    const d = parse(e.data);
    if (!d || typeof d.videoId !== 'string' || !ID.test(d.videoId)) return;
    const frame = Array.from(doc.querySelectorAll('iframe')).find(f => f.contentWindow === e.source);
    const info = frame && frameInfo(frame);
    if (!info || info.id !== d.videoId || !frame.isConnected) return;
    if (d.type === 'hello') {
      let session = sessions.get(frame);
      if (!session || session.id !== info.id) {
        session = { id: info.id, token: nonce() }; sessions.set(frame, session);
      }
      const vm = findCell(frame);
      const state = vm && cells.get(vm);
      const audio = state?.videoId === info.id && state.liveAudio;
      e.source.postMessage(envelope({ type: 'challenge', videoId: info.id, token: session.token,
        ...(audio ? { resumeInterruptedLive: true, audio } : {}) }), info.origin);
      return;
    }
    const session = sessions.get(frame);
    if (d.type === 'intent' && session && session.id === info.id && d.token === session.token && d.action === 'cancel') {
      const vm = findCell(frame);
      if (config.edgeReuse && vm) cancelForUser(vm);
      return;
    }
    if (d.type !== 'status' || !session || session.id !== info.id || d.token !== session.token
      || !validAudio(d) || !['idle', 'waiting', 'playing', 'stalled'].includes(d.status)) return;
    const vm = findCell(frame);
    if (!vm) return;
    const state = stateFor(vm, info.id);
    const now = mono();
    if (d.status === 'playing') {
      if (!state.job) state.userHold = false;
      if (state.stableAt === null || state.lastSeen === null || now - state.lastSeen > 2500) state.stableAt = now;
      if (now - state.stableAt >= config.stableSeconds * 1000) { state.attempts = 0; state.liveAudio = null; }
    } else state.stableAt = null;
    state.lastSeen = now;
    if (d.status === 'stalled') {
      if ((d.reason === 'live-ended' || d.reason === 'live-error') && !state.liveAudio)
        state.liveAudio = { volume: d.volume, muted: d.muted };
      void recover(frame, d, state).catch(error => console.warn('[Holodex 恢复]', error?.name));
    }
  });
  function sweep() {
    for (const job of jobs) if (job.reuse ? !reuseAlive(job) : !alive(job)) finish(job);
    later(sweep, 1000);
  }
  sweep();
  disposers.push(() => { for (const job of jobs) finish(job); });
})();
