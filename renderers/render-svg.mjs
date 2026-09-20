// SVG renderer.
//
// Takes a validated model plus its layout and emits the schematic. The LLM never
// writes SVG; this file is the only thing that does, which is what makes the
// output deterministic and reviewable.
//
// Styling is ISO-first and monochrome. Line TYPE carries the meaning:
//   continuous  suction, pressure, working, return -- all main lines
//   long dash   pilot / control lines
//   short dash  drain and leakage lines
//   dash-dot    enclosure around a multi-element unit
// Pressure and return are not given different colours or styles, because ISO
// 1219 does not distinguish them graphically and a reader would misread a
// non-standard style as something it is not.

import { group, text, esc, n, arrowhead, segmentDirection } from './shared/svg.mjs';
import { presentParams } from './shared/units.mjs';

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

// Semantic classes only. Colour lives here once, so the same markup renders
// black-on-white standalone and inverts under the viewer's dark theme.
export const STYLESHEET = `
  .hy-root { --ink: #101418; --paper: #ffffff; --faint: #6b7480; }
  .hy-root { background: var(--paper); color: var(--ink); font-family: ${FONT}; }
  .sym, .line, .pilot-line, .drain-line, .enclosure { fill: none; stroke: var(--ink); }
  .sym { stroke-width: 1.4; stroke-linecap: square; stroke-linejoin: miter; }
  .line { stroke-width: 1.6; }
  .pilot-line { stroke-width: 1; stroke-dasharray: 7 4; }
  .drain-line { stroke-width: 1; stroke-dasharray: 2.5 2.5; }
  .enclosure { stroke-width: 1; stroke-dasharray: 9 3 2 3; }
  .element-dash { stroke-dasharray: 3 3; }
  .arrow-head { stroke: none; }
  /* Every caption gets a paper-coloured halo drawn behind its glyphs, so a line
     passing under a label does not run through the text. Cheaper and more
     robust than moving labels around, and it inverts with the theme because the
     halo is the paper colour rather than a fixed white. */
  text { paint-order: stroke; stroke: var(--paper); stroke-width: 3px; stroke-linejoin: round; }
  .tag { font-size: 12px; font-weight: 600; fill: var(--ink); }
  .param { font-size: 10px; fill: var(--faint); }
  .port-label { font-size: 8.5px; fill: var(--faint); stroke-width: 2.5px; }
  .line-label { font-size: 9px; fill: var(--faint); }
  .glyph-text { fill: var(--ink); }
  .title { font-size: 17px; font-weight: 600; fill: var(--ink); }
  .subtitle, .meta-line { font-size: 10.5px; fill: var(--faint); }
  .note-heading { font-size: 10px; font-weight: 600; fill: var(--ink); }
  .note-body { font-size: 9.5px; fill: var(--faint); }
  .frame { fill: none; stroke: var(--ink); stroke-width: 1; }
`;

export const DARK_OVERRIDES = `
  .hy-root { --ink: #e6e9ed; --paper: #11151a; --faint: #98a2ae; }
`;

const LINE_CLASS = {
  suction: 'line',
  pressure: 'line',
  working: 'line',
  return: 'line',
  pilot: 'pilot-line',
  drain: 'drain-line',
};

/**
 * Whether a flow arrow may be drawn on this line.
 *
 * A working line between a directional valve and an actuator reverses with the
 * spool: an arrow on it would simply be false. Arrows go only where direction
 * cannot change -- suction, pump delivery, and flow into the reservoir.
 */
function arrowDirection(route) {
  const { connection } = route;
  if (connection.arrow === 'none') return null;
  if (connection.arrow === 'forward') return 'forward';
  if (connection.line === 'working' || connection.line === 'pilot') return null;

  const fromType = connection.endpoints.from.target.component.type;
  const toType = connection.endpoints.to.target.component.type;
  const fromPort = connection.endpoints.from.port.id;
  const toPort = connection.endpoints.to.port.id;

  if (connection.line === 'suction') return 'forward';
  if (fromType === 'pump' && fromPort === 'outlet') return 'forward';
  if (toType === 'reservoir' && toPort === 'return') return 'forward';
  if (fromType === 'reservoir' && fromPort === 'outlet') return 'forward';
  return null;
}

function pathData(points) {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${n(x)} ${n(y)}`).join(' ');
}

/** Arrowhead two thirds along the route, clear of both ports. */
function routeArrow(points) {
  let total = 0;
  const lengths = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const length = Math.abs(points[index + 1][0] - points[index][0])
      + Math.abs(points[index + 1][1] - points[index][1]);
    lengths.push(length);
    total += length;
  }
  if (total < 40) return '';

  let target = total * 0.6;
  for (let index = 0; index < lengths.length; index += 1) {
    if (target <= lengths[index]) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[index + 1];
      const ratio = lengths[index] === 0 ? 0 : target / lengths[index];
      const x = x1 + (x2 - x1) * ratio;
      const y = y1 + (y2 - y1) * ratio;
      return arrowhead(x, y, segmentDirection(points[index], points[index + 1]), { size: 4.5 });
    }
    target -= lengths[index];
  }
  return '';
}

function renderConnections(layout) {
  return layout.routed.map((route) => {
    const cls = LINE_CLASS[route.connection.line] ?? 'line';
    const arrow = arrowDirection(route) ? routeArrow(route.points) : '';
    const label = route.connection.label ?? '';
    const title = `${route.connection.from} to ${route.connection.to} (${route.connection.line})`;
    const text_ = route.connection.label && route.connection.labelText ? '' : '';
    return `<g class="conn" data-edge="${esc(label)}" data-line="${esc(route.connection.line)}">`
      + `<title>${esc(title)}</title>`
      + `<path class="${cls}" d="${pathData(route.points)}"/>${arrow}${text_}</g>`;
  }).join('');
}

const PORT_LABEL_OFFSET = { left: [-7, 3], right: [7, 3], top: [0, -5], bottom: [0, 11] };
const PORT_LABEL_ANCHOR = { left: 'end', right: 'start', top: 'middle', bottom: 'middle' };

function renderComponent(entry, model) {
  const { component, config, geometry, ports, symbol } = entry;
  const [x, y] = component.pos;
  const children = [symbol.draw({ config, geometry, component })];

  if (geometry.portLabels) {
    for (const port of Object.values(ports)) {
      if (!port.label) continue;
      const [dx, dy] = PORT_LABEL_OFFSET[port.side];
      children.push(text(port.x + dx, port.y + dy, port.label, {
        cls: 'port-label',
        anchor: PORT_LABEL_ANCHOR[port.side],
      }));
    }
  }

  if (geometry.labelAnchor) {
    const anchor = geometry.labelAnchor;
    children.push(text(anchor.x, anchor.y, component.id, { cls: 'tag', anchor: anchor.anchor }));

    const captions = [];
    if (component.label) captions.push(component.label);
    captions.push(...presentParams(component.type, component.params, model.meta.units ?? 'si'));
    captions.slice(0, 2).forEach((caption, index) => {
      children.push(text(anchor.x, anchor.y + 12 + index * 11, caption, {
        cls: 'param',
        anchor: anchor.anchor,
      }));
    });
  }

  return group(children, {
    cls: `component component-${component.type}`,
    id: `component-${component.id}`,
    transform: `translate(${n(x)} ${n(y)})`,
    extra: [['data-focus', component.id], ['data-type', component.type]],
  });
}

/**
 * Assumptions printed on the drawing itself.
 *
 * They are in the model and in validation.md too, but a schematic gets pasted
 * into a report and arrives without either. An assumption that can be separated
 * from the drawing it qualifies is an assumption that will be.
 */
function renderNotes(model, viewBox) {
  const assumptions = model.assumptions ?? [];
  if (!assumptions.length) return { svg: '', height: 0 };

  const lineHeight = 12;
  const left = viewBox.x + 18;
  let cursor = viewBox.y + viewBox.height - 18 - assumptions.length * lineHeight;
  const children = [text(left, cursor - 6, 'Assumptions', { cls: 'note-heading', anchor: 'start' })];

  for (const assumption of assumptions) {
    children.push(text(left, cursor + 6, `${assumption.subject}: ${assumption.statement}`, {
      cls: 'note-body',
      anchor: 'start',
    }));
    cursor += lineHeight;
  }
  return { svg: group(children, { cls: 'notes' }), height: assumptions.length * lineHeight + 18 };
}

function renderTitleBlock(model, viewBox, counts) {
  const right = viewBox.x + viewBox.width - 18;
  const top = viewBox.y + 26;
  const children = [text(right, top, model.meta.title, { cls: 'title', anchor: 'end' })];

  if (model.meta.subtitle) {
    children.push(text(right, top + 16, model.meta.subtitle, { cls: 'subtitle', anchor: 'end' }));
  }

  const identity = [
    model.meta.drawing_number ? `Drawing ${model.meta.drawing_number}` : null,
    model.meta.revision ? `Rev ${model.meta.revision}` : null,
    `Units: ${(model.meta.units ?? 'si') === 'si' ? 'SI (bar, L/min, mm)' : 'imperial (psi, gpm, in)'}`,
    'ISO 1219-style schematic',
  ].filter(Boolean).join('  |  ');

  children.push(text(right, top + (model.meta.subtitle ? 32 : 18), identity, {
    cls: 'meta-line',
    anchor: 'end',
  }));

  if (counts?.warning || counts?.info) {
    const summary = [
      counts.warning ? `${counts.warning} warning${counts.warning === 1 ? '' : 's'}` : null,
      counts.info ? `${counts.info} note${counts.info === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(', ');
    children.push(text(right, top + (model.meta.subtitle ? 46 : 32), `Validation: ${summary} - see validation report`, {
      cls: 'meta-line',
      anchor: 'end',
    }));
  }

  return group(children, { cls: 'title-block' });
}

/**
 * Render the schematic body (everything inside <svg>), plus the viewBox it needs.
 * Kept separate from the document wrapper so the same body can be embedded in the
 * standalone .svg and in the HTML viewer without re-rendering.
 */
export function renderBody(model, resolved, layout, { counts } = {}) {
  const components = [...resolved.values()]
    // Stable paint order by id, so the SVG is byte-identical across runs
    // regardless of Map insertion order.
    .sort((left, right) => (left.component.id < right.component.id ? -1 : 1))
    .map((entry) => renderComponent(entry, model))
    .join('');

  const notes = renderNotes(model, layout.viewBox);

  return [
    `<g class="connections">${renderConnections(layout)}</g>`,
    `<g class="components">${components}</g>`,
    renderTitleBlock(model, layout.viewBox, counts),
    notes.svg,
  ].join('');
}

/** A complete standalone .svg document. */
export function renderSvgDocument(model, resolved, layout, { counts } = {}) {
  const { viewBox } = layout;
  const body = renderBody(model, resolved, layout, { counts });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" role="img"`
      + ` viewBox="${n(viewBox.x)} ${n(viewBox.y)} ${n(viewBox.width)} ${n(viewBox.height)}"`
      + ` width="${n(viewBox.width)}" height="${n(viewBox.height)}" class="hy-root">`,
    `<title>${esc(model.meta.title)}</title>`,
    `<desc>ISO 1219-style hydraulic circuit schematic generated by hydraulify.</desc>`,
    `<style>${STYLESHEET}@media (prefers-color-scheme: dark){${DARK_OVERRIDES}}</style>`,
    `<rect x="${n(viewBox.x)}" y="${n(viewBox.y)}" width="${n(viewBox.width)}" height="${n(viewBox.height)}" fill="var(--paper)"/>`,
    body,
    '</svg>',
    '',
  ].join('\n');
}
