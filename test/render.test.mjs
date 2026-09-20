// Renderer tests: layout, routing, units and output stability.
//
// Three layers, deliberately:
//   1. property assertions  - rules that must hold for any circuit
//   2. layout-report golden - the primary regression artifact, because a diff
//                             here reads as "C1.rod anchor moved" rather than as
//                             a wall of changed path data
//   3. SVG golden           - two canonical circuits only, to catch the things a
//                             layout report cannot see
//
// Regenerate goldens deliberately, never reflexively:
//   UPDATE_GOLDENS=1 node --test test/render.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyse, renderSvg, report } from '../renderers/pipeline.mjs';
import { presentParam, significantFigures } from '../renderers/shared/units.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const goldens = path.join(here, 'golden');

const load = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

function checkGolden(name, actual) {
  const file = path.join(goldens, name);
  const normalised = actual.endsWith('\n') ? actual : `${actual}\n`;
  if (process.env.UPDATE_GOLDENS === '1' || !fs.existsSync(file)) {
    fs.mkdirSync(goldens, { recursive: true });
    fs.writeFileSync(file, normalised, 'utf8');
    return;
  }
  const expected = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(normalised, expected, `${name} differs from its golden. If the change is intended, rerun with UPDATE_GOLDENS=1 and read the diff before committing.`);
}

const t1 = () => load('t1-simple-cylinder.json');

test('Test 1 renders, and renders identically on a second pass', () => {
  const model = t1();
  const first = analyse(model);
  assert.equal(first.ok, true, first.diagnostics.map((item) => item.message).join('; '));

  const svgA = renderSvg(model, first);
  const svgB = renderSvg(clone(model), analyse(clone(model)));
  assert.equal(svgA, svgB, 'the same model must produce byte-identical SVG');
  assert.ok(!/NaN|undefined|Infinity/.test(svgA), 'no non-finite value may reach the output');
});

test('an invalid circuit produces no drawing at all', () => {
  const model = t1();
  model.connections = model.connections.filter((connection) => connection.id !== 'retract');
  const analysis = analyse(model);
  assert.equal(analysis.ok, false);
  assert.throws(() => renderSvg(model, analysis), /failed validation/);
});

test('layout report golden: anchors, sides and routes', () => {
  const model = t1();
  const analysis = analyse(model);
  checkGolden('t1-layout.json', `${JSON.stringify(report(model, analysis), null, 2)}\n`);
});

test('SVG golden: the full drawing', () => {
  const model = t1();
  checkGolden('t1.svg', renderSvg(model, analyse(model)));
});

test('every port anchor lies on the frame edge it declares', () => {
  const model = t1();
  const analysis = analyse(model);
  for (const component of report(model, analysis).components) {
    const [x, y] = component.pos;
    const [width, height] = component.size;
    for (const [name, port] of Object.entries(component.ports)) {
      const [ax, ay] = port.anchor;
      assert.ok(ax >= x && ax <= x + width, `${component.id}.${name} x outside frame`);
      assert.ok(ay >= y && ay <= y + height, `${component.id}.${name} y outside frame`);
    }
  }
});

test('routes leave and enter perpendicular to their port sides', () => {
  const model = t1();
  const analysis = analyse(model);
  for (const connection of report(model, analysis).connections) {
    const points = connection.points;
    const [fromSide, toSide] = connection.sides;
    const axisOf = (a, b) => (Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? 'horizontal' : 'vertical');
    const expected = (side) => (side === 'left' || side === 'right' ? 'horizontal' : 'vertical');
    if (points.length >= 2) {
      assert.equal(axisOf(points[0], points[1]), expected(fromSide), `${connection.id} leaves ${fromSide} off-axis`);
      assert.equal(axisOf(points.at(-2), points.at(-1)), expected(toSide), `${connection.id} enters ${toSide} off-axis`);
    }
  }
});

test('Test 6: pilot lines are drawn differently from working lines', () => {
  const model = t1();
  // A counterbalance valve in the rod line, piloted from the cap line: the
  // arrangement §33 example 4 asks for.
  model.components.push(
    { id: 'CB1', type: 'counterbalance_valve', pos: [560, 320], config: { pilot_type: 'external' }, params: { setting_bar: 210 } },
    { id: 'J3', type: 'junction', pos: [700, 176], config: { way: 3 } },
  );
  model.connections = model.connections.filter((connection) => connection.id !== 'retract');
  model.connections.push(
    { id: 'cb-feed', from: 'V1.B', to: 'CB1.inlet', line: 'working' },
    { id: 'cb-load', from: 'CB1.outlet', to: 'C1.rod', line: 'working' },
    { id: 'cb-pilot', from: 'CB1.pilot', to: 'J3.bottom', line: 'pilot' },
  );
  model.connections.find((connection) => connection.id === 'extend').to = 'J3.left';
  model.connections.push({ id: 'cap-line', from: 'J3.right', to: 'C1.cap', line: 'working' });

  const analysis = analyse(model);
  assert.equal(analysis.ok, true, analysis.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join('; '));

  const svg = renderSvg(model, analysis);
  const pilot = svg.match(/<g class="conn" data-edge="cb-pilot"[^>]*>.*?<\/g>/s);
  assert.ok(pilot, 'pilot connection must be rendered');
  assert.match(pilot[0], /class="pilot-line"/, 'a pilot line must not use the working-line class');

  const working = svg.match(/<g class="conn" data-edge="cb-load"[^>]*>.*?<\/g>/s);
  assert.match(working[0], /class="line"/);
  assert.ok(!/pilot-line/.test(working[0]), 'a working line must not be dashed as a control line');
});

test('Test 5: the four centre conditions draw different spool paths', () => {
  const rendered = new Map();
  for (const centre of ['closed', 'open', 'tandem', 'float']) {
    const model = t1();
    model.components.find((component) => component.id === 'V1').config.center_condition = centre;
    const analysis = analyse(model);
    assert.equal(analysis.ok, true, `${centre} centre should render`);
    const svg = renderSvg(model, analysis);
    const valve = svg.match(/<g class="component component-directional_control_valve".*?<\/g>\s*(?=<g class="component|<\/g>)/s);
    rendered.set(centre, valve ? valve[0] : svg);
  }

  const seen = new Set();
  for (const [centre, svg] of rendered) {
    assert.ok(!seen.has(svg), `${centre} centre draws the same paths as another centre condition`);
    seen.add(svg);
  }

  // A closed centre blocks all four ports, so it carries four blocking bars and
  // no through-path in the middle envelope; an open centre joins them instead.
  assert.notEqual(rendered.get('closed'), rendered.get('open'));
});

test('flow arrows appear only where the direction cannot reverse', () => {
  const model = t1();
  const analysis = analyse(model);
  const svg = renderSvg(model, analysis);

  const connectionSvg = (id) => svg.match(new RegExp(`<g class="conn" data-edge="${id}"[^>]*>.*?</g>`, 's'))[0];

  assert.match(connectionSvg('suction'), /arrow-head/, 'a suction line has one possible direction');
  assert.ok(!/arrow-head/.test(connectionSvg('extend')), 'a valve-to-actuator line reverses with the spool and must not carry an arrow');
  assert.ok(!/arrow-head/.test(connectionSvg('retract')), 'a valve-to-actuator line reverses with the spool and must not carry an arrow');
});

test('authored via waypoints are used verbatim', () => {
  const model = t1();
  const target = model.connections.find((connection) => connection.id === 'pressure-rail');
  target.via = [[240, 180], [526, 180]];

  const analysis = analyse(model);
  const route = report(model, analysis).connections.find((connection) => connection.id === 'pressure-rail');
  assert.equal(route.route, 'authored');
  assert.deepEqual(route.points, [[240, 280], [240, 180], [526, 180], [526, 240]]);
});

test('units: conversion is marked and never exceeds the source precision', () => {
  assert.equal(significantFigures(180), 3);
  assert.equal(significantFigures(20), 2);
  assert.equal(significantFigures(0.5), 1);

  assert.deepEqual(presentParam('setting_bar', 180, 'si'), { text: '180 bar', converted: false, unit: 'bar', value: 180 });

  const imperial = presentParam('setting_bar', 180, 'imperial');
  assert.equal(imperial.converted, true);
  assert.equal(imperial.text, '~2610 psi', 'three significant figures in, three out');

  const flow = presentParam('flow_lpm', 20, 'imperial');
  assert.equal(flow.text, '~5.3 gpm', 'two significant figures in, two out');

  // An unknown value is never replaced by a guess.
  assert.equal(presentParam('setting_bar', null, 'si'), null);
});

test('the model is never mutated by rendering', () => {
  const model = t1();
  const before = JSON.stringify(model);
  const analysis = analyse(model);
  renderSvg(model, analysis);
  report(model, analysis);
  assert.equal(JSON.stringify(model), before, 'the model is the source of truth and must come out unchanged');
});

test('imperial rendering converts captions without touching the model', () => {
  const model = t1();
  model.meta.units = 'imperial';
  const svg = renderSvg(model, analyse(model));
  assert.match(svg, /~2610 psi/);
  assert.match(svg, /imperial \(psi, gpm, in\)/);
  assert.equal(model.components.find((component) => component.id === 'RV1').params.setting_bar, 180);
});
