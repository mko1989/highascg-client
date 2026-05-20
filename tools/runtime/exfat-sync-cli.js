#!/usr/bin/env node
/**
 * WO-47: run exFAT ↔ project mtime sync from the shell (boot hook / manual).
 * Usage: node tools/exfat-sync-cli.js [--dry-run]
 */
'use strict'

const { runExfatSync } = require('../src/system/exfat-sync')

const dryRun = process.argv.includes('--dry-run')

runExfatSync({
	dryRun,
	log: (lvl, m) => {
		if (lvl === 'warn' || lvl === 'error') console.error(m)
		else console.log(m)
	},
})
	.then((r) => {
		console.log(JSON.stringify(r, null, 2))
		const benign =
			!r.errors?.length ||
			(r.errors.length === 1 &&
				/not a mount point|no valid exfat-sync map|no exfat sync map\b/i.test(String(r.errors[0])))
		process.exit(benign ? 0 : 1)
	})
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
