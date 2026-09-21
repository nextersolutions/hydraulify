// The extended accumulator and reservoir.
//
// The accumulator gains a gas port and a direct-contact type for compressed-air
// storage. The tests that matter most here are the backward-compatibility ones:
// an accumulator that does not ask for either must be byte-for-byte the symbol
// it always was, and its liquid side must still resolve to oil.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveComponent, getSymbol } from '../renderers/symbols/index.mjs';
import { CRITICALITY } from '../renderers/symbols/contract.mjs';
import { validateModel } from '../validate/index.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const example05 = () => JSON.parse(fs.readFileSync(path.join(root, 'examples', '05-filtered-power-unit.json'), 'utf8'));
const accumulator = (config) => resolveComponent({ id: 'ACC1', type: 'accumulator', pos: [0, 0], config });
const draw = (config) => {
  const { config: merged, geometry } = accumulator(config);
  return getSymbol('accumulator').draw({ config: merged, geometry, component: { id: 'ACC1' } });
};

test('an accumulator that asks for nothing new keeps its frame and single port', () => {
  const { geometry, ports } = accumulator({});
  assert.equal(geometry.width, 46);
  assert.equal(geometry.height, 68);
  assert.deepEqual(Object.keys(ports), ['inlet']);
  assert.equal(ports.inlet.y, 68);
  assert.equal(ports.inlet.medium, 'liquid');
});

test('a gas port sits on the top edge, in its own group, and is required', () => {
  const { geometry, ports } = accumulator({ gas_port: true });
  assert.equal(geometry.height, 76, 'the shell moves down to make room for the gas connection');
  assert.deepEqual(Object.keys(ports).sort(), ['gas', 'inlet']);

  assert.equal(ports.gas.side, 'top');
  assert.equal(ports.gas.y, 0);
  assert.equal(ports.gas.medium, 'air');
  assert.equal(ports.gas.group, 'gas');
  assert.equal(ports.gas.criticality, CRITICALITY.REQUIRED);

  assert.equal(ports.inlet.y, geometry.height, 'the liquid port stays on the bottom edge');
  assert.equal(ports.inlet.group, 'liquid');
});

test('the gas connection is drawn from the top edge to the shell', () => {
  assert.match(draw({ gas_port: true }), /<line x1="23" y1="0" x2="23" y2="10"/);
  assert.doesNotMatch(draw({}), /y1="0" x2="23" y2="10"/);
});

test('direct contact draws a free surface across the shell, not a separator', () => {
  const svg = draw({ accumulator_type: 'none' });
  assert.match(svg, /<line x1="5" y1="28" x2="41" y2="28"/, 'the liquid level spans the shell wall to wall');
  assert.match(svg, /<polygon/, 'with the level marker');
  assert.doesNotMatch(svg, /<path/, 'and no bladder or diaphragm curve');
});

test('liquid fixes the liquid side; unstated, it inherits', () => {
  assert.equal(accumulator({ liquid: 'water' }).ports.inlet.medium, 'water');
  assert.equal(accumulator({}).ports.inlet.medium, 'liquid');
});

test('the bill of materials says what was chosen', () => {
  const describe = (config) => getSymbol('accumulator').describe({ config: accumulator(config).config });
  assert.equal(describe({}), 'Bladder accumulator');
  assert.equal(describe({ accumulator_type: 'none', gas_port: true, liquid: 'water' }), 'Accumulator, direct gas-liquid contact, water, with gas port');
  assert.equal(describe({ gas_port: true }), 'Bladder accumulator, with gas port');
});

test('schema: a spring- or weight-loaded accumulator cannot declare a gas port', () => {
  for (const kind of ['spring', 'weight']) {
    const model = example05();
    model.components.find((component) => component.id === 'ACC1').config = { accumulator_type: kind, gas_port: true };
    const result = validateModel(model);
    assert.equal(result.stage, 'schema', kind);
    const finding = result.diagnostics.find((item) => item.code === 'schema/const');
    assert.ok(finding, `${kind}: expected a schema/const finding`);
    assert.match(finding.supportedFixes[0], /contains no gas/);
  }
  const model = example05();
  model.components.find((component) => component.id === 'ACC1').config = { accumulator_type: 'spring', gas_port: false };
  assert.equal(validateModel(model).stage, 'topology', 'gas_port: false is always allowed');
});

test('a declared gas port left open is an error, because it contradicts itself', () => {
  const model = example05();
  model.components.find((component) => component.id === 'ACC1').config.gas_port = true;
  const result = validateModel(model);
  assert.equal(result.ok, false);
  const finding = result.diagnostics.find((item) => item.code === 'topology/required-port-unconnected');
  assert.deepEqual([finding.subject.component, finding.subject.port], ['ACC1', 'gas']);
});

test('in a real circuit the gas side carries air while the liquid side stays oil', () => {
  const model = example05();
  const acc = model.components.find((component) => component.id === 'ACC1');
  acc.config.gas_port = true;
  model.components.push({ id: 'PG9', type: 'pressure_gauge', pos: [acc.pos[0], acc.pos[1] - 90] });
  model.connections.push({ id: 'gas-side', from: 'ACC1.gas', to: 'PG9.inlet', line: 'pressure' });

  const result = validateModel(model);
  assert.deepEqual(result.diagnostics.filter((item) => item.severity === 'error'), []);
  const medium = (id) => result.connections.find((connection) => connection.id === id).medium;
  assert.equal(medium('gas-side'), 'air');
  assert.equal(medium(model.connections.find((connection) => connection.to === 'ACC1.inlet').id), 'oil');
  assert.equal(result.groupMedia.get('ACC1#gas'), 'air');
  assert.equal(result.groupMedia.get('ACC1#liquid'), 'oil');
});

test('a water accumulator on an oil reservoir circuit is a conflict naming both', () => {
  const model = example05();
  model.components.find((component) => component.id === 'ACC1').config.liquid = 'water';
  model.components.find((component) => component.id === 'T1').config = { liquid: 'oil' };
  const result = validateModel(model);
  const finding = result.diagnostics.find((item) => item.code === 'media/conflict');
  assert.ok(finding, 'expected a media conflict');
  assert.match(finding.message, /oil \(T1\.outlet, T1\.return\)/);
  assert.match(finding.message, /water \(ACC1\.inlet\)/);
});

test('stating water on one component carries it through the whole circuit it touches', () => {
  // Nothing else in example 05 fixes a liquid, so water is not a conflict: the
  // pump, valves and tank all inherit it. That is the rule working, not a gap.
  const model = example05();
  model.components.find((component) => component.id === 'ACC1').config.liquid = 'water';
  const result = validateModel(model);
  assert.deepEqual(result.diagnostics.filter((item) => item.code.startsWith('media/')), []);
  assert.ok(result.connections.every((connection) => connection.medium === 'water'));
});

test('reservoir: liquid fixes both ports and the description, and oil stays the default', () => {
  const water = resolveComponent({ id: 'T1', type: 'reservoir', pos: [0, 0], config: { liquid: 'water' } });
  assert.equal(water.ports.outlet.medium, 'water');
  assert.equal(water.ports.return.medium, 'water');
  const describe = (config) => getSymbol('reservoir').describe({ config: resolveComponent({ id: 'T1', type: 'reservoir', pos: [0, 0], config }).config });
  assert.equal(describe({ liquid: 'water' }), 'Water reservoir');
  assert.equal(describe({}), 'Hydraulic reservoir');
  assert.equal(describe({ vented: false }), 'Pressurised hydraulic reservoir');
  assert.equal(describe({ vented: false, liquid: 'water' }), 'Pressurised water reservoir');
});
