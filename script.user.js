// ==UserScript==
// @name         Shinigami Enhancer
// @description  Userscript for Shinigami to enhance experience while reading.
// @license      MIT
// @namespace    https://github.com/rheznendra
// @homepage     https://github.com/rheznendra/shinigami-enhancer
// @version      1.4.0
// @author       RZ
// @match        https://s1.shinigami.mx/*
// @icon         https://raw.githubusercontent.com/rheznendra/shinigami-enhancer/refs/heads/main/icon.png
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.shinigami.io
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

;(() => {
	'use strict'

	// Default states
	const state = {
		chapterCardLinkSeries: GM_getValue(
			'chapterCardLinkSeries',
			GM_getValue('newTabSeries', GM_getValue('newTabPustaka', true)),
		),
		alwaysOpenAsNewTab: GM_getValue('alwaysOpenAsNewTab', true),
		alwaysShowScrollbar: GM_getValue('alwaysShowScrollbar', true),
		mobilePullToRefresh: GM_getValue('mobilePullToRefresh', true),
		arrowKeyChapterNav: GM_getValue('arrowKeyChapterNav', true),
		backToTop: GM_getValue('backToTop', true),
		homeButtonTopBar: GM_getValue('homeButtonTopBar', true),
		hideBarsOnScrollUp: GM_getValue('hideBarsOnScrollUp', true),
		scrollToBottom: GM_getValue('scrollToBottom', true),
		hidePremiumUpselling: GM_getValue('hidePremiumUpselling', true),
		alsoHidePremiumChat: GM_getValue('alsoHidePremiumChat', true),
		autoUpvoteChapter: GM_getValue('autoUpvoteChapter', false),
		homeChapterButtonLinks: GM_getValue('homeChapterButtonLinks', true),
		homeChapterAlwaysNewTab: GM_getValue('homeChapterAlwaysNewTab', false),
		commentSectionOnBottom: GM_getValue('commentSectionOnBottom', true),
		homeSimpleMode: GM_getValue('homeSimpleMode', false),
		homeMirrorTab: GM_getValue('homeMirrorTab', true),
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
	// Shared In-Memory Manga List Store (/v1/manga/list)
	// ==========================================
	const mangaListStore = {
		pages: new Map(), // `${tabKey}:${offset}` -> { raw, items }
		byMangaId: new Map(), // manga_id -> manga object
		byChapterId: new Map(), // chapter_id -> { manga, chapter }
	}

	const ALLOWED_MIRROR_FORMATS = new Set(['manhwa', 'manhua', 'manga'])

	function getTargetMangaListOffset(url) {
		if (!url || !url.includes('/v1/manga/list')) return null
		try {
			const u = new URL(url, 'https://api.shinigami.io')
			const p = u.searchParams
			const type = p.get('type')
			const format = p.get('format')

			const isValidTab =
				type === 'project' ||
				(type === 'mirror' &&
					(!format || ALLOWED_MIRROR_FORMATS.has(format)))

			const isMatch =
				u.pathname === '/v1/manga/list' &&
				isValidTab &&
				p.get('is_update') === 'true' &&
				p.get('sort') === 'latest' &&
				p.get('sort_order') === 'desc' &&
				p.get('limit') === '20'

			if (!isMatch) return null
			const offset = Number(p.get('offset') ?? 0)
			return Number.isFinite(offset) ? offset : null
		} catch (_) {
			return null
		}
	}

	function storeMangaListResponse(payload, url = '') {
		if (!payload || payload.retcode !== 0 || !Array.isArray(payload.data))
			return

		let tabKey = 'project:all'
		try {
			const u = new URL(
				url || 'https://api.shinigami.io/v1/manga/list',
				'https://api.shinigami.io',
			)
			tabKey = `${u.searchParams.get('type') || 'project'}:${u.searchParams.get('format') || 'all'}`
		} catch (_) {}

		const offset =
			typeof payload.meta?.offset === 'number'
				? payload.meta.offset
				: (getTargetMangaListOffset(url) ?? 0)

		mangaListStore.pages.set(`${tabKey}:${offset}`, {
			raw: payload,
			items: payload.data,
		})

		for (const manga of payload.data) {
			if (manga.manga_id) {
				mangaListStore.byMangaId.set(manga.manga_id, manga)
			}
			if (Array.isArray(manga.chapters)) {
				for (const ch of manga.chapters) {
					if (ch.chapter_id) {
						mangaListStore.byChapterId.set(ch.chapter_id, {
							manga,
							chapter: ch,
						})
					}
				}
			}
		}

		applyHomeChapterButtonLinks()
	}

	// ==========================================
	// Feature 1: Chapter Card as Link on Series (+ Sub-toggle: Always Open New Tab)
	// ==========================================
	function applyChapterCardLinks() {
		if (!state.chapterCardLinkSeries) return

		// Temporarily disable and clean up overlay links while chapter selection checkboxes are active
		if (
			document.querySelector(
				'[data-testid^="chapter-row-"][data-testid$="-checkbox"], [data-testid^="chapter-row-"] [role="checkbox"]',
			)
		) {
			removeChapterCardLinks()
			return
		}

		document
			.querySelectorAll('[data-testid^="chapter-row-"]')
			.forEach((card) => {
				const existing = card.querySelector('a[data-injected-link]')
				if (existing) {
					if (state.alwaysOpenAsNewTab) {
						existing.target = '_blank'
						existing.rel = 'noopener noreferrer'
					} else {
						existing.removeAttribute('target')
						existing.removeAttribute('rel')
					}
					return
				}

				const id = card.dataset.testid.slice('chapter-row-'.length)
				if (!id) return

				if (getComputedStyle(card).position === 'static') {
					card.style.position = 'relative'
					card.dataset.injectedRelative = 'true'
				}

				const link = document.createElement('a')
				link.href = `/chapter/${id}`
				if (state.alwaysOpenAsNewTab) {
					link.target = '_blank'
					link.rel = 'noopener noreferrer'
				}
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

	function removeChapterCardLinks() {
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
	// Feature 3: Mobile Pull to Refresh (Circular Disc, Excludes /chapter/*)
	// ==========================================
	const PTR_INDICATOR_ID = 'shinigami-ptr-indicator'
	const PTR_STYLE_ID = 'shinigami-ptr-style'
	const PTR_THRESHOLD = 95
	let ptrAttached = false
	let ptrStartY = 0
	let ptrStartX = 0
	let ptrActive = false
	let ptrReady = false
	let ptrRefreshing = false

	function isPullToRefreshExcludedRoute() {
		return /^\/chapter(\/|$)/i.test(location.pathname)
	}

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

	function ensurePtrStyle() {
		if (document.getElementById(PTR_STYLE_ID)) return
		const style = document.createElement('style')
		style.id = PTR_STYLE_ID
		style.textContent = `
	@keyframes shinigami-ptr-spin {
	from { transform: rotate(0deg); }
	to { transform: rotate(360deg); }
	}
	#${PTR_INDICATOR_ID} {
	position: fixed;
	top: 0;
	left: 50%;
	width: 44px;
	height: 44px;
	margin-left: -22px;
	border-radius: 50%;
	background: #333538;
	border: 1px solid rgba(255, 255, 255, 0.14);
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.42);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 999999;
	pointer-events: none;
	opacity: 0;
	transform: translate3d(0, -56px, 0) scale(0.85);
	will-change: transform, opacity;
	}
	#${PTR_INDICATOR_ID} svg {
	width: 22px;
	height: 22px;
	color: #9ca3af;
	transition: color 0.15s ease;
	will-change: transform;
	}
	#${PTR_INDICATOR_ID}.is-ready svg {
	color: #f3f4f6;
	}
	#${PTR_INDICATOR_ID}.is-spinning svg {
	color: #f3f4f6;
	animation: shinigami-ptr-spin 0.65s linear infinite;
	}
`
		;(document.head || document.body).appendChild(style)
	}

	function getPtrIndicator() {
		if (!document.body) return null
		ensurePtrStyle()
		let el = document.getElementById(PTR_INDICATOR_ID)
		if (!el) {
			el = document.createElement('div')
			el.id = PTR_INDICATOR_ID
			el.innerHTML = `
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
		<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
		<path d="M3 3v5h5"></path>
		<path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
		<path d="M16 16h5v5"></path>
	</svg>
	`
			document.body.appendChild(el)
		}
		return el
	}

	function resetPtrIndicator(immediate = false) {
		const el = document.getElementById(PTR_INDICATOR_ID)
		if (!el) return
		el.classList.remove('is-ready', 'is-spinning')
		if (immediate) {
			el.style.transition = 'none'
			el.style.opacity = '0'
			el.style.transform = 'translate3d(0, -56px, 0) scale(0.85)'
			return
		}
		requestAnimationFrame(() => {
			el.style.transition =
				'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease'
			el.style.opacity = '0'
			el.style.transform = 'translate3d(0, -56px, 0) scale(0.85)'
		})
	}

	function onPtrTouchStart(e) {
		if (
			ptrRefreshing ||
			!state.mobilePullToRefresh ||
			isPullToRefreshExcludedRoute() ||
			e.touches.length !== 1
		) {
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
		if (!ptrActive || ptrRefreshing || e.touches.length !== 1) return

		const dy = e.touches[0].clientY - ptrStartY
		const dx = Math.abs(e.touches[0].clientX - ptrStartX)

		if (dy <= 0 || dx > dy) {
			if (dy < -10) {
				ptrActive = false
				resetPtrIndicator()
			}
			return
		}

		const damped = PTR_THRESHOLD * 1.45 * (1 - Math.exp(-dy / 220))
		if (damped < 8) return

		const indicator = getPtrIndicator()
		if (!indicator) return

		const progress = Math.min(damped / PTR_THRESHOLD, 1)
		ptrReady = damped >= PTR_THRESHOLD

		indicator.style.transition = 'none'
		indicator.style.opacity = String(Math.min(progress * 1.35, 1))
		indicator.style.transform = `translate3d(0, ${damped - 36}px, 0) scale(${0.85 + progress * 0.15})`
		indicator.classList.toggle('is-ready', ptrReady)

		const svg = indicator.querySelector('svg')
		if (svg) {
			svg.style.transform = `rotate(${damped * 2.8}deg)`
		}
	}

	function onPtrTouchEnd() {
		if (!ptrActive) return
		ptrActive = false

		if (ptrReady && !isPullToRefreshExcludedRoute()) {
			ptrRefreshing = true
			const indicator = getPtrIndicator()
			if (indicator) {
				requestAnimationFrame(() => {
					indicator.style.transition =
						'transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease'
					indicator.style.opacity = '1'
					indicator.style.transform =
						'translate3d(0, 22px, 0) scale(1)'
					indicator.classList.add('is-spinning')
				})
			}
			setTimeout(() => {
				location.reload()
			}, 280)
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
		ptrRefreshing = false
		document.getElementById(PTR_INDICATOR_ID)?.remove()
		document.getElementById(PTR_STYLE_ID)?.remove()
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
			mangaId: data.manga_id || null,
			prevId: data.prev_chapter_id || null,
			prevNum: data.prev_chapter_number ?? null,
			nextId: data.next_chapter_id || null,
			nextNum: data.next_chapter_number ?? null,
		})
		if (
			state.autoUpvoteChapter &&
			getCurrentChapterId() === data.chapter_id
		) {
			triggerAutoUpvote(data.chapter_id)
		}
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

		const pageWindow =
			typeof unsafeWindow !== 'undefined' ? unsafeWindow : window

		const origFetch = pageWindow.fetch
		pageWindow.fetch = async function (...args) {
			try {
				const reqUrl =
					typeof args[0] === 'string' ? args[0] : args[0]?.url || ''
				if (reqUrl.includes('api.shinigami.io')) {
					const headers = args[1]?.headers || args[0]?.headers
					const auth =
						headers instanceof Headers
							? headers.get('Authorization')
							: headers?.Authorization || headers?.authorization
					if (auth) cachedApiAuthHeader = auth
				}
			} catch (_) {}

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
				if (getTargetMangaListOffset(reqUrl) !== null) {
					response
						.clone()
						.json()
						.then((json) => storeMangaListResponse(json, reqUrl))
						.catch(() => {})
				}
				if (reqUrl.includes('/comment/api/v2/pages/reactions?')) {
					response
						.clone()
						.json()
						.then((json) => {
							const myReaction =
								json?.my_reaction ??
								json?.data?.my_reaction ??
								null
							const match = reqUrl.match(
								/page_key=manga%3A[^%&]+%3Achapter%3A([a-f0-9-]+)|page_key=manga:[^:&]+:chapter:([a-f0-9-]+)/i,
							)
							const cid = match?.[1] || match?.[2]
							if (cid && myReaction === 1) {
								upvotedChapters.add(cid)
							}
						})
						.catch(() => {})
				}
			} catch (_) {}
			return response
		}

		const origOpen = pageWindow.XMLHttpRequest.prototype.open
		const origSetHeader =
			pageWindow.XMLHttpRequest.prototype.setRequestHeader
		const origSend = pageWindow.XMLHttpRequest.prototype.send
		pageWindow.XMLHttpRequest.prototype.open = function (
			method,
			url,
			...rest
		) {
			this._shinigamiUrl = typeof url === 'string' ? url : ''
			return origOpen.call(this, method, url, ...rest)
		}
		pageWindow.XMLHttpRequest.prototype.setRequestHeader = function (
			name,
			value,
		) {
			if (
				this._shinigamiUrl?.includes('api.shinigami.io') &&
				typeof name === 'string' &&
				name.toLowerCase() === 'authorization' &&
				value
			) {
				cachedApiAuthHeader = value
			}
			return origSetHeader.call(this, name, value)
		}
		pageWindow.XMLHttpRequest.prototype.send = function (...args) {
			if (this._shinigamiUrl?.includes('/v1/chapter/detail/')) {
				this.addEventListener('load', () => {
					try {
						storeChapterDetail(JSON.parse(this.responseText))
					} catch (_) {}
				})
			}
			if (getTargetMangaListOffset(this._shinigamiUrl) !== null) {
				this.addEventListener('load', () => {
					try {
						storeMangaListResponse(
							JSON.parse(this.responseText),
							this._shinigamiUrl,
						)
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
	const BTT_IDLE_HIDE_MS = 1500
	const bttTokens = {
		styleId: randomIdent(10),
		btnClass: randomIdent(10),
		visibleClass: randomIdent(8),
		dataAttr: `data-${randomIdent(7)}`,
	}
	let bttAttached = false
	let bttHideTimer = null
	let lastScrollTarget = null

	function isBackToTopExcludedRoute() {
		return /^\/community\/chat(\/|$)/i.test(location.pathname)
	}

	function ensureBackToTopElements() {
		if (!state.backToTop) return

		// 1. Inject randomized stylesheet (also hides site's built-in jump button)
		let style = document.getElementById(bttTokens.styleId)
		if (!style) {
			style = document.createElement('style')
			style.id = bttTokens.styleId
			style.textContent = `
	[data-testid="reader-floating-nav-jump"],
	[data-testid="site-footer-desktop"] > div:nth-of-type(2) > button {
		display: none !important;
	}
	.${bttTokens.btnClass} {
		position: fixed !important;
		right: 16px !important;
		bottom: 24px !important;
		width: 48px !important;
		height: 48px !important;
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
		pointer-events: none !important;
		transform: translateY(10px) scale(0.95) !important;
		transition: opacity 0.22s ease, transform 0.22s ease, visibility 0.22s ease, background-color 0.15s ease !important;
		-webkit-tap-highlight-color: transparent !important;
	}
	@media (max-width: 425px) {
		[data-testid="reader-floating-nav"] {
		bottom: 138px !important;
		}
	}
	@media (max-width: 768px) {
		[data-testid="reader-floating-nav"] {
		right: 148px !important;
		bottom: calc(25px + env(safe-area-inset-bottom)) !important;
		}
		.${bttTokens.btnClass} {
		bottom: calc(86px + env(safe-area-inset-bottom, 0px)) !important;
		}
	}
	.${bttTokens.btnClass}.${bttTokens.visibleClass} {
		opacity: 1 !important;
		visibility: visible !important;
		pointer-events: auto !important;
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

		if (isBackToTopExcludedRoute()) {
			clearTimeout(bttHideTimer)
			document.querySelector(`[${bttTokens.dataAttr}]`)?.remove()
			return
		}
		if (!document.body) return

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
				clearTimeout(bttHideTimer)
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
		}
	}

	function updateBackToTopVisibility(e) {
		if (isBackToTopExcludedRoute()) {
			clearTimeout(bttHideTimer)
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
			clearTimeout(bttHideTimer)
			bttHideTimer = setTimeout(() => {
				btn.classList.remove(bttTokens.visibleClass)
			}, BTT_IDLE_HIDE_MS)
		} else {
			clearTimeout(bttHideTimer)
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
		clearTimeout(bttHideTimer)
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
	// Feature 6: Home Button on Top Bar (also hides reader-floating-nav)
	// ==========================================
	const HOME_TOP_BAR_STYLE_ID = 'shinigami-home-topbar-style'

	function applyHomeButtonTopBar() {
		if (!state.homeButtonTopBar) return

		const styleTarget = document.head || document.body
		if (styleTarget && !document.getElementById(HOME_TOP_BAR_STYLE_ID)) {
			const style = document.createElement('style')
			style.id = HOME_TOP_BAR_STYLE_ID
			style.textContent = `
	[data-testid="reader-floating-nav"] {
		display: none !important;
	}
	`
			styleTarget.appendChild(style)
		}

		const topBar = document.querySelector(
			'[data-testid="reader-top-bar-surface"]',
		)
		if (!topBar || topBar.querySelector('a[data-injected-home-btn]')) return

		const homeBtn = document.createElement('a')
		homeBtn.href = window.location.origin
		homeBtn.setAttribute('aria-label', 'ke Home')
		homeBtn.setAttribute('type', 'button')
		homeBtn.dataset.injectedHomeBtn = 'true'
		homeBtn.className =
			'flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--sg-radius-md)] outline-none transition-colors duration-150 sg-neutral-fill text-[var(--sg-accent-light)] [&_svg]:text-current hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sg-text-primary)]'
		homeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-house text-foreground" aria-hidden="true" style="color: inherit;"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"></path><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>`

		topBar.prepend(homeBtn)
	}

	function removeHomeButtonTopBar() {
		document.getElementById(HOME_TOP_BAR_STYLE_ID)?.remove()
		document
			.querySelectorAll('a[data-injected-home-btn]')
			.forEach((btn) => btn.remove())
	}

	// ==========================================
	// Feature 7: Hide Reader Bars on Scroll Up (Click/Tap to Show)
	// ==========================================
	const HIDE_BARS_STYLE_ID = 'shinigami-hide-bars-scrollup-style'
	const HIDE_BARS_CLASS = 'shinigami-force-hide-reader-bars'
	let hideBarsAttached = false
	let lastReaderScrollY = 0

	function isChapterReaderRoute() {
		return /^\/chapter(\/|$)/i.test(location.pathname)
	}

	function ensureHideBarsStyle() {
		const target = document.head || document.body
		if (!target || document.getElementById(HIDE_BARS_STYLE_ID)) return

		const style = document.createElement('style')
		style.id = HIDE_BARS_STYLE_ID
		style.textContent = `
	[data-testid="reader-top-bar-surface"],
	[data-testid="reader-bottom-bar"] {
	transition: transform 220ms ease, right 260ms ease !important;
	}
	html.${HIDE_BARS_CLASS} [data-testid="reader-top-bar-surface"] {
	transform: translateY(-100%) !important;
	pointer-events: none !important;
	}
	html.${HIDE_BARS_CLASS} [data-testid="reader-bottom-bar"] {
	transform: translateY(100%) !important;
	pointer-events: none !important;
	}
`
		target.appendChild(style)
	}

	function onReaderBarScroll(e) {
		if (!state.hideBarsOnScrollUp || !isChapterReaderRoute()) {
			document.documentElement.classList.remove(HIDE_BARS_CLASS)
			return
		}

		const target = e?.target
		const currentY =
			target &&
			target instanceof Element &&
			target !== document.documentElement &&
			target !== document.body
				? target.scrollTop
				: window.scrollY || document.documentElement.scrollTop || 0

		if (Math.abs(currentY - lastReaderScrollY) < 4) return

		if (currentY < lastReaderScrollY && currentY > 20) {
			// Scrolling up -> slide top bar up & bottom bar down
			document.documentElement.classList.add(HIDE_BARS_CLASS)
			syncCommentBoxWithToolbar()
		}

		lastReaderScrollY = currentY
	}

	function onReaderScreenClick(e) {
		if (!state.hideBarsOnScrollUp || !isChapterReaderRoute()) return

		// Only intercept if we are currently force-hiding the bars
		if (!document.documentElement.classList.contains(HIDE_BARS_CLASS))
			return

		const el = e.target instanceof Element ? e.target : null
		if (
			el?.closest(
				'[data-testid="reader-top-bar-surface"], [data-testid="reader-bottom-bar"], button, a, input, select',
			)
		) {
			return
		}

		// Check if the site's own React state already has the bars open underneath our override
		const topBar = document.querySelector(
			'[data-testid="reader-top-bar-surface"]',
		)
		const isSiteBarAlreadyOpen =
			topBar &&
			getComputedStyle(topBar).visibility !== 'hidden' &&
			getComputedStyle(topBar).opacity !== '0'

		document.documentElement.classList.remove(HIDE_BARS_CLASS)
		syncCommentBoxWithToolbar()

		// If the site thought the bars were already open, block this tap from reaching React so it doesn't immediately close them
		if (isSiteBarAlreadyOpen) {
			e.stopPropagation()
		}
	}

	function applyHideBarsOnScrollUp() {
		if (!state.hideBarsOnScrollUp) return
		ensureHideBarsStyle()
		if (!hideBarsAttached) {
			lastReaderScrollY =
				window.scrollY || document.documentElement.scrollTop || 0
			window.addEventListener('scroll', onReaderBarScroll, {
				passive: true,
				capture: true,
			})
			window.addEventListener('click', onReaderScreenClick, {
				capture: true,
			})
			hideBarsAttached = true
		}
	}

	function removeHideBarsOnScrollUp() {
		if (hideBarsAttached) {
			window.removeEventListener('scroll', onReaderBarScroll, {
				capture: true,
			})
			window.removeEventListener('click', onReaderScreenClick, {
				capture: true,
			})
			hideBarsAttached = false
		}
		document.documentElement.classList.remove(HIDE_BARS_CLASS)
		document.getElementById(HIDE_BARS_STYLE_ID)?.remove()
		syncCommentBoxWithToolbar()
	}

	// ==========================================
	// Feature 8: Scroll to Bottom (/chapter/* only, visible at very top of page)
	// ==========================================
	const stbTokens = {
		styleId: randomIdent(10),
		btnClass: randomIdent(10),
		visibleClass: randomIdent(8),
		dataAttr: `data-${randomIdent(7)}`,
	}
	let stbAttached = false

	function isScrollToBottomAllowedRoute() {
		return /^\/chapter(\/|$)/i.test(location.pathname)
	}

	function isAtReaderTop() {
		if ((window.scrollY || document.documentElement.scrollTop || 0) > 10)
			return false
		const endCard = document.querySelector(
			'[data-testid="strip-end-card-mount"]',
		)
		let el = endCard?.parentElement || null
		while (el && el !== document.body && el !== document.documentElement) {
			if (el.scrollTop > 10) return false
			el = el.parentElement
		}
		return true
	}

	function ensureScrollToBottomElements() {
		if (!state.scrollToBottom || !isScrollToBottomAllowedRoute()) {
			document.querySelector(`[${stbTokens.dataAttr}]`)?.remove()
			return
		}
		if (!document.body) return

		// 1. Inject randomized stylesheet
		let style = document.getElementById(stbTokens.styleId)
		if (!style) {
			style = document.createElement('style')
			style.id = stbTokens.styleId
			style.textContent = `
	.${stbTokens.btnClass} {
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
		pointer-events: none !important;
		transform: translateY(10px) scale(0.95) !important;
		transition: opacity 0.22s ease, transform 0.22s ease, visibility 0.22s ease, background-color 0.15s ease !important;
		-webkit-tap-highlight-color: transparent !important;
	}
	@media (max-width: 768px) {
		.${stbTokens.btnClass} {
		bottom: calc(86px + env(safe-area-inset-bottom, 0px)) !important;
		}
	}
	.${stbTokens.btnClass}.${stbTokens.visibleClass} {
		opacity: 1 !important;
		visibility: visible !important;
		pointer-events: auto !important;
		transform: translateY(0) scale(1) !important;
	}
	.${stbTokens.btnClass}:hover {
		background: rgba(39, 39, 42, 0.98) !important;
		border-color: rgba(255, 255, 255, 0.3) !important;
	}
	.${stbTokens.btnClass}:active {
		transform: translateY(0) scale(0.92) !important;
	}
	.${stbTokens.btnClass} svg {
		width: 20px !important;
		height: 20px !important;
		pointer-events: none !important;
		display: block !important;
	}
	`
			;(document.head || document.body).appendChild(style)
		}

		// 2. Inject randomized circular down-arrow button if not present
		let btn = document.querySelector(`[${stbTokens.dataAttr}]`)
		if (!btn) {
			btn = document.createElement('button')
			btn.type = 'button'
			btn.className = stbTokens.btnClass
			btn.setAttribute(stbTokens.dataAttr, '1')
			btn.innerHTML = `
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
		<path d="M12 5v14"></path>
		<path d="M19 12l-7 7-7-7"></path>
	</svg>
	`
			btn.addEventListener('click', () => {
				const target = document.querySelector(
					'[data-testid="strip-end-card-mount"]',
				)
				if (target) {
					target.scrollIntoView({
						behavior: 'smooth',
						block: 'start',
					})
				} else {
					window.scrollTo({
						top: document.documentElement.scrollHeight,
						behavior: 'smooth',
					})
				}
			})
			document.body.appendChild(btn)
			updateScrollToBottomVisibility()
		}
	}

	function updateScrollToBottomVisibility() {
		if (!isScrollToBottomAllowedRoute()) {
			document.querySelector(`[${stbTokens.dataAttr}]`)?.remove()
			return
		}

		const btn = document.querySelector(`[${stbTokens.dataAttr}]`)
		if (!btn) return

		const endCardExists = !!document.querySelector(
			'[data-testid="strip-end-card-mount"]',
		)
		if (endCardExists && isAtReaderTop()) {
			btn.classList.add(stbTokens.visibleClass)
		} else {
			btn.classList.remove(stbTokens.visibleClass)
		}
	}

	function applyScrollToBottom() {
		if (!state.scrollToBottom) return
		ensureScrollToBottomElements()
		if (!stbAttached) {
			window.addEventListener('scroll', updateScrollToBottomVisibility, {
				passive: true,
				capture: true,
			})
			stbAttached = true
		}
	}

	function removeScrollToBottom() {
		if (stbAttached) {
			window.removeEventListener(
				'scroll',
				updateScrollToBottomVisibility,
				{ capture: true },
			)
			stbAttached = false
		}
		document.querySelector(`[${stbTokens.dataAttr}]`)?.remove()
		document.getElementById(stbTokens.styleId)?.remove()
	}

	// ==========================================
	// Feature 9: Hide Premium Upselling (+ Sub-toggle: Also hide premium chat)
	// ==========================================
	const HIDE_PREMIUM_STYLE_ID = 'shinigami-hide-premium-upselling-style'
	const HIDE_PREMIUM_CHAT_STYLE_ID = 'shinigami-hide-premium-chat-style'
	const USER_ME_ROUTE_CLASS = 'shinigami-route-user-me'
	const COMMUNITY_CHAT_ROUTE_CLASS = 'shinigami-route-community-chat'

	function syncHidePremiumRouteClasses() {
		document.documentElement.classList.toggle(
			USER_ME_ROUTE_CLASS,
			/^\/user\/me(\/|$)/i.test(location.pathname),
		)
		document.documentElement.classList.toggle(
			COMMUNITY_CHAT_ROUTE_CLASS,
			/^\/community\/chat(\/|$)/i.test(location.pathname),
		)
	}

	function applyHidePremiumUpselling() {
		if (!state.hidePremiumUpselling) return

		syncHidePremiumRouteClasses()

		const target = document.head || document.body
		if (!target) return

		let style = document.getElementById(HIDE_PREMIUM_STYLE_ID)
		if (!style) {
			style = document.createElement('style')
			style.id = HIDE_PREMIUM_STYLE_ID
			style.textContent = `
	/* 1. Main navbar last item */
	nav[aria-label="Main"] > div > ul > li:last-child {
		display: none !important;
	}
	/* 2. Profile dropdown menu second item */
	[role="menu"] [role="menuitem"]:nth-of-type(2) {
		display: none !important;
	}
	/* 3. Profile upgrade card on /user/me */
	html.${USER_ME_ROUTE_CLASS} [data-testid="profile-upgrade-card"] {
		display: none !important;
	}
	/* 4. Footer premium upsell links (mobile & desktop) */
	div[data-testid="site-footer-mobile"] > div:nth-of-type(2) div[role="group"] a:first-of-type,
	div[data-testid="site-footer-desktop"] div[role="group"]:has(~ div[role="group"]) ~ div[role="group"]:nth-of-type(n) a:first-of-type {
		display: none !important;
	}
	`
			target.appendChild(style)
		} else if (style.parentNode?.lastElementChild !== style) {
			target.appendChild(style)
		}

		// Sub-feature: Also hide premium chat (.mini-sb first child when 2+ child divs exist)
		if (state.alsoHidePremiumChat) {
			let chatStyle = document.getElementById(HIDE_PREMIUM_CHAT_STYLE_ID)
			if (!chatStyle) {
				chatStyle = document.createElement('style')
				chatStyle.id = HIDE_PREMIUM_CHAT_STYLE_ID
				chatStyle.textContent = `
		html.${COMMUNITY_CHAT_ROUTE_CLASS} [data-testid="room-sidebar"] .mini-sb:has(> div:nth-child(2)) > div:first-child {
		display: none !important;
		}
	`
				target.appendChild(chatStyle)
			} else if (chatStyle.parentNode?.lastElementChild !== chatStyle) {
				target.appendChild(chatStyle)
			}
		} else {
			document.getElementById(HIDE_PREMIUM_CHAT_STYLE_ID)?.remove()
		}
	}

	function removeHidePremiumUpselling() {
		document.documentElement.classList.remove(
			USER_ME_ROUTE_CLASS,
			COMMUNITY_CHAT_ROUTE_CLASS,
		)
		document.getElementById(HIDE_PREMIUM_STYLE_ID)?.remove()
		document.getElementById(HIDE_PREMIUM_CHAT_STYLE_ID)?.remove()
	}

	// ==========================================
	// Feature 10: Auto Upvote when Opening Chapter
	// ==========================================
	const upvotedChapters = new Set()
	const upvotingInFlight = new Set()
	let cachedApiAuthHeader = null

	function getStoredAuthToken() {
		if (cachedApiAuthHeader) return cachedApiAuthHeader
		try {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i)
				const val = localStorage.getItem(key)
				if (!val) continue
				if (/^Bearer\s+/i.test(val)) return val
				if (key && /token|auth/i.test(key)) {
					if (val.startsWith('eyJ')) return `Bearer ${val}`
					try {
						const parsed = JSON.parse(val)
						const tok =
							parsed?.access_token ||
							parsed?.token ||
							parsed?.state?.token
						if (typeof tok === 'string' && tok.length > 10) {
							return /^Bearer\s+/i.test(tok)
								? tok
								: `Bearer ${tok}`
						}
					} catch (_) {}
				}
			}
		} catch (_) {}
		return null
	}

	function gmRequestJson(options) {
		return new Promise((resolve) => {
			GM_xmlhttpRequest({
				...options,
				onload: (res) => {
					let json = null
					try {
						json = JSON.parse(res.responseText)
					} catch (_) {}
					resolve({ status: res.status, json })
				},
				onerror: () => resolve({ status: 0, json: null }),
				ontimeout: () => resolve({ status: 0, json: null }),
			})
		})
	}

	async function triggerAutoUpvote(chapterId = getCurrentChapterId()) {
		if (!state.autoUpvoteChapter || !chapterId) return
		if (upvotedChapters.has(chapterId) || upvotingInFlight.has(chapterId))
			return

		upvotingInFlight.add(chapterId)
		try {
			const meta = await fetchChapterDetail(chapterId)
			if (!meta?.mangaId) return

			const pageKey = `manga:${meta.mangaId}:chapter:${chapterId}`
			const headers = {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			}
			const auth = getStoredAuthToken()
			if (auth) {
				headers.Authorization = /^Bearer\s+/i.test(auth)
					? auth
					: `Bearer ${auth}`
			}

			// 1. Check current reaction status first
			const checkRes = await gmRequestJson({
				method: 'GET',
				url: `https://api.shinigami.io/comment/api/v2/pages/reactions?page_key=${encodeURIComponent(pageKey)}`,
				headers,
			})

			const myReaction =
				checkRes.json?.my_reaction ??
				checkRes.json?.data?.my_reaction ??
				null

			if (myReaction === 1) {
				upvotedChapters.add(chapterId)
				return
			}

			// 2. Only send POST if not already upvoted (my_reaction is null / !== 1)
			const postRes = await gmRequestJson({
				method: 'POST',
				url: 'https://api.shinigami.io/comment/api/v2/pages/reactions',
				headers,
				data: JSON.stringify({
					action: 'set',
					page_key: pageKey,
					reaction_id: 1,
				}),
			})

			if (postRes.status >= 200 && postRes.status < 300) {
				upvotedChapters.add(chapterId)
			}
		} catch (_) {
		} finally {
			upvotingInFlight.delete(chapterId)
		}
	}

	function applyAutoUpvoteChapter() {
		if (!state.autoUpvoteChapter) return
		hookNetworkForChapterDetail()
		const chapterId = getCurrentChapterId()
		if (chapterId) {
			triggerAutoUpvote(chapterId)
		}
	}

	// ==========================================
	// Feature 11: Home Chapter Buttons as Links (+ Sub-toggle: Always Open as New Tab)
	// ==========================================
	let homeContextMenuAttached = false

	function isHomeRoute() {
		return location.pathname === '/' || location.pathname === ''
	}

	function findMangaFromRestoreKey(restoreKey) {
		if (!restoreKey) return null
		if (mangaListStore.byMangaId.has(restoreKey)) {
			return mangaListStore.byMangaId.get(restoreKey)
		}
		for (const [mangaId, manga] of mangaListStore.byMangaId.entries()) {
			if (restoreKey.includes(mangaId)) return manga
		}
		return null
	}

	function onHomeNativeContextMenu(e) {
		if (!state.homeChapterButtonLinks || !isHomeRoute()) return
		if (
			e.target instanceof Element &&
			e.target.closest('[data-restore-key]')
		) {
			e.stopImmediatePropagation()
		}
	}

	function applyHomeChapterButtonLinks() {
		if (!state.homeChapterButtonLinks || !isHomeRoute()) return

		if (!homeContextMenuAttached) {
			window.addEventListener('contextmenu', onHomeNativeContextMenu, {
				capture: true,
			})
			homeContextMenuAttached = true
		}

		if (mangaListStore.byMangaId.size === 0) return

		document.querySelectorAll('[data-restore-key]').forEach((container) => {
			const restoreKey = container.getAttribute('data-restore-key')
			const manga = findMangaFromRestoreKey(restoreKey)
			if (!manga) return

			const mangaId = manga.manga_id || restoreKey
			const seriesHref = `/series/${mangaId}`

			if (getComputedStyle(container).position === 'static') {
				container.style.position = 'relative'
				container.dataset.injectedRelative = 'true'
			}

			// 1. Make the card itself a real /series/* link overlay
			let cardLink = container.querySelector(
				'a[data-injected-home-card-link]',
			)
			if (!cardLink) {
				cardLink = document.createElement('a')
				cardLink.dataset.discover = 'true'
				cardLink.dataset.injectedHomeCardLink = 'true'
				cardLink.style.cssText =
					'position: absolute; inset: 0; outline: none; z-index: 10; border-radius: inherit;'
				container.prepend(cardLink)
			}
			if (cardLink.getAttribute('href') !== seriesHref) {
				cardLink.href = seriesHref
			}

			// 2. Make the 2 chapter buttons real /chapter/* links above the card link
			if (!Array.isArray(manga.chapters) || manga.chapters.length === 0)
				return

			const img = container.querySelector('img')
			const imgParentDiv = img?.parentElement
			if (!imgParentDiv) return

			let siblingDiv = imgParentDiv.nextElementSibling
			while (siblingDiv && siblingDiv.tagName !== 'DIV') {
				siblingDiv = siblingDiv.nextElementSibling
			}
			if (!siblingDiv) return

			const childDivWithButtons = Array.from(siblingDiv.children).find(
				(el) =>
					el.tagName === 'DIV' &&
					el.querySelectorAll('button').length >= 1,
			)
			if (!childDivWithButtons) return

			const buttons = Array.from(
				childDivWithButtons.querySelectorAll('button'),
			).slice(0, 2)
			const targetChapters = [manga.chapters[0], manga.chapters[1]]

			buttons.forEach((btn, idx) => {
				const chapter = targetChapters[idx]
				if (!chapter?.chapter_id) return

				const href = `/chapter/${chapter.chapter_id}`
				let link = btn.querySelector('a[data-injected-home-ch-link]')

				if (!link) {
					if (getComputedStyle(btn).position === 'static') {
						btn.style.position = 'relative'
						btn.dataset.injectedRelative = 'true'
					}
					btn.style.zIndex = '20'

					link = document.createElement('a')
					link.dataset.discover = 'true'
					link.dataset.injectedHomeChLink = 'true'
					link.style.cssText =
						'position: absolute; inset: 0; outline: none; z-index: 25; border-radius: inherit;'
					link.addEventListener('click', (e) => {
						e.stopPropagation()
					})
					btn.prepend(link)
				}

				if (link.getAttribute('href') !== href) {
					link.href = href
				}
				if (state.homeChapterAlwaysNewTab) {
					link.target = '_blank'
					link.rel = 'noopener noreferrer'
				} else {
					link.removeAttribute('target')
					link.removeAttribute('rel')
				}
			})
		})
	}

	function removeHomeChapterButtonLinks() {
		if (homeContextMenuAttached) {
			window.removeEventListener('contextmenu', onHomeNativeContextMenu, {
				capture: true,
			})
			homeContextMenuAttached = false
		}
		document
			.querySelectorAll(
				'a[data-injected-home-card-link], a[data-injected-home-ch-link]',
			)
			.forEach((link) => {
				const parent = link.parentElement
				if (parent) {
					if (parent.dataset.injectedRelative) {
						parent.style.position = ''
						delete parent.dataset.injectedRelative
					}
					if (parent.tagName === 'BUTTON') {
						parent.style.zIndex = ''
					}
				}
				link.remove()
			})
	}

	// ==========================================
	// Feature 12: Bottom Comment Section
	// ==========================================
	const BOTTOM_COMMENTS_STYLE_ID = 'shinigami-end-card-comments-style'
	const TOOLBAR_VISIBLE_CLASS = 'shinigami-reader-toolbar-visible'
	const STICKY_COMMENT_BOX_ATTR = 'data-shinigami-sticky-comment-box'
	let bottomCommentsListenersAttached = false
	let bottomCommentsMountedPath = null
	let bottomCommentsStep = 'idle' // 'idle' -> 'opening' -> 'moved_closing' -> 'done'
	let bottomCommentsOriginalParent = null
	let bottomCommentsOriginalNextSibling = null
	let toolbarSyncTimer = null

	function isElementActuallyVisibleOnScreen(el, direction = 'bottom') {
		if (!el) return false

		const style = getComputedStyle(el)
		if (
			style.display === 'none' ||
			style.visibility === 'hidden' ||
			style.pointerEvents === 'none' ||
			parseFloat(style.opacity) <= 0.05
		) {
			return false
		}

		if (style.transform && style.transform !== 'none') {
			const match = style.transform.match(
				/matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*([^)]+)\)/,
			)
			if (match) {
				const ty = parseFloat(match[1])
				if (direction === 'bottom' && ty > 10) return false
				if (direction === 'top' && ty < -10) return false
			}
		}

		const rect = el.getBoundingClientRect()
		if (rect.height === 0 || rect.width === 0) return false
		if (direction === 'bottom' && rect.top >= window.innerHeight - 2)
			return false
		if (direction === 'top' && rect.bottom <= 2) return false

		return true
	}

	function isBottomToolbarActuallyVisible() {
		if (document.documentElement.classList.contains(HIDE_BARS_CLASS)) {
			return false
		}

		const bottomBar = document.querySelector(
			'[data-testid="reader-bottom-bar"]',
		)
		const topBar = document.querySelector(
			'[data-testid="reader-top-bar-surface"]',
		)

		return (
			isElementActuallyVisibleOnScreen(bottomBar, 'bottom') ||
			isElementActuallyVisibleOnScreen(topBar, 'top')
		)
	}

	function syncCommentBoxWithToolbar() {
		if (!state.commentSectionOnBottom || !isChapterReaderRoute()) {
			document.documentElement.classList.remove(TOOLBAR_VISIBLE_CLASS)
			return
		}
		const visible = isBottomToolbarActuallyVisible()
		document.documentElement.classList.toggle(
			TOOLBAR_VISIBLE_CLASS,
			visible,
		)
	}

	function scheduleToolbarSyncChecks() {
		syncCommentBoxWithToolbar()
		requestAnimationFrame(syncCommentBoxWithToolbar)
		clearTimeout(toolbarSyncTimer)
		toolbarSyncTimer = setTimeout(syncCommentBoxWithToolbar, 60)
	}

	function onBottomCommentsPointerUp() {
		if (!state.commentSectionOnBottom) return
		scheduleToolbarSyncChecks()
	}

	function onBottomCommentsScroll() {
		if (!state.commentSectionOnBottom) return
		syncCommentBoxWithToolbar()
	}

	function onBottomCommentsTransitionEnd(e) {
		if (!state.commentSectionOnBottom) return
		if (
			e.target instanceof Element &&
			e.target.matches(
				'[data-testid="reader-bottom-bar"], [data-testid="reader-top-bar-surface"]',
			)
		) {
			syncCommentBoxWithToolbar()
		}
	}

	function ensureBottomCommentsStyles() {
		const target = document.head || document.body
		if (!target || document.getElementById(BOTTOM_COMMENTS_STYLE_ID)) return

		const style = document.createElement('style')
		style.id = BOTTOM_COMMENTS_STYLE_ID
		style.textContent = `
	/* Hide bottom toolbar comments toggle, reaction bar, built-in end-card comments button, and moved comment header close button */
	button[data-tour="comments"],
	[data-comment-section-root] [data-testid="reaction-bar"],
	[data-testid="end-card-comments"],
	[data-testid="end-card-stack"] [data-testid="comment-header-actions"] > button:nth-of-type(2) {
	display: none !important;
	}

	/* Expand end-card to 100% max-width */
	[data-testid="end-card-stack"] > [data-testid="end-card"] {
	max-width: 100% !important;
	width: 100% !important;
	}

	[role="menuitemcheckbox"] {
	cursor: pointer !important;
	}

	/* Smooth transition for the sticky comment input wrapper (desktop & mobile) */
	[${STICKY_COMMENT_BOX_ATTR}="true"],
	[data-testid="end-card-stack"] div:has(> [data-testid="composer-collapsed"]),
	[data-testid="end-card-stack"] div:has(> [data-testid="focus-handoff-proxy"]) {
	transition: opacity 180ms ease, transform 180ms ease, visibility 180ms ease !important;
	}

	/* Hide sticky comment box only when the toolbar is visible on screen */
	html.${TOOLBAR_VISIBLE_CLASS} [${STICKY_COMMENT_BOX_ATTR}="true"],
	html.${TOOLBAR_VISIBLE_CLASS} [data-testid="end-card-stack"] div:has(> [data-testid="composer-collapsed"]),
	html.${TOOLBAR_VISIBLE_CLASS} [data-testid="end-card-stack"] div:has(> [data-testid="focus-handoff-proxy"]) {
	opacity: 0 !important;
	visibility: hidden !important;
	pointer-events: none !important;
	transform: translateY(12px) !important;
	}

	/* Style the moved comment section inside end-card-stack */
	[data-testid="end-card-stack"] [data-comment-section-root="true"] {
	position: static !important;
	inset: auto !important;
	transform: none !important;
	width: 100% !important;
	max-width: 100% !important;
	height: auto !important;
	max-height: none !important;
	min-height: 0 !important;
	opacity: 1 !important;
	visibility: visible !important;
	pointer-events: auto !important;
	border-radius: var(--sg-radius-lg, 12px) !important;
	background: var(--sg-surface-1, rgba(24, 24, 27, 0.7)) !important;
	border: 1px solid rgba(255, 255, 255, 0.1) !important;
	padding: 16px !important;
	overflow: visible !important;
	}

	[data-testid="end-card-stack"] [data-comment-section-root="true"] > div {
	max-height: none !important;
	height: auto !important;
	overflow: visible !important;
	}
`
		target.appendChild(style)
	}

	function applyCommentSectionOnBottom() {
		if (!state.commentSectionOnBottom) return

		if (!bottomCommentsListenersAttached) {
			// Use pointerup so Feature 7's click stopPropagation() never blocks toolbar sync
			window.addEventListener('pointerup', onBottomCommentsPointerUp, {
				capture: true,
				passive: true,
			})
			window.addEventListener('scroll', onBottomCommentsScroll, {
				capture: true,
				passive: true,
			})
			window.addEventListener(
				'transitionend',
				onBottomCommentsTransitionEnd,
				{
					capture: true,
					passive: true,
				},
			)
			bottomCommentsListenersAttached = true
		}

		if (!isChapterReaderRoute()) {
			bottomCommentsMountedPath = null
			bottomCommentsStep = 'idle'
			document.documentElement.classList.remove(TOOLBAR_VISIBLE_CLASS)
			return
		}

		ensureBottomCommentsStyles()
		syncCommentBoxWithToolbar()

		if (bottomCommentsMountedPath !== location.pathname) {
			bottomCommentsMountedPath = location.pathname
			bottomCommentsStep = 'idle'
		}

		const endCardStack = document.querySelector(
			'[data-testid="end-card-stack"]',
		)
		if (!endCardStack) return

		const commentRoot = document.querySelector(
			'[data-comment-section-root="true"]',
		)
		const commentsBtn = document.querySelector(
			'button[data-tour="comments"]',
		)

		// Step 1: Trigger open once so React mounts [data-comment-section-root="true"]
		if (!commentRoot && bottomCommentsStep === 'idle' && commentsBtn) {
			bottomCommentsStep = 'opening'
			commentsBtn.click()
			return
		}

		// Step 2: Once mounted, save its original sidebar position, move it into end-card-stack, and close React's drawer
		if (commentRoot && commentRoot.parentElement !== endCardStack) {
			if (!endCardStack.contains(commentRoot)) {
				bottomCommentsOriginalParent = commentRoot.parentElement
				bottomCommentsOriginalNextSibling = commentRoot.nextSibling
			}
			endCardStack.appendChild(commentRoot)
			bottomCommentsStep = 'moved_closing'

			setTimeout(() => {
				const scrim = document.querySelector(
					'[data-testid="reader-dock-scrim"]',
				)
				if (scrim) {
					scrim.click()
				} else if (commentsBtn) {
					commentsBtn.click()
				}
				bottomCommentsStep = 'done'
				syncCommentBoxWithToolbar()
			}, 50)
		}

		// Step 3: Tag the sticky/fixed comment input wrapper regardless of viewport
		const composerAnchor = endCardStack.querySelector(
			'[data-testid="composer-collapsed"], [data-testid="focus-handoff-proxy"]',
		)
		if (
			composerAnchor &&
			!endCardStack.querySelector(`[${STICKY_COMMENT_BOX_ATTR}="true"]`)
		) {
			let el = composerAnchor.parentElement
			while (el && el !== endCardStack) {
				if (
					['sticky', 'fixed'].includes(getComputedStyle(el).position)
				) {
					el.setAttribute(STICKY_COMMENT_BOX_ATTR, 'true')
					break
				}
				el = el.parentElement
			}
		}
	}

	function removeCommentSectionOnBottom() {
		clearTimeout(toolbarSyncTimer)
		if (bottomCommentsListenersAttached) {
			window.removeEventListener('pointerup', onBottomCommentsPointerUp, {
				capture: true,
			})
			window.removeEventListener('scroll', onBottomCommentsScroll, {
				capture: true,
			})
			window.removeEventListener(
				'transitionend',
				onBottomCommentsTransitionEnd,
				{ capture: true },
			)
			bottomCommentsListenersAttached = false
		}
		document.documentElement.classList.remove(TOOLBAR_VISIBLE_CLASS)
		document.getElementById(BOTTOM_COMMENTS_STYLE_ID)?.remove()
		document
			.querySelectorAll(`[${STICKY_COMMENT_BOX_ATTR}]`)
			.forEach((el) => el.removeAttribute(STICKY_COMMENT_BOX_ATTR))

		const commentRoot = document.querySelector(
			'[data-comment-section-root="true"]',
		)
		if (commentRoot && bottomCommentsOriginalParent?.isConnected) {
			if (
				bottomCommentsOriginalNextSibling &&
				bottomCommentsOriginalNextSibling.parentElement ===
					bottomCommentsOriginalParent
			) {
				bottomCommentsOriginalParent.insertBefore(
					commentRoot,
					bottomCommentsOriginalNextSibling,
				)
			} else {
				bottomCommentsOriginalParent.appendChild(commentRoot)
			}
		}
		bottomCommentsOriginalParent = null
		bottomCommentsOriginalNextSibling = null
		bottomCommentsMountedPath = null
		bottomCommentsStep = 'idle'
	}

	// ==========================================
	// Feature 13: Simple Mode on Home (Hide Banner & Comic Ranking)
	// ==========================================
	const HOME_SIMPLE_MODE_STYLE_ID = 'shinigami-home-simple-mode-style'
	const HOME_ROUTE_CLASS = 'shinigami-route-home'

	function syncHomeRouteClass() {
		document.documentElement.classList.toggle(
			HOME_ROUTE_CLASS,
			isHomeRoute(),
		)
	}

	function applyHomeSimpleMode() {
		if (!state.homeSimpleMode) return

		syncHomeRouteClass()

		const target = document.head || document.body
		if (!target) return

		let style = document.getElementById(HOME_SIMPLE_MODE_STYLE_ID)
		if (!style) {
			style = document.createElement('style')
			style.id = HOME_SIMPLE_MODE_STYLE_ID
			style.textContent = `
        html.${HOME_ROUTE_CLASS} .layout-nav-clearance > div > div:nth-child(1),
        html.${HOME_ROUTE_CLASS} .layout-nav-clearance > div > div:nth-child(2) {
			display: none !important;
        }
		html.${HOME_ROUTE_CLASS} .layout-nav-clearance > div > div:last-child {
			margin-top: 1rem !important;
        }`
			target.appendChild(style)
		} else if (style.parentNode?.lastElementChild !== style) {
			target.appendChild(style)
		}
	}

	function removeHomeSimpleMode() {
		document.documentElement.classList.remove(HOME_ROUTE_CLASS)
		document.getElementById(HOME_SIMPLE_MODE_STYLE_ID)?.remove()
	}

	// ==========================================
	// Feature 14: "Mirror" Sub-Menu Tab on Home (Next to Project)
	// ==========================================
	const MIRROR_TAB_ATTR = 'data-shinigami-mirror-tab'
	const MIRROR_PANEL_ATTR = 'data-shinigami-mirror-panel'
	const MIRROR_TAB_STYLE_ID = 'shinigami-mirror-tab-style'
	const MIRROR_SESSION_KEY = 'shinigami_mirror_tab_state_v1'

	function loadMirrorSessionState() {
		try {
			const raw = sessionStorage.getItem(MIRROR_SESSION_KEY)
			if (!raw) return { active: false, targetCount: 20 }
			const parsed = JSON.parse(raw)
			return {
				active: Boolean(parsed?.active),
				targetCount: Math.max(20, Number(parsed?.targetCount) || 20),
			}
		} catch (_) {
			return { active: false, targetCount: 20 }
		}
	}

	function saveMirrorSessionState() {
		try {
			sessionStorage.setItem(
				MIRROR_SESSION_KEY,
				JSON.stringify({
					active: mirrorTabActive,
					targetCount: mirrorTabActive
						? Math.max(
								20,
								mirrorTabOffset ||
									mirrorInitialTargetCount ||
									20,
							)
						: 20,
				}),
			)
		} catch (_) {}
	}

	const initialMirrorSession = loadMirrorSessionState()
	let mirrorTabActive = initialMirrorSession.active
	let mirrorInitialTargetCount = initialMirrorSession.targetCount
	let mirrorTabSwitchingOut = false
	let mirrorTabLoading = false
	let mirrorTabItems = []
	let mirrorTabOffset = 0
	let mirrorTabHasMore = true
	let mirrorResizeAttached = false
	let lastMirrorRenderSignature = ''

	const FLAG_SVGS = {
		kr: `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='900'%20height='600'%20viewBox='-72%20-48%20144%2096'%3e%3cpath%20fill='%23fff'%20d='M-72-48v96H72v-96z'/%3e%3cg%20stroke='%23000'%20stroke-width='4'%3e%3cpath%20transform='rotate(33.69006752598)'%20d='M-50-12v24m6%200v-24m6%200v24m76%200V1m0-2v-11m6%200v11m0%202v11m6%200V1m0-2v-11'/%3e%3cpath%20transform='rotate(-33.69006752598)'%20d='M-50-12v24m6%200V1m0-2v-11m6%200v24m76%200V1m0-2v-11m6%200v24m6%200V1m0-2v-11'/%3e%3c/g%3e%3cg%20transform='rotate(33.69006752598)'%3e%3cpath%20fill='%23cd2e3a'%20d='M12%200a18%2018%200%2011-36%200%2024%2024%200%201148%200'/%3e%3cpath%20fill='%230047a0'%20d='M0%200a12%2012%200%201124%200%2024%2024%200%2011-48%200%2012%2012%200%201024%200'/%3e%3c/g%3e%3c/svg%3e`,
		cn: `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20xmlns:xlink='http://www.w3.org/1999/xlink'%20width='900'%20height='600'%3e%3cpath%20fill='%23EE1C25'%20d='M0%200h900v600H0'/%3e%3cg%20transform='matrix(3%200%200%203%20150%20150)'%3e%3cpath%20id='a'%20d='m0-30%2017.634%2054.27-46.166-33.54h57.064l-46.166%2033.54Z'%20fill='%23FF0'/%3e%3c/g%3e%3cuse%20xlink:href='%23a'%20transform='rotate(23.036%202.784%20766.082)'/%3e%3cuse%20xlink:href='%23a'%20transform='rotate(45.87%2038.201%20485.396)'/%3e%3cuse%20xlink:href='%23a'%20transform='rotate(69.945%2029.892%20362.328)'/%3e%3cuse%20xlink:href='%23a'%20transform='rotate(20.66%20-590.66%20957.955)'/%3e%3c/svg%3e`,
		jp: `data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='900'%20height='600'%3e%3cpath%20fill='%23fff'%20d='M0%200h900v600H0z'/%3e%3ccircle%20cx='450'%20cy='300'%20r='180'%20fill='%23bc002d'/%3e%3c/svg%3e`,
	}

	function getCountryFlagSrc(manga) {
		const fmt = String(manga.format || manga.country_id || '').toLowerCase()
		if (fmt.includes('manhua') || fmt === 'cn') return FLAG_SVGS.cn
		if (fmt.includes('manga') || fmt === 'jp') return FLAG_SVGS.jp
		return FLAG_SVGS.kr
	}

	function formatRelativeIdTime(dateStr) {
		if (!dateStr) return ''
		const diffSec = Math.max(
			0,
			Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000),
		)
		if (Number.isNaN(diffSec)) return ''
		if (diffSec < 60) return 'baru saja'
		const mins = Math.floor(diffSec / 60)
		if (mins < 60) return `${mins} mnt`
		const hours = Math.floor(mins / 60)
		if (hours < 24) return `${hours} jam`
		const days = Math.floor(hours / 24)
		if (days < 7) return `${days} hr`
		const weeks = Math.floor(days / 7)
		if (weeks < 5) return `${weeks} minggu`
		const months = Math.floor(days / 30)
		if (months < 12) return `${months} bln`
		return `${Math.floor(days / 365)} thn`
	}

	function escapeHtml(str) {
		return String(str ?? '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
	}

	function getHomeFeedContainers() {
		const projectBtn = Array.from(
			document.querySelectorAll('div.cursor-pointer'),
		).find((el) => {
			const span = el.querySelector('span')
			return (
				span &&
				span.textContent.trim() === 'Project' &&
				el.parentElement
			)
		})

		const tabBar = projectBtn?.parentElement
		if (!tabBar) return null

		let tabBarSection = tabBar.parentElement
		while (tabBarSection && tabBarSection !== document.body) {
			const sibling = tabBarSection.nextElementSibling
			if (
				sibling &&
				(sibling.querySelector('[data-queue-intro-scope]') ||
					sibling.querySelector('[style*="will-change"]') ||
					sibling.hasAttribute('data-queue-intro-scope') ||
					String(sibling.getAttribute('style') || '').includes(
						'will-change',
					))
			) {
				break
			}
			tabBarSection = tabBarSection.parentElement
		}

		const section = tabBarSection?.parentElement
		const contentWrap = tabBarSection?.nextElementSibling
		if (!section || !contentWrap) return null

		return { section, tabBar, contentWrap }
	}

	function getMirrorColumnsPerRow(contentWrap) {
		const nativeRow = contentWrap?.querySelector(
			':scope > div:first-child .flex.flex-row',
		)
		if (nativeRow && nativeRow.children.length > 0) {
			return nativeRow.children.length
		}
		const w = window.innerWidth
		if (w >= 768) return 5
		if (w >= 640) return 3
		return 2
	}

	function ensureMirrorTabStyle(tabBar) {
		const activePill =
			tabBar?.querySelector('.sg-accent-fill') ||
			document.querySelector('.sg-accent-fill')
		if (activePill) {
			const bg = getComputedStyle(activePill).backgroundColor
			if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
				document.documentElement.style.setProperty(
					'--sg-userscript-accent-bg',
					bg,
				)
			}
		}

		if (document.getElementById(MIRROR_TAB_STYLE_ID)) return
		const target = document.head || document.body
		if (!target) return

		const style = document.createElement('style')
		style.id = MIRROR_TAB_STYLE_ID
		style.textContent = `
      [data-shinigami-tabbar-override="true"] > div:not([${MIRROR_TAB_ATTR}]):not([data-shinigami-pending-tab="true"]) {
        background-color: var(--sg-neutral-fill, rgba(255, 255, 255, 0.06)) !important;
        background-image: none !important;
      }
      [data-shinigami-tabbar-override="true"] > div:not([${MIRROR_TAB_ATTR}]):not([data-shinigami-pending-tab="true"]) svg {
        color: var(--sg-accent-light) !important;
      }
      [data-shinigami-tabbar-override="true"] > div:not([${MIRROR_TAB_ATTR}]):not([data-shinigami-pending-tab="true"]) span {
        font-weight: 400 !important;
        color: rgb(238, 238, 238) !important;
      }

      [data-shinigami-tabbar-override="true"] > div[data-shinigami-pending-tab="true"] {
        background-color: var(--sg-userscript-accent-bg, #facc15) !important;
      }
      [data-shinigami-tabbar-override="true"] > div[data-shinigami-pending-tab="true"] svg,
      [data-shinigami-tabbar-override="true"] > div[data-shinigami-pending-tab="true"] span {
        color: var(--sg-accent-fg) !important;
      }
      [data-shinigami-tabbar-override="true"] > div[data-shinigami-pending-tab="true"] span {
        font-weight: 500 !important;
      }
    `
		target.appendChild(style)
	}

	function setMirrorButtonVisual(mirrorBtn, isActive) {
		if (!mirrorBtn) return
		mirrorBtn.classList.toggle('sg-accent-fill', isActive)
		mirrorBtn.classList.toggle('sg-neutral-fill', !isActive)

		const svg = mirrorBtn.querySelector('svg')
		if (svg) {
			svg.style.color = isActive
				? 'var(--sg-accent-fg)'
				: 'var(--sg-accent-light)'
		}
		const span = mirrorBtn.querySelector('span')
		if (span) {
			span.style.fontWeight = isActive ? '500' : '400'
			span.style.color = isActive
				? 'var(--sg-accent-fg)'
				: 'rgb(238, 238, 238)'
		}
	}

	function syncMirrorTabStyles(tabBar) {
		if (!tabBar) return
		ensureMirrorTabStyle(tabBar)

		const mirrorBtn = tabBar.querySelector(`[${MIRROR_TAB_ATTR}]`)
		if (mirrorTabActive || mirrorTabSwitchingOut) {
			tabBar.setAttribute('data-shinigami-tabbar-override', 'true')
		} else {
			tabBar.removeAttribute('data-shinigami-tabbar-override')
		}
		setMirrorButtonVisual(mirrorBtn, mirrorTabActive)
	}

	function buildMirrorCardHtml(manga) {
		const id = escapeHtml(manga.manga_id)
		const title = escapeHtml(manga.title || '')
		const cover = escapeHtml(
			manga.cover_image_url || manga.cover_portrait_url || '',
		)
		const flagSrc = getCountryFlagSrc(manga)
		const chapters = Array.isArray(manga.chapters)
			? manga.chapters.slice(0, 2)
			: []

		const badgeText = manga.badge || manga.label || ''
		const badgeHtml = badgeText
			? `<div class="flex flex-col absolute px-2 py-0.5 rounded-md z-10 sg-accent-fill top-2 right-2" data-testid="manga-badge-overlay" style="max-width: 120px;"><span class="select-text text-[11px] font-bold line-clamp-1 text-[var(--sg-accent-fg)]">${escapeHtml(badgeText)}</span></div>`
			: ''

		const chButtonsHtml = chapters
			.map((ch, idx) => {
				const chNum = escapeHtml(ch.chapter_number ?? '')
				const timeStr = escapeHtml(
					formatRelativeIdTime(ch.created_at || ch.updated_at),
				)
				const fillClass =
					idx === 0 ? 'sg-neutral-fill-raised' : 'sg-neutral-fill'
				return `<button type="button" class="relative flex w-full items-center justify-between px-2 py-1.5 ${fillClass} rounded-[5px] text-left transition-[filter] hover:brightness-110" aria-label="Chapter ${chNum}" data-state="closed" style="overflow: visible;"><span class="select-text text-xs whitespace-nowrap text-foreground"><span class="md:hidden">Ch.</span><span class="hidden md:inline">Chapter</span> ${chNum}</span><span class="text-foreground select-text text-xs whitespace-nowrap">${timeStr}</span></button>`
			})
			.join('')

		return `
      <div class="flex flex-col flex-1 min-w-0" data-restore-key="${id}" data-restore-ns="manga">
        <div class="flex flex-col card-item w-full cursor-pointer" data-state="closed">
          <div class="flex flex-col bg-card rounded-lg overflow-hidden">
            <div class="flex flex-col relative aspect-[3/4] bg-muted overflow-hidden w-full shrink-0">
              <img alt="${title}" class="absolute inset-0 w-full h-full object-cover" decoding="async" loading="lazy" data-testid="card-comic-cover" src="${cover}">
              ${badgeHtml}
              <div style="position: absolute; bottom: 8px; right: 8px; width: 24px; height: 18px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.2); box-shadow: rgba(0, 0, 0, 0.45) 0px 1px 4px; overflow: hidden;">
                <img alt="" src="${flagSrc}" style="width: 100%; height: 100%; object-fit: cover;">
              </div>
            </div>
            <div class="flex flex-col p-2.5">
              <span class="select-text text-foreground text-[13px] font-medium mb-2 line-clamp-1 min-h-[1lh] md:line-clamp-2 md:min-h-[2lh]">${title}</span>
              <div class="flex flex-col gap-1">${chButtonsHtml}</div>
            </div>
          </div>
        </div>
      </div>
    `
	}

	function renderMirrorPanel(force = false) {
		const containers = getHomeFeedContainers()
		if (!containers) return
		const { contentWrap } = containers

		const nativeChildren = Array.from(contentWrap.children).filter(
			(el) => !el.hasAttribute(MIRROR_PANEL_ATTR),
		)
		let mirrorPanel = contentWrap.querySelector(`[${MIRROR_PANEL_ATTR}]`)

		if (!mirrorTabActive) {
			nativeChildren.forEach((el) => {
				el.style.display = ''
			})
			if (mirrorPanel) mirrorPanel.style.display = 'none'
			lastMirrorRenderSignature = ''
			return
		}

		nativeChildren.forEach((el) => {
			el.style.display = 'none'
		})

		if (!mirrorPanel) {
			mirrorPanel = document.createElement('div')
			mirrorPanel.setAttribute(MIRROR_PANEL_ATTR, 'true')
			mirrorPanel.style.willChange = 'opacity'

			mirrorPanel.addEventListener('click', (e) => {
				const loadBtn =
					e.target instanceof Element
						? e.target.closest('[data-mirror-load-more]')
						: null
				if (loadBtn) {
					e.preventDefault()
					e.stopPropagation()
					fetchMirrorFeed(false, 20)
				}
			})

			contentWrap.appendChild(mirrorPanel)
		}
		mirrorPanel.style.display = ''

		const cols = getMirrorColumnsPerRow(contentWrap)
		const signature = `${mirrorTabItems.length}|${cols}|${mirrorTabLoading ? 1 : 0}|${mirrorTabHasMore ? 1 : 0}`
		if (!force && signature === lastMirrorRenderSignature) {
			return
		}
		lastMirrorRenderSignature = signature

		const rowsHtml = []
		for (let i = 0; i < mirrorTabItems.length; i += cols) {
			const slice = mirrorTabItems.slice(i, i + cols)
			const cardsHtml = slice.map(buildMirrorCardHtml).join('')
			const fillersCount = cols - slice.length
			const fillersHtml =
				fillersCount > 0
					? Array.from({ length: fillersCount })
							.map(
								() =>
									'<div class="flex flex-col flex-1 min-w-0"></div>',
							)
							.join('')
					: ''
			rowsHtml.push(
				`<div class="flex flex-row" style="gap: 12px;">${cardsHtml}${fillersHtml}</div>`,
			)
		}

		const loadMoreHtml = mirrorTabHasMore
			? `
        <div class="flex flex-col mx-auto w-full max-w-[1024px] px-[10px] md:px-6 py-4">
          <div class="flex flex-row items-center justify-center pt-4">
            <button type="button" data-mirror-load-more="true" class="flex flex-row items-center justify-center group shrink-0 gap-2 rounded-md shadow-none whitespace-nowrap outline-none transition-all border h-10 px-4 py-2 sg-neutral-fill border-transparent cursor-pointer" ${mirrorTabLoading ? 'disabled' : ''}>
              <div class="flex flex-row items-center justify-center gap-2">
                <span class="text-sm font-medium pointer-events-none transition-colors group-hover:text-accent-foreground select-text text-[#eee]">${mirrorTabLoading ? 'Memuat...' : 'Muat lainnya'}</span>
              </div>
            </button>
          </div>
        </div>
      `
			: ''

		mirrorPanel.innerHTML = `
      <div class="flex flex-col mx-auto w-full max-w-[1024px] px-[10px] md:px-6 pt-3" data-queue-intro-scope="">
        <div class="flex flex-col" style="gap: 12px;">
          ${rowsHtml.join('')}
        </div>
      </div>
      ${loadMoreHtml}
    `

		if (!state.homeChapterButtonLinks) {
			mirrorPanel
				.querySelectorAll('[data-restore-key]')
				.forEach((cardEl) => {
					const mangaId = cardEl.getAttribute('data-restore-key')
					const manga = mangaListStore.byMangaId.get(mangaId)
					cardEl
						.querySelector('.card-item')
						?.addEventListener('click', () => {
							location.href = `/series/${mangaId}`
						})
					const btns = cardEl.querySelectorAll('button')
					btns.forEach((btn, idx) => {
						const chId = manga?.chapters?.[idx]?.chapter_id
						if (chId) {
							btn.addEventListener('click', (e) => {
								e.stopPropagation()
								location.href = `/chapter/${chId}`
							})
						}
					})
				})
		} else {
			applyHomeChapterButtonLinks()
		}
	}

	async function fetchMirrorFeed(reset = false, customLimit = 20) {
		if (mirrorTabLoading) return
		if (reset) {
			mirrorTabOffset = 0
			mirrorTabItems = []
			mirrorTabHasMore = true
		}
		if (!mirrorTabHasMore) return

		mirrorTabLoading = true
		renderMirrorPanel(true)

		try {
			const limit = Math.max(20, Number(customLimit) || 20)
			const url = `https://api.shinigami.io/v1/manga/list?type=mirror&is_update=true&sort=latest&sort_order=desc&offset=${mirrorTabOffset}&limit=${limit}`
			const res = await fetch(url, {
				headers: { Accept: 'application/json' },
			})
			const json = await res.json()

			if (json?.retcode === 0 && Array.isArray(json.data)) {
				storeMangaListResponse(json, url)
				mirrorTabItems.push(...json.data)
				mirrorTabOffset += json.data.length
				mirrorTabHasMore =
					Boolean(json.meta?.has_next) && json.data.length > 0
				saveMirrorSessionState()
			} else {
				mirrorTabHasMore = false
			}
		} catch (_) {
			showToast('Gagal memuat daftar Mirror')
		} finally {
			mirrorTabLoading = false
			renderMirrorPanel(true)
		}
	}

	function onMirrorResize() {
		if (mirrorTabActive && isHomeRoute()) {
			renderMirrorPanel()
		}
	}

	function applyHomeMirrorTab() {
		if (!state.homeMirrorTab || !isHomeRoute()) return

		if (!mirrorResizeAttached) {
			window.addEventListener('resize', onMirrorResize, { passive: true })
			mirrorResizeAttached = true
		}

		const containers = getHomeFeedContainers()
		if (!containers) return
		const { tabBar } = containers

		if (!tabBar.dataset.shinigamiTabBarBound) {
			tabBar.dataset.shinigamiTabBarBound = 'true'
			tabBar.addEventListener(
				'click',
				(e) => {
					const clickedTab =
						e.target instanceof Element
							? e.target.closest('div.cursor-pointer')
							: null
					if (!clickedTab || clickedTab.parentElement !== tabBar)
						return
					if (clickedTab.hasAttribute(MIRROR_TAB_ATTR)) return

					if (mirrorTabActive || mirrorTabSwitchingOut) {
						mirrorTabActive = false
						mirrorTabSwitchingOut = true
						saveMirrorSessionState()
						tabBar
							.querySelectorAll(
								'[data-shinigami-pending-tab="true"]',
							)
							.forEach((el) =>
								el.removeAttribute(
									'data-shinigami-pending-tab',
								),
							)
						clickedTab.setAttribute(
							'data-shinigami-pending-tab',
							'true',
						)
						syncMirrorTabStyles(tabBar)
						renderMirrorPanel()
					}
				},
				{ capture: true },
			)
		}

		if (
			!tabBar.querySelector(`[${MIRROR_TAB_ATTR}]`) &&
			tabBar.firstElementChild
		) {
			const mirrorBtn = document.createElement('div')
			mirrorBtn.setAttribute(MIRROR_TAB_ATTR, 'true')
			mirrorBtn.className =
				'shrink-0 whitespace-nowrap cursor-pointer px-3 py-1.5 flex flex-row items-center gap-1.5 sg-neutral-fill'
			mirrorBtn.style.borderRadius = '8px'
			mirrorBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-left-right-dashed preview-icon"><path d="M15 10V9"/><path d="M15 15v-1"/><path d="M15 21v-2"/><path d="M15 5V3"/><path d="M9 10V9"/><path d="M9 15v-1"/><path d="M9 21v-2"/><path d="M9 5V3"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg><span style="font-size: 13px; font-weight: 400; color: rgb(238, 238, 238); user-select: none;">Mirror</span>`

			mirrorBtn.addEventListener('click', (e) => {
				e.stopPropagation()
				if (mirrorTabActive) return
				mirrorTabSwitchingOut = false
				mirrorTabActive = true
				saveMirrorSessionState()
				tabBar
					.querySelectorAll('[data-shinigami-pending-tab="true"]')
					.forEach((el) =>
						el.removeAttribute('data-shinigami-pending-tab'),
					)
				syncMirrorTabStyles(tabBar)
				if (mirrorTabItems.length === 0) {
					fetchMirrorFeed(true, 20)
				} else {
					renderMirrorPanel()
				}
			})

			tabBar.firstElementChild.after(mirrorBtn)
		}

		syncMirrorTabStyles(tabBar)
		if (mirrorTabActive) {
			if (mirrorTabItems.length === 0 && !mirrorTabLoading) {
				const restoreLimit = mirrorInitialTargetCount
				mirrorInitialTargetCount = 20
				fetchMirrorFeed(true, restoreLimit)
			} else {
				renderMirrorPanel()
			}
		}
	}

	function removeHomeMirrorTab() {
		if (mirrorResizeAttached) {
			window.removeEventListener('resize', onMirrorResize)
			mirrorResizeAttached = false
		}
		mirrorTabActive = false
		mirrorTabSwitchingOut = false
		lastMirrorRenderSignature = ''
		try {
			sessionStorage.removeItem(MIRROR_SESSION_KEY)
		} catch (_) {}
		document.getElementById(MIRROR_TAB_STYLE_ID)?.remove()

		const containers = getHomeFeedContainers()
		if (containers) {
			const { tabBar, contentWrap } = containers
			tabBar.removeAttribute('data-shinigami-tabbar-override')
			tabBar
				.querySelectorAll('[data-shinigami-pending-tab="true"]')
				.forEach((el) =>
					el.removeAttribute('data-shinigami-pending-tab'),
				)
			tabBar.querySelector(`[${MIRROR_TAB_ATTR}]`)?.remove()
			contentWrap.querySelector(`[${MIRROR_PANEL_ATTR}]`)?.remove()
			Array.from(contentWrap.children).forEach((el) => {
				el.style.display = ''
			})
		}
	}

	// ==========================================
	// Unified SPA Route Change Handler
	// ==========================================
	function onRouteChange() {
		if (state.mobilePullToRefresh && isPullToRefreshExcludedRoute()) {
			ptrActive = false
			ptrReady = false
			resetPtrIndicator(true)
		}

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

		if (state.hideBarsOnScrollUp) {
			lastReaderScrollY =
				window.scrollY || document.documentElement.scrollTop || 0
			document.documentElement.classList.remove(HIDE_BARS_CLASS)
		}

		if (state.scrollToBottom) {
			ensureScrollToBottomElements()
			updateScrollToBottomVisibility()
		}

		if (state.autoUpvoteChapter) {
			const chapterId = getCurrentChapterId()
			if (chapterId) {
				triggerAutoUpvote(chapterId)
			}
		}

		if (state.homeChapterButtonLinks) {
			applyHomeChapterButtonLinks()
		}

		if (state.commentSectionOnBottom) {
			bottomCommentsMountedPath = null
			bottomCommentsStep = 'idle'
			applyCommentSectionOnBottom()
		}

		if (state.homeSimpleMode) {
			syncHomeRouteClass()
		}

		if (state.homeMirrorTab) {
			if (!isHomeRoute()) {
				mirrorTabActive = false
			} else {
				applyHomeMirrorTab()
			}
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
		applyChapterCardLinks()
		applyScrollbarCSS()
		applyPullToRefresh()
		applyArrowKeyNav()
		applyBackToTop()
		applyHomeButtonTopBar()
		applyHideBarsOnScrollUp()
		applyScrollToBottom()
		applyHidePremiumUpselling()
		applyAutoUpvoteChapter()
		applyHomeChapterButtonLinks()
		applyCommentSectionOnBottom()
		applyHomeSimpleMode()
		applyHomeMirrorTab()
	}

	function scheduleSync() {
		if (
			rafScheduled ||
			(!state.chapterCardLinkSeries &&
				!state.alwaysShowScrollbar &&
				!state.backToTop &&
				!state.homeButtonTopBar &&
				!state.scrollToBottom &&
				!state.hidePremiumUpselling &&
				!state.homeChapterButtonLinks &&
				!state.commentSectionOnBottom &&
				!state.homeMirrorTab)
		) {
			return
		}
		rafScheduled = true
		requestAnimationFrame(() => {
			rafScheduled = false
			applyChapterCardLinks()
			applyScrollbarCSS()
			ensureBackToTopElements()
			applyHomeButtonTopBar()
			ensureScrollToBottomElements()
			updateScrollToBottomVisibility()
			applyHidePremiumUpselling()
			applyHomeChapterButtonLinks()
			applyCommentSectionOnBottom()
			syncCommentBoxWithToolbar()
			applyHomeMirrorTab()
		})
	}

	// ==========================================
	// Violentmonkey Menu Toggles
	// ==========================================
	function renderMenu() {
		menuIds.forEach((id) => GM_unregisterMenuCommand(id))
		menuIds = []

		const opts = { autoClose: false }

		const chapterLinkLabel = `${state.chapterCardLinkSeries ? '✅' : '❌'} Chapter Card as Link on Series`
		menuIds.push(
			GM_registerMenuCommand(
				chapterLinkLabel,
				() => {
					state.chapterCardLinkSeries = !state.chapterCardLinkSeries
					GM_setValue(
						'chapterCardLinkSeries',
						state.chapterCardLinkSeries,
					)
					state.chapterCardLinkSeries
						? applyChapterCardLinks()
						: removeChapterCardLinks()
					renderMenu()
				},
				opts,
			),
		)

		if (state.chapterCardLinkSeries) {
			const alwaysNewTabLabel = `   └─ ${state.alwaysOpenAsNewTab ? '✅' : '❌'} Open Chapter Card in New Tab`
			menuIds.push(
				GM_registerMenuCommand(
					alwaysNewTabLabel,
					() => {
						state.alwaysOpenAsNewTab = !state.alwaysOpenAsNewTab
						GM_setValue(
							'alwaysOpenAsNewTab',
							state.alwaysOpenAsNewTab,
						)
						applyChapterCardLinks()
						renderMenu()
					},
					opts,
				),
			)
		}

		const scrollbarLabel = `${state.alwaysShowScrollbar ? '✅' : '❌'} Always Show Scrollbar`
		menuIds.push(
			GM_registerMenuCommand(
				scrollbarLabel,
				() => {
					state.alwaysShowScrollbar = !state.alwaysShowScrollbar
					GM_setValue(
						'alwaysShowScrollbar',
						state.alwaysShowScrollbar,
					)
					state.alwaysShowScrollbar
						? applyScrollbarCSS()
						: removeScrollbarCSS()
					renderMenu()
				},
				opts,
			),
		)

		const ptrLabel = `${state.mobilePullToRefresh ? '✅' : '❌'} Mobile Pull to Refresh`
		menuIds.push(
			GM_registerMenuCommand(
				ptrLabel,
				() => {
					state.mobilePullToRefresh = !state.mobilePullToRefresh
					GM_setValue(
						'mobilePullToRefresh',
						state.mobilePullToRefresh,
					)
					state.mobilePullToRefresh
						? applyPullToRefresh()
						: removePullToRefresh()
					renderMenu()
				},
				opts,
			),
		)

		const arrowLabel = `${state.arrowKeyChapterNav ? '✅' : '❌'} Arrow Keys Prev/Next Chapter`
		menuIds.push(
			GM_registerMenuCommand(
				arrowLabel,
				() => {
					state.arrowKeyChapterNav = !state.arrowKeyChapterNav
					GM_setValue('arrowKeyChapterNav', state.arrowKeyChapterNav)
					state.arrowKeyChapterNav
						? applyArrowKeyNav()
						: removeArrowKeyNav()
					renderMenu()
				},
				opts,
			),
		)

		const bttLabel = `${state.backToTop ? '✅' : '❌'} Back to Top Button`
		menuIds.push(
			GM_registerMenuCommand(
				bttLabel,
				() => {
					state.backToTop = !state.backToTop
					GM_setValue('backToTop', state.backToTop)
					state.backToTop ? applyBackToTop() : removeBackToTop()
					renderMenu()
				},
				opts,
			),
		)

		const homeBtnLabel = `${state.homeButtonTopBar ? '✅' : '❌'} Home Button on Top Bar`
		menuIds.push(
			GM_registerMenuCommand(
				homeBtnLabel,
				() => {
					state.homeButtonTopBar = !state.homeButtonTopBar
					GM_setValue('homeButtonTopBar', state.homeButtonTopBar)
					state.homeButtonTopBar
						? applyHomeButtonTopBar()
						: removeHomeButtonTopBar()
					renderMenu()
				},
				opts,
			),
		)

		const hideBarsLabel = `${state.hideBarsOnScrollUp ? '✅' : '❌'} Hide Bars on Scroll Up`
		menuIds.push(
			GM_registerMenuCommand(
				hideBarsLabel,
				() => {
					state.hideBarsOnScrollUp = !state.hideBarsOnScrollUp
					GM_setValue('hideBarsOnScrollUp', state.hideBarsOnScrollUp)
					state.hideBarsOnScrollUp
						? applyHideBarsOnScrollUp()
						: removeHideBarsOnScrollUp()
					renderMenu()
				},
				opts,
			),
		)

		const stbLabel = `${state.scrollToBottom ? '✅' : '❌'} Scroll to Bottom Button`
		menuIds.push(
			GM_registerMenuCommand(
				stbLabel,
				() => {
					state.scrollToBottom = !state.scrollToBottom
					GM_setValue('scrollToBottom', state.scrollToBottom)
					state.scrollToBottom
						? applyScrollToBottom()
						: removeScrollToBottom()
					renderMenu()
				},
				opts,
			),
		)

		const hidePremiumLabel = `${state.hidePremiumUpselling ? '✅' : '❌'} Hide Premium Upselling`
		menuIds.push(
			GM_registerMenuCommand(
				hidePremiumLabel,
				() => {
					state.hidePremiumUpselling = !state.hidePremiumUpselling
					GM_setValue(
						'hidePremiumUpselling',
						state.hidePremiumUpselling,
					)
					state.hidePremiumUpselling
						? applyHidePremiumUpselling()
						: removeHidePremiumUpselling()
					renderMenu()
				},
				opts,
			),
		)

		if (state.hidePremiumUpselling) {
			const hidePremiumChatLabel = `   └─ ${state.alsoHidePremiumChat ? '✅' : '❌'} Also hide premium chat`
			menuIds.push(
				GM_registerMenuCommand(
					hidePremiumChatLabel,
					() => {
						state.alsoHidePremiumChat = !state.alsoHidePremiumChat
						GM_setValue(
							'alsoHidePremiumChat',
							state.alsoHidePremiumChat,
						)
						applyHidePremiumUpselling()
						renderMenu()
					},
					opts,
				),
			)
		}

		const autoUpvoteLabel = `${state.autoUpvoteChapter ? '✅' : '❌'} Auto Upvote when Opening Chapter`
		menuIds.push(
			GM_registerMenuCommand(
				autoUpvoteLabel,
				() => {
					state.autoUpvoteChapter = !state.autoUpvoteChapter
					GM_setValue('autoUpvoteChapter', state.autoUpvoteChapter)
					if (state.autoUpvoteChapter) applyAutoUpvoteChapter()
					renderMenu()
				},
				opts,
			),
		)

		const homeChBtnLabel = `${state.homeChapterButtonLinks ? '✅' : '❌'} Home Chapter Buttons as Link`
		menuIds.push(
			GM_registerMenuCommand(
				homeChBtnLabel,
				() => {
					state.homeChapterButtonLinks = !state.homeChapterButtonLinks
					GM_setValue(
						'homeChapterButtonLinks',
						state.homeChapterButtonLinks,
					)
					state.homeChapterButtonLinks
						? applyHomeChapterButtonLinks()
						: removeHomeChapterButtonLinks()
					renderMenu()
				},
				opts,
			),
		)

		if (state.homeChapterButtonLinks) {
			const homeChNewTabLabel = `   └─ ${state.homeChapterAlwaysNewTab ? '✅' : '❌'} Open Home Chapter in New Tab`
			menuIds.push(
				GM_registerMenuCommand(
					homeChNewTabLabel,
					() => {
						state.homeChapterAlwaysNewTab =
							!state.homeChapterAlwaysNewTab
						GM_setValue(
							'homeChapterAlwaysNewTab',
							state.homeChapterAlwaysNewTab,
						)
						applyHomeChapterButtonLinks()
						renderMenu()
					},
					opts,
				),
			)
		}

		const bottomCommentsLabel = `${state.commentSectionOnBottom ? '✅' : '❌'} Bottom Comment Section`
		menuIds.push(
			GM_registerMenuCommand(
				bottomCommentsLabel,
				() => {
					state.commentSectionOnBottom = !state.commentSectionOnBottom
					GM_setValue(
						'commentSectionOnBottom',
						state.commentSectionOnBottom,
					)
					state.commentSectionOnBottom
						? applyCommentSectionOnBottom()
						: removeCommentSectionOnBottom()
					renderMenu()
				},
				opts,
			),
		)

		const homeSimpleModeLabel = `${state.homeSimpleMode ? '✅' : '❌'} Simple Mode at Home`
		menuIds.push(
			GM_registerMenuCommand(
				homeSimpleModeLabel,
				() => {
					state.homeSimpleMode = !state.homeSimpleMode
					GM_setValue('homeSimpleMode', state.homeSimpleMode)
					state.homeSimpleMode
						? applyHomeSimpleMode()
						: removeHomeSimpleMode()
					renderMenu()
				},
				opts,
			),
		)

		const homeMirrorTabLabel = `${state.homeMirrorTab ? '✅' : '❌'} Add Mirror Tab on Home`
		menuIds.push(
			GM_registerMenuCommand(
				homeMirrorTabLabel,
				() => {
					state.homeMirrorTab = !state.homeMirrorTab
					GM_setValue('homeMirrorTab', state.homeMirrorTab)
					state.homeMirrorTab
						? applyHomeMirrorTab()
						: removeHomeMirrorTab()
					renderMenu()
				},
				opts,
			),
		)
	}

	// Initialize network hook immediately at document-start
	hookNetworkForChapterDetail()
	hookHistoryNavigation()

	// Run DOM-dependent features once the DOM is ready
	function initDomFeatures() {
		renderMenu()
		syncFeatures()
		new MutationObserver(scheduleSync).observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['class', 'style', 'aria-hidden', 'inert'],
		})
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initDomFeatures, {
			once: true,
		})
	} else {
		initDomFeatures()
	}
})()
