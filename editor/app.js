// hydraulify viewer and editor: the page.
//
// Everything that decides what the circuit is lives in the shared modules the
// CLI runs too: ops.mjs changes the model, draft.mjs validates and lays it
// out, render-svg draws it. This file is the page around them -- the camera,
// pointer gestures, panels, dialogs, saving and exports -- and never draws a
// symbol or a line itself.

import { analyseDraft } from './draft.mjs';
import { createHistory } from './history.mjs';
import * as ops from './ops.mjs';
import {
  PALETTE, TYPE_NAMES, LINE_TYPES, SUGGESTED_PARAMS, QUANTITY_FIELDS, quantityOfParam,
  configFields, allParamNames, needsPlacementChoice, configFromChoices, initialAnswers,
  PLACEMENT_CHOICES, applicableOptions, reconcileAnswers, getPath, setPath,
} from './catalog.mjs';
import { renderBody, renderSvgDocument, arrowDirection } from '../renderers/render-svg.mjs';
import { resolveComponent, SYMBOLS } from '../renderers/symbols/index.mjs';
import { parsePortRef } from '../validate/index.mjs';

const GRID = 4;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const RASTER_SCALE = 4;
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
const LOAD_BEARING = {
  directional_control_valve: ['configuration', 'center_condition', 'actuation'],
  cylinder: ['cylinder_type'],
  electrical_machine: ['role'],
};

const $ = (id) => document.getElementById(id);
const snap = (value) => Math.round(value / GRID) * GRID;

const state = {
  model: null,
  draft: null,
  history: null,
  schema: null,
  mode: 'view',
  selection: null, // { kind: 'component', id } | { kind: 'connection', index }
  camera: { x: 0, y: 0, k: 1 },
  gesture: null,
  wiring: null, // click-to-connect: { from, point }
  placing: null, // palette tool: { type }
  file: { handle: null, name: 'model.json' },
  savedJson: '',
  showInfo: false,
  pending: null,
};

// --- small DOM helpers ------------------------------------------------------

function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key === 'html') element.innerHTML = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (value === true) element.setAttribute(key, '');
    else element.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

let toastTimer = null;
function toast(message, { ms = 3800 } = {}) {
  const box = $('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, ms);
}

function hint(message) {
  const box = $('hint');
  box.textContent = message ?? '';
  box.hidden = !message;
}

// --- start ----------------------------------------------------------------------

export async function start() {
  state.model = JSON.parse($('hy-model').textContent);
  state.schema = JSON.parse($('hy-schema').textContent);
  state.file.name = JSON.parse($('hy-source').textContent).name || 'model.json';
  state.history = createHistory(state.model);
  state.draft = analyseDraft(state.model);
  state.savedJson = JSON.stringify(state.model);

  $('canvas').removeAttribute('viewBox');
  buildToolbar();
  buildPalette();
  wireCanvas();
  wireKeyboard();
  window.addEventListener('beforeunload', (event) => {
    if (isDirty()) { event.preventDefault(); event.returnValue = ''; }
  });
  new ResizeObserver(() => applyCamera()).observe($('stage'));

  renderAll();
  fit();
  document.body.dataset.ready = 'true';
  window.hydraulify = testHooks();
}

// --- camera ---------------------------------------------------------------------

function applyCamera() {
  const { x, y, k } = state.camera;
  $('camera').setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
  const label = $('zoom-label');
  if (label) label.textContent = `${Math.round(k * 100)}%`;
}

function stageSize() {
  const rect = $('canvas').getBoundingClientRect();
  return { width: rect.width || 800, height: rect.height || 600, left: rect.left, top: rect.top };
}

function toWorld(event) {
  const { left, top } = stageSize();
  const { x, y, k } = state.camera;
  return [(event.clientX - left - x) / k, (event.clientY - top - y) / k];
}

function fitRect(rect, { max = 2 } = {}) {
  const { width, height } = stageSize();
  const k = Math.max(MIN_ZOOM, Math.min(max, Math.min(width / rect.width, height / rect.height) * 0.94));
  state.camera = {
    k,
    x: (width - rect.width * k) / 2 - rect.x * k,
    y: (height - rect.height * k) / 2 - rect.y * k,
  };
  applyCamera();
}

function fit() {
  if (state.draft?.layout) fitRect(state.draft.layout.viewBox);
}

function zoomBy(factor, around) {
  const { width, height } = stageSize();
  const [cx, cy] = around ?? [width / 2, height / 2];
  const { x, y, k } = state.camera;
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k * factor));
  state.camera = { k: next, x: cx - (cx - x) * (next / k), y: cy - (cy - y) * (next / k) };
  applyCamera();
}

function zoomTo(id) {
  const frame = state.draft.layout?.frames.get(id);
  if (!frame) return;
  const pad = 140;
  fitRect({ x: frame.x - pad, y: frame.y - pad, width: frame.width + pad * 2, height: frame.height + pad * 2 }, { max: 2.2 });
}

// --- model changes --------------------------------------------------------------

function setModel(model) {
  state.model = model;
  state.draft = analyseDraft(model);
}

/** Record an edit: it becomes the current model and an undo step. */
function commit(model, { select } = {}) {
  if (!model) return;
  setModel(model);
  state.history.push(model);
  if (select !== undefined) state.selection = select;
  keepSelectionValid();
  renderAll();
}

/** Show a model while a gesture is still in progress; nothing is recorded. */
function preview(model) {
  state.pending = model;
  if (state.frameRequested) return;
  state.frameRequested = true;
  requestAnimationFrame(() => {
    state.frameRequested = false;
    if (!state.pending) return;
    setModel(state.pending);
    state.pending = null;
    renderDrawing();
    renderOverlay();
  });
}

function flushPreview() {
  if (state.pending) {
    setModel(state.pending);
    state.pending = null;
  }
}

function keepSelectionValid() {
  const selection = state.selection;
  if (!selection) return;
  if (selection.kind === 'component' && !state.model.components.some((component) => component.id === selection.id)) state.selection = null;
  if (selection.kind === 'connection' && !state.model.connections[selection.index]) state.selection = null;
}

function undo() {
  const model = state.history.undo();
  if (!model) return;
  setModel(model);
  keepSelectionValid();
  renderAll();
}

function redo() {
  const model = state.history.redo();
  if (!model) return;
  setModel(model);
  keepSelectionValid();
  renderAll();
}

function isDirty() {
  return JSON.stringify(state.model) !== state.savedJson;
}

function routesByIndex() {
  return new Map((state.draft.layout?.routed ?? []).map((route) => [route.connection.index, route.points]));
}

function routeOf(index) {
  return state.draft.layout?.routed.find((route) => route.connection.index === index) ?? null;
}

function connectionLabel(index) {
  const connection = state.model.connections[index];
  return connection?.id ?? `connections[${index}]`;
}

function connectionIndexByLabel(label) {
  return state.model.connections.findIndex((connection, index) => (connection.id ?? `connections[${index}]`) === label);
}

// --- rendering ------------------------------------------------------------------

function renderAll() {
  renderDrawing();
  renderOverlay();
  renderHeader();
  renderInspector();
  renderDiagnostics();
}

function renderHeader() {
  const { draft, model } = state;
  $('doc-title').textContent = model.meta.title || 'Untitled circuit';
  document.title = `${model.meta.title || 'Untitled circuit'} - hydraulic schematic`;
  const status = $('status');
  status.textContent = draft.status;
  status.dataset.status = draft.status;
  $('dirty').hidden = !isDirty();
  const undoButton = $('btn-undo');
  if (undoButton) {
    undoButton.disabled = !state.history.canUndo;
    $('btn-redo').disabled = !state.history.canRedo;
  }
  const exportable = draft.ok;
  for (const button of document.querySelectorAll('[data-export]')) {
    button.disabled = !exportable;
    button.title = exportable ? '' : `Fix the ${draft.counts?.error ?? 0} error(s) first: an invalid circuit is never exported.`;
  }
}

function renderDrawing() {
  const { draft, model } = state;
  const drawing = $('drawing');
  if (!draft.drawable || !draft.layout) {
    drawing.innerHTML = '';
    hint('The model is too malformed to draw. See the validation panel.');
    return;
  }
  if (!state.placing && !state.wiring) hint(null);
  const { viewBox } = draft.layout;
  const paper = $('paper');
  paper.setAttribute('x', viewBox.x);
  paper.setAttribute('y', viewBox.y);
  paper.setAttribute('width', viewBox.width);
  paper.setAttribute('height', viewBox.height);
  drawing.innerHTML = renderBody(model, draft.resolved, draft.layout, { counts: draft.counts });
  applyFocus();
}

/** In view mode, a selected component lights itself and its neighbours. */
function applyFocus() {
  const drawing = $('drawing');
  const selection = state.selection;
  const focusing = state.mode === 'view' && selection;
  drawing.classList.toggle('focusing', Boolean(focusing));
  if (!focusing) return;
  const lit = new Set();
  const litLines = new Set();
  if (selection.kind === 'component') {
    lit.add(selection.id);
    for (const route of state.draft.layout?.routed ?? []) {
      const ends = [route.connection.endpoints.from.componentId, route.connection.endpoints.to.componentId];
      if (ends.includes(selection.id)) {
        ends.forEach((id) => lit.add(id));
        litLines.add(route.connection.label);
      }
    }
  } else {
    const route = routeOf(selection.index);
    if (route) {
      lit.add(route.connection.endpoints.from.componentId);
      lit.add(route.connection.endpoints.to.componentId);
      litLines.add(route.connection.label);
    }
  }
  for (const element of drawing.querySelectorAll('.component')) {
    element.classList.toggle('lit', lit.has(element.dataset.focus));
  }
  for (const element of drawing.querySelectorAll('.conn')) {
    element.classList.toggle('lit', litLines.has(element.dataset.edge));
  }
}

function pathData(points) {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');
}

function diagnosticTargets(item) {
  const subject = item.subject ?? {};
  const components = new Set();
  const connections = new Set();
  if (subject.component) components.add(subject.component);
  if (subject.port) components.add(String(subject.port).split('.')[0]);
  if (subject.components) String(subject.components).split(',').map((id) => id.trim()).filter(Boolean).forEach((id) => components.add(id));
  if (subject.connection) {
    const index = connectionIndexByLabel(subject.connection);
    if (index >= 0) connections.add(index);
  }
  return { components, connections };
}

function renderOverlay() {
  const { draft, mode, selection } = state;
  const overlay = $('overlay');
  if (!draft.layout) { overlay.innerHTML = ''; return; }
  const parts = [];
  const editing = mode === 'edit';

  // Findings, marked where they are.
  const marked = new Map();
  const markedLines = new Map();
  for (const item of draft.diagnostics) {
    if (item.severity === 'info') continue;
    const { components, connections } = diagnosticTargets(item);
    for (const id of components) if (marked.get(id) !== 'error') marked.set(id, item.severity);
    for (const index of connections) if (markedLines.get(index) !== 'error') markedLines.set(index, item.severity);
  }
  for (const [id, severity] of marked) {
    const frame = draft.layout.frames.get(id);
    if (frame) parts.push(`<rect class="mark ${severity}" x="${frame.x - 5}" y="${frame.y - 5}" width="${frame.width + 10}" height="${frame.height + 10}" rx="4"/>`);
  }
  for (const [index, severity] of markedLines) {
    const route = routeOf(index);
    if (route) parts.push(`<path class="mark-line ${severity}" d="${pathData(route.points)}"/>`);
  }

  // Hit areas: the drawing itself takes no pointer events.
  for (const [id, frame] of draft.layout.frames) {
    parts.push(`<rect class="hit-comp" data-id="${escapeXml(id)}" x="${frame.x - 3}" y="${frame.y - 3}" width="${frame.width + 6}" height="${frame.height + 6}"/>`);
  }
  for (const route of draft.layout.routed) {
    parts.push(`<path class="hit-conn" data-index="${route.connection.index}" d="${pathData(route.points)}"/>`);
  }

  // Selection.
  if (selection?.kind === 'component') {
    const frame = draft.layout.frames.get(selection.id);
    if (frame) parts.push(`<rect class="sel" x="${frame.x - 7}" y="${frame.y - 7}" width="${frame.width + 14}" height="${frame.height + 14}" rx="3"/>`);
  }
  if (selection?.kind === 'connection') {
    const route = routeOf(selection.index);
    if (route) {
      parts.push(`<path class="sel-line" d="${pathData(route.points)}"/>`);
      if (editing) {
        route.points.slice(0, -1).forEach((point, segment) => {
          const next = route.points[segment + 1];
          const horizontal = point[1] === next[1];
          const vertical = point[0] === next[0];
          if (!horizontal && !vertical) return;
          const length = Math.abs(next[0] - point[0]) + Math.abs(next[1] - point[1]);
          if (length < 10) return;
          const cx = (point[0] + next[0]) / 2;
          const cy = (point[1] + next[1]) / 2;
          const [w, hgt] = horizontal ? [12, 6] : [6, 12];
          parts.push(`<rect class="seg-handle ${horizontal ? 'h' : 'v'}" data-seg="${segment}" x="${cx - w / 2}" y="${cy - hgt / 2}" width="${w}" height="${hgt}" rx="2"/>`);
        });
      }
    }
  }

  // Ports, while editing: hollow when free, filled when a line is on them.
  if (editing) {
    const busy = new Set();
    for (const route of draft.layout.routed) {
      for (const end of ['from', 'to']) busy.add(`${route.connection.endpoints[end].componentId}.${route.connection.endpoints[end].port.id}`);
    }
    for (const [id, entry] of draft.resolved) {
      const [px, py] = entry.component.pos;
      if (entry.component.type === 'junction') {
        const port = entry.ports.left;
        const used = ['left', 'right', 'top', 'bottom'].filter((side) => busy.has(`${id}.${side}`));
        parts.push(`<circle class="port${used.length ? ' busy' : ''}" data-ref="${escapeXml(id)}.left" cx="${px + port.x}" cy="${py + port.y}" r="3.5"/>`);
        continue;
      }
      for (const port of Object.values(entry.ports)) {
        const ref = `${id}.${port.id}`;
        parts.push(`<circle class="port${busy.has(ref) ? ' busy' : ''}" data-ref="${escapeXml(ref)}" cx="${px + port.x}" cy="${py + port.y}" r="3.5"><title>${escapeXml(ref)}</title></circle>`);
      }
    }
  }

  parts.push('<g id="transient"></g>');
  overlay.innerHTML = parts.join('');
}

function transient(markup) {
  const layer = $('transient');
  if (layer) layer.innerHTML = markup;
}

// --- toolbar -------------------------------------------------------------------

function menu(id, label, items) {
  const panel = h('div', { class: 'menu', id: `${id}-menu`, role: 'menu', hidden: true }, items);
  const button = h('button', {
    id,
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    onclick: (event) => {
      event.stopPropagation();
      const open = panel.hidden;
      closeMenus();
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    },
  }, label);
  return h('div', { class: 'menu-wrap' }, button, panel);
}

function closeMenus() {
  for (const panel of document.querySelectorAll('.menu')) panel.hidden = true;
  for (const button of document.querySelectorAll('[aria-haspopup]')) button.setAttribute('aria-expanded', 'false');
}

function menuItem(label, hintText, onclick, extra = {}) {
  return h('button', {
    role: 'menuitem',
    onclick: (event) => { closeMenus(); onclick(event); },
    ...extra,
  }, h('span', { text: label }), hintText ? h('small', { text: hintText }) : null);
}

function buildToolbar() {
  const tools = $('tools');
  const search = h('input', {
    type: 'search',
    id: 'search',
    placeholder: 'Find component',
    list: 'search-list',
    'aria-label': 'Find a component',
    onkeydown: (event) => {
      if (event.key === 'Enter') { event.preventDefault(); findComponent(event.target.value); }
      if (event.key === 'Escape') { event.target.value = ''; event.target.blur(); }
    },
    onchange: (event) => findComponent(event.target.value),
  });
  tools.append(
    h('div', { class: 'group' }, search, h('datalist', { id: 'search-list' })),
    h('div', { class: 'group' },
      h('button', { title: 'Zoom out (-)', 'aria-label': 'Zoom out', onclick: () => zoomBy(1 / 1.25) }, '−'),
      h('span', { id: 'zoom-label', class: 'zoom-label' }, '100%'),
      h('button', { title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => zoomBy(1.25) }, '+'),
      h('button', { title: 'Fit the drawing (F)', onclick: fit }, 'Fit')),
    h('span', { class: 'sep' }),
    h('div', { class: 'group edit-only' },
      h('button', { id: 'btn-undo', title: 'Undo (Ctrl+Z)', onclick: undo }, 'Undo'),
      h('button', { id: 'btn-redo', title: 'Redo (Ctrl+Shift+Z)', onclick: redo }, 'Redo')),
    h('button', { id: 'btn-edit', 'aria-pressed': 'false', title: 'Edit the circuit (E)', onclick: () => setMode(state.mode === 'edit' ? 'view' : 'edit') }, 'Edit'),
    menu('btn-file', 'File', [
      menuItem('Save', 'Ctrl+S', () => save()),
      menuItem('Save as…', '', () => save({ as: true })),
      h('hr'),
      menuItem('Open model…', '', openModel),
      menuItem('New circuit', '', newModel),
    ]),
    menu('btn-export', 'Export', [
      menuItem('PNG', 'lossless', () => runExport('png'), { dataset: { export: 'png' } }),
      menuItem('JPEG', 'compact', () => runExport('jpeg'), { dataset: { export: 'jpeg' } }),
      menuItem('WebP', 'modern', () => runExport('webp'), { dataset: { export: 'webp' } }),
      menuItem('SVG', 'vector, as the CLI writes it', () => runExport('svg'), { dataset: { export: 'svg' } }),
      h('hr'),
      menuItem('Copy as PNG', 'clipboard', () => runExport('clipboard'), { dataset: { export: 'clipboard' } }),
      menuItem('Share card', '1200×630 PNG', () => runExport('share-card'), { dataset: { export: 'share-card' } }),
      menuItem('Flow animation', 'WebM, 6 s', () => runExport('webm'), { dataset: { export: 'webm' } }),
    ]),
  );
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.menu-wrap')) closeMenus();
  });
}

function setMode(mode) {
  state.mode = mode;
  document.body.dataset.mode = mode;
  $('btn-edit').setAttribute('aria-pressed', String(mode === 'edit'));
  $('btn-edit').textContent = mode === 'edit' ? 'Done' : 'Edit';
  cancelTransient();
  applyFocus();
  renderOverlay();
  renderInspector();
  renderDiagnostics();
}

function findComponent(query) {
  const text = String(query ?? '').trim().toLowerCase();
  if (!text) return;
  const match = state.model.components.find((component) => component.id.toLowerCase() === text)
    ?? state.model.components.find((component) => [component.id, component.label, TYPE_NAMES[component.type], component.type]
      .some((value) => value && String(value).toLowerCase().includes(text)));
  if (!match) { toast(`Nothing matches "${query}".`); return; }
  selectComponent(match.id);
  zoomTo(match.id);
  pulse(match.id);
}

function pulse(id) {
  const frame = state.draft.layout?.frames.get(id);
  if (!frame) return;
  transient(`<rect class="pulse" x="${frame.x - 10}" y="${frame.y - 10}" width="${frame.width + 20}" height="${frame.height + 20}" rx="6"/>`);
}

function refreshSearchList() {
  const list = $('search-list');
  if (!list) return;
  list.replaceChildren(...state.model.components
    .filter((component) => component.type !== 'junction')
    .map((component) => h('option', { value: component.id }, `${TYPE_NAMES[component.type] ?? component.type}${component.label ? ` - ${component.label}` : ''}`)));
}

// --- palette -------------------------------------------------------------------

function symbolMarkup(type, config = {}, { pad = 6, extraClass = '' } = {}) {
  const component = { id: 'X', type, pos: [0, 0], config };
  const entry = resolveComponent(component);
  const art = entry.symbol.draw({ config: entry.config, geometry: entry.geometry, component, style: { machine: state.model?.meta?.machine_style ?? 'iso1219' } });
  const { width, height } = entry.geometry;
  return { art, width, height, svg: `<svg class="hy-root ${extraClass}" viewBox="${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${art}</svg>` };
}

function buildPalette() {
  const palette = $('palette');
  for (const group of PALETTE) {
    palette.append(h('h2', { text: group.title }));
    const items = h('div', { class: 'items' });
    for (const type of group.types) {
      const defaults = type === 'boundary' ? { direction: 'from', name: 'in' } : {};
      const item = h('button', {
        class: 'palette-item',
        dataset: { type },
        title: `${TYPE_NAMES[type]}: drag onto the drawing, or click and then click where it goes`,
        html: symbolMarkup(type, defaults).svg,
        onpointerdown: (event) => startPaletteDrag(event, type),
      });
      item.append(h('span', { text: TYPE_NAMES[type] }));
      items.append(item);
    }
    palette.append(items);
  }
  palette.append(h('p', { class: 'tip', text: 'Drag from a port to another port to draw a line. Drop on a port that already has one, or on a line, and a junction is inserted.' }));
}

function startPaletteDrag(event, type) {
  if (event.button !== 0) return;
  event.preventDefault();
  state.gesture = { kind: 'palette', type, startX: event.clientX, startY: event.clientY, moved: false };
}

function setPlacingTool(type) {
  state.placing = type ? { type } : null;
  for (const item of document.querySelectorAll('.palette-item')) {
    item.setAttribute('aria-pressed', String(item.dataset.type === type));
  }
  hint(type ? `Click on the drawing to place a ${TYPE_NAMES[type].toLowerCase()}. Esc to cancel.` : null);
  if (!type) transient('');
}

function ghostMarkup(type, world) {
  const defaults = type === 'boundary' ? { direction: 'from', name: 'in' } : {};
  const { art, width, height } = symbolMarkup(type, defaults);
  const x = snap(world[0] - width / 2);
  const y = snap(world[1] - height / 2);
  return `<g class="ghost hy-root" transform="translate(${x} ${y})">${art}</g>`;
}

async function placeAt(type, world) {
  let config = {};
  if (needsPlacementChoice(type)) {
    config = await choosePlacement(type);
    if (!config) return;
  }
  const size = resolveComponent({ id: 'X', type, pos: [0, 0], config }).geometry;
  const pos = [snap(world[0] - size.width / 2), snap(world[1] - size.height / 2)];
  const { model, id } = ops.addComponent(state.model, { type, pos, config });
  commit(model, { select: { kind: 'component', id } });
}

// --- pointer gestures ------------------------------------------------------------

function wireCanvas() {
  const canvas = $('canvas');
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', () => cancelGesture());
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const { left, top } = stageSize();
    zoomBy(Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0016)), [event.clientX - left, event.clientY - top]);
  }, { passive: false });
  canvas.addEventListener('dblclick', (event) => {
    const hit = event.target.closest('.hit-comp');
    if (hit) zoomTo(hit.dataset.id);
  });
}

function onPointerDown(event) {
  if (event.button === 1 || (event.button === 0 && state.spaceHeld)) {
    beginPan(event);
    return;
  }
  if (event.button !== 0) return;
  const world = toWorld(event);
  const target = event.target;
  const editing = state.mode === 'edit';

  if (state.wiring) { finishWire(event, world, state.wiring.from); return; }
  if (state.placing) { const { type } = state.placing; setPlacingTool(null); placeAt(type, world); return; }

  if (editing && target.classList.contains('port')) {
    event.preventDefault();
    state.gesture = { kind: 'wire', from: target.dataset.ref, startX: event.clientX, startY: event.clientY, moved: false };
    return;
  }
  if (editing && target.classList.contains('seg-handle') && state.selection?.kind === 'connection') {
    const route = routeOf(state.selection.index);
    if (!route) return;
    const segment = Number(target.dataset.seg);
    const [a, b] = [route.points[segment], route.points[segment + 1]];
    state.gesture = {
      kind: 'segment', index: state.selection.index, segment, points: route.points,
      horizontal: a[1] === b[1], start: world, original: state.model, moved: false,
    };
    return;
  }
  const componentHit = target.closest('.hit-comp');
  if (componentHit) {
    const id = componentHit.dataset.id;
    selectComponent(id);
    if (editing) state.gesture = { kind: 'move', id, start: world, original: state.model, moved: false, startX: event.clientX, startY: event.clientY };
    return;
  }
  const lineHit = target.closest('.hit-conn');
  if (lineHit) {
    selectConnection(Number(lineHit.dataset.index));
    return;
  }
  beginPan(event, { clearOnClick: true });
}

function beginPan(event, { clearOnClick = false } = {}) {
  state.gesture = { kind: 'pan', startX: event.clientX, startY: event.clientY, camera: { ...state.camera }, moved: false, clearOnClick };
  document.body.classList.add('panning');
}

function moved(gesture, event, threshold = 3) {
  if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > threshold) gesture.moved = true;
  return gesture.moved;
}

function onPointerMove(event) {
  const gesture = state.gesture;
  if (!gesture) {
    if (state.wiring) updateWire(event, state.wiring.from);
    else if (state.placing && event.target.closest?.('#stage')) transient(ghostMarkup(state.placing.type, toWorld(event)));
    return;
  }
  switch (gesture.kind) {
    case 'pan': {
      if (!moved(gesture, event, 2)) return;
      state.camera = { ...gesture.camera, x: gesture.camera.x + event.clientX - gesture.startX, y: gesture.camera.y + event.clientY - gesture.startY };
      applyCamera();
      return;
    }
    case 'move': {
      if (!moved(gesture, event)) return;
      const world = toWorld(event);
      const [dx, dy] = alignedDelta(gesture, world);
      preview(ops.moveComponents(gesture.original, [gesture.id], dx, dy));
      return;
    }
    case 'segment': {
      const world = toWorld(event);
      const delta = snap(gesture.horizontal ? world[1] - gesture.start[1] : world[0] - gesture.start[0]);
      if (!delta && !gesture.moved) return;
      gesture.moved = true;
      const via = ops.dragSegment(gesture.points, gesture.segment, delta);
      preview(ops.setVia(gesture.original, gesture.index, via));
      return;
    }
    case 'wire': {
      moved(gesture, event);
      updateWire(event, gesture.from);
      return;
    }
    case 'palette': {
      if (!moved(gesture, event, 4)) return;
      // Hit-tested by position: a touch keeps delivering to the palette button.
      const over = document.elementFromPoint(event.clientX, event.clientY)?.closest('#stage');
      if (over) transient(ghostMarkup(gesture.type, toWorld(event)));
      else transient('');
      return;
    }
    default:
  }
}

function onPointerUp(event) {
  const gesture = state.gesture;
  state.gesture = null;
  document.body.classList.remove('panning');
  if (!gesture) return;
  switch (gesture.kind) {
    case 'pan':
      if (!gesture.moved && gesture.clearOnClick) clearSelection();
      return;
    case 'move':
    case 'segment':
      if (gesture.moved) {
        flushPreview();
        commit(state.model);
      }
      return;
    case 'wire': {
      if (!gesture.moved) {
        // A click on a port starts a line that follows the pointer to the next click.
        state.wiring = { from: gesture.from };
        hint(`Click the port to connect ${gesture.from} to, or a line to branch into. Esc to cancel.`);
        return;
      }
      finishWire(event, toWorld(event), gesture.from);
      return;
    }
    case 'palette': {
      transient('');
      const over = document.elementFromPoint(event.clientX, event.clientY)?.closest('#stage');
      if (gesture.moved && over) placeAt(gesture.type, toWorld(event));
      else if (!gesture.moved) setPlacingTool(state.placing?.type === gesture.type ? null : gesture.type);
      return;
    }
    default:
  }
}

function cancelGesture() {
  const gesture = state.gesture;
  state.gesture = null;
  document.body.classList.remove('panning');
  if (gesture && (gesture.kind === 'move' || gesture.kind === 'segment')) {
    state.pending = null;
    setModel(gesture.original);
    renderAll();
  }
  transient('');
}

function cancelTransient() {
  cancelGesture();
  state.wiring = null;
  setPlacingTool(null);
  hint(null);
  transient('');
}

/**
 * The drag delta, on the grid, nudged so a port lines up exactly with the
 * port it is joined to when it comes close: square lines read better than
 * lines with a 3px jog in them.
 */
function alignedDelta(gesture, world) {
  let dx = snap(world[0] - gesture.start[0]);
  let dy = snap(world[1] - gesture.start[1]);
  const model = gesture.original;
  const component = model.components.find((item) => item.id === gesture.id);
  if (!component) return [dx, dy];
  let bestX = null;
  let bestY = null;
  for (const connection of model.connections) {
    const ends = [connection.from, connection.to];
    const mine = ends.find((ref) => parsePortRef(ref).componentId === gesture.id);
    const other = ends.find((ref) => parsePortRef(ref).componentId !== gesture.id);
    if (!mine || !other) continue;
    const a = ops.portAnchor(model, mine);
    const b = ops.portAnchor(model, other);
    if (!a || !b) continue;
    const gapX = b.point[0] - (a.point[0] + dx);
    const gapY = b.point[1] - (a.point[1] + dy);
    if (Math.abs(gapX) <= 6 && (bestX === null || Math.abs(gapX) < Math.abs(bestX))) bestX = gapX;
    if (Math.abs(gapY) <= 6 && (bestY === null || Math.abs(gapY) < Math.abs(bestY))) bestY = gapY;
  }
  if (bestX !== null) dx += bestX;
  if (bestY !== null) dy += bestY;
  return [dx, dy];
}

/** What is under the pointer for a line being drawn: a port, or a line to tee into. */
function wireTarget(event, from) {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  if (!element) return null;
  if (element.classList.contains('port') && element.dataset.ref !== from) return { kind: 'port', ref: element.dataset.ref, element };
  const line = element.closest?.('.hit-conn');
  if (line) return { kind: 'line', index: Number(line.dataset.index), element: line };
  const component = element.closest?.('.hit-comp');
  if (component && component.dataset.id !== parsePortRef(from).componentId) {
    const ref = nearestPort(component.dataset.id, toWorld(event));
    if (ref) return { kind: 'port', ref, element: document.querySelector(`.port[data-ref="${CSS.escape(ref)}"]`) };
  }
  return null;
}

/** The port of a component nearest a point, preferring free ones. */
function nearestPort(id, world) {
  const entry = state.draft.resolved.get(id);
  if (!entry) return null;
  let best = null;
  for (const port of Object.values(entry.ports)) {
    const ref = `${id}.${port.id}`;
    const point = [entry.component.pos[0] + port.x, entry.component.pos[1] + port.y];
    const busy = ops.connectionsAtPort(state.model, ref).length > 0 && entry.component.type !== 'junction';
    const distance = Math.hypot(point[0] - world[0], point[1] - world[1]) + (busy ? 1000 : 0);
    if (!best || distance < best.distance) best = { ref, distance };
  }
  return best?.ref ?? null;
}

function updateWire(event, from) {
  const start = ops.portAnchor(state.model, from);
  if (!start) return;
  const world = toWorld(event);
  const [x1, y1] = start.point;
  const horizontalFirst = start.side === 'left' || start.side === 'right';
  const corner = horizontalFirst ? [world[0], y1] : [x1, world[1]];
  for (const element of document.querySelectorAll('.target')) element.classList.remove('target');
  const target = wireTarget(event, from);
  target?.element?.classList.add('target');
  transient(`<path class="rubber" d="M${x1} ${y1} L${corner[0]} ${corner[1]} L${world[0]} ${world[1]}"/>`);
}

function finishWire(event, world, from) {
  state.wiring = null;
  hint(null);
  transient('');
  const target = wireTarget(event, from);
  if (!target) return;
  let result;
  if (target.kind === 'port') {
    result = ops.connectPorts(state.model, from, target.ref, { routes: routesByIndex(), grid: GRID });
  } else {
    const route = routeOf(target.index);
    result = ops.connectToLine(state.model, from, target.index, route?.points, world, { grid: GRID });
  }
  if (result.error) { toast(result.error); renderOverlay(); return; }
  commit(result.model, { select: { kind: 'connection', index: result.index } });
  if (result.junctions?.length) toast(`Junction ${result.junctions.join(', ')} inserted: a port takes one line, so the branch tees off here.`);
}

// --- selection ------------------------------------------------------------------

function selectComponent(id) {
  state.selection = { kind: 'component', id };
  applyFocus();
  renderOverlay();
  renderInspector();
}

function selectConnection(index) {
  state.selection = { kind: 'connection', index };
  applyFocus();
  renderOverlay();
  renderInspector();
}

function clearSelection() {
  if (!state.selection) return;
  state.selection = null;
  applyFocus();
  renderOverlay();
  renderInspector();
}

function deleteSelection() {
  const selection = state.selection;
  if (!selection || state.mode !== 'edit') return;
  if (selection.kind === 'component') commit(ops.deleteComponents(state.model, [selection.id]), { select: null });
  else commit(ops.deleteConnections(state.model, [selection.index]), { select: null });
}

function toggleMirror() {
  const selection = state.selection;
  if (selection?.kind !== 'component' || state.mode !== 'edit') return;
  const component = state.model.components.find((item) => item.id === selection.id);
  commit(ops.setComponentField(state.model, selection.id, ['mirror'], component.mirror ? undefined : true).model);
}

function nudge(dx, dy) {
  const selection = state.selection;
  if (selection?.kind !== 'component' || state.mode !== 'edit') return;
  commit(ops.moveComponents(state.model, [selection.id], dx, dy));
}

// --- keyboard ---------------------------------------------------------------------

function wireKeyboard() {
  window.addEventListener('keydown', (event) => {
    const typing = event.target.closest?.('input, textarea, select, [contenteditable]');
    const ctrl = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') {
      if (typing) return;
      cancelTransient();
      clearSelection();
      closeMenus();
      return;
    }
    if (ctrl && event.key.toLowerCase() === 's') { event.preventDefault(); save(); return; }
    if (typing) return;
    if (event.key === ' ') { state.spaceHeld = true; return; }
    if (ctrl && event.key.toLowerCase() === 'z') { event.preventDefault(); if (state.mode === 'edit') (event.shiftKey ? redo : undo)(); return; }
    if (ctrl && event.key.toLowerCase() === 'y') { event.preventDefault(); if (state.mode === 'edit') redo(); return; }
    if (ctrl) return;
    const step = event.shiftKey ? GRID * 5 : GRID;
    switch (event.key) {
      case 'Delete':
      case 'Backspace': event.preventDefault(); deleteSelection(); break;
      case 'm': case 'M': toggleMirror(); break;
      case 'e': case 'E': setMode(state.mode === 'edit' ? 'view' : 'edit'); break;
      case 'f': case 'F': fit(); break;
      case '+': case '=': zoomBy(1.25); break;
      case '-': case '_': zoomBy(1 / 1.25); break;
      case '/': event.preventDefault(); $('search').focus(); break;
      case 'ArrowLeft': event.preventDefault(); nudge(-step, 0); break;
      case 'ArrowRight': event.preventDefault(); nudge(step, 0); break;
      case 'ArrowUp': event.preventDefault(); nudge(0, -step); break;
      case 'ArrowDown': event.preventDefault(); nudge(0, step); break;
      default:
    }
  });
  window.addEventListener('keyup', (event) => { if (event.key === ' ') state.spaceHeld = false; });
}

// --- inspector ----------------------------------------------------------------------

function field(label, control, { note } = {}) {
  return h('div', { class: 'field' }, h('label', { text: label }), note ? h('div', { class: 'row' }, control, note) : control);
}

function textInput(key, value, onCommit, { disabled, placeholder, maxLength, type = 'text' } = {}) {
  return h('input', {
    type,
    value: value ?? '',
    placeholder,
    maxlength: maxLength,
    disabled,
    dataset: { key },
    onchange: (event) => onCommit(event.target.value),
    onkeydown: (event) => { if (event.key === 'Enter') event.target.blur(); },
  });
}

function selectInput(key, options, value, onCommit, { disabled } = {}) {
  const select = h('select', { disabled, dataset: { key }, onchange: (event) => onCommit(event.target.value) });
  for (const [optionValue, label] of options) {
    select.append(h('option', { value: optionValue, selected: String(optionValue) === String(value ?? '') }, label));
  }
  return select;
}

function renderInspector() {
  const panel = $('inspector');
  const active = document.activeElement?.closest?.('#inspector') ? document.activeElement.dataset.key : null;
  panel.replaceChildren();
  const selection = state.selection;
  if (selection?.kind === 'component') inspectComponent(panel, selection.id);
  else if (selection?.kind === 'connection') inspectConnection(panel, selection.index);
  else inspectDrawing(panel);
  if (active) panel.querySelector(`[data-key="${CSS.escape(active)}"]`)?.focus();
  refreshSearchList();
}

function inspectDrawing(panel) {
  const { model } = state;
  const editing = state.mode === 'edit';
  const disabled = !editing;
  const setMeta = (key) => (value) => commit(ops.setMetaField(state.model, key, value.trim() === '' && key !== 'title' ? undefined : value));
  panel.append(
    h('h2', {}, 'Drawing', h('small', { text: `${model.components.length} components, ${model.connections.length} lines` })),
    field('Title', textInput('meta.title', model.meta.title, setMeta('title'), { disabled, maxLength: 120 })),
    field('Subtitle', textInput('meta.subtitle', model.meta.subtitle, setMeta('subtitle'), { disabled, maxLength: 200 })),
    field('Drawing no.', textInput('meta.drawing_number', model.meta.drawing_number, setMeta('drawing_number'), { disabled, maxLength: 60 })),
    field('Revision', textInput('meta.revision', model.meta.revision, setMeta('revision'), { disabled, maxLength: 20 })),
    field('Units', selectInput('meta.units', [['si', 'SI (bar, L/min, mm)'], ['imperial', 'Imperial (psi, gpm, in)']], model.meta.units ?? 'si', setMeta('units'), { disabled })),
    field('Turbine drawn', selectInput('meta.machine_style', [['iso1219', 'ISO 1219 (fluid power)'], ['iso10628', 'ISO 10628 (process)']], model.meta.machine_style ?? 'iso1219', setMeta('machine_style'), { disabled })),
  );

  panel.append(h('h3', { text: 'Assumptions' }));
  const assumptions = model.assumptions ?? [];
  if (!assumptions.length) panel.append(h('p', { class: 'muted', text: 'None recorded. Every choice made without being stated belongs here: it is printed on the drawing.' }));
  if (!editing) {
    panel.append(h('ul', { class: 'assumption-list' }, assumptions.map((assumption) => h('li', {},
      h('strong', { text: `${assumption.subject}: ` }), assumption.statement,
      assumption.rationale ? h('div', { class: 'muted', text: assumption.rationale }) : null))));
    panel.append(h('p', { class: 'muted', text: 'Select a component or a line to see its details. Press Edit to change the circuit.' }));
    return;
  }
  assumptions.forEach((assumption, index) => {
    const update = (key) => (value) => {
      const next = assumptions.map((item) => ({ ...item }));
      if (value.trim()) next[index][key] = value;
      else if (key === 'rationale') delete next[index][key];
      else return;
      commit(ops.setAssumptions(state.model, next));
    };
    panel.append(h('div', { class: 'stack' },
      h('div', { class: 'row' },
        h('input', { type: 'text', value: assumption.subject, placeholder: 'Subject (V1, circuit)', disabled, dataset: { key: `assumption.${index}.subject` }, onchange: (event) => update('subject')(event.target.value) }),
        editing ? h('button', { class: 'danger', title: 'Remove this assumption', onclick: () => commit(ops.setAssumptions(state.model, assumptions.filter((_, other) => other !== index))) }, '×') : null),
      h('textarea', { placeholder: 'What was assumed', disabled, dataset: { key: `assumption.${index}.statement` }, onchange: (event) => update('statement')(event.target.value) }, assumption.statement),
      h('input', { type: 'text', value: assumption.rationale ?? '', placeholder: 'Why (optional)', disabled, dataset: { key: `assumption.${index}.rationale` }, onchange: (event) => update('rationale')(event.target.value) })));
  });
  panel.append(h('div', { class: 'actions' }, h('button', {
    onclick: () => commit(ops.setAssumptions(state.model, [...assumptions, { subject: 'circuit', statement: 'Describe the assumption.' }])),
  }, 'Add assumption')));
}

function inspectComponent(panel, id) {
  const { model, draft } = state;
  const component = model.components.find((item) => item.id === id);
  const entry = draft.resolved?.get(id);
  if (!component) return;
  const editing = state.mode === 'edit';
  const disabled = !editing;
  const set = (path) => (value) => {
    const result = ops.setComponentField(state.model, id, path, value);
    commit(result.model);
    if (result.removed.length) toast(`Removed ${result.removed.length} line(s) on ports this configuration does not have: ${result.removed.join(', ')}. Undo to restore.`, { ms: 6000 });
  };

  panel.append(h('h2', {}, `${TYPE_NAMES[component.type] ?? component.type}`, h('small', { text: component.type })));

  const idInput = textInput('id', component.id, (value) => {
    const result = ops.renameComponent(state.model, id, value.trim());
    if (result.error) { toast(result.error); renderInspector(); return; }
    commit(result.model, { select: { kind: 'component', id: value.trim() } });
  }, { disabled, maxLength: 32 });
  panel.append(field('Id', idInput));
  if (component.type !== 'junction') {
    panel.append(field('Label', textInput('label', component.label, (value) => set(['label'])(value.trim() || undefined), { disabled, maxLength: 80, placeholder: 'Shown under the id' })));
  }
  const pos = h('div', { class: 'row' },
    textInput('pos.x', component.pos[0], (value) => commit(ops.moveComponentTo(state.model, id, [Number(value) || 0, component.pos[1]])), { disabled, type: 'number' }),
    textInput('pos.y', component.pos[1], (value) => commit(ops.moveComponentTo(state.model, id, [component.pos[0], Number(value) || 0])), { disabled, type: 'number' }));
  panel.append(field('Position', pos));
  if (component.type !== 'junction') {
    panel.append(field('Mirrored', h('input', {
      type: 'checkbox', checked: component.mirror === true, disabled, dataset: { key: 'mirror' },
      onchange: (event) => set(['mirror'])(event.target.checked ? true : undefined),
    })));
  }

  // Config, from the schema.
  const fields = configFields(state.schema, component.type);
  if (fields.length && component.type !== 'junction') {
    panel.append(h('h3', { text: 'Configuration' }));
    const defaults = SYMBOLS.get(component.type)?.defaults ?? {};
    for (const spec of fields) {
      // Only a three-position valve has a centre.
      if (component.type === 'directional_control_valve' && spec.key[0] === 'center_condition' && entry?.config.configuration !== '4/3') continue;
      const stated = getPath(component.config ?? {}, spec.key);
      const effective = entry ? getPath(entry.config, spec.key) : stated;
      const fallback = getPath(defaults, spec.key);
      const loadBearing = (LOAD_BEARING[component.type] ?? []).includes(spec.key[0]);
      const pretty = (value) => String(value).replace(/_/g, ' ');
      const label = spec.key.map((part) => part.replace(/_/g, ' ')).join(' ');
      const key = `config.${spec.key.join('.')}`;
      const note = stated === undefined && loadBearing && !(spec.key[0] === 'center_condition' && entry?.config.configuration !== '4/3')
        ? h('span', { class: 'badge', title: 'Defaulted, not stated. State it, or record an assumption: it changes how the circuit behaves.' }, 'default')
        : null;
      let control;
      if (spec.kind === 'enum') {
        const options = [['', stated === undefined && fallback !== undefined ? `default (${pretty(fallback)})` : stated === undefined ? 'not stated' : 'unset']]
          .concat(spec.options.map((value) => [value, pretty(value)]));
        control = selectInput(key, options, stated ?? '', (value) => {
          const parsed = spec.options.find((option) => String(option) === value);
          set(['config', ...spec.key])(value === '' ? undefined : parsed);
        }, { disabled });
      } else if (spec.kind === 'boolean') {
        control = selectInput(key, [['', `default (${effective ? 'yes' : 'no'})`], ['true', 'yes'], ['false', 'no']], stated === undefined ? '' : String(stated),
          (value) => set(['config', ...spec.key])(value === '' ? undefined : value === 'true'), { disabled });
      } else {
        control = textInput(key, stated, (value) => set(['config', ...spec.key])(value.trim() || undefined), { disabled, maxLength: spec.maxLength ?? undefined });
      }
      if (spec.description) control.title = spec.description;
      panel.append(field(label, control, { note }));
    }
  }

  // Parameters: suggested for this type first, then whatever else is stated.
  const params = component.params ?? {};
  const suggested = SUGGESTED_PARAMS[component.type] ?? [];
  if (suggested.length || Object.keys(params).length) {
    panel.append(h('h3', { text: 'Parameters' }));
    const shown = new Set();
    const units = model.meta.units === 'imperial' ? 'imperial' : 'si';
    const paramRow = (label, name, unit) => {
      shown.add(name);
      const value = params[name];
      const input = textInput(`params.${name}`, value === null || value === undefined ? '' : value, (text) => {
        const trimmed = text.trim();
        if (trimmed === '') { set(['params', name])(undefined); return; }
        const number = Number(trimmed);
        if (!Number.isFinite(number)) { toast(`${label} must be a number.`); renderInspector(); return; }
        set(['params', name])(number);
      }, { disabled, type: 'number', placeholder: value === null ? 'unknown' : 'not stated' });
      const unknown = h('label', { class: 'toggle', title: 'Explicitly unknown: reported as such, never guessed' },
        h('input', { type: 'checkbox', checked: value === null, disabled, dataset: { key: `params.${name}.unknown` }, onchange: (event) => set(['params', name])(event.target.checked ? null : undefined) }), '?');
      panel.append(field(label, h('div', { class: 'row' }, input, h('span', { class: 'unit', text: unit }), unknown)));
    };
    for (const base of suggested) {
      const spec = QUANTITY_FIELDS[base];
      const name = spec.si in params ? spec.si : spec.imperial in params ? spec.imperial : (units === 'imperial' ? spec.imperial : spec.si);
      paramRow(spec.label, name, spec.unit[name === spec.imperial && spec.imperial !== spec.si ? 1 : 0]);
    }
    for (const name of Object.keys(params)) {
      if (shown.has(name)) continue;
      const quantity = quantityOfParam(name);
      paramRow(quantity?.field.label ?? name.replace(/_/g, ' '), name, quantity ? quantity.field.unit[quantity.system === 'imperial' && quantity.field.imperial !== quantity.field.si ? 1 : 0] : '');
    }
    if (editing) {
      const available = allParamNames(state.schema).filter((name) => !(name in params) && !shown.has(name));
      panel.append(field('Add', selectInput('params.add', [['', 'another parameter…'], ...available.map((name) => [name, name])], '', (name) => {
        if (name) set(['params', name])(null);
      })));
    }
  }

  // Ports.
  if (entry && component.type !== 'junction') {
    panel.append(h('h3', { text: 'Ports' }));
    const list = h('ul', { class: 'ports-list' });
    for (const port of Object.values(entry.ports)) {
      const ref = `${id}.${port.id}`;
      const lines = ops.connectionsAtPort(state.model, ref);
      const right = lines.length
        ? h('button', { class: 'linkish', onclick: () => selectConnection(lines[0]) }, connectionLabel(lines[0]))
        : h('label', { class: 'toggle', title: 'Blanked off in the real assembly: never reported as unconnected' },
          h('input', { type: 'checkbox', checked: port.plugged, disabled, dataset: { key: `ports.${port.id}.plugged` }, onchange: (event) => set(['ports', port.id, 'plugged'])(event.target.checked ? true : undefined) }),
          'plugged');
      list.append(h('li', {}, h('span', {}, port.id, h('span', { class: 'muted', text: ` ${port.criticality}` })), right));
    }
    panel.append(list);
  }

  if (component.type !== 'junction') {
    panel.append(h('h3', { text: 'Note' }));
    panel.append(h('textarea', {
      class: 'note', disabled, dataset: { key: 'note' }, maxlength: 200, style: 'width:100%',
      onchange: (event) => set(['note'])(event.target.value.trim() || undefined),
    }, component.note ?? ''));
  }

  if (editing) {
    panel.append(h('div', { class: 'actions' },
      component.type !== 'junction' ? h('button', { onclick: toggleMirror, title: 'M' }, component.mirror ? 'Unmirror' : 'Mirror') : null,
      h('button', { class: 'danger', onclick: deleteSelection, title: 'Delete' }, 'Delete')));
  }
}

function inspectConnection(panel, index) {
  const connection = state.model.connections[index];
  if (!connection) return;
  const editing = state.mode === 'edit';
  const disabled = !editing;
  const route = routeOf(index);
  const set = (key) => (value) => commit(ops.setConnectionField(state.model, index, key, value));
  const endButton = (reference) => h('button', { class: 'linkish', onclick: () => selectComponent(parsePortRef(reference).componentId) }, reference);

  panel.append(h('h2', {}, 'Line', h('small', { text: route?.connection.medium ? `carries ${String(route.connection.medium).replace(/_/g, ' ')}` : '' })));
  panel.append(field('From', endButton(connection.from)));
  panel.append(field('To', endButton(connection.to)));
  panel.append(field('Id', textInput('id', connection.id, (value) => {
    const trimmed = value.trim();
    if (trimmed && (!ops.isValidId(trimmed) || state.model.connections.some((other, otherIndex) => otherIndex !== index && other.id === trimmed))) {
      toast(`${trimmed} is not a valid, unused line id.`);
      renderInspector();
      return;
    }
    set('id')(trimmed || undefined);
  }, { disabled, maxLength: 32 })));
  panel.append(field('Line type', selectInput('line', LINE_TYPES.map((type) => [type, type]), connection.line, set('line'), { disabled })));
  panel.append(field('Label', textInput('label', connection.label, (value) => set('label')(value.trim() || undefined), { disabled, maxLength: 60, placeholder: 'Printed beside the line' })));
  if (connection.line !== 'mechanical') {
    panel.append(field('Arrow', selectInput('arrow', [['auto', 'auto (only where flow cannot reverse)'], ['forward', 'forward'], ['none', 'none']], connection.arrow ?? 'auto',
      (value) => set('arrow')(value === 'auto' ? undefined : value), { disabled })));
  } else {
    panel.append(field('Clutch', h('input', { type: 'checkbox', checked: connection.clutch === true, disabled, dataset: { key: 'clutch' }, onchange: (event) => set('clutch')(event.target.checked ? true : undefined) })));
  }
  panel.append(h('h3', { text: 'Route' }));
  if (connection.via?.length) {
    panel.append(h('p', { class: 'muted', text: `Pinned through ${connection.via.length} waypoint${connection.via.length === 1 ? '' : 's'}.` }));
    if (editing) panel.append(h('div', { class: 'actions' }, h('button', { onclick: () => commit(ops.setVia(state.model, index, null)) }, 'Route automatically')));
  } else {
    panel.append(h('p', { class: 'muted', text: editing ? 'Routed automatically. Drag a handle on the selected line to pin its route.' : 'Routed automatically.' }));
  }
  if (editing) panel.append(h('div', { class: 'actions' }, h('button', { class: 'danger', onclick: deleteSelection }, 'Delete line')));
}

// --- diagnostics --------------------------------------------------------------------

function renderDiagnostics() {
  const panel = $('diagnostics');
  const { draft } = state;
  const counts = draft.counts ?? { error: 0, warning: 0, info: 0 };
  panel.replaceChildren();
  const toggle = h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', checked: state.showInfo, onchange: (event) => { state.showInfo = event.target.checked; renderDiagnostics(); } }),
    `notes (${counts.info})`);
  panel.append(h('h2', {}, 'Validation', h('small', { text: `${counts.error} errors, ${counts.warning} warnings` }), toggle));
  const items = draft.diagnostics.filter((item) => state.showInfo || item.severity !== 'info');
  if (!items.length) {
    panel.append(h('p', { class: counts.error ? 'error-text' : 'clean', text: counts.error ? '' : 'Topologically consistent with the information provided.' }));
    return;
  }
  const list = h('ul', { class: 'diag-list' });
  for (const item of items) {
    const row = h('li', {
      dataset: { severity: item.severity, code: item.code },
      title: (item.supportedFixes ?? []).join('\n'),
      onclick: () => revealDiagnostic(item),
    }, h('span', { class: 'dot' }), h('div', {}, item.message, h('div', { class: 'code', text: item.code })));
    if (state.mode === 'edit' && item.code === 'assumptions/undeclared' && item.subject?.component) {
      row.lastChild.append(h('button', {
        class: 'linkish',
        onclick: (event) => { event.stopPropagation(); recordAssumption(item); },
      }, 'Record as an assumption'));
    }
    list.append(row);
  }
  panel.append(list);
}

function revealDiagnostic(item) {
  const { components, connections } = diagnosticTargets(item);
  const [first] = components;
  if (first && state.draft.layout?.frames.has(first)) {
    selectComponent(first);
    zoomTo(first);
    pulse(first);
  } else if (connections.size) {
    selectConnection([...connections][0]);
  }
}

function recordAssumption(item) {
  const id = item.subject.component;
  const values = item.evidence?.appliedValues ?? {};
  const words = Object.entries(values).map(([key, value]) => `${key.replace(/_/g, ' ')} ${typeof value === 'object' ? JSON.stringify(value) : value}`).join(', ');
  const assumptions = [...(state.model.assumptions ?? []), { subject: id, statement: `Drawn with the default ${words}.` }];
  commit(ops.setAssumptions(state.model, assumptions), { select: null });
  toast(`Assumption recorded for ${id}. Edit its wording under Drawing.`);
}

// --- dialogs --------------------------------------------------------------------

function choosePlacement(type) {
  const dialog = $('chooser');
  let answers = initialAnswers(type);
  return new Promise((resolve) => {
    const preview = h('div', { class: 'preview' });
    const questions = h('div', {});
    const ok = h('button', { class: 'primary', value: 'ok' }, `Place ${TYPE_NAMES[type].toLowerCase()}`);
    const refresh = () => {
      answers = reconcileAnswers(type, answers);
      const config = configFromChoices(type, answers);
      questions.replaceChildren();
      for (const question of PLACEMENT_CHOICES[type]) {
        if (question.when && !question.when(config)) continue;
        const name = question.key.join('.');
        const current = getPath(answers, question.key);
        const set = (value) => { setPath(answers, question.key, value); refresh(); };
        const options = applicableOptions(question, config);
        let control;
        if (question.text) {
          control = h('input', {
            type: 'text', value: current ?? '', maxlength: question.maxLength, name, required: true,
            oninput: (event) => { setPath(answers, question.key, event.target.value); ok.disabled = !String(event.target.value).trim(); },
            // Enter would submit the form's first button, which is Cancel.
            onkeydown: (event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (!ok.disabled) dialog.close('ok');
            },
          });
        } else if (options.length <= 4) {
          control = h('div', {}, options.map((option) => h('label', { class: 'choice' },
            h('input', { type: 'radio', name, value: option.value, checked: option.value === current, onchange: () => set(option.value) }),
            h('span', {}, option.label, option.hint ? h('small', { text: option.hint }) : null))));
        } else {
          control = h('select', { name, onchange: (event) => set(event.target.value) },
            options.map((option) => h('option', { value: option.value, selected: option.value === current }, option.label)));
        }
        questions.append(h('fieldset', {}, h('legend', { text: question.label }), control));
      }
      try {
        preview.innerHTML = symbolMarkup(type, { ...config, ...(type === 'boundary' && !config.name ? { name: '?' } : {}) }).svg;
      } catch {
        preview.textContent = '';
      }
      const missingText = PLACEMENT_CHOICES[type].some((question) => question.text && !String(getPath(answers, question.key) ?? '').trim());
      ok.disabled = missingText;
    };
    const form = h('form', { method: 'dialog' },
      h('h2', { text: `Place a ${TYPE_NAMES[type].toLowerCase()}` }),
      h('p', { class: 'lead', text: 'These choices change how the circuit behaves, so they are asked rather than defaulted. You can change them later in the inspector.' }),
      h('div', { class: 'chooser-body' }, questions, preview),
      h('div', { class: 'buttons' }, h('button', { value: 'cancel', formnovalidate: true }, 'Cancel'), ok));
    dialog.replaceChildren(form);
    refresh();
    dialog.onclose = () => {
      resolve(dialog.returnValue === 'ok' ? configFromChoices(type, answers) : null);
    };
    dialog.returnValue = '';
    dialog.showModal();
  });
}

function confirmDialog(title, message, okLabel = 'Continue') {
  const dialog = $('confirm');
  return new Promise((resolve) => {
    dialog.replaceChildren(h('form', { method: 'dialog' },
      h('h2', { text: title }),
      h('p', { class: 'lead', text: message }),
      h('div', { class: 'buttons' }, h('button', { value: 'cancel' }, 'Cancel'), h('button', { class: 'primary', value: 'ok' }, okLabel))));
    dialog.onclose = () => resolve(dialog.returnValue === 'ok');
    dialog.returnValue = '';
    dialog.showModal();
  });
}

// --- files ------------------------------------------------------------------------

function modelText() {
  return `${JSON.stringify(state.model, null, 2)}\n`;
}

function markSaved() {
  state.savedJson = JSON.stringify(state.model);
  renderHeader();
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function save({ as = false } = {}) {
  const errors = state.draft.counts?.error ?? 0;
  if (errors && !(await confirmDialog('Save with errors?',
    `The circuit has ${errors} error${errors === 1 ? '' : 's'}. It will be saved as it is, and deliver will refuse to draw it until they are fixed.`, 'Save anyway'))) return;
  const text = modelText();
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      if (!state.file.handle || as) {
        state.file.handle = await window.showSaveFilePicker({
          suggestedName: state.file.name,
          types: [{ description: 'hydraulify circuit model', accept: { 'application/json': ['.json'] } }],
        });
      }
      const writable = await state.file.handle.createWritable();
      await writable.write(text);
      await writable.close();
      state.file.name = state.file.handle.name;
      markSaved();
      toast(`Saved ${state.file.name}. Run deliver on it to regenerate the SVG, report and bill of materials.`, { ms: 6000 });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      toast(`Could not write the file (${error?.message ?? error}); downloading it instead.`);
    }
  }
  download(new Blob([text], { type: 'application/json' }), state.file.name);
  markSaved();
}

async function openModel() {
  if (isDirty() && !(await confirmDialog('Discard unsaved changes?', 'Opening another model replaces this one.', 'Open another'))) return;
  let text;
  let handle = null;
  let name;
  try {
    if (typeof window.showOpenFilePicker === 'function') {
      [handle] = await window.showOpenFilePicker({ types: [{ description: 'hydraulify circuit model', accept: { 'application/json': ['.json'] } }] });
      const file = await handle.getFile();
      text = await file.text();
      name = file.name;
    } else {
      const file = await new Promise((resolve) => {
        const input = h('input', { type: 'file', accept: '.json,application/json', onchange: (event) => resolve(event.target.files[0]) });
        input.click();
      });
      if (!file) return;
      text = await file.text();
      name = file.name;
    }
  } catch (error) {
    if (error?.name !== 'AbortError') toast(`Could not open the file: ${error?.message ?? error}`);
    return;
  }
  let model;
  try {
    model = JSON.parse(text);
  } catch (error) {
    toast(`${name} is not JSON: ${error.message}`);
    return;
  }
  if (!model || typeof model !== 'object' || !Array.isArray(model.components) || !Array.isArray(model.connections) || !model.meta) {
    toast(`${name} is not a hydraulify circuit model.`);
    return;
  }
  loadModel(model, { handle, name });
}

function loadModel(model, { handle = null, name = 'model.json' } = {}) {
  state.history.reset(model);
  setModel(model);
  state.selection = null;
  state.file = { handle, name };
  state.savedJson = JSON.stringify(model);
  renderAll();
  fit();
}

async function newModel() {
  if (isDirty() && !(await confirmDialog('Discard unsaved changes?', 'A new circuit replaces this one.', 'Start a new circuit'))) return;
  loadModel(ops.emptyModel(), { name: 'model.json' });
  setMode('edit');
}

// --- exports -----------------------------------------------------------------------

/** The drawing exactly as `render` writes it. Only for a circuit without errors. */
function exportSvg() {
  const { draft, model } = state;
  if (!draft.ok) throw new Error(`The circuit has ${draft.counts.error} error(s). An invalid circuit is never exported.`);
  return renderSvgDocument(model, draft.resolved, draft.layout, { counts: draft.counts });
}

/** Rasters are always ink on paper, whatever the viewer's system theme. */
function lightSvg(svg, width, height) {
  return svg
    .replace(/@media \(prefers-color-scheme: dark\)\{[\s\S]*?\}\s*\}/, '')
    .replace(/(<svg[^>]*?) width="[^"]*" height="[^"]*"/, `$1 width="${width}" height="${height}"`);
}

function loadImage(svgText) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The drawing could not be rasterized.')); };
    image.src = url;
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(`This browser cannot encode ${type}.`))), type, quality);
  });
}

async function rasterize(format) {
  const svg = exportSvg();
  const { width, height } = state.draft.layout.viewBox;
  let scale = RASTER_SCALE;
  while (scale > 1 && width * scale * height * scale > MAX_CANVAS_PIXELS) scale -= 1;
  const image = await loadImage(lightSvg(svg, width * scale, height * scale));
  const canvas = h('canvas', { width: width * scale, height: height * scale });
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const type = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const blob = await canvasBlob(canvas, type, format === 'png' ? undefined : 0.95);
  if (format === 'webp' && blob.type !== 'image/webp') throw new Error('This browser cannot encode WebP; use PNG or JPEG.');
  return blob;
}

function fitText(context, text, maxWidth, size, minimum, weight) {
  let current = size;
  const font = (value) => `${weight} ${value}px 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  context.font = font(current);
  while (current > minimum && context.measureText(text).width > maxWidth) {
    current -= 1;
    context.font = font(current);
  }
  let value = text;
  while (value.length > 1 && context.measureText(value).width > maxWidth) value = `${value.slice(0, -2)}…`;
  return value;
}

async function shareCard() {
  const svg = exportSvg();
  const { width, height } = state.draft.layout.viewBox;
  const W = 1200;
  const H = 630;
  const pad = 44;
  const header = 104;
  const box = { x: pad, y: header, width: W - pad * 2, height: H - header - 46 };
  const scale = Math.min(box.width / width, box.height / height);
  const image = await loadImage(lightSvg(svg, Math.round(width * scale * 2), Math.round(height * scale * 2)));
  const canvas = h('canvas', { width: W, height: H });
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, W, H);
  context.fillStyle = '#15191e';
  context.textBaseline = 'alphabetic';
  context.fillText(fitText(context, state.model.meta.title, W - pad * 2, 30, 18, '700'), pad, 58);
  if (state.model.meta.subtitle) {
    context.fillStyle = '#5d6773';
    context.fillText(fitText(context, state.model.meta.subtitle, W - pad * 2, 15, 11, '400'), pad, 84);
  }
  context.fillStyle = '#d9dde3';
  context.fillRect(pad, header - 8, W - pad * 2, 1);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  context.drawImage(image, box.x + (box.width - drawWidth) / 2, box.y + (box.height - drawHeight) / 2, drawWidth, drawHeight);
  context.fillStyle = '#5d6773';
  context.font = "400 12px 'Helvetica Neue', Helvetica, Arial, sans-serif";
  context.fillText('ISO 1219-style schematic · drawn from a validated model with hydraulify', pad, H - 20);
  return canvasBlob(canvas, 'image/png');
}

function flowRoutes() {
  return (state.draft.layout?.routed ?? [])
    .map((route) => ({ direction: arrowDirection(route), points: route.points }))
    .filter((route) => route.direction)
    .map((route) => (route.direction === 'reverse' ? [...route.points].reverse() : route.points));
}

/**
 * Six seconds of flow, on the lines whose direction the ports make certain --
 * the same lines that carry an arrow. A line through a directional valve
 * reverses with the spool, and the model has no spool position, so it stays
 * still rather than show a flow nobody stated.
 */
async function recordFlow() {
  const flows = flowRoutes();
  if (!flows.length) throw new Error('No line in this circuit has a flow direction the model can back up, so there is nothing to animate.');
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) throw new Error('This browser cannot record video.');
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mime) throw new Error('This browser cannot record WebM.');
  const { x, y, width, height } = state.draft.layout.viewBox;
  const scale = Math.min(2, 1920 / width);
  const W = Math.round((width * scale) / 2) * 2;
  const H = Math.round((height * scale) / 2) * 2;
  const background = await loadImage(lightSvg(exportSvg(), W, H));
  const canvas = h('canvas', { width: W, height: H });
  const context = canvas.getContext('2d');
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const done = new Promise((resolve) => { recorder.onstop = resolve; });
  const started = performance.now();
  const frame = () => {
    const elapsed = performance.now() - started;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(background, 0, 0, W, H);
    context.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
    context.strokeStyle = '#1a5fd6';
    context.lineWidth = 2.2;
    context.lineJoin = 'round';
    context.setLineDash([7, 11]);
    context.lineDashOffset = -(elapsed / 1000) * 36;
    for (const points of flows) {
      context.beginPath();
      points.forEach(([px, py], index) => (index ? context.lineTo(px, py) : context.moveTo(px, py)));
      context.stroke();
    }
    if (elapsed < 6000) requestAnimationFrame(frame);
    else recorder.stop();
  };
  recorder.start(250);
  frame();
  await done;
  return new Blob(chunks, { type: 'video/webm' });
}

function exportName(suffix) {
  const base = state.file.name.replace(/\.json$/i, '') || 'circuit';
  return `${base}${suffix}`;
}

async function exportBlob(format) {
  switch (format) {
    case 'svg': return new Blob([exportSvg()], { type: 'image/svg+xml;charset=utf-8' });
    case 'png':
    case 'jpeg':
    case 'webp': return rasterize(format);
    case 'share-card': return shareCard();
    case 'webm': return recordFlow();
    default: throw new Error(`Unknown export ${format}`);
  }
}

async function runExport(format) {
  try {
    if (format === 'clipboard') {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('This browser does not allow copying images here; download a PNG instead.');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': rasterize('png') })]);
      toast('Copied as PNG.');
      return;
    }
    if (format === 'webm') toast('Recording six seconds of flow…', { ms: 7000 });
    const blob = await exportBlob(format);
    const suffix = { svg: '.svg', png: '.png', jpeg: '.jpg', webp: '.webp', 'share-card': '-card.png', webm: '-flow.webm' }[format];
    download(blob, exportName(suffix));
  } catch (error) {
    console.error(error);
    toast(error?.message ?? String(error), { ms: 6000 });
  }
}

// --- hooks for tests --------------------------------------------------------------

function testHooks() {
  return {
    get model() { return state.model; },
    get draft() { return state.draft; },
    get selection() { return state.selection; },
    get camera() { return { ...state.camera }; },
    exportBlob,
    setMode,
    loadModel,
    undo,
    redo,
    worldToClient([wx, wy]) {
      const { left, top } = stageSize();
      const { x, y, k } = state.camera;
      return [left + x + wx * k, top + y + wy * k];
    },
  };
}
