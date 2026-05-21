#!/usr/bin/env node
'use strict'

const { spawnSync } = require('child_process')
const path = require('path')

let electron
try {
	electron = require('electron')
} catch {
	console.error(
		'[launcher] Electron is not installed.\n' +
			'  From the repo root run:  npm install\n' +
			'  (electron is an optionalDependency of highascg)\n'
	)
	process.exit(1)
}

const launcherDir = __dirname
const r = spawnSync(electron, [launcherDir], {
	stdio: 'inherit',
	env: process.env,
	cwd: path.resolve(launcherDir, '../../..'),
})
process.exit(typeof r.status === 'number' ? r.status : 1)
