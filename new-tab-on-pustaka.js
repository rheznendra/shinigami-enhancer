// ==UserScript==
// @name         Open new tab on Pustaka page
// @namespace    https://github.com/rheznendra
// @homepage     https://github.com/rheznendra/shinigami-enhancer
// @version      2026-11-19
// @author       RZ
// @match        https://s1.shinigami.mx/*
// @icon         https://raw.githubusercontent.com/rheznendra/shinigami-enhancer/refs/heads/main/icon.png
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  function injectLinks() {
    document.querySelectorAll('[data-testid^="chapter-row-"]').forEach((card) => {
      if (card.querySelector('a[data-injected-link]')) return;

      const id = card.dataset.testid.slice('chapter-row-'.length);
      if (!id) return;

      if (getComputedStyle(card).position === 'static') {
        card.style.position = 'relative';
      }

      const link = document.createElement('a');
      link.href = `/chapter/${id}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.discover = 'true';
      link.dataset.injectedLink = 'true';
      link.style.cssText = 'position: absolute; inset: 0; outline: none; z-index: 10;';
      link.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      card.prepend(link);
    });
  }

  injectLinks();
  new MutationObserver(injectLinks).observe(document.body, { childList: true, subtree: true });
})();
