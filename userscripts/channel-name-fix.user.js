// ==UserScript==
// @name         Holodex Channel Name Fix
// @namespace    https://github.com/lyl7410/Holodex-HyperChat-Cleaner
// @version      2.5.2
// @description  修复 Holodex 多视图频道名、直播标题、频道ID，以及媒体控制/布局面板头像。
// @match        https://holodex.net/*
// @match        https://www.holodex.net/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      www.youtube.com
// @updateURL    https://raw.githubusercontent.com/lyl7410/Holodex-HyperChat-Cleaner/main/userscripts/channel-name-fix.user.js
// @downloadURL  https://raw.githubusercontent.com/lyl7410/Holodex-HyperChat-Cleaner/main/userscripts/channel-name-fix.user.js
// ==/UserScript==

(() => {
    'use strict';

    const V = '2.5.2';
    const VIDEO = /^[\w-]{11}$/;
    const CHANNEL = /^UC[\w-]{22}$/;
    const KEY = 'hcnf_video_metadata_v25';
    const CHANNEL_KEY = 'hcnf_channel_metadata_v25';
    const CACHE_AGE = 14 * 86400000;
    const INCOMPLETE_AGE = 86400000;
    const doc = (typeof unsafeWindow !== 'undefined' ? unsafeWindow.document : document);
    const videoCache = GM_getValue(KEY, {}) || {};
    const channelCache = GM_getValue(CHANNEL_KEY, {}) || {};
    const pending = new Map(), channelPending = new Map(), failures = new Map();
    const queue = [];
    let running = 0, storeCache = null, debounce = null;

    const isVideo = id => typeof id === 'string' && VIDEO.test(id);
    const isChannel = id => typeof id === 'string' && CHANNEL.test(id);
    const validName = s => typeof s === 'string' && !!s.trim() &&
        s.length < 180 && !isVideo(s.trim()) && !isChannel(s.trim()) && s.trim() !== 'YouTube';
    const validTitle = (s,id) => typeof s === 'string' && !!s.trim() &&
        s.length < 300 && s.trim() !== id && s.trim() !== 'YouTube';

    function imageUrl(raw) {
        if (!raw || typeof raw !== 'string') return null;
        try {
            const u = new URL(raw.replace(/&amp;/g, '&'));
            return u.protocol === 'https:' &&
                ['yt3.googleusercontent.com','yt3.ggpht.com','yt3.google.com'].includes(u.hostname)
                ? u.href : null;
        } catch { return null; }
    }
    function channelUrl(raw) {
        if (!raw || typeof raw !== 'string') return null;
        try {
            const u = new URL(raw, 'https://www.youtube.com');
            if (!['youtube.com','www.youtube.com'].includes(u.hostname)) return null;
            if (!/^\/(?:channel\/UC[\w-]{22}|@[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)/.test(u.pathname)) return null;
            return 'https://www.youtube.com' + u.pathname;
        } catch { return null; }
    }
    function readString(s) {
        try { return JSON.parse('"' + s + '"'); }
        catch { return s.replace(/\\\//g, '/'); }
    }
    function field(html, re) {
        const m = html && html.match(re);
        return m ? readString(m[1]) : null;
    }
    // Only parse JSON data; never evaluate remote webpage scripts.
    function jsonObject(html, marker) {
        const startMarker = html.indexOf(marker);
        if (startMarker < 0) return null;
        const start = html.indexOf('{', startMarker + marker.length);
        if (start < 0 || start - startMarker > 25) return null;
        let depth = 0, string = false, escape = false;
        for (let i = start; i < Math.min(html.length, start + 250000); i++) {
            const c = html[i];
            if (string) {
                if (escape) escape = false;
                else if (c === '\\') escape = true;
                else if (c === '"') string = false;
            } else if (c === '"') string = true;
            else if (c === '{') depth++;
            else if (c === '}' && --depth === 0) {
                try { return JSON.parse(html.slice(start, i + 1)); }
                catch { return null; }
            }
        }
        return null;
    }
    function parseWatch(html, id) {
        const out = {};
        const details = jsonObject(html, '"videoDetails"');
        if (details && details.videoId === id) {
            if (validTitle(details.title,id)) out.title = details.title.trim();
            if (validName(details.author)) out.name = details.author.trim();
            if (isChannel(details.channelId)) out.channelId = details.channelId;
        }
        if (!out.channelId) {
            const meta = field(html, /<meta\b[^>]*itemprop=["']channelId["'][^>]*content=["'](UC[\w-]{22})["']/i);
            if (isChannel(meta)) out.channelId = meta;
        }
        if (!out.name) {
            const owner = field(html, /"ownerChannelName"\s*:\s*"((?:\\.|[^"\\])*)"/);
            if (validName(owner)) out.name = owner.trim();
        }
        // Restrict image lookup to the video owner, not random chat/comment avatars.
        const ownerAt = html.indexOf('"videoOwnerRenderer"');
        if (ownerAt >= 0) {
            const section = html.slice(ownerAt, ownerAt + 16000);
            for (const m of section.matchAll(/"url"\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
                const avatar = imageUrl(readString(m[1]));
                if (avatar) { out.avatar = avatar; break; }
            }
        }
        return out;
    }
    function parseChannel(html) {
        const result = {};
        const id = field(html, /<meta\b[^>]*itemprop=["']channelId["'][^>]*content=["'](UC[\w-]{22})["']/i) ||
            field(html, /"externalId"\s*:\s*"(UC[\w-]{22})"/);
        if (isChannel(id)) result.channelId = id;
        for (const meta of html.match(/<meta\b[^>]*>/gi) || []) {
            if (!/(?:name|property)=["'](?:og:image|twitter:image)["']/i.test(meta)) continue;
            const avatar = imageUrl(field(meta, /content=["']([^"']+)["']/i));
            if (avatar) { result.avatar = avatar; break; }
        }
        return result;
    }
    function fetchText(url) {
        return new Promise(resolve => GM_xmlhttpRequest({
            method:'GET',url,timeout:11000,
            onload:r=>resolve(r.status === 200 ? r.responseText : null),
            onerror:()=>resolve(null),ontimeout:()=>resolve(null)
        }));
    }
    function saveVideo(id, data) {
        videoCache[id] = { ...data, updated: Date.now() };
        GM_setValue(KEY,videoCache);
    }
    function saveChannel(url, data) {
        channelCache[url] = { ...data, updated: Date.now() };
        GM_setValue(CHANNEL_KEY,channelCache);
    }
    function legacyName(id) {
        for (const k of ['hcc_channel_names_v24','holodex_channel_name_v24',
            'holodex_channel_name_v23','hyperchat_video_cache_v21',
            'hyperchat_name_fix_v22_cache']) {
            const item = (GM_getValue(k,{}) || {})[id];
            const name = typeof item === 'string' ? item : (item?.name || item?.channelName);
            if (validName(name)) return name.trim();
        }
        return null;
    }
    function readChannel(url) {
        if (!url) return Promise.resolve({});
        if (channelCache[url]?.avatar && Date.now() - channelCache[url].updated < CACHE_AGE)
            return Promise.resolve(channelCache[url]);
        if (channelPending.has(url)) return channelPending.get(url);
        const task = fetchText(url).then(html => {
            if (!html) return {};
            const parsed = parseChannel(html);
            if (parsed.avatar || parsed.channelId) saveChannel(url,parsed);
            return parsed;
        }).finally(()=>channelPending.delete(url));
        channelPending.set(url,task);
        return task;
    }
    async function download(id, video) {
        const out = { ...(videoCache[id] || {}) };
        if (!validName(out.name)) out.name = legacyName(id);
        if (!validTitle(out.title,id) && validTitle(video?.title,id) &&
            video.title !== video?.channel?.name) out.title = video.title;
        if (!isChannel(out.channelId) && isChannel(video?.channel?.id))
            out.channelId = video.channel.id;
        const watch = await fetchText('https://www.youtube.com/watch?v=' + id);
        if (watch) Object.assign(out,parseWatch(watch,id));

        if (!validTitle(out.title,id) || !validName(out.name) ||
            (!out.channelId && !out.avatar)) {
            const url = 'https://www.youtube.com/oembed?format=json&url=' +
                encodeURIComponent('https://www.youtube.com/watch?v=' + id);
            const response = await fetchText(url);
            if (response) {
                try {
                    const data = JSON.parse(response);
                    if (validTitle(data.title,id)) out.title = data.title.trim();
                    if (validName(data.author_name)) out.name = data.author_name.trim();
                    out.channelUrl = channelUrl(data.author_url) || out.channelUrl;
                } catch {}
            }
        }

        if (!out.avatar || !isChannel(out.channelId)) {
            const url = isChannel(out.channelId)
                ? 'https://www.youtube.com/channel/' + out.channelId : out.channelUrl;
            const channel = await readChannel(url);
            if (channel.avatar) out.avatar = channel.avatar;
            if (!isChannel(out.channelId) && isChannel(channel.channelId))
                out.channelId = channel.channelId;
        }
        if (!validTitle(out.title,id)) delete out.title;
        if (!validName(out.name)) delete out.name;
        if (!isChannel(out.channelId)) delete out.channelId;
        out.avatar = imageUrl(out.avatar);
        if (!out.title && !out.name && !out.channelId && !out.avatar) return null;
        saveVideo(id,out);
        return out;
    }
    function advanceQueue() {
        while (running < 2 && queue.length) {
            const task = queue.shift();
            running++;
            Promise.resolve().then(task.run)
                .then(task.resolve,task.reject)
                .finally(()=>{running--;advanceQueue();});
        }
    }
    function requestVideo(id,video) {
        const cached = videoCache[id];
        const complete = cached && validTitle(cached.title,id) &&
            validName(cached.name) && isChannel(cached.channelId) && imageUrl(cached.avatar);
        if (cached && Date.now() - cached.updated < (complete ? CACHE_AGE : INCOMPLETE_AGE))
            return Promise.resolve(cached);
        if (pending.has(id)) return pending.get(id);
        if (failures.has(id) && Date.now() - failures.get(id) < 600000)
            return Promise.resolve(cached || null);
        const task = new Promise((resolve,reject)=>{
            queue.push({run:()=>download(id,video),resolve,reject});
            advanceQueue();
        }).then(info=>{
            if (info) failures.delete(id); else failures.set(id,Date.now());
            return info || cached || null;
        }).catch(()=>{
            failures.set(id,Date.now());return cached || null;
        }).finally(()=>pending.delete(id));
        pending.set(id,task);
        return task;
    }

    // Holodex Vue 2/Vuex state is shared by the chat, video and both dialogs.
    function findVue(el,name) {
        for (let depth=0;el && depth<12;el=el.parentElement,depth++) {
            let vm=el.__vue__;
            for (let i=0;vm && i<30;vm=vm.$parent,i++)
                if ((!name || vm.$options?.name===name) && vm.$store) return vm;
        }
        return null;
    }
    function store() {
        if (storeCache?.state?.multiview?.layoutContent) return storeCache;
        for (const selector of ['#app','.multiview','.tabbed-chat-select',
            '.layout-preview','.media-controls-list','.mv-cell']) {
            const el=doc.querySelector(selector);
            const vm=el && findVue(el);
            if (vm?.$store?.state?.multiview?.layoutContent) {
                storeCache=vm.$store;return storeCache;
            }
        }
        return null;
    }
    function writeStore(s,id,info) {
        if (!s || !info) return;
        const values=Object.values(s.state.multiview.layoutContent||{});
        const old=values.find(x=>x?.type==='video' && x.video?.id===id)?.video;
        if (!old) return;
        const channel={...(old.channel||{})};
        let changed=false;
        if (validName(info.name) && channel.name!==info.name) {
            channel.name=info.name;changed=true;
        }
        if (isChannel(info.channelId) && channel.id!==info.channelId) {
            channel.id=info.channelId;changed=true;
        }
        const preference=s.state.settings?.nameProperty;
        if (preference && preference!=='name' &&
            !validName(channel[preference]) && validName(info.name)) {
            channel[preference]=info.name;changed=true;
        }
        const title=validTitle(info.title,id) ? info.title : old.title;
        if (old.title!==title) changed=true;
        if (changed) {
            // Preserve status, start time, player flags, and every other video field.
            try { s.commit('multiview/setVideoData',[{...old,title,channel}]); }
            catch (e) { console.warn('[Holodex Metadata Fix] Vuex update failed',e); }
        }
    }

    // Official Holodex ChannelImg assumes /statics/channelImg/UC.../50.png exists.
    // For unindexed channels overlay the ACTUAL YouTube channel portrait.
    GM_addStyle(
        '.layout-preview .grabbable{position:relative!important}' +
        '.layout-preview .hcnf-avatar{position:absolute;top:50%;left:50%;' +
        'transform:translate(-50%,-50%);width:40px;height:40px;z-index:2;' +
        'border-radius:50%;object-fit:cover;pointer-events:none}' +
        '.media-controls-list .v-list-item__avatar{position:relative}' +
        '.media-controls-list .hcnf-avatar{position:absolute;inset:0;width:100%;' +
        'height:100%;z-index:2;border-radius:50%;object-fit:cover;pointer-events:none}' +
        '.hcnf-avatar:not(.loaded){visibility:hidden}'
    );
    function showAvatar(target,id,url) {
        const avatar=imageUrl(url);
        if (!target || !isVideo(id) || !avatar) return;
        let el=target.querySelector(':scope > img.hcnf-avatar');
        if (el?.dataset.videoId===id && el.src===avatar) return;
        el?.remove();
        el=doc.createElement('img');
        el.className='hcnf-avatar';
        el.alt='频道头像';
        el.dataset.videoId=id;
        el.referrerPolicy='no-referrer';
        el.onload=()=>el.classList.add('loaded');
        el.onerror=()=>el.remove();
        el.src=avatar;
        target.appendChild(el);
    }
    function fixLayout(s) {
        const layout=s?.state.multiview.layout||[];
        const contents=s?.state.multiview.layoutContent||{};
        for (const preview of doc.querySelectorAll('.layout-preview')) {
            if (!preview.getClientRects().length) continue;
            const cells=[...preview.querySelectorAll(':scope > .layout-preview-cell')];
            if (cells.length!==layout.length) continue;
            layout.forEach((item,i)=>{
                const record=contents[item.i];
                const video=record?.type==='video' && record.video;
                const avatar=isVideo(video?.id) && videoCache[video.id]?.avatar;
                if (avatar) showAvatar(cells[i].querySelector('.grabbable'),video.id,avatar);
            });
        }
    }
    function fixMedia() {
        for (const list of doc.querySelectorAll('.media-controls-list')) {
            if (!list.getClientRects().length) continue;
            const vm=findVue(list,'MediaControls');
            const videos=(vm?.cells || vm?.$parent?.$refs?.videoCell || [])
                .map(c=>c.video).filter(Boolean);
            const rows=[...list.children]
                .filter(row=>row.classList?.contains('v-list-item') &&
                    row.querySelector('.v-list-item__avatar'));
            // Do not guess at the row-to-video mapping.
            if (!videos.length || videos.length!==rows.length) continue;
            videos.forEach((video,i)=>{
                if (!isVideo(video?.id)) return;
                const data=videoCache[video.id];
                if (data?.avatar)
                    showAvatar(rows[i].querySelector('.v-list-item__avatar'),video.id,data.avatar);
                const text=rows[i].querySelector('.v-list-item-title');
                if (text && validTitle(data?.title,video.id) &&
                    [video.id,video.channel?.name].includes(text.textContent?.trim()))
                    text.textContent=data.title;
            });
        }
    }
    function fixNameFallback() {
        // Used only if Holodex Vue is unavailable in the userscript realm.
        for (const node of doc.querySelectorAll('.tabbed-chat-select .v-select__selection')) {
            const id=node.textContent?.trim();
            const name=isVideo(id)&&(videoCache[id]?.name||legacyName(id));
            if (!validName(name)) continue;
            const text=[...node.childNodes].find(n=>n.nodeType===3 && n.nodeValue.trim()===id);
            if (text) text.nodeValue=name;
        }
    }

    let lastPath='';
    function tick() {
        if (!/^\/multiview(?:\/|$)/.test(location.pathname)) return;
        const s=store();
        if (!s) {fixNameFallback();return;}
        const contents=Object.values(s.state.multiview.layoutContent||{});
        const videos=new Map();
        for (const cell of contents) {
            const v=cell?.type==='video' && cell.video;
            if (isVideo(v?.id) && v.type!=='twitch') videos.set(v.id,v);
        }
        for (const [id,v] of videos) {
            const cached=videoCache[id];
            if (cached) writeStore(s,id,cached);
            const complete=cached && validTitle(cached.title,id) &&
                validName(cached.name) && isChannel(cached.channelId) && imageUrl(cached.avatar);
            const fresh=cached && Date.now()-cached.updated <
                (complete ? CACHE_AGE : INCOMPLETE_AGE);
            if (fresh || pending.has(id) ||
                (failures.has(id) && Date.now()-failures.get(id)<600000)) continue;
            requestVideo(id,v).then(data=>{
                if (data) {writeStore(s,id,data);schedule(120);}
            });
        }
        fixLayout(s);fixMedia();fixNameFallback();
    }
    function schedule(ms=150) {
        if (debounce) return;
        debounce=setTimeout(()=>{debounce=null;tick();},ms);
    }

    GM_registerMenuCommand('📊 查看频道资料缓存',()=>{
        alert('Holodex Channel Name Fix '+V+'\n视频：'+Object.keys(videoCache).length+
            '\n频道：'+Object.keys(channelCache).length);
    });
    GM_registerMenuCommand('🔄 重新获取当前视频资料',()=>{
        const s=store();
        if (s) Object.values(s.state.multiview.layoutContent||{}).forEach(row=>{
            if (row?.type==='video' && isVideo(row.video?.id)) {
                delete videoCache[row.video.id];failures.delete(row.video.id);
            }
        });
        GM_setValue(KEY,videoCache);
        schedule(50);
    });
    GM_registerMenuCommand('🗑 清空频道资料缓存',()=>{
        if (!confirm('清空频道名称、直播标题和频道头像缓存？')) return;
        for (const id of Object.keys(videoCache)) delete videoCache[id];
        for (const id of Object.keys(channelCache)) delete channelCache[id];
        failures.clear();
        GM_setValue(KEY,videoCache);GM_setValue(CHANNEL_KEY,channelCache);
        schedule(50);
    });
    schedule(0);
    [400,1200,3000,6500].forEach(n=>setTimeout(()=>schedule(),n));
    const watcher=new MutationObserver(mutations=>{
        for (const mutation of mutations) for (const n of mutation.addedNodes) {
            if (n.nodeType!==1) continue;
            if (n.matches?.('.layout-preview,.media-controls-list,.mv-cell,.multiview,.v-dialog__content--active') ||
                n.querySelector?.('.layout-preview,.media-controls-list,.mv-cell,.multiview')) {
                schedule();return;
            }
        }
    });
    watcher.observe(doc.documentElement,{childList:true,subtree:true});
    setInterval(()=>{if (!doc.hidden) tick();},4000);
    doc.addEventListener('visibilitychange',()=>{if (!doc.hidden) schedule(80);});
})();