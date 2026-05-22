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
					if (!rel || rel.includes('..')) return next()
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
				fs.cpSync(src, dest, { recursive: true })
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
		plugins: [highascgApiOriginPlugin(apiOrigin), copyClientStaticTreesPlugin()],
		build: {
			outDir: '../dist-web',
			emptyOutDir: true,
			rollupOptions: {
				external: [
					'three',
					'grapesjs',
					'html-to-image',
					'three/addons/controls/OrbitControls.js',
					'three/addons/loaders/GLTFLoader.js',
				],
			},
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
