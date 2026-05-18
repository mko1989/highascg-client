#!/usr/bin/env node
/**
 * Validates that eggs exclude fragments and bootstrap artefacts cover the WO-47 split layout.
 */
import assert from 'node:assert'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(import.meta.url)
const root = join(dirname(here), '..')

const fragmentPath = join(root, 'tools/live-usb/penguins-eggs-exclude-highascg-fragment.list')
const excludesPath = join(root, 'config/bootstrap-rsync-excludes.txt')

/** @param {string} filePath @param {string[]} needles */
function mustContain(filePath, needles) {
	const text = readFileSync(filePath, 'utf8')
	for (const n of needles) {
		assert.ok(text.includes(n), `${filePath}: missing line containing: ${n}`)
	}
}

const eggsNeedles = [
	'home/casparcg/highascg/src',
	'home/casparcg/highascg/tools',
	'home/casparcg/highascg/web',
	'home/casparcg/highascg/work',
	'home/casparcg/highascg/node_modules',
	'home/casparcg/highascg/package.json',
	'home/casparcg/highascg/index.js',
]

const rsyncNeedles = ['config/casparcg.config', 'lib/', 'node_modules/']

mustContain(fragmentPath, eggsNeedles)
mustContain(excludesPath, rsyncNeedles)
assert.ok(existsSync(join(root, 'scripts/highascg-exfat-bootstrap.sh')))
assert.ok(existsSync(join(root, 'docs/WO47_ISO_VS_EXFAT.md')))

console.log('wo47 manifest: OK')
