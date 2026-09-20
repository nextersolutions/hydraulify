// Deterministic SVG primitives.
//
// Determinism is a hard requirement: the same model must produce byte-identical
// output on every platform and Node version, because golden SVGs are compared
// byte for byte. Two rules enforce it here:
//   1. every number goes through n(), which rounds to 2 decimals and kills -0
//   2. attributes are emitted in a fixed declaration order, never from object
//      iteration of caller-supplied maps
//
// Styling is semantic: elements carry classes, never inline colours, so the same
// SVG renders black-on-white standalone and inverts inside the HTML viewer.

const DECIMALS = 2;

/** Deterministic number formatting: 2 decimals, trailing zeros stripped, no -0. */
export function n(value) {
  if (!Number.isFinite(value)) throw new Error(`svg: non-finite coordinate ${value}`);
  const rounded = Number(value.toFixed(DECIMALS));
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  return String(safe);
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function attrs(pairs) {
  return pairs
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}="${typeof value === 'number' ? n(value) : esc(value)}"`)
    .join(' ');
}

export function line(x1, y1, x2, y2, { cls = 'sym', extra = [] } = {}) {
  return `<line ${attrs([['x1', x1], ['y1', y1], ['x2', x2], ['y2', y2], ['class', cls], ...extra])}/>`;
}

export function polyline(points, { cls = 'sym', fill = 'none', extra = [] } = {}) {
  const d = points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
  return `<polyline ${attrs([['points', d], ['class', cls], ['fill', fill], ...extra])}/>`;
}

export function polygon(points, { cls = 'sym', fill = 'none', extra = [] } = {}) {
  const d = points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
  return `<polygon ${attrs([['points', d], ['class', cls], ['fill', fill], ...extra])}/>`;
}

export function rect(x, y, width, height, { cls = 'sym', fill = 'none', rx, extra = [] } = {}) {
  return `<rect ${attrs([['x', x], ['y', y], ['width', width], ['height', height], ['rx', rx], ['class', cls], ['fill', fill], ...extra])}/>`;
}

export function circle(cx, cy, r, { cls = 'sym', fill = 'none', extra = [] } = {}) {
  return `<circle ${attrs([['cx', cx], ['cy', cy], ['r', r], ['class', cls], ['fill', fill], ...extra])}/>`;
}

export function path(d, { cls = 'sym', fill = 'none', extra = [] } = {}) {
  return `<path ${attrs([['d', d], ['class', cls], ['fill', fill], ...extra])}/>`;
}

export function text(x, y, content, {
  cls = 'label',
  anchor = 'middle',
  baseline,
  size,
  extra = [],
} = {}) {
  return `<text ${attrs([
    ['x', x], ['y', y],
    ['class', cls],
    ['text-anchor', anchor],
    ['dominant-baseline', baseline],
    ['font-size', size],
    ...extra,
  ])}>${esc(content)}</text>`;
}

export function group(children, { cls, id, transform, extra = [] } = {}) {
  const body = children.filter(Boolean).join('');
  const header = attrs([['id', id], ['class', cls], ['transform', transform], ...extra]);
  return header ? `<g ${header}>${body}</g>` : `<g>${body}</g>`;
}

/**
 * An arrowhead drawn as explicit geometry rather than a marker.
 *
 * Markers would be terser, but a marker is scaled by stroke width and rotated by
 * the renderer, which makes its rendered size implementation-defined across
 * viewers. A schematic's arrowheads carry meaning, so they are drawn as real
 * triangles at a fixed size.
 */
export function arrowhead(x, y, direction, { size = 5, cls = 'sym arrow-head' } = {}) {
  const vectors = {
    right: [[0, 0], [-size * 1.6, -size * 0.7], [-size * 1.6, size * 0.7]],
    left: [[0, 0], [size * 1.6, -size * 0.7], [size * 1.6, size * 0.7]],
    down: [[0, 0], [-size * 0.7, -size * 1.6], [size * 0.7, -size * 1.6]],
    up: [[0, 0], [-size * 0.7, size * 1.6], [size * 0.7, size * 1.6]],
  };
  const shape = vectors[direction];
  if (!shape) throw new Error(`svg: unknown arrow direction ${direction}`);
  return polygon(shape.map(([dx, dy]) => [x + dx, y + dy]), { cls, fill: 'currentColor' });
}

/** Direction of travel from one point to the next, for arrowhead placement. */
export function segmentDirection([x1, y1], [x2, y2]) {
  if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) return x2 >= x1 ? 'right' : 'left';
  return y2 >= y1 ? 'down' : 'up';
}
