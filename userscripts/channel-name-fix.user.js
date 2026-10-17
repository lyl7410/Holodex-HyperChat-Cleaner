// ==UserScript==
// @name         Holodex Channel Name Fix
// @namespace    https://github.com/lyl7410/Holodex-HyperChat-Cleaner
// @version      2.4.0
// @description  Replace Holodex video-ID labels with actual YouTube channel names (including selected Vuetify label).
// @match        https://holodex.net/*
// @match        https://www.holodex.net/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      www.youtube.com
// ==/UserScript==

(() => {
    'use strict';

    const ID = /^[A-Za-z0-9_-]{11}$/;
    const CACHE = 'hcc_channel_names_v24';
    const cache = GM_getValue(CACHE, {});
    const requests = new Map();
    const labelSelector = '.tabbed-chat-select .v-select__selection, .v-list-item__title';
    let queued = false;

    function fetchName(id) {
        if (cache[id]?.name) return Promise.resolve(cache[id].name);
        if (requests.has(id)) return requests.get(id);
        const url = 'https://www.youtube.com/oembed?format=json&url=' +
            encodeURIComponent('https://www.youtube.com/watch?v=' + id);
        const task = new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: 12000,
                onload: response => {
                    let name = null;
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText);
                            name = typeof data.author_name === 'string' ? data.author_name.trim() : null;
                        } catch {}
                    }
                    if (name) {
                        cache[id] = { name, updated: Date.now() };
                        GM_setValue(CACHE, cache);
                    }
                    resolve(name);
                },
                onerror: () => resolve(null),
                ontimeout: () => resolve(null)
            });
        }).finally(() => requests.delete(id));
        requests.set(id, task);
        return task;
    }

    function replaceLabel(el, id, name) {
        if (!el.isConnected || el.textContent.trim() !== id) return;
        // Update only the label, never the enclosing Vuetify button or its SVG.
        const textNode = [...el.childNodes].find(
            node => node.nodeType === Node.TEXT_NODE && node.textContent.trim() === id
        );
        if (textNode) textNode.textContent = name;
        else if (!el.children.length) el.textContent = name;
        el.title = name;
    }

    function scan() {
        document.querySelectorAll(labelSelector).forEach(el => {
            const id = el.textContent.trim();
            if (!ID.test(id)) return;
            if (cache[id]?.name) {
                replaceLabel(el, id, cache[id].name);
            } else {
                fetchName(id).then(name => {
                    if (name) replaceLabel(el, id, name);
                });
            }
        });
    }

    function schedule() {
        if (queued) return;
        queued = true;
        setTimeout(() => {
            queued = false;
            scan();
        }, 120);
    }

    GM_registerMenuCommand('清除频道名称缓存并刷新', () => {
        GM_setValue(CACHE, {});
        location.reload();
    });

    scan();
    const observer = new MutationObserver(mutations => {
        // Observe text changes and newly inserted Vuetify menus without touching chat messages.
        if (mutations.some(m =>
            m.target?.closest?.('.tabbed-chat-select, .v-menu__content') ||
            [...m.addedNodes].some(n => n.nodeType === 1 &&
                (n.matches?.('.tabbed-chat-select, .v-menu__content') ||
                 n.querySelector?.('.tabbed-chat-select, .v-menu__content')))
        )) schedule();
    });
    observer.observe(document.documentElement, {
        subtree: true, childList: true, characterData: true
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) schedule();
    });
})();
