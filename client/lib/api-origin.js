/**
 * API origin resolution for split UI (Vite / Electron) vs same-origin (legacy / Companion).
 * @see docs/PLAN_SERVER_CLIENT_SPLIT.md
 */

/**
 * Companion path prefix when the SPA is hosted under /instance/<id>/.
 * @returns {string} e.g. `/instance/abc` or ``
 */
export function getCompanionPathPrefix() {
	if (typeof location === 'undefined') return ''
	const p = location.pathname.replace(/\/$/, '') || '/'
	const m = p.match(/^(\/instance\/[^/]+)/)
	return m ? m[1] : ''
}

/**
 * Explicit API origin (no trailing slash): Electron `window.__HIGHASCG_API_ORIGIN__` or Vite env.
 * Empty string => same-origin relative `/api/...` (legacy monolith or Vite proxy).
 * @returns {string}
 */
export function getApiOrigin() {
	if (typeof globalThis !== 'undefined' && globalThis.__HIGHASCG_API_ORIGIN__) {
		return String(globalThis.__HIGHASCG_API_ORIGIN__).trim().replace(/\/$/, '')
	}
	const built = typeof import.meta !== 'undefined' && import.meta.env?.VITE_HIGHASCG_API_ORIGIN
	if (built && String(built).trim()) {
		return String(built).trim().replace(/\/$/, '')
	}
	return ''
}

/**
 * Base for `/api/...` fetch paths.
 * - Cross-origin: `http://host:4200` (+ optional Companion prefix if ever used on UI host)
 * - Same-origin: `` or `/instance/<id>`
 * @returns {string}
 */
export function getApiBase() {
	const companion = getCompanionPathPrefix()
	const origin = getApiOrigin()
	if (origin) return origin + companion
	return companion
}

/**
 * Absolute URL for server-hosted assets (`/templates/`, `/vendor/`, …).
 * @param {string} path must start with `/`
 * @returns {string}
 */
export function assetUrl(path) {
	const p = path.startsWith('/') ? path : `/${path}`
	const origin = getApiOrigin()
	if (origin) return origin + p
	return p
}

/**
 * Resolve any API path to a full URL suitable for `fetch` / `<img src>`.
 * @param {string} path e.g. `/api/media`
 * @returns {string}
 */
export function resolveApiUrl(path) {
	const p = path.startsWith('/') ? path : `/${path}`
	const base = getApiBase()
	if (base.startsWith('http://') || base.startsWith('https://')) return base + p
	if (typeof location !== 'undefined') return location.origin + base + p
	return base + p
}

/**
 * WebSocket URL for `/api/ws`.
 * @returns {string}
 */
export function getWsUrl() {
	const companion = getCompanionPathPrefix()
	const origin = getApiOrigin()
	if (origin) {
		const wsBase = origin.replace(/^http/, 'ws')
		return `${wsBase}${companion}/api/ws`
	}
	if (typeof location === 'undefined') return `ws://127.0.0.1:4200${companion}/api/ws`
	const pageOrigin = location.origin.replace(/^http/, 'ws')
	return `${pageOrigin}${companion}/api/ws`
}
