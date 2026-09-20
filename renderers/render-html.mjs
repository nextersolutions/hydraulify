// The HTML viewer artifact.
//
// The schematic SVG is injected into archify's viewer template (vendored in
// assets/viewer-template.html, MIT), which brings pan/zoom, light/dark theming,
// search, focus and export with it.
//
// Two things about that template drive the code below.
//
// It has no optional chaining anywhere: the viewer wires listeners with
// unguarded `getElementById(...)` calls at init. Deleting a toolbar button
// therefore throws a TypeError and takes the whole viewer down with it -- pan,
// zoom, theme, everything. So controls with no hydraulic meaning (visual
// presets, trace motion, brand marks, repository evidence, guided story) are
// HIDDEN with CSS rather than removed. The JS still finds every element it
// expects; the reader is not offered a button that does nothing.
//
// And its visual presets restyle a diagram into gradients and neon, which is the
// opposite of what an engineering drawing should look like. The schematic's own
// stylesheet is injected after the template's, and the preset attribute is
// pinned to classic.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderBody, STYLESHEET, DARK_OVERRIDES } from './render-svg.mjs';
import { esc, n } from './shared/svg.mjs';
import { viewerCatalog, localizeTemplate, resolveLocale } from './shared/viewer-i18n.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(here, '..', 'assets', 'viewer-template.html');

const SVG_SLOT_RE = /      <!-- ARCHIFY:SVG_SLOT_START -->[\s\S]*?      <!-- ARCHIFY:SVG_SLOT_END -->/;
const CARDS_SLOT_RE = /    <!-- ARCHIFY:CARDS_SLOT_START -->[\s\S]*?    <!-- ARCHIFY:CARDS_SLOT_END -->/;
const SUBTITLE_SLOT_RE = /^([ \t]*)<p class="subtitle">\[Subtitle description\]<\/p>[ \t]*(\r?\n)?/m;
const GUIDED_VIEWS_PLACEHOLDER = '<!-- ARCHIFY:GUIDED_VIEWS_DATA -->';
const I18N_PLACEHOLDER = '    <!-- ARCHIFY:I18N_DATA -->';
const SOURCE_EVIDENCE_PLACEHOLDER = '    <!-- ARCHIFY:SOURCE_EVIDENCE_DATA -->';

const HTML_PLACEHOLDER = '<html lang="en" data-theme="dark" data-preset="[VISUAL PRESET]">';
const TITLE_PLACEHOLDER = '<title>[PROJECT NAME] Architecture Diagram</title>';
const H1_PLACEHOLDER = '<h1>[PROJECT NAME] Architecture</h1>';

// Controls the vendored viewer offers that mean nothing for a hydraulic
// schematic. Hidden, not deleted: see the note at the top of this file.
const HIDDEN_CONTROLS = [
  '#btn-preset',
  '.preset-menu',
  '#btn-motion',
  '#btn-semantic-lens',
  '#btn-route-probe',
  '#focus-brand',
  '#focus-repository',
  '#focus-evidence',
  '#focus-evidence-links',
  '.guided-views',
];

const VIEWER_OVERRIDES = `
/* hydraulify: schematic styling, injected after the template's own rules. */
${STYLESHEET}
:root[data-theme="dark"] { ${DARK_OVERRIDES.replace(/\.hy-root\s*\{|\}/g, '')} }
.hy-root { background: transparent; }
.diagram-container svg { background: var(--paper); }

/* Controls with no hydraulic meaning. The elements stay in the DOM because the
   viewer's init does unguarded getElementById lookups and would throw. */
${HIDDEN_CONTROLS.join(',\n')} { display: none !important; }
`;

function serializeScriptJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

/**
 * Cards beside the drawing: what the reader needs to know that the schematic
 * itself does not carry. Validation status, the assumptions, and what is still
 * unspecified -- never decoration.
 */
function buildCards(model, analysis) {
  const cards = [];
  const counts = analysis.counts ?? { error: 0, warning: 0, info: 0 };

  const status = [`Status: ${analysis.status}`];
  if (counts.warning) status.push(`${counts.warning} warning${counts.warning === 1 ? '' : 's'}`);
  if (counts.info) status.push(`${counts.info} note${counts.info === 1 ? '' : 's'}`);
  status.push(`${model.components.length} components, ${model.connections.length} connections`);
  cards.push({ title: 'Validation', items: status });

  const assumptions = model.assumptions ?? [];
  if (assumptions.length) {
    cards.push({
      title: 'Assumptions',
      items: assumptions.map((assumption) => `${assumption.subject}: ${assumption.statement}`),
    });
  }

  const unspecified = (analysis.diagnostics ?? [])
    .filter((item) => item.code === 'parameters/key-unspecified')
    .map((item) => `${item.subject.component}: ${item.subject.parameter}`);
  if (unspecified.length) {
    cards.push({ title: 'Not specified', items: unspecified });
  }

  return cards;
}

function renderCards(cards) {
  if (!cards.length) return '';
  return cards.map((card) => {
    const items = card.items.map((item) => `<li>${esc(item)}</li>`).join('');
    return `<div class="card"><h3>${esc(card.title)}</h3><ul>${items}</ul></div>`;
  }).join('\n');
}

export function loadViewerTemplate() {
  return fs.readFileSync(TEMPLATE_PATH, 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Build the standalone HTML artifact.
 * Deterministic for a given model: no timestamps, no random ids.
 */
export function renderHtmlDocument(model, analysis, { template = loadViewerTemplate() } = {}) {
  for (const [name, pattern] of [
    ['SVG slot', SVG_SLOT_RE],
    ['cards slot', CARDS_SLOT_RE],
    ['subtitle slot', SUBTITLE_SLOT_RE],
  ]) {
    if (!pattern.test(template)) {
      throw new Error(`viewer template is missing its ${name}; assets/viewer-template.html may have been replaced with an incompatible version.`);
    }
  }
  for (const placeholder of [HTML_PLACEHOLDER, TITLE_PLACEHOLDER, H1_PLACEHOLDER, GUIDED_VIEWS_PLACEHOLDER]) {
    if (!template.includes(placeholder)) {
      throw new Error(`viewer template is missing the placeholder ${JSON.stringify(placeholder)}.`);
    }
  }

  const locale = resolveLocale('en');
  const { viewBox } = analysis.layout;
  const body = renderBody(model, analysis.resolved, analysis.layout, { counts: analysis.counts });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="hy-root" role="img"`
    + ` viewBox="${n(viewBox.x)} ${n(viewBox.y)} ${n(viewBox.width)} ${n(viewBox.height)}">`
    + `<title>${esc(model.meta.title)}</title>`
    + `<desc>ISO 1219-style hydraulic circuit schematic generated by hydraulify.</desc>`
    + `${body}</svg>`;

  const subtitle = model.meta.subtitle
    ? `<p class="subtitle">${esc(model.meta.subtitle)}</p>`
    : '';

  const i18nData = `    <script id="archify-i18n-data" type="application/json">${serializeScriptJson({ locale, messages: viewerCatalog(locale) })}</script>`;

  let out = localizeTemplate(template, locale);
  out = out.includes(I18N_PLACEHOLDER)
    ? out.replace(I18N_PLACEHOLDER, () => i18nData)
    : out.replace(GUIDED_VIEWS_PLACEHOLDER, () => `${i18nData}\n    ${GUIDED_VIEWS_PLACEHOLDER}`);

  out = out
    .replace(HTML_PLACEHOLDER, () => '<html lang="en" data-theme="light" data-preset="classic">')
    .replace(TITLE_PLACEHOLDER, () => `<title>${esc(model.meta.title)} - hydraulic schematic</title>`)
    .replace(H1_PLACEHOLDER, () => `<h1>${esc(model.meta.title)}</h1>`)
    .replace(SUBTITLE_SLOT_RE, (_match, indent, newline = '') => (subtitle ? `${indent}${subtitle}${newline}` : ''))
    .replace(SVG_SLOT_RE, () => svg)
    .replace(CARDS_SLOT_RE, () => renderCards(buildCards(model, analysis)))
    .replace(GUIDED_VIEWS_PLACEHOLDER, () => '<script id="archify-guided-views-data" type="application/json">[]</script>')
    .replace(SOURCE_EVIDENCE_PLACEHOLDER, () => '');

  // Schematic styling last, so it wins over the template's diagram rules.
  out = out.replace('</head>', () => `<style>${VIEWER_OVERRIDES}</style>\n</head>`);

  return out;
}
