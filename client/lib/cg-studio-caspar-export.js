/**
 * CasparCG HTML template export (WO-32 T0.2).
 * Wraps GrapesJS HTML/CSS into a single deployable file with window.update(json).
 */

/**
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
function escapeJsonForScript(data) {
	return JSON.stringify(data == null ? {} : data).replace(/</g, '\\u003c')
}

/**
 * Build a Caspar-safe single-file HTML template.
 *
 * @param {{
 *   name: string,
 *   html: string,
 *   css: string,
 *   projectData?: object,
 *   fields?: Record<string, string>,
 * }} opts
 * @returns {{ html: string, projectJson: string }}
 */
export function buildCasparTemplateHtml(opts) {
	const name = String(opts.name || 'template').trim() || 'template'
	const bodyHtml = String(opts.html || '').trim()
	const css = String(opts.css || '').trim()
	const fields = opts.fields && typeof opts.fields === 'object' ? opts.fields : {}
	const projectData = opts.projectData != null ? opts.projectData : null

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
* { box-sizing: border-box; }
${css}
</style>
</head>
<body>
${bodyHtml}
<script>
(function () {
  var fields = ${escapeJsonForScript(fields)};
  window.fields = fields;

  function applyField(key, value) {
    if (key == null || key === '') return;
    var el = document.getElementById(String(key));
    if (!el) el = document.querySelector('[data-field="' + String(key).replace(/"/g, '') + '"]');
    if (!el) return;
    if (value && typeof value === 'object' && value.src != null) {
      if (el.tagName === 'IMG') el.src = value.src;
      return;
    }
    var text = value == null ? '' : String(value);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = text;
    else el.textContent = text;
  }

  window.update = function (data) {
    if (!data) return;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { return; }
    }
    if (typeof data !== 'object') return;
    Object.keys(data).forEach(function (k) { applyField(k, data[k]); });
  };

  window.play = function () {};
  window.stop = function () {};
  window.next = function () {};
})();
</script>
</body>
</html>`

	const projectJson = JSON.stringify(
		{
			name,
			version: 1,
			exportedAt: new Date().toISOString(),
			fields,
			projectData,
			html: bodyHtml,
			css,
		},
		null,
		2,
	)

	return { html, projectJson }
}
