import { defineConfig, loadEnv } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WEBUI_PORT } from './client/lib/webui-port.js'

const repoDir = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(repoDir, 'client')

const STATIC_MIME = {
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.txt': 'text/plain',
}

/** @param {string} rel — path under the copied tree, e.g. `/modules/cg-studio/entry.js` */
function skipOptionalModuleBundleCopy(rel) {
	return /^\/modules\/cg-studio\//.test(rel)
}

/** Copy trees the UI loads by URL (/assets/…, /fonts/…) — not only Vite-bundled imports. */
function copyClientStaticTreesPlugin() {
	const trees = [
		{ src: path.join(clientDir, 'assets'), urlPath: '/assets' },
		{ src: path.join(clientDir, 'fonts'), urlPath: '/fonts' },
		{ src: path.join(clientDir, 'fixtures'), urlPath: '/fixtures' },
	]
	return {
		name: 'highascg-copy-client-static',
		configureServer(server) {
			for (const { src, urlPath } of trees) {
				if (!fs.existsSync(src)) continue
				server.middlewares.use(urlPath, (req, res, next) => {
					const rel = decodeURIComponent((req.url || '').split('?')[0] || '')
					if (!rel || rel.includes('..') || skipOptionalModuleBundleCopy(rel)) return next()
					const file = path.join(src, rel)
					if (!file.startsWith(src)) return next()
					fs.readFile(file, (err, data) => {
						if (err) return next()
						const ext = path.extname(file).toLowerCase()
						if (STATIC_MIME[ext]) res.setHeader('Content-Type', STATIC_MIME[ext])
						res.end(data)
					})
				})
			}
		},
		closeBundle() {
			const outDir = path.join(repoDir, 'dist-web')
			for (const { src, urlPath } of trees) {
				if (!fs.existsSync(src)) continue
				const dest = path.join(outDir, urlPath.replace(/^\//, ''))
				fs.mkdirSync(dest, { recursive: true })
				fs.cpSync(src, dest, {
					recursive: true,
					filter: (srcPath) => {
						const rel = path.relative(src, srcPath).replace(/\\/g, '/')
						if (!rel || rel === '.') return true
						return !skipOptionalModuleBundleCopy(`/${rel}`)
					},
				})
			}
		},
	}
}

/** @param {string} apiOrigin */
function vendorImportMapEntries(apiOrigin) {
	// Always use relative paths for vendor imports so they go through the same-origin proxy (Web UI port / companion)
	// which avoids all CORS issues and works under any custom LAN IP configuration.
	return {
		three: '/vendor/three/build/three.module.js',
		'three/': '/vendor/three/',
		'three/addons/': '/vendor/three/examples/jsm/',
		grapesjs: '/vendor/grapesjs/dist/grapes.mjs',
		'html-to-image': '/vendor/html-to-image/es/index.js',
	}
}

const optionalModulesRegistryPath = path.join(clientDir, 'lib', 'optional-modules-registry.json')

/** Dev: local GET /api/modules (before proxy) — set HIGHASCG_ENABLED_MODULES=cg-studio,previs */
function optionalModulesDevApiPlugin() {
	return {
		name: 'highascg-optional-modules-dev-api',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const urlPath = (req.url || '').split('?')[0]
				if (urlPath !== '/api/modules' || req.method !== 'GET') return next()
				let registry = []
				try {
					registry = JSON.parse(fs.readFileSync(optionalModulesRegistryPath, 'utf8')).modules || []
				} catch {
					/* ignore */
				}
				const visible = registry.filter((m) => m.launcherHidden !== true)
				const env = process.env.HIGHASCG_ENABLED_MODULES
				const enabledIds = env
					? env.split(',').map((s) => s.trim()).filter(Boolean)
					: visible.filter((m) => m.defaultEnabled).map((m) => m.id)
				const allowed = new Set(enabledIds)
				const enabled = []
				const bundles = []
				const styles = []
				for (const mod of visible) {
					if (!allowed.has(mod.id)) continue
					enabled.push(mod.id)
					if (mod.bundle && !bundles.includes(mod.bundle)) bundles.push(mod.bundle)
					for (const href of mod.styles || []) {
						if (!styles.includes(href)) styles.push(href)
					}
				}
				res.setHeader('Content-Type', 'application/json')
				res.end(JSON.stringify({ enabled, bundles, styles, wsNamespaces: enabled.filter((id) => id !== 'cg-studio') }))
			})
		},
	}
}

/** Dev-only CG Studio API when playout server has no cg-studio routes (WO-32). */
function cgStudioDevApiPlugin() {
	const templatesDir = path.join(clientDir, 'fixtures', 'cg-studio-templates')
	return {
		name: 'highascg-cg-studio-dev-api',
		configureServer(server) {
			fs.mkdirSync(templatesDir, { recursive: true })
			server.middlewares.use(async (req, res, next) => {
				const url = (req.url || '').split('?')[0]
				if (!url.startsWith('/api/cg-studio')) return next()

				if (url === '/api/cg-studio/health' && req.method === 'GET') {
					res.setHeader('Content-Type', 'application/json')
					res.end(JSON.stringify({ ok: true, module: 'cg-studio', dev: true }))
					return
				}

				if (url === '/api/cg-studio/save' && req.method === 'POST') {
					let body = ''
					req.on('data', (chunk) => {
						body += chunk
					})
					req.on('end', () => {
						try {
							const payload = JSON.parse(body || '{}')
							const name = String(payload.name || 'template')
								.trim()
								.replace(/[^\w.-]+/g, '_') || 'template'
							const casparHtml = String(payload.casparHtml || '')
							const projectJson = String(payload.projectJson || '{}')
							const htmlPath = path.join(templatesDir, `${name}.html`)
							const jsonPath = path.join(templatesDir, `${name}.project.json`)
							fs.writeFileSync(htmlPath, casparHtml || payload.html || '', 'utf8')
							fs.writeFileSync(jsonPath, projectJson, 'utf8')
							res.setHeader('Content-Type', 'application/json')
							res.end(
								JSON.stringify({
									ok: true,
									name,
									path: `/fixtures/cg-studio-templates/${name}.html`,
								}),
							)
						} catch (err) {
							res.statusCode = 400
							res.setHeader('Content-Type', 'text/plain')
							res.end(err && err.message ? err.message : String(err))
						}
					})
					return
				}

				res.statusCode = 404
				res.end('Not found')
			})
		},
	}
}

/** Inject import map + meta for split dev (UI → API :4200). */
function highascgApiOriginPlugin(apiOrigin) {
	return {
		name: 'highascg-api-origin',
		transformIndexHtml(html) {
			const origin = (apiOrigin || '').replace(/\/$/, '')
			const map = JSON.stringify({ imports: vendorImportMapEntries(origin) }, null, '\t')
			let out = html.replace(/location\.port === '\d+'/, `location.port === '${WEBUI_PORT}'`)
			if (html.includes('id="highascg-importmap-bootstrap"')) {
				out = out.replace(
					/<script type="importmap" id="highascg-importmap">[\s\S]*?<\/script>/,
					`<script type="importmap" id="highascg-importmap">\n${map}\n\t</script>`,
				)
			}
			out = out.replace(
				/<meta name="highascg-api-origin" content="[^"]*">/,
				`<meta name="highascg-api-origin" content="${origin}">`,
			)
			const grapesCss = '/vendor/grapesjs/dist/css/grapes.min.css'
			out = out.replace(
				/href="\/vendor\/grapesjs\/dist\/css\/grapes\.min\.css"/,
				`href="${grapesCss}"`,
			)
			return out
		},
	}
}

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '')
	// Dev proxy target only — production UI must use same-origin / :4350 proxy (not baked loopback).
	const proxyTarget = (env.VITE_HIGHASCG_API_ORIGIN || 'http://127.0.0.1:4200').replace(/\/$/, '')
	const apiOrigin = mode === 'production' ? '' : proxyTarget
	const apiHttp = proxyTarget.startsWith('http') ? proxyTarget : `http://${proxyTarget}`
	const apiWs = apiHttp.replace(/^http/, 'ws')

	return {
		root: 'client',
		base: './',
		plugins: [
			highascgApiOriginPlugin(apiOrigin),
			copyClientStaticTreesPlugin(),
			optionalModulesDevApiPlugin(),
			cgStudioDevApiPlugin(),
		],
		build: {
			outDir: '../dist-web',
			emptyOutDir: true,
			rollupOptions: {
				external: [
					'three',
					'html-to-image',
					'three/addons/controls/OrbitControls.js',
					'three/addons/loaders/GLTFLoader.js',
				],
			},
		},
		optimizeDeps: {
			include: ['grapesjs'],
		},
		server: {
			port: WEBUI_PORT,
			host: true,
			proxy: {
				'/api/ws': { target: apiWs, ws: true },
				'/ws': { target: apiWs, ws: true },
				'/api': { target: apiHttp, changeOrigin: true },
				'/vendor': { target: apiHttp, changeOrigin: true },
				'/template': { target: apiHttp, changeOrigin: true },
				'/templates': { target: apiHttp, changeOrigin: true },
			},
		},
	}
})
