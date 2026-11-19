// ==UserScript==
// @name         Bypass Shinigami Pop-up
// @namespace    https://github.com/rheznendra
// @homepage     https://github.com/rheznendra/shinigami-enhancer
// @version      2026-11-16
// @author       RZ
// @match        *://*.shinigami.*/*
// @icon         https://raw.githubusercontent.com/rheznendra/shinigami-enhancer/refs/heads/main/icon.png
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const FORCE_VALUES = () => {
        sessionStorage.setItem('showAdsGamePopup', 'true');
        sessionStorage.setItem('showAds', '0');
        console.log('[Tampermonkey] Forced sessionStorage: showAdsGamePopup=true, showAds=0');
    };

    // 1. Force immediately
    FORCE_VALUES();

    // 2. Also monitor changes to DOM (Svelte routing or dynamic injection)
    const observer = new MutationObserver(() => {
        FORCE_VALUES();
    });

    // Start observing body mutations once DOM is ready
    window.addEventListener('DOMContentLoaded', () => {
        const body = document.querySelector('body');
        if (body) {
            observer.observe(body, { childList: true, subtree: true });
        }
    });

    // 3. Hijack pushState & replaceState (used in SPA routing)
    const hijackHistoryMethod = (method) => {
        const original = history[method];
        history[method] = function () {
            const result = original.apply(this, arguments);
            setTimeout(FORCE_VALUES, 0); // Delay to let route render
            return result;
        };
    };

    hijackHistoryMethod('pushState');
    hijackHistoryMethod('replaceState');

    // 4. Listen to popstate (back/forward browser navigation)
    window.addEventListener('popstate', () => {
        setTimeout(FORCE_VALUES, 0);
    });
})();
