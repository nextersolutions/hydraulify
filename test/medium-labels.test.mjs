// Medium labels and flow arrows.
//
// ISO 1219 draws every working line alike, so in a drawing with more than one
// fluid the medium is printed where it matters and nowhere else. The tests are
// as much about where labels must NOT appear -- oil-only drawings, shafts,
// short lines between parts of one fluid -- because a drawing labelled
// everywhere is as hard to read as one labelled nowhere.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyse, renderSvg } from '../renderers/pipeline.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const fragment = () => load('test/fixtures/caes-fragment.json');

function render(model) {
  const analysis = analyse(model);
  assert.equal(analysis.ok, true, analysis.diagnostics.filter((item) => item.severity === 'error').map((item) => item.message).join('\n'));
  return { svg: renderSvg(model, analysis), analysis };
}

function connectionGroup(svg, edge) {
  const match = svg.match(new RegExp(`<g class="conn" data-edge="${edge}"[^>]*>([\\s\\S]*?)</g>(?=<g class="conn"|</g>)`));
  assert.ok(match, `connection ${edge} is drawn`);
  return match[1];
}

const labelOf = (svg, edge) => connectionGroup(svg, edge).match(/class="line-label"[^>]*>([^<]*)</)?.[1] ?? null;

/** The direction an arrowhead points: its first vertex is the tip. */
function arrowOf(svg, edge) {
  const polygon = connectionGroup(svg, edge).match(/<polygon points="([^"]+)" class="sym arrow-head"/);
  if (!polygon) return null;
  const [tip, left, right] = polygon[1].split(' ').map((pair) => pair.split(',').map(Number));
  const dx = tip[0] - (left[0] + right[0]) / 2;
  const dy = tip[1] - (left[1] + right[1]) / 2;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

test('a drawing with one fluid prints no medium labels at all', () => {
  // 01 to 05 are oil throughout; 06 and 07 are the mixed ones.
  for (const name of fs.readdirSync(path.join(root, 'examples')).filter((file) => /^0[1-5]-.*\.json$/.test(file))) {
    const { svg } = render(load(`examples/${name}`));
    assert.doesNotMatch(svg, /class="line-label"/, name);
  }
});

test('every line into a component that carries two fluids says which one it carries', () => {
  const { svg } = render(fragment());
  // HX1: air through the process side, cooling water through the utility side.
  assert.equal(labelOf(svg, 'discharge'), 'air');
  assert.equal(labelOf(svg, 'cooled'), 'air');
  assert.equal(labelOf(svg, 'cw-in'), 'water');
  assert.equal(labelOf(svg, 'cw-out'), 'water');
  // HX2: air heated by thermal oil.
  assert.equal(labelOf(svg, 'regulated'), 'air');
  assert.equal(labelOf(svg, 'heat-in'), 'thermal oil');
  assert.equal(labelOf(svg, 'hot-air'), 'air');
});

test('short lines between parts of one fluid, and shafts, stay unlabelled', () => {
  const { svg } = render(fragment());
  assert.equal(labelOf(svg, 'store-out'), null);
  assert.equal(labelOf(svg, 'isolated'), null);
  assert.equal(labelOf(svg, 'drive'), null);
  assert.equal(labelOf(svg, 'output'), null);
});

test('a long run is labelled even away from a change of fluid', () => {
  const model = fragment();
  assert.equal(labelOf(render(model).svg, 'exhaust'), null, 'the exhaust is short as drawn');
  model.components.find((component) => component.id === 'SIL').pos = [1000, 720];
  assert.equal(labelOf(render(model).svg, 'exhaust'), 'air', 'and labelled once it runs long');
});

test('an authored label is drawn, alone in one fluid and with the medium in several', () => {
  const oil = load('examples/02-solenoid-cylinder.json');
  const pressure = oil.connections.find((connection) => connection.line === 'pressure');
  pressure.label = 'HP supply';
  assert.equal(labelOf(render(oil).svg, pressure.id), 'HP supply');

  const mixed = fragment();
  mixed.connections.find((connection) => connection.id === 'discharge').label = 'stage 1';
  mixed.connections.find((connection) => connection.id === 'store-out').label = 'store outlet';
  const { svg } = render(mixed);
  assert.equal(labelOf(svg, 'discharge'), 'stage 1 - air');
  assert.equal(labelOf(svg, 'store-out'), 'store outlet', 'no medium where none is called for');
});

test('a label sits above a horizontal run and beside a vertical one', () => {
  const { svg, analysis } = render(fragment());
  const route = (id) => analysis.layout.routed.find((item) => item.connection.id === id).points;
  const position = (edge) => {
    const match = connectionGroup(svg, edge).match(/<text x="([^"]+)" y="([^"]+)" class="line-label"/);
    return match.slice(1).map(Number);
  };
  for (const edge of ['discharge', 'cooled', 'hot-air', 'cw-in']) {
    const points = route(edge);
    let best = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
      const length = (i) => Math.abs(points[i + 1][0] - points[i][0]) + Math.abs(points[i + 1][1] - points[i][1]);
      if (length(index) > length(best)) best = index;
    }
    const [from, to] = [points[best], points[best + 1]];
    const [x, y] = position(edge);
    if (from[1] === to[1]) assert.ok(y < from[1], `${edge}: above its horizontal run`);
    else assert.ok(x > from[0], `${edge}: right of its vertical run`);
  }
});

test('arrows follow the flow on the air side', () => {
  const { svg } = render(fragment());
  for (const edge of ['intake', 'discharge', 'cooled', 'store-out', 'isolated', 'regulated', 'hot-air', 'exhaust', 'cw-in', 'heat-in']) {
    assert.ok(arrowOf(svg, edge), `${edge} has a fixed direction, so it carries an arrow`);
  }
  assert.equal(arrowOf(svg, 'drive'), null);
});

test('an arrow points the way the flow goes, whichever way round the line was written', () => {
  const forward = fragment();
  const reversed = fragment();
  const exhaust = reversed.connections.find((connection) => connection.id === 'exhaust');
  [exhaust.from, exhaust.to] = [exhaust.to, exhaust.from]; // written silencer -> turbine
  const intake = reversed.connections.find((connection) => connection.id === 'intake');
  [intake.from, intake.to] = [intake.to, intake.from]; // written compressor -> boundary

  // The silencer is below the turbine: the exhaust arrow points down both ways.
  assert.equal(arrowOf(render(forward).svg, 'exhaust'), 'down');
  assert.equal(arrowOf(render(reversed).svg, 'exhaust'), 'down');
  // The intake arrow points away from the ambient boundary both ways. Its
  // screen direction depends on the route, so compare the two drawings.
  assert.equal(arrowOf(render(reversed).svg, 'intake'), arrowOf(render(forward).svg, 'intake'));
});

test('an oil line written backwards gets its arrow the right way round too', () => {
  const model = load('examples/02-solenoid-cylinder.json');
  const tank = model.connections.find((connection) => connection.to.endsWith('.return') && connection.to.startsWith('T1'));
  const before = arrowOf(render(model).svg, tank.id);
  [tank.from, tank.to] = [tank.to, tank.from];
  assert.ok(before, 'the tank return carries an arrow');
  assert.equal(arrowOf(render(model).svg, tank.id), before, 'still pointing into the tank');
});
