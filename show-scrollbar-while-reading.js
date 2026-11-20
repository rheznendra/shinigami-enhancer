// ==UserScript==
// @name         Always show scrollbar while reading
// @namespace    https://github.com/rheznendra
// @homepage     https://github.com/rheznendra/shinigami-enhancer
// @version      2026-11-21
// @author       RZ
// @match        https://s1.shinigami.mx/*
// @icon         https://raw.githubusercontent.com/rheznendra/shinigami-enhancer/refs/heads/main/icon.png
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  function injectScrollbarCSS() {
    let style = document.getElementById('force-scrollbar-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'force-scrollbar-style';
    }

    style.textContent = `
      /* 1. Show scrollbars on all containers without altering overflow behavior */
      *, *::before, *::after {
        scrollbar-width: auto !important;
        -ms-overflow-style: auto !important;
      }

      /* 2. Force WebKit (Chrome/Brave/Edge) scrollbars to paint visibly */
      *::-webkit-scrollbar {
        display: block !important;
        width: 8px !important;
        height: 1px !important;
      }

      *::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.2) !important;
      }

      *::-webkit-scrollbar-thumb {
        background: rgba(150, 150, 150, 0.6) !important;
        border-radius: 6px !important;
      }

      *::-webkit-scrollbar-thumb:hover {
        background: rgba(180, 180, 180, 0.9) !important;
      }

      /* 3. Keep Radix UI custom ScrollArea thumbs visible */
      [data-radix-scroll-area-scrollbar] {
        opacity: 1 !important;
        visibility: visible !important;
        display: flex !important;
      }
    `;

    (document.body || document.head).appendChild(style);
  }

  injectScrollbarCSS();
  new MutationObserver(() => {
    const style = document.getElementById('force-scrollbar-style');
    if (style && style.parentNode?.lastElementChild !== style) {
      (document.body || document.head).appendChild(style);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
