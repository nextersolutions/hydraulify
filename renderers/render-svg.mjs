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

import { group, text, esc, n, arrowhead, segmentDirection, line, rect } from './shared/svg.mjs';
import { presentParams } from './shared/units.mjs';

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

// Semantic classes only. Colour lives here once, so the same markup renders
// black-on-white standalone and inverts under the viewer's dark theme.
//
// Solid is opted into per element with fill="currentColor", and the rule that
// honours it is load-bearing: a CSS rule always beats an SVG fill attribute, so
// without it the `fill: none` on .sym hollows every solid element. Pump
// triangles then read as pneumatic, junction dots as rings, and arrowheads --
// which have no stroke either -- vanish. That shipped once with every test green,
// because tests read the source; `visual-check` now measures what is painted.
export const STYLESHEET = `
  .hy-root { --ink: #101418; --paper: #ffffff; --faint: #6b7480; }
  .hy-root { background: var(--paper); color: var(--ink); font-family: ${FONT}; }
  .sym, .line, .pilot-line, .drain-line, .enclosure { fill: none; stroke: var(--ink); }
  .sym[fill="currentColor"] { fill: currentColor; }
  .sym { stroke-width: 1.4; stroke-linecap: square; stroke-linejoin: miter; }
  .line { stroke-width: 1.6; }
  .pilot-line { stroke-width: 1; stroke-dasharray: 7 4; }
  .drain-line { stroke-width: 1; stroke-dasharray: 2.5 2.5; }
  .shaft-line, .shaft-core { fill: none; stroke-linejoin: miter; }
  .shaft-line { stroke: var(--ink); stroke-width: 4.4; }
  .shaft-core { stroke: var(--paper); stroke-width: 1.6; stroke-linecap: square; }
  .clutch-gap { fill: var(--paper); stroke: none; }
  .clutch-plate { stroke: var(--ink); stroke-width: 1.6; }
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
  .boundary-text { font-size: 9.5px; fill: var(--ink); }
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

// Ports flow can only leave, and ports flow can only enter. A line touching one
// of these has a direction that cannot reverse, so it may carry an arrow.
const FLOW_OUT = [
  ['pump', ['outlet']],
  ['reservoir', ['outlet']],
  ['compressor', ['outlet']],
  ['turbine', ['exhaust']],
  ['air_receiver', ['outlet']],
  ['heat_exchanger', ['out', 'utility_out']],
  ['pressure_regulator', ['outlet']],
];
const FLOW_IN = [
  ['pump', ['inlet']],
  ['reservoir', ['return']],
  ['compressor', ['inlet']],
  ['turbine', ['inlet']],
  ['air_receiver', ['inlet']],
  ['heat_exchanger', ['in', 'utility_in']],
  ['pressure_regulator', ['inlet']],
  ['silencer', ['inlet']],
];

/**
 * Whether a flow arrow may be drawn on this line, and which way.
 *
 * Returns 'forward' when flow runs from the connection's `from` end to its `to`
 * end, 'reverse' when it runs the other way, or null for no arrow. Direction
 * comes from the ports, not from the order the author wrote the ends in, so a
 * line written from the silencer back to the turbine still points at the
 * silencer.
 */
export function arrowDirection(route) {
  const { connection } = route;
  // A shaft carries torque, not flow: there is no direction of flow to show,
  // and an authored arrow cannot give it one.
  if (connection.line === 'mechanical') return null;
  if (connection.arrow === 'none') return null;
  if (connection.arrow === 'forward') return 'forward';
  // A working line between a directional valve and an actuator reverses with
  // the spool, and a pilot line carries a signal: an arrow on either is false.
  if (connection.line === 'working' || connection.line === 'pilot') return null;

  const { from, to } = connection.endpoints;
  const matches = (end, table) => table.some(([type, ports]) => (
    end.target.component.type === type && ports.includes(end.port.id)
  ));
  if (matches(from, FLOW_OUT) || matches(to, FLOW_IN)) return 'forward';
  if (matches(to, FLOW_OUT) || matches(from, FLOW_IN)) return 'reverse';

  // A boundary says which way the flow crosses it.
  const boundary = (end) => (end.target.component.type === 'boundary' ? end.target.config.direction : null);
  if (boundary(from) === 'from' || boundary(to) === 'to') return 'forward';
  if (boundary(to) === 'from' || boundary(from) === 'to') return 'reverse';

  if (connection.line === 'suction') return 'forward';
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

/**
 * A shaft is the ISO double line. Drawn as a wide ink stroke with a narrow
 * paper stroke along its middle, which leaves two parallel lines -- and unlike
 * two offset polylines it keeps every corner mitred correctly and inverts
 * with the theme. The widths match the double line inside the machine
 * symbols (1.4-wide lines, 3 apart), so a routed shaft continues the one drawn
 * in the symbol. The core has a square cap: with both strokes ending at the
 * same point, anti-aliasing leaves a grey tick across the join, and running the
 * core 0.8 past the end covers it. The core is exactly as wide as the gap
 * between the symbol's own two lines, so the overrun lands only in that gap.
 */
function renderShaft(points) {
  const d = pathData(points);
  return `<path class="shaft-line" d="${d}"/><path class="shaft-core" d="${d}"/>`;
}

/** The longest straight run of a route: where a clutch has room to sit. */
export function longestSegment(points) {
  let best = null;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[index + 1];
    const length = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    // Strictly longer, so the first of two equal runs wins and output is stable.
    if (!best || length > best.length) best = { index, length, from: points[index], to: points[index + 1] };
  }
  return best;
}

/**
 * A clutch: the shaft breaks, and two plates face each other across the gap.
 * The break is what says the coupling can open. Drawn across the middle of
 * the longest straight run, clear of both machines.
 */
function renderClutch(points) {
  const segment = longestSegment(points);
  if (!segment || segment.length < 24) return '';
  const [x1, y1] = segment.from;
  const [x2, y2] = segment.to;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const gap = 3;
  const reach = 7;
  const horizontal = y1 === y2;
  const cut = horizontal
    ? rect(cx - gap, cy - 3, gap * 2, 6, { cls: 'clutch-gap', fill: null })
    : rect(cx - 3, cy - gap, 6, gap * 2, { cls: 'clutch-gap', fill: null });
  const plates = horizontal
    ? line(cx - gap, cy - reach, cx - gap, cy + reach, { cls: 'clutch-plate' })
      + line(cx + gap, cy - reach, cx + gap, cy + reach, { cls: 'clutch-plate' })
    : line(cx - reach, cy - gap, cx + reach, cy - gap, { cls: 'clutch-plate' })
      + line(cx - reach, cy + gap, cx + reach, cy + gap, { cls: 'clutch-plate' });
  return `<g class="clutch">${cut}${plates}</g>`;
}

const MEDIUM_WORDS = {
  oil: 'oil',
  water: 'water',
  thermal_oil: 'thermal oil',
  air: 'air',
  nitrogen: 'nitrogen',
  steam: 'steam',
  flue_gas: 'flue gas',
};

// A run at least this long gets its medium printed even away from a change of
// fluid, so a reader following a long line across a mixed drawing need not
// trace it back to a symbol.
const LONG_RUN = 240;

function routeLength(points) {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    total += Math.abs(points[index + 1][0] - points[index][0]) + Math.abs(points[index + 1][1] - points[index][1]);
  }
  return total;
}

/**
 * Which lines carry their medium in words.
 *
 * ISO 1219 draws air, water and oil lines alike, so in a drawing with more
 * than one fluid a line alone does not say what it carries. It gets said where
 * it matters: on every line into a component that carries a different fluid
 * on another side -- an accumulator's gas and liquid, a heat exchanger's
 * process and utility -- and on long runs. A drawing with one fluid prints
 * none, so every oil-only drawing is exactly what it was.
 */
export function mediumLabelling(layout) {
  const fluid = layout.routed.filter((route) => route.connection.medium && route.connection.medium !== 'mechanical');
  if (new Set(fluid.map((route) => route.connection.medium)).size < 2) return () => false;

  const mediaAt = new Map(); // component id -> fluids on its lines
  for (const route of fluid) {
    for (const end of ['from', 'to']) {
      const id = route.connection.endpoints[end].componentId;
      const media = mediaAt.get(id) ?? new Set();
      media.add(route.connection.medium);
      mediaAt.set(id, media);
    }
  }
  return (route) => {
    const { connection } = route;
    if (!connection.medium || connection.medium === 'mechanical') return false;
    const atChange = ['from', 'to'].some((end) => (mediaAt.get(connection.endpoints[end].componentId)?.size ?? 0) > 1);
    return atChange || routeLength(route.points) >= LONG_RUN;
  };
}

/** The words printed beside a line: what the author wrote, then the medium. */
function lineLabelText(route, withMedium) {
  const words = [route.connection.authoredLabel, withMedium ? MEDIUM_WORDS[route.connection.medium] : null];
  return words.filter(Boolean).join(' - ');
}

/**
 * A line label sits beside the middle of the line's longest straight run:
 * above a horizontal run, to the right of a vertical one. It clears an
 * arrowhead or a clutch drawn on the same run, and carries the text halo, so a
 * line passing under it stays readable.
 */
function renderLineLabel(points, content) {
  if (!content) return '';
  const segment = longestSegment(points);
  if (!segment) return '';
  const cx = (segment.from[0] + segment.to[0]) / 2;
  const cy = (segment.from[1] + segment.to[1]) / 2;
  return segment.from[1] === segment.to[1]
    ? text(cx, cy - 9, content, { cls: 'line-label', anchor: 'middle' })
    : text(cx + 9, cy + 3, content, { cls: 'line-label', anchor: 'start' });
}

function renderConnections(layout) {
  const labelMedium = mediumLabelling(layout);
  return layout.routed.map((route) => {
    const cls = LINE_CLASS[route.connection.line] ?? 'line';
    const direction = arrowDirection(route);
    const arrow = direction ? routeArrow(direction === 'reverse' ? [...route.points].reverse() : route.points) : '';
    const label = route.connection.label ?? '';
    const title = `${route.connection.from} to ${route.connection.to} (${route.connection.line})`;
    const text_ = renderLineLabel(route.points, lineLabelText(route, labelMedium(route)));
    const body = route.connection.line === 'mechanical'
      ? renderShaft(route.points) + (route.connection.clutch ? renderClutch(route.points) : '')
      : `<path class="${cls}" d="${pathData(route.points)}"/>`;
    return `<g class="conn" data-edge="${esc(label)}" data-line="${esc(route.connection.line)}">`
      + `<title>${esc(title)}</title>`
      + `${body}${arrow}${text_}</g>`;
  }).join('');
}

const PORT_LABEL_OFFSET = { left: [-7, 3], right: [7, 3], top: [0, -5], bottom: [0, 11] };
const PORT_LABEL_ANCHOR = { left: 'end', right: 'start', top: 'middle', bottom: 'middle' };

/** Model-wide drawing conventions, handed to every symbol's draw. */
export function drawingStyle(model) {
  return { machine: model.meta?.machine_style ?? 'iso1219' };
}

/**
 * The standard line in the title block. A drawing that borrows a symbol from
 * another standard says so, rather than claiming a convention it does not
 * follow throughout.
 */
function conventionLine(model) {
  const borrowsTurbine = drawingStyle(model).machine === 'iso10628'
    && model.components.some((component) => component.type === 'turbine');
  return borrowsTurbine ? 'ISO 1219-style schematic; turbine per ISO 10628' : 'ISO 1219-style schematic';
}

function renderComponent(entry, model) {
  const { component, config, geometry, ports, symbol } = entry;
  const [x, y] = component.pos;

  // A mirrored symbol is flipped about its own vertical centre line. The port
  // table was mirrored to match in resolveComponent, so the two stay together.
  // Captions are drawn outside this flip: mirrored text is unreadable.
  const style = drawingStyle(model);
  const artwork = geometry.mirrored
    ? `<g transform="translate(${n(geometry.width)} 0) scale(-1 1)">${symbol.draw({ config, geometry, component, style })}</g>`
    : symbol.draw({ config, geometry, component, style });
  const children = [artwork];

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
    conventionLine(model),
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
