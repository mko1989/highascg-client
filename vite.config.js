import { defineConfig, loadEnv } from 'vite'

/** @param {string} apiOrigin */
function vendorImportMapEntries(apiOrigin) {
	const o = (apiOrigin || '').replace(/\/$/, '')
	const vp = (p) => (o ? `${o}${p}` : p)
	return {
		three: vp('/vendor/three/build/three.module.js'),
		'three/': vp('/vendor/three/'),
		'three/addons/': vp('/vendor/three/examples/jsm/'),
		grapesjs: vp('/vendor/grapesjs/dist/grapes.mjs'),
		'html-to-image': vp('/vendor/html-to-image/es/index.js'),
	}
}

/** Inject import map + meta for split dev (UI :3000 → API :4200). */
function highascgApiOriginPlugin(apiOrigin) {
	return {
		name: 'highascg-api-origin',
		transformIndexHtml(html) {
			const origin = (apiOrigin || '').replace(/\/$/, '')
			const map = JSON.stringify({ imports: vendorImportMapEntries(origin) }, null, '\t')
			let out = html
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
			const grapesCss = origin ? `${origin}/vendor/grapesjs/dist/css/grapes.min.css` : '/vendor/grapesjs/dist/css/grapes.min.css'
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
	const apiOrigin = (env.VITE_HIGHASCG_API_ORIGIN || 'http://127.0.0.1:4200').replace(/\/$/, '')
	const apiHttp = apiOrigin.startsWith('http') ? apiOrigin : `http://${apiOrigin}`
	const apiWs = apiHttp.replace(/^http/, 'ws')

	return {
		root: 'client',
		base: './',
		plugins: [highascgApiOriginPlugin(apiOrigin)],
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
			port: 3000,
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
