// Validation rules per fluid, for shafts, and for heat sources.
//
// Each rule gets a case where it must fire and a case where it must stay quiet.
// The quiet cases matter as much: a rule that fires on a correct plant teaches
// people to ignore the validator. Two tests pin the reason paths are traced per
// fluid at all -- the old component-level trace passed both of them.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateModel } from '../validate/index.mjs';
import { analyse } from '../renderers/pipeline.mjs';
import { topologyChecklist } from '../validate/report.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const fragment = () => load('test/fixtures/caes-fragment.json');
const codes = (model) => validateModel(model).diagnostics.map((item) => item.code);
const find = (model, code) => validateModel(model).diagnostics.filter((item) => item.code === code);
const component = (model, id) => model.components.find((item) => item.id === id);
const connection = (model, id) => model.connections.find((item) => item.id === id);

test('the compressed-air fragment raises no path, shaft or media findings', () => {
  const found = codes(fragment()).filter((code) => !code.startsWith('parameters/'));
  assert.deepEqual(found, []);
});

test('hydraulic examples keep exactly the findings they had', () => {
  for (const name of fs.readdirSync(path.join(root, 'examples')).filter((file) => file.endsWith('.json'))) {
    const found = codes(load(`examples/${name}`));
    assert.ok(!found.some((code) => /^(pneumatic|mechanical|media)\//.test(code)), `${name}: ${found.join(', ')}`);
  }
});

// --- liquids ---------------------------------------------------------------------

test('no-reservoir fires for liquid with nowhere to come from, and names the liquid', () => {
  const model = load('examples/02-solenoid-cylinder.json');
  model.components = model.components.filter((item) => item.id !== 'T1');
  model.connections = model.connections.filter((item) => !item.from.startsWith('T1.') && !item.to.startsWith('T1.'));
  const [finding] = find(model, 'hydraulic/no-reservoir');
  assert.ok(finding, 'expected no-reservoir');
  assert.match(finding.message, /carries oil/);
});

test('no-reservoir stays quiet when liquid lines end on boundaries, or there is no liquid at all', () => {
  // The fragment's cooling water and thermal oil come from and go to boundaries.
  assert.equal(find(fragment(), 'hydraulic/no-reservoir').length, 0);
  // An air-only drawing has nothing to return to a tank.
  const air = fragment();
  const liquidIds = new Set(['CWS', 'CWR', 'TES', 'TESR']);
  air.components = air.components.filter((item) => !liquidIds.has(item.id));
  air.connections = air.connections.filter((item) => !['cw-in', 'cw-out', 'heat-in', 'heat-out'].includes(item.id));
  assert.equal(find(air, 'hydraulic/no-reservoir').length, 0);
});

test('a pump cannot reach a tank through the far side of a heat exchanger', () => {
  // The old trace joined components by any line, so P1 -> HX1 -> T1 "reached"
  // the tank. The oil in the utility loop never touches it.
  const model = {
    schema_version: 1,
    diagram_type: 'hydraulic_circuit',
    meta: { title: 'Utility loop' },
    components: [
      { id: 'T1', type: 'reservoir', pos: [40, 300] },
      { id: 'HX1', type: 'heat_exchanger', pos: [200, 160], config: { function: 'cooling' } },
      { id: 'P1', type: 'pump', pos: [400, 160] },
    ],
    connections: [
      { id: 'out', from: 'T1.outlet', to: 'HX1.in', line: 'suction' },
      { id: 'back', from: 'HX1.out', to: 'T1.return', line: 'return' },
      { id: 'loop-a', from: 'HX1.utility_out', to: 'P1.inlet', line: 'suction' },
      { id: 'loop-b', from: 'P1.outlet', to: 'HX1.utility_in', line: 'pressure' },
    ],
  };
  const [finding] = find(model, 'hydraulic/pump-without-source');
  assert.ok(finding, 'the pump in the utility loop has no traceable tank');
  assert.equal(finding.subject.component, 'P1');
});

test('a tank with no pump on it needs no return line', () => {
  // A compensation basin fills and empties through one line.
  const model = fragment();
  model.components.push(
    { id: 'BASIN', type: 'reservoir', pos: [1200, 600], config: { liquid: 'water' } },
    { id: 'ACC', type: 'accumulator', pos: [1120, 420], config: { accumulator_type: 'none', gas_port: true, liquid: 'water', gas: 'air' } },
    { id: 'AIRB', type: 'boundary', pos: [1180, 360], config: { direction: 'from', name: 'store', medium: 'air' } },
  );
  model.connections.push(
    { id: 'comp', from: 'BASIN.outlet', to: 'ACC.inlet', line: 'working' },
    { id: 'gas', from: 'AIRB.port', to: 'ACC.gas', line: 'pressure' },
  );
  assert.equal(find(model, 'hydraulic/no-return-path').length, 0);
});

// --- gases -----------------------------------------------------------------------

test('a turbine with nothing upstream that supplies air is flagged', () => {
  const model = fragment();
  // Feed the store line from a boundary the air LEAVES by: nothing supplies it.
  model.connections = model.connections.filter((item) => item.id !== 'store-out');
  model.components.push({ id: 'OFF', type: 'boundary', pos: [560, 380], config: { direction: 'to', name: 'elsewhere' } });
  model.connections.push({ id: 'dead', from: 'V1.inlet', to: 'OFF.port', line: 'pressure' });
  assert.deepEqual(find(model, 'pneumatic/turbine-without-supply').map((item) => item.subject.component), ['T1']);
});

test('a turbine exhaust that reaches a store is not "supplied": supply and exhaust are traced apart', () => {
  // Both turbine ports sit in one group. A trace from the component would find
  // the receiver on the exhaust side and call the turbine supplied.
  const model = fragment();
  model.connections = model.connections.filter((item) => !['store-out', 'exhaust'].includes(item.id));
  model.components.push(
    { id: 'OFF', type: 'boundary', pos: [560, 380], config: { direction: 'to', name: 'elsewhere' } },
    { id: 'R9', type: 'air_receiver', pos: [960, 440], config: { single_port: true } },
  );
  model.connections.push(
    { id: 'dead', from: 'V1.inlet', to: 'OFF.port', line: 'pressure' },
    { id: 'into-store', from: 'T1.exhaust', to: 'R9.port', line: 'return' },
  );
  const found = codes(model);
  assert.ok(found.includes('pneumatic/turbine-without-supply'));
  assert.ok(found.includes('pneumatic/exhaust-not-to-atmosphere'));
});

test('a compressor with no intake is flagged; one drawing from ambient is not', () => {
  assert.equal(find(fragment(), 'pneumatic/compressor-without-intake').length, 0);
  const model = fragment();
  component(model, 'AIR').config.direction = 'to';
  assert.deepEqual(find(model, 'pneumatic/compressor-without-intake').map((item) => item.subject.component), ['C1']);
});

test('a safety valve on air vents to atmosphere; venting into a store is flagged', () => {
  const vented = fragment();
  vented.components.push(
    { id: 'R9', type: 'air_receiver', pos: [300, 460], config: { single_port: true, gas: 'air' } },
    { id: 'SV9', type: 'relief_valve', pos: [440, 420] },
    { id: 'SIL9', type: 'silencer', pos: [460, 560] },
  );
  vented.connections.push(
    { id: 'sv-in', from: 'R9.port', to: 'SV9.inlet', line: 'pressure' },
    { id: 'sv-out', from: 'SV9.outlet', to: 'SIL9.inlet', line: 'return' },
  );
  assert.equal(find(vented, 'pneumatic/relief-not-to-atmosphere').length, 0);
  assert.equal(find(vented, 'hydraulic/relief-not-to-tank').length, 0, 'an air relief is never asked to reach a tank');

  const trapped = fragment();
  trapped.components.push(
    { id: 'R9', type: 'air_receiver', pos: [300, 460], config: { single_port: true, gas: 'air' } },
    { id: 'SV9', type: 'relief_valve', pos: [440, 420] },
    { id: 'R10', type: 'air_receiver', pos: [460, 560], config: { single_port: true } },
  );
  trapped.connections.push(
    { id: 'sv-in', from: 'R9.port', to: 'SV9.inlet', line: 'pressure' },
    { id: 'sv-out', from: 'SV9.outlet', to: 'R10.port', line: 'return' },
  );
  assert.deepEqual(find(trapped, 'pneumatic/relief-not-to-atmosphere').map((item) => item.subject.component), ['SV9']);
});

// --- shafts ----------------------------------------------------------------------

test('a shaft train with nothing driving it is an error', () => {
  const model = fragment();
  // M1 becomes a generator: now a compressor is coupled only to a generator.
  component(model, 'M1').config.role = 'generator';
  component(model, 'M1').mirror = true;
  const [finding] = find(model, 'mechanical/nothing-drives');
  assert.ok(finding);
  assert.equal(finding.severity, 'error');
  assert.equal(finding.subject.components, 'C1, M1');
});

test('a shaft train with nothing driven is a warning', () => {
  const model = fragment();
  component(model, 'G1').config.role = 'motor';
  component(model, 'G1').mirror = true;
  const [finding] = find(model, 'mechanical/nothing-driven');
  assert.ok(finding);
  assert.equal(finding.severity, 'warning');
  assert.equal(finding.subject.components, 'G1, T1');
});

test('a motor-generator both drives and is driven, so a shared train is sound', () => {
  const model = load('test/fixtures/caes-fragment.json');
  model.components = model.components.filter((item) => !['M1', 'G1'].includes(item.id));
  model.connections = model.connections.filter((item) => !['drive', 'output'].includes(item.id));
  model.components.push({ id: 'MG1', type: 'electrical_machine', pos: [600, 60], config: { role: 'motor_generator' } });
  model.connections.push(
    { id: 'charge', from: 'MG1.shaft_a', to: 'C1.shaft', line: 'mechanical', clutch: true },
    { id: 'discharge', from: 'T1.shaft', to: 'MG1.shaft_b', line: 'mechanical', clutch: true },
  );
  assert.deepEqual(codes(model).filter((code) => code.startsWith('mechanical/')), []);
});

// --- load-bearing choices ------------------------------------------------------------

test('a preheater with nothing stating its heat source is raised, because it would print "oil"', () => {
  const model = fragment();
  delete component(model, 'HX2').config.utility_medium;
  const [finding] = find(model, 'media/heat-source-unstated');
  assert.ok(finding);
  assert.equal(finding.severity, 'warning');
  assert.equal(finding.subject.component, 'HX2');

  // A boundary that states the medium settles it just as well as the config.
  component(model, 'TES').config.medium = 'thermal_oil';
  assert.equal(find(model, 'media/heat-source-unstated').length, 0);
});

test('a cooler with nothing stating its medium is only noted', () => {
  const model = fragment();
  delete component(model, 'HX1').config.utility_medium;
  const [finding] = find(model, 'media/cooling-medium-unstated');
  assert.ok(finding);
  assert.equal(finding.severity, 'info');
});

test('a defaulted electrical machine role is a load-bearing assumption', () => {
  const model = fragment();
  delete component(model, 'G1').config;
  const [finding] = find(model, 'assumptions/undeclared');
  assert.ok(finding, 'the shaft arrangement was defaulted with nothing on the record');
  assert.equal(finding.subject.component, 'G1');

  model.assumptions = [{ subject: 'G1', statement: 'Drawn as a generator driven by the turbine.' }];
  assert.equal(find(model, 'assumptions/undeclared').length, 0);
});

// --- the report checklist ------------------------------------------------------------

test('the checklist traces the air side, and shows none of it for a hydraulic circuit', () => {
  const rows = (model) => topologyChecklist(analyse(model)).map((row) => `${row.status} ${row.label}`);
  const air = rows(fragment());
  for (const label of ['Turbine is supplied with air from a store or compressor', 'Turbine exhausts to atmosphere',
    'Compressor draws from an intake', 'Every shaft train has a driver']) {
    assert.ok(air.includes(`pass ${label}`), label);
  }
  const oil = rows(load('examples/02-solenoid-cylinder.json'));
  assert.ok(!oil.some((row) => /Turbine|Compressor|shaft train|Safety valve/.test(row)));

  const broken = fragment();
  component(broken, 'AIR').config.direction = 'to';
  assert.ok(rows(broken).includes('fail Compressor draws from an intake'));
});
