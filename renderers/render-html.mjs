// The HTML artifact: hydraulify's own viewer and editor.
//
// The page runs the same modules as the CLI -- validator, layout, renderer --
// so it cannot draw a circuit differently from `render`, and every edit made
// in it is checked by the rules `validate` applies. Those modules are ES
// modules, and the page is one file that has to work from disk with nothing
// installed, so their sources travel inside it: each one is loaded from a Blob
// URL, with its import specifiers pointed at the Blob URLs of its dependencies.
// The browser does the module work; nothing here transpiles.
//
// The drawing is also rendered here, into the page, so the file shows the
// schematic before any script runs and `check` has something to inspect.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderBody, STYLESHEET } from './render-svg.mjs';
import { esc, n } from './shared/svg.mjs';

const skillRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'editor/app.js';
const IMPORT_RE = /(^|\n)(\s*(?:import|export)\s[^'";]*?from\s*)(['"])([^'"]+)\3/g;

/**
 * The editor's module graph, in dependency order, each source with its
 * relative imports rewritten to `hy:<path from the skill root>`.
 *
 * Refuses anything that is not a relative import: a `node:` builtin or a
 * package would fail in the browser, and would fail silently until someone
 * opened the page.
 */
export function collectModules(entry = ENTRY) {
  const sources = {};
  const order = [];
  const visiting = new Set();

  const visit = (relative) => {
    if (sources[relative] !== undefined) return;
    if (visiting.has(relative)) throw new Error(`editor modules import each other in a cycle through ${relative}`);
    visiting.add(relative);
    const absolute = path.join(skillRoot, relative);
    const source = fs.readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n');
    const dependencies = [];
    const rewritten = source.replace(IMPORT_RE, (match, lead, head, quote, specifier) => {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        throw new Error(`${relative} imports ${specifier}; the editor page can load only the skill's own modules`);
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
      dependencies.push(target);
      return `${lead}${head}${quote}hy:${target}${quote}`;
    });
    for (const dependency of dependencies) visit(dependency);
    visiting.delete(relative);
    sources[relative] = rewritten;
    order.push(relative);
  };

  visit(entry);
  return { entry, order, sources };
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function readAsset(relative) {
  return fs.readFileSync(path.join(skillRoot, relative), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Build the standalone HTML artifact. Deterministic for a given model.
 *
 * @param {object} options.sourceName the model's file name, offered when saving
 */
export function renderHtmlDocument(model, analysis, { sourceName = 'model.json' } = {}) {
  const { viewBox } = analysis.layout;
  const body = renderBody(model, analysis.resolved, analysis.layout, { counts: analysis.counts });
  const schema = JSON.parse(readAsset('schemas/hydraulic-circuit.schema.json'));
  const modules = collectModules();
  const title = esc(model.meta.title);

  const svg = `<svg id="canvas" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}"`
    + ` viewBox="${n(viewBox.x)} ${n(viewBox.y)} ${n(viewBox.width)} ${n(viewBox.height)}">`
    + '<g id="camera">'
    + `<rect id="paper" class="paper" x="${n(viewBox.x)}" y="${n(viewBox.y)}" width="${n(viewBox.width)}" height="${n(viewBox.height)}"/>`
    + `<g id="drawing" class="hy-root">${body}</g>`
    + '<g id="overlay"></g>'
    + '</g></svg>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="hydraulify">
<title>${title} - hydraulic schematic</title>
<style>
${STYLESHEET}
${readAsset('editor/editor.css')}
</style>
</head>
<body data-mode="view">
<header class="bar">
  <div class="doc">
    <h1 id="doc-title">${title}</h1>
    <span id="status" class="status" data-status="${esc(analysis.status)}">${esc(analysis.status)}</span>
    <span id="dirty" class="dirty" hidden>unsaved</span>
  </div>
  <div class="tools" id="tools"></div>
</header>
<main class="workspace">
  <aside id="palette" class="palette" aria-label="Components"></aside>
  <section id="stage" class="stage">
${svg}
    <div id="boot-error" class="boot-error" hidden></div>
    <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
    <div id="hint" class="hint" hidden></div>
  </section>
  <aside id="side" class="side">
    <section id="inspector" class="inspector" aria-label="Properties"></section>
    <section id="diagnostics" class="diagnostics" aria-label="Validation"></section>
  </aside>
</main>
<dialog id="chooser" class="chooser"></dialog>
<dialog id="confirm" class="confirm"></dialog>
<script type="application/json" id="hy-model">${scriptJson(model)}</script>
<script type="application/json" id="hy-source">${scriptJson({ name: sourceName })}</script>
<script type="application/json" id="hy-schema">${scriptJson(schema)}</script>
<script type="application/json" id="hy-modules">${scriptJson(modules)}</script>
<script type="module">
${readAsset('editor/boot.js')}</script>
</body>
</html>
`;
}
