import { defineConfig } from 'vite'

export default defineConfig({
	root: 'client',
	base: './',
	build: {
		outDir: '../dist-web',
		emptyOutDir: true,
		rollupOptions: {
			external: [
				'three',
				'grapesjs',
				'html-to-image',
				'three/addons/controls/OrbitControls.js',
				'three/addons/loaders/GLTFLoader.js'
			]
		}
	},
	server: {
		port: 3000,
		host: true,
		proxy: {
			'/api/ws': {
				target: 'ws://localhost:8000',
				ws: true
			},
			'/ws': {
				target: 'ws://localhost:8000',
				ws: true
			},
			'/api': {
				target: 'http://localhost:8000',
				changeOrigin: true
			},
			'/vendor': {
				target: 'http://localhost:8000',
				changeOrigin: true
			},
			'/template': {
				target: 'http://localhost:8000',
				changeOrigin: true
			},
			'/templates': {
				target: 'http://localhost:8000',
				changeOrigin: true
			}
		}
	}
})
