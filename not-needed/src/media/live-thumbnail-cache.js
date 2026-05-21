'use strict'

async function handleLiveThumbnailGet(ctx, ch, query) {
	return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not implemented' }) }
}

async function handleLiveThumbnailCapturePost(body, ctx) {
	return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not implemented' }) }
}

async function handleLiveThumbnailUploadPost(req, query, ctx) {
	return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not implemented' }) }
}

module.exports = {
	handleLiveThumbnailGet,
	handleLiveThumbnailCapturePost,
	handleLiveThumbnailUploadPost,
}
