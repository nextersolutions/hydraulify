// Validation layer tests.
//
// These cover the brief's §30 cases that are about validation rather than
// rendering, plus the rules most likely to be wrong in a way nobody notices: a
// legitimate circuit being rejected, and an invalid one passing.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateModel } from '../validate/index.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

const codes = (result) => result.diagnostics.map((item) => item.code);
const bySeverity = (result, severity) => result.diagnostics.filter((item) => item.severity === severity);

test('Test 1: tank - pump - 4/3 valve - double-acting cylinder - tank validates', () => {
  const result = validateModel(load('t1-simple-cylinder.json'));
  const errors = bySeverity(result, 'error');
  assert.deepEqual(errors.map((item) => `${item.code} ${item.message}`), [], 'expected no errors');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'PASS');
});

test('Test 7: an unconnected cylinder port is an error naming that port', () => {
  const model = clone(load('t1-simple-cylinder.json'));
  model.connections = model.connections.filter((connection) => connection.id !== 'retract');

  const result = validateModel(model);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'INVALID');

  const finding = result.diagnostics.find((item) => item.code === 'topology/required-port-unconnected'
    && item.subject.component === 'C1');
  assert.ok(finding, 'expected an unconnected-port error for C1');
  assert.equal(finding.subject.port, 'rod');
  assert.match(finding.message, /C1\.rod is not connected/);
  // The valve's B port is now dangling too, which is a warning rather than an
  // error because a four-way valve can legitimately be used as a three-way.
  const valveFinding = result.diagnostics.find((item) => item.code === 'topology/port-unconnected'
    && item.subject.component === 'V1');
  assert.equal(valveFinding.severity, 'warning');
});

test('a port marked plugged is not reported as unconnected', () => {
  const model = clone(load('t1-simple-cylinder.json'));
  model.connections = model.connections.filter((connection) => connection.id !== 'retract');
  model.components.find((component) => component.id === 'V1').ports = { B: { plugged: true } };
  model.components.find((component) => component.id === 'C1').ports = { rod: { plugged: true } };

  const result = validateModel(model);
  assert.equal(bySeverity(result, 'error').length, 0);
  assert.ok(!codes(result).includes('topology/required-port-unconnected'));
  assert.ok(!codes(result).includes('topology/port-unconnected'));
});

test('two lines on one port are refused, with the junction as the fix', () => {
  const model = clone(load('t1-simple-cylinder.json'));
  model.connections.push({ id: 'second-tap', from: 'P1.outlet', to: 'RV1.inlet', line: 'pressure' });

  const result = validateModel(model);
  const finding = result.diagnostics.find((item) => item.code === 'topology/port-overloaded');
  assert.ok(finding);
  assert.equal(finding.severity, 'error');
  assert.match(finding.message, /P1\.outlet carries 2 connections/);
  assert.match(finding.supportedFixes[0], /junction/);
});

test('an unknown port is refused and lists the ports the component has', () => {
  const model = clone(load('t1-simple-cylinder.json'));
  model.connections.find((connection) => connection.id === 'extend').from = 'V1.X';

  const result = validateModel(model);
  const finding = result.diagnostics.find((item) => item.code === 'topology/unknown-port');
  assert.ok(finding);
  assert.match(finding.message, /V1 \(directional_control_valve\) has no port "X"/);
  assert.deepEqual(finding.evidence.available.sort(), ['A', 'B', 'P', 'T']);
});

test('a control line typed as a working line is an error, not a warning', () => {
  const model = clone(load('t1-simple-cylinder.json'));
  model.components.push({
    id: 'CB1',
    type: 'counterbalance_valve',
    pos: [820, 300],
    config: { pilot_type: 'external' },
    params: { setting_bar: 210 },
  });
  model.connections.push(
    { id: 'cb-in', from: 'CB1.inlet', to: 'CB1.outlet', line: 'working' },
  );
  // Replace the self-connection with a real pilot mis-typed as pressure.
  model.connections.pop();
  model.connections.push({ id: 'cb-pilot', from: 'CB1.pilot', to: 'J1.left', line: 'pressure' });

  const result = validateModel(model);
  const finding = result.diagnostics.find((item) => item.code === 'hydraulic/line-type-invalid');
  assert.ok(finding, 'a pilot port carrying a non-pilot line must be an error');
  assert.equal(finding.severity, 'error');
  assert.match(finding.supportedFixes[0], /"line": "pilot"/);
});

test('an actuator port wired straight to tank is refused', () => {
  const model = clone(load('t1-simple-cylinder.json'));
  model.connections.find((connection) => connection.id === 'retract').to = 'T1.return';
  model.connections.find((connection) => connection.id === 'retract').from = 'C1.rod';
  model.connections = model.connections.filter((connection) => connection.id !== 'tank-return');

  const result = validateModel(model);
  const finding = result.diagnostics.find((item) => item.code === 'hydraulic/actuator-to-tank');
  assert.ok(finding);
  assert.equal(finding.severity, 'error');
});

test('a pump delivering into another pump inlet is refused', () => {
  const model = clone(load('t1-simple-cylinder.json'));
  model.components.push({ id: 'P2', type: 'pump', pos: [900, 420], params: { flow_lpm: 10 } });
  model.connections.push(
    { id: 'bad-charge', from: 'P1.outlet', to: 'P2.inlet', line: 'pressure' },
    { id: 'p2-out', from: 'P2.outlet', to: 'J1.left', line: 'pressure' },
  );
  // P1.outlet now has two connections; remove the original to isolate the rule.
  model.connections = model.connections.filter((connection) => connection.id !== 'delivery');

  const result = validateModel(model);
  assert.ok(codes(result).includes('hydraulic/pump-to-pump'));
});

test('junction degree must match the declared way', () => {
  const model = clone(load('t1-simple-cylinder.json'));
  model.components.find((component) => component.id === 'J1').config = { way: 4 };

  const result = validateModel(model);
  const finding = result.diagnostics.find((item) => item.code === 'topology/junction-degree');
  assert.ok(finding);
  assert.match(finding.message, /declared 4-way but carries 3 connections/);
});

test('Test 8: missing parameters warn, and nothing is invented', () => {
  const model = clone(load('t1-simple-cylinder.json'));
  for (const component of model.components) delete component.params;

  const result = validateModel(model);
  assert.equal(bySeverity(result, 'error').length, 0, 'the drawing is still valid');

  const keyWarnings = result.diagnostics.filter((item) => item.code === 'parameters/key-unspecified');
  const subjects = keyWarnings.map((item) => `${item.subject.component}: ${item.subject.parameter}`);
  assert.ok(subjects.includes('P1: delivery (flow or displacement)'));
  assert.ok(subjects.includes('RV1: pressure setting'));
  assert.ok(subjects.includes('C1: bore'));

  // Nothing the validator produced may contain a substituted value.
  for (const component of model.components) {
    assert.equal(component.params, undefined, 'validation must not write parameters into the model');
  }
});

test('a load-bearing default with no recorded assumption is a warning', () => {
  const model = clone(load('t1-simple-cylinder.json'));
  delete model.assumptions;
  delete model.components.find((component) => component.id === 'V1').config.center_condition;

  const result = validateModel(model);
  const finding = result.diagnostics.find((item) => item.code === 'assumptions/undeclared');
  assert.ok(finding, 'a defaulted centre condition must be declared or recorded');
  assert.equal(finding.subject.component, 'V1');
  assert.match(finding.evidence.defaulted.join(','), /center_condition/);
});

test('an isolated component is refused', () => {
  const model = clone(load('t1-simple-cylinder.json'));
  model.components.push({ id: 'PG1', type: 'pressure_gauge', pos: [500, 500] });

  const result = validateModel(model);
  const finding = result.diagnostics.find((item) => item.code === 'topology/isolated-component');
  assert.ok(finding);
  assert.equal(finding.subject.component, 'PG1');
});

test('schema failure stops before topology rules cascade', () => {
  const model = clone(load('t1-simple-cylinder.json'));
  delete model.components.find((component) => component.id === 'C1').pos;

  const result = validateModel(model);
  assert.equal(result.stage, 'schema');
  assert.equal(result.ok, false);
  assert.ok(codes(result).every((code) => code.startsWith('schema/')));
});

test('diagnostic ordering is stable across runs', () => {
  const model = clone(load('t1-simple-cylinder.json'));
  model.connections = model.connections.filter((connection) => connection.id !== 'retract');
  const first = validateModel(model).diagnostics.map((item) => `${item.severity}/${item.code}/${JSON.stringify(item.subject)}`);
  const second = validateModel(clone(model)).diagnostics.map((item) => `${item.severity}/${item.code}/${JSON.stringify(item.subject)}`);
  assert.deepEqual(first, second);
});
