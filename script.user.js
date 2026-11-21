// ==UserScript==
// @name         Shinigami Enhancer
// @namespace    https://github.com/rheznendra
// @homepage     https://github.com/rheznendra/shinigami-enhancer
// @version      1.0.0
// @author       RZ
// @match        https://s1.shinigami.mx/*
// @icon         https://raw.githubusercontent.com/rheznendra/shinigami-enhancer/refs/heads/main/icon.png
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

;(() => {
	'use strict'

	// Default states (all enabled on first install; migrates legacy 'newTabPustaka' key if present)
	const state = {
		newTabSeries: GM_getValue(
			'newTabSeries',
			GM_getValue('newTabPustaka', true),
		),
		alwaysShowScrollbar: GM_getValue('alwaysShowScrollbar', true),
		mobilePullToRefresh: GM_getValue('mobilePullToRefresh', true),
		arrowKeyChapterNav: GM_getValue('arrowKeyChapterNav', true),
		backToTop: GM_getValue('backToTop', true),
	}

	let menuIds = []

	// Helper to generate random CSS-safe identifiers per session (anti-adblock)
	function randomIdent(len = 8) {
		const chars = 'abcdefghijklmnopqrstuvwxyz'
		let out = '_' + chars[Math.floor(Math.random() * chars.length)]
		const pool = chars + '0123456789'
		for (let i = 0; i < len; i++) {
			out += pool[Math.floor(Math.random() * pool.length)]
		}
		return out
	}

	// ==========================================
	// Shared Toast Notification Helper
	// ==========================================
	let toastTimeout = null
	function showToast(message) {
		if (!document.body) return
		let toast = document.getElementById('shinigami-enhancer-toast')
		if (!toast) {
			toast = document.createElement('div')
			toast.id = 'shinigami-enhancer-toast'
			toast.style.cssText = `
	position: fixed;
	bottom: 24px;
	left: 50%;
	transform: translateX(-50%);
	z-index: 999999;
	background: rgba(24, 24, 27, 0.94);
	color: #f4f4f5;
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 999px;
	padding: 8px 16px;
	font-family: system-ui, -apple-system, sans-serif;
	font-size: 13px;
	font-weight: 500;
	box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
	pointer-events: none;
	opacity: 0;
	transition: opacity 0.18s ease;
	`
			document.body.appendChild(toast)
		}
		toast.textContent = message
		toast.style.opacity = '1'
		clearTimeout(toastTimeout)
		toastTimeout = setTimeout(() => {
			toast.style.opacity = '0'
		}, 1800)
	}

	// ==========================================
	// Feature 1: Always Open New Tab on Series
	// ==========================================
	function applyNewTabLinks() {
		if (!state.newTabSeries) return

		document
			.querySelectorAll('[data-testid^="chapter-row-"]')
			.forEach((card) => {
				if (card.querySelector('a[data-injected-link]')) return

				const id = card.dataset.testid.slice('chapter-row-'.length)
				if (!id) return

				if (getComputedStyle(card).position === 'static') {
					card.style.position = 'relative'
					card.dataset.injectedRelative = 'true'
				}

				const link = document.createElement('a')
				link.href = `/chapter/${id}`
				link.target = '_blank'
				link.rel = 'noopener noreferrer'
				link.dataset.discover = 'true'
				link.dataset.injectedLink = 'true'
				link.style.cssText =
					'position: absolute; inset: 0; outline: none; z-index: 10;'
				link.addEventListener('click', (e) => {
					e.stopPropagation()
				})
				card.prepend(link)
			})
	}

	function removeNewTabLinks() {
		document.querySelectorAll('a[data-injected-link]').forEach((link) => {
			const card = link.parentElement
			if (card && card.dataset.injectedRelative) {
				card.style.position = ''
				delete card.dataset.injectedRelative
			}
			link.remove()
		})
	}

	// ==========================================
	// Feature 2: Always Show Scrollbar
	// ==========================================
	const SCROLLBAR_STYLE_ID = 'force-scrollbar-style'
	const SCROLLBAR_CSS = `
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
`

	function applyScrollbarCSS() {
		if (!state.alwaysShowScrollbar) return

		const target = document.body || document.head
		if (!target) return

		let style = document.getElementById(SCROLLBAR_STYLE_ID)
		if (!style) {
			style = document.createElement('style')
			style.id = SCROLLBAR_STYLE_ID
			style.textContent = SCROLLBAR_CSS
			target.appendChild(style)
		} else if (style.parentNode?.lastElementChild !== style) {
			target.appendChild(style)
		}
	}

	function removeScrollbarCSS() {
		document.getElementById(SCROLLBAR_STYLE_ID)?.remove()
	}

	// ==========================================
	// Feature 3: Mobile Pull to Refresh
	// ==========================================
	const PTR_INDICATOR_ID = 'shinigami-ptr-indicator'
	const PTR_THRESHOLD = 110
	let ptrAttached = false
	let ptrStartY = 0
	let ptrStartX = 0
	let ptrActive = false
	let ptrReady = false

	function isAtScrollTop(target) {
		if ((window.scrollY || document.documentElement.scrollTop || 0) > 0)
			return false
		let el = target instanceof Element ? target : null
		while (el && el !== document.body && el !== document.documentElement) {
			if (el.scrollTop > 0) return false
			el = el.parentElement
		}
		return true
	}

	function getPtrIndicator() {
		let el = document.getElementById(PTR_INDICATOR_ID)
		if (!el && document.body) {
			el = document.createElement('div')
			el.id = PTR_INDICATOR_ID
			el.style.cssText = `
	position: fixed;
	top: 0;
	left: 50%;
	transform: translate(-50%, -60px);
	z-index: 999999;
	background: rgba(24, 24, 27, 0.92);
	color: #f4f4f5;
	border: 1px solid rgba(255, 255, 255, 0.14);
	border-radius: 999px;
	padding: 7px 14px;
	font-family: system-ui, -apple-system, sans-serif;
	font-size: 13px;
	font-weight: 500;
	display: flex;
	align-items: center;
	gap: 6px;
	box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
	pointer-events: none;
	opacity: 0;
	transition: opacity 0.15s ease, background-color 0.15s ease;
	`
			document.body.appendChild(el)
		}
		return el
	}

	function resetPtrIndicator() {
		const el = document.getElementById(PTR_INDICATOR_ID)
		if (!el) return
		el.style.transition = 'transform 0.2s ease, opacity 0.2s ease'
		el.style.transform = 'translate(-50%, -60px)'
		el.style.opacity = '0'
	}

	function onPtrTouchStart(e) {
		if (!state.mobilePullToRefresh || e.touches.length !== 1) {
			ptrActive = false
			return
		}
		if (!isAtScrollTop(e.target)) {
			ptrActive = false
			return
		}
		ptrStartY = e.touches[0].clientY
		ptrStartX = e.touches[0].clientX
		ptrActive = true
		ptrReady = false
	}

	function onPtrTouchMove(e) {
		if (!ptrActive || e.touches.length !== 1) return

		const dy = e.touches[0].clientY - ptrStartY
		const dx = Math.abs(e.touches[0].clientX - ptrStartX)

		if (dy <= 0 || dx > dy) {
			if (dy < -10) {
				ptrActive = false
				resetPtrIndicator()
			}
			return
		}

		const pull = Math.min(dy * 0.45, PTR_THRESHOLD + 30)
		if (pull < 12) return

		const indicator = getPtrIndicator()
		if (!indicator) return

		ptrReady = pull >= PTR_THRESHOLD
		indicator.style.transition = 'background-color 0.15s ease'
		indicator.style.opacity = String(Math.min(pull / 50, 1))
		indicator.style.transform = `translate(-50%, ${pull - 42}px)`
		indicator.style.background = ptrReady
			? 'rgba(22, 163, 74, 0.95)'
			: 'rgba(24, 24, 27, 0.92)'
		indicator.textContent = ptrReady
			? '↻ Release to refresh'
			: '↓ Pull to refresh'
	}

	function onPtrTouchEnd() {
		if (!ptrActive) return
		ptrActive = false

		if (ptrReady) {
			const indicator = getPtrIndicator()
			if (indicator) {
				indicator.textContent = '↻ Refreshing...'
				indicator.style.transform = 'translate(-50%, 16px)'
			}
			location.reload()
		} else {
			resetPtrIndicator()
		}
		ptrReady = false
	}

	function applyPullToRefresh() {
		if (!state.mobilePullToRefresh || ptrAttached) return
		window.addEventListener('touchstart', onPtrTouchStart, {
			passive: true,
		})
		window.addEventListener('touchmove', onPtrTouchMove, { passive: true })
		window.addEventListener('touchend', onPtrTouchEnd, { passive: true })
		window.addEventListener('touchcancel', onPtrTouchEnd, { passive: true })
		ptrAttached = true
	}

	function removePullToRefresh() {
		if (ptrAttached) {
			window.removeEventListener('touchstart', onPtrTouchStart)
			window.removeEventListener('touchmove', onPtrTouchMove)
			window.removeEventListener('touchend', onPtrTouchEnd)
			window.removeEventListener('touchcancel', onPtrTouchEnd)
			ptrAttached = false
		}
		ptrActive = false
		ptrReady = false
		document.getElementById(PTR_INDICATOR_ID)?.remove()
	}

	// ==========================================
	// Feature 4: Arrow Key Chapter Navigation (/chapter/XXX only)
	// ==========================================
	const chapterMetaCache = new Map()
	const pendingFetches = new Map()
	let arrowNavAttached = false
	let networkHooked = false

	function getCurrentChapterId() {
		const match = location.pathname.match(/^\/chapter\/([a-f0-9-]+)/i)
		return match ? match[1] : null
	}

	function storeChapterDetail(payload) {
		const data = payload?.data
		if (!data?.chapter_id) return
		chapterMetaCache.set(data.chapter_id, {
			prevId: data.prev_chapter_id || null,
			prevNum: data.prev_chapter_number ?? null,
			nextId: data.next_chapter_id || null,
			nextNum: data.next_chapter_number ?? null,
		})
	}

	async function fetchChapterDetail(chapterId) {
		if (!chapterId) return null
		if (chapterMetaCache.has(chapterId))
			return chapterMetaCache.get(chapterId)
		if (pendingFetches.has(chapterId)) return pendingFetches.get(chapterId)

		const request = fetch(
			`https://api.shinigami.io/v1/chapter/detail/${chapterId}`,
			{
				method: 'GET',
				headers: { Accept: 'application/json' },
			},
		)
			.then((res) => (res.ok ? res.json() : null))
			.then((json) => {
				storeChapterDetail(json)
				return chapterMetaCache.get(chapterId) || null
			})
			.catch(() => null)
			.finally(() => {
				pendingFetches.delete(chapterId)
			})

		pendingFetches.set(chapterId, request)
		return request
	}

	function hookNetworkForChapterDetail() {
		if (networkHooked) return
		networkHooked = true

		const origFetch = window.fetch
		window.fetch = async function (...args) {
			const response = await origFetch.apply(this, args)
			try {
				const reqUrl =
					typeof args[0] === 'string' ? args[0] : args[0]?.url || ''
				if (reqUrl.includes('/v1/chapter/detail/')) {
					response
						.clone()
						.json()
						.then(storeChapterDetail)
						.catch(() => {})
				}
			} catch (_) {}
			return response
		}

		const origOpen = XMLHttpRequest.prototype.open
		const origSend = XMLHttpRequest.prototype.send
		XMLHttpRequest.prototype.open = function (method, url, ...rest) {
			this._shinigamiUrl = typeof url === 'string' ? url : ''
			return origOpen.call(this, method, url, ...rest)
		}
		XMLHttpRequest.prototype.send = function (...args) {
			if (this._shinigamiUrl?.includes('/v1/chapter/detail/')) {
				this.addEventListener('load', () => {
					try {
						storeChapterDetail(JSON.parse(this.responseText))
					} catch (_) {}
				})
			}
			return origSend.apply(this, args)
		}
	}

	async function onArrowKeyDown(e) {
		if (!state.arrowKeyChapterNav) return
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return

		const chapterId = getCurrentChapterId()
		if (!chapterId) return

		const active = document.activeElement
		if (
			active &&
			(active.tagName === 'INPUT' ||
				active.tagName === 'TEXTAREA' ||
				active.tagName === 'SELECT' ||
				active.isContentEditable)
		) {
			return
		}

		const meta = await fetchChapterDetail(chapterId)
		if (!meta) {
			showToast('Failed to load chapter info')
			return
		}

		if (e.key === 'ArrowLeft') {
			if (meta.prevId) {
				e.preventDefault()
				location.href = `/chapter/${meta.prevId}`
			} else {
				showToast('Already at the first chapter')
			}
		} else if (e.key === 'ArrowRight') {
			if (meta.nextId) {
				e.preventDefault()
				location.href = `/chapter/${meta.nextId}`
			} else {
				showToast('No next chapter available')
			}
		}
	}

	function applyArrowKeyNav() {
		if (!state.arrowKeyChapterNav || arrowNavAttached) return
		hookNetworkForChapterDetail()
		window.addEventListener('keydown', onArrowKeyDown)
		arrowNavAttached = true
		const chapterId = getCurrentChapterId()
		if (chapterId && !chapterMetaCache.has(chapterId)) {
			fetchChapterDetail(chapterId)
		}
	}

	function removeArrowKeyNav() {
		if (arrowNavAttached) {
			window.removeEventListener('keydown', onArrowKeyDown)
			arrowNavAttached = false
		}
	}

	// ==========================================
	// Feature 5: Back to Top Button
	// ==========================================
	const bttTokens = {
		styleId: randomIdent(10),
		btnClass: randomIdent(10),
		visibleClass: randomIdent(8),
		dataAttr: `data-${randomIdent(7)}`,
	}
	let bttAttached = false
	let lastScrollTarget = null

	function isBackToTopExcludedRoute() {
		return /^\/community\/chat(\/|$)/i.test(location.pathname)
	}

	function ensureBackToTopElements() {
		if (!state.backToTop || isBackToTopExcludedRoute()) {
			document.querySelector(`[${bttTokens.dataAttr}]`)?.remove()
			return
		}
		if (!document.body) return

		// 1. Inject randomized stylesheet
		let style = document.getElementById(bttTokens.styleId)
		if (!style) {
			style = document.createElement('style')
			style.id = bttTokens.styleId
			style.textContent = `
	.${bttTokens.btnClass} {
		position: fixed !important;
		right: 22px !important;
		bottom: 24px !important;
		width: 44px !important;
		height: 44px !important;
		border-radius: 50% !important;
		background: rgba(24, 24, 27, 0.9) !important;
		color: #f4f4f5 !important;
		border: 1px solid rgba(255, 255, 255, 0.16) !important;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.38) !important;
		display: flex !important;
		align-items: center !important;
		justify-content: center !important;
		cursor: pointer !important;
		z-index: 999998 !important;
		padding: 0 !important;
		margin: 0 !important;
		opacity: 0 !important;
		visibility: hidden !important;
		transform: translateY(10px) scale(0.95) !important;
		transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s ease, background-color 0.15s ease !important;
		-webkit-tap-highlight-color: transparent !important;
	}
	.${bttTokens.btnClass}.${bttTokens.visibleClass} {
		opacity: 1 !important;
		visibility: visible !important;
		transform: translateY(0) scale(1) !important;
	}
	.${bttTokens.btnClass}:hover {
		background: rgba(39, 39, 42, 0.98) !important;
		border-color: rgba(255, 255, 255, 0.3) !important;
	}
	.${bttTokens.btnClass}:active {
		transform: translateY(0) scale(0.92) !important;
	}
	.${bttTokens.btnClass} svg {
		width: 20px !important;
		height: 20px !important;
		pointer-events: none !important;
		display: block !important;
	}
	`
			;(document.head || document.body).appendChild(style)
		}

		// 2. Inject randomized circular button if not present
		let btn = document.querySelector(`[${bttTokens.dataAttr}]`)
		if (!btn) {
			btn = document.createElement('button')
			btn.type = 'button'
			btn.className = bttTokens.btnClass
			btn.setAttribute(bttTokens.dataAttr, '1')
			btn.innerHTML = `
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
		<path d="M12 19V5"></path>
		<path d="M5 12l7-7 7 7"></path>
	</svg>
	`
			btn.addEventListener('click', () => {
				window.scrollTo({ top: 0, behavior: 'smooth' })
				if (
					lastScrollTarget &&
					lastScrollTarget !== document &&
					lastScrollTarget !== window
				) {
					try {
						lastScrollTarget.scrollTo({
							top: 0,
							behavior: 'smooth',
						})
					} catch (_) {
						lastScrollTarget.scrollTop = 0
					}
				}
			})
			document.body.appendChild(btn)
			updateBackToTopVisibility()
		}
	}

	function updateBackToTopVisibility(e) {
		if (isBackToTopExcludedRoute()) {
			document.querySelector(`[${bttTokens.dataAttr}]`)?.remove()
			return
		}

		const btn = document.querySelector(`[${bttTokens.dataAttr}]`)
		if (!btn) return

		const target = e?.target
		if (target && target instanceof Element && target.scrollTop > 0) {
			lastScrollTarget = target
		}

		const winScroll =
			window.scrollY || document.documentElement.scrollTop || 0
		const containerScroll =
			lastScrollTarget && lastScrollTarget instanceof Element
				? lastScrollTarget.scrollTop
				: 0

		if (winScroll > 300 || containerScroll > 300) {
			btn.classList.add(bttTokens.visibleClass)
		} else {
			btn.classList.remove(bttTokens.visibleClass)
		}
	}

	function applyBackToTop() {
		if (!state.backToTop) return
		ensureBackToTopElements()
		if (!bttAttached) {
			window.addEventListener('scroll', updateBackToTopVisibility, {
				passive: true,
				capture: true,
			})
			bttAttached = true
		}
	}

	function removeBackToTop() {
		if (bttAttached) {
			window.removeEventListener('scroll', updateBackToTopVisibility, {
				capture: true,
			})
			bttAttached = false
		}
		document.querySelector(`[${bttTokens.dataAttr}]`)?.remove()
		document.getElementById(bttTokens.styleId)?.remove()
		lastScrollTarget = null
	}

	// ==========================================
	// Unified SPA Route Change Handler
	// ==========================================
	function onRouteChange() {
		if (state.arrowKeyChapterNav) {
			const chapterId = getCurrentChapterId()
			if (chapterId && !chapterMetaCache.has(chapterId)) {
				fetchChapterDetail(chapterId)
			}
		}

		if (state.backToTop) {
			lastScrollTarget = null
			ensureBackToTopElements()
			updateBackToTopVisibility()
		}
	}

	function hookHistoryNavigation() {
		const wrap = (type) => {
			const orig = history[type]
			history[type] = function (...args) {
				const result = orig.apply(this, args)
				onRouteChange()
				return result
			}
		}
		wrap('pushState')
		wrap('replaceState')
		window.addEventListener('popstate', onRouteChange)
	}

	// ==========================================
	// Unified DOM Observer (rAF throttled)
	// ==========================================
	let rafScheduled = false

	function syncFeatures() {
		applyNewTabLinks()
		applyScrollbarCSS()
		applyPullToRefresh()
		applyArrowKeyNav()
		applyBackToTop()
	}

	function scheduleSync() {
		if (
			rafScheduled ||
			(!state.newTabSeries &&
				!state.alwaysShowScrollbar &&
				!state.backToTop)
		) {
			return
		}
		rafScheduled = true
		requestAnimationFrame(() => {
			rafScheduled = false
			applyNewTabLinks()
			applyScrollbarCSS()
			ensureBackToTopElements()
		})
	}

	// ==========================================
	// Violentmonkey Menu Toggles
	// ==========================================
	function renderMenu() {
		menuIds.forEach((id) => GM_unregisterMenuCommand(id))
		menuIds = []

		const seriesLabel = `${state.newTabSeries ? '✅' : '❌'} Always open new tab on Series`
		menuIds.push(
			GM_registerMenuCommand(seriesLabel, () => {
				state.newTabSeries = !state.newTabSeries
				GM_setValue('newTabSeries', state.newTabSeries)
				state.newTabSeries ? applyNewTabLinks() : removeNewTabLinks()
				renderMenu()
			}),
		)

		const scrollbarLabel = `${state.alwaysShowScrollbar ? '✅' : '❌'} Always Show Scrollbar`
		menuIds.push(
			GM_registerMenuCommand(scrollbarLabel, () => {
				state.alwaysShowScrollbar = !state.alwaysShowScrollbar
				GM_setValue('alwaysShowScrollbar', state.alwaysShowScrollbar)
				state.alwaysShowScrollbar
					? applyScrollbarCSS()
					: removeScrollbarCSS()
				renderMenu()
			}),
		)

		const ptrLabel = `${state.mobilePullToRefresh ? '✅' : '❌'} Mobile Pull to Refresh`
		menuIds.push(
			GM_registerMenuCommand(ptrLabel, () => {
				state.mobilePullToRefresh = !state.mobilePullToRefresh
				GM_setValue('mobilePullToRefresh', state.mobilePullToRefresh)
				state.mobilePullToRefresh
					? applyPullToRefresh()
					: removePullToRefresh()
				renderMenu()
			}),
		)

		const arrowLabel = `${state.arrowKeyChapterNav ? '✅' : '❌'} Arrow Keys Prev/Next Chapter`
		menuIds.push(
			GM_registerMenuCommand(arrowLabel, () => {
				state.arrowKeyChapterNav = !state.arrowKeyChapterNav
				GM_setValue('arrowKeyChapterNav', state.arrowKeyChapterNav)
				state.arrowKeyChapterNav
					? applyArrowKeyNav()
					: removeArrowKeyNav()
				renderMenu()
			}),
		)

		const bttLabel = `${state.backToTop ? '✅' : '❌'} Back to Top Button`
		menuIds.push(
			GM_registerMenuCommand(bttLabel, () => {
				state.backToTop = !state.backToTop
				GM_setValue('backToTop', state.backToTop)
				state.backToTop ? applyBackToTop() : removeBackToTop()
				renderMenu()
			}),
		)
	}

	// Initialize
	hookHistoryNavigation()
	renderMenu()
	syncFeatures()
	new MutationObserver(scheduleSync).observe(document.documentElement, {
		childList: true,
		subtree: true,
	})
})()
