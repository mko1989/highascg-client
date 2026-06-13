/**
 * Default CasparCG screen-consumer flags when settings keys are unset.
 * Windowed + borderless, V-sync on when keys are unset.
 */
export const SCREEN_CONSUMER_DEFAULTS = {
	windowed: true,
	borderless: true,
	vsync: true,
}

/**
 * @param {Record<string, unknown>} cs casparServer settings slice
 * @param {number} screenN 1-based screen index
 */
export function screenConsumerFlagsFromCasparServer(cs, screenN) {
	const n = Math.max(1, Number(screenN) || 1)
	const w = cs[`screen_${n}_windowed`]
	const v = cs[`screen_${n}_vsync`]
	const b = cs[`screen_${n}_borderless`]
	return {
		windowed:
			w === undefined || w === null
				? SCREEN_CONSUMER_DEFAULTS.windowed
				: w !== false && w !== 'false',
		vsync:
			v === undefined || v === null ? SCREEN_CONSUMER_DEFAULTS.vsync : v === true || v === 'true',
		borderless:
			b === undefined || b === null
				? SCREEN_CONSUMER_DEFAULTS.borderless
				: b !== false && b !== 'false',
	}
}

/** @param {number} screenN @param {{ windowed?: boolean, borderless?: boolean, vsync?: boolean }} [overrides] */
export function screenConsumerCasparPatch(screenN, overrides = {}) {
	const n = Math.max(1, Number(screenN) || 1)
	const flags = { ...SCREEN_CONSUMER_DEFAULTS, ...overrides }
	return {
		[`screen_${n}_windowed`]: !!flags.windowed,
		[`screen_${n}_borderless`]: !!flags.borderless,
		[`screen_${n}_vsync`]: !!flags.vsync,
	}
}

/** POST /api/settings body fragment for default windowed + borderless + vsync on a screen index. */
export function screenConsumerDefaultsSettingsPatch(screenN, overrides = {}) {
	return { casparServer: screenConsumerCasparPatch(screenN, overrides) }
}

/**
 * Older configs / Caspar templates often persist windowed on + borderless off.
 * Treat that as “never configured” and seed client defaults (borderless on).
 */
export function legacyBorderedWindowConsumer(cs, screenN) {
	const n = Math.max(1, Number(screenN) || 1)
	const w = cs[`screen_${n}_windowed`]
	const windowed =
		w === undefined || w === null ? SCREEN_CONSUMER_DEFAULTS.windowed : w !== false && w !== 'false'
	if (!windowed) return false
	const b = cs[`screen_${n}_borderless`]
	return b === false || b === 'false'
}

export function screenConsumerKeysUnset(cs, screenN) {
	const n = Math.max(1, Number(screenN) || 1)
	return (
		(cs[`screen_${n}_windowed`] === undefined || cs[`screen_${n}_windowed`] === null) &&
		(cs[`screen_${n}_borderless`] === undefined || cs[`screen_${n}_borderless`] === null) &&
		(cs[`screen_${n}_vsync`] === undefined || cs[`screen_${n}_vsync`] === null)
	)
}

/** @returns {boolean} true when a settings write was needed */
export function shouldSeedScreenConsumerDefaults(cs, screenN) {
	return screenConsumerKeysUnset(cs, screenN) || legacyBorderedWindowConsumer(cs, screenN)
}
