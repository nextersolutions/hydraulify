// Units added for compressed-air storage: temperature, power, gas flow.
//
// Each of the new quantities has one way to be subtly wrong, and each test here
// is aimed at that way rather than at the happy path: temperature has an offset
// that breaks significant figures, gas volume has reference conditions that
// break a naive volume ratio, and a gas flow can be stated two ways that can
// disagree.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { presentParam, presentParams, splitParamName, QUANTITIES } from '../renderers/shared/units.mjs';
import { validateModel } from '../validate/index.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = () => JSON.parse(fs.readFileSync(path.join(root, 'examples', '02-solenoid-cylinder.json'), 'utf8'));
const text = (name, value, system) => presentParam(name, value, system).text;

test('temperature keeps the resolution of its source, because significant figures do not survive an offset', () => {
  // The trap: 0 degC has one significant figure, and 32 rounded to one figure is 30.
  assert.equal(text('temperature_c', 0, 'imperial'), '~32 °F');
  assert.equal(text('temperature_c', 20, 'imperial'), '~68 °F');
  assert.equal(text('temperature_c', -40, 'imperial'), '~-40 °F');
  assert.equal(text('temperature_c', 20.5, 'imperial'), '~68.9 °F');
  assert.equal(text('temperature_c', 650, 'imperial'), '~1202 °F');
  assert.equal(text('temperature_f', 68, 'si'), '~20 °C');
  assert.equal(text('temperature_c', 20, 'si'), '20 °C', 'no conversion, no tilde');
});

test('a temperature that rounds to zero is printed as 0, never -0', () => {
  assert.equal(text('temperature_f', 32, 'si'), '~0 °C');
  assert.equal(text('temperature_f', 31.9, 'si'), '~-0.1 °C');
  assert.equal(text('temperature_f', 31.5, 'si'), '~-0.3 °C');
  assert.equal(text('temperature_f', 31, 'si'), '~-1 °C');
});

test('gas volume flow converts through the reference temperatures, not just the volume ratio', () => {
  // Nm3 is at 0 degC, scf at 60 degF. Ignoring that is a 5.7% error.
  const naive = (1 / 0.3048 ** 3) / 60;
  const { factor } = QUANTITIES.normal_flow;
  assert.ok(Math.abs(factor - 0.6221) < 5e-5, `Nm3/h -> scfm factor ${factor}`);
  assert.ok(Math.abs(factor / naive - 1.0569) < 1e-4, 'the temperature ratio must be applied');
  assert.equal(text('flow_nm3h', 1000, 'imperial'), '~622.1 scfm');
  assert.equal(text('flow_scfm', 622, 'si'), '~1000 Nm3/h');
});

test('power and mass flow convert by factor with the source precision', () => {
  assert.equal(text('power_kw', 250, 'imperial'), '~335 hp');
  assert.equal(text('power_hp', 335, 'si'), '~250 kW');
  assert.equal(text('mass_flow_kgs', 100, 'imperial'), '~220 lb/s');
  assert.equal(text('mass_flow_lbs', 220, 'si'), '~99.8 kg/s');
});

test('the suffix, not the base name, decides whether a flow is liquid or gas', () => {
  assert.equal(splitParamName('flow_lpm').quantity, 'flow');
  assert.equal(splitParamName('flow_gpm').quantity, 'flow');
  assert.equal(splitParamName('flow_nm3h').quantity, 'normal_flow');
  assert.equal(splitParamName('flow_scfm').quantity, 'normal_flow');
  assert.equal(splitParamName('mass_flow_kgs').quantity, 'mass_flow');
  assert.equal(splitParamName('flow_kgs'), null, 'a suffix from another quantity is not a match');
});

test('new parameters print on the drawing with their units', () => {
  assert.deepEqual(
    presentParams('turbine', { power_kw: 290, temperature_c: 550, mass_flow_kgs: 420 }, 'si'),
    ['290 kW', '550 °C', '420 kg/s'],
  );
});

const schemaCodes = (params) => {
  const model = base();
  model.components.find((component) => component.id === 'P1').params = params;
  return validateModel(model).diagnostics.filter((item) => item.code.startsWith('schema/'));
};

test('schema: temperatures may be zero or negative, but not below absolute zero', () => {
  assert.deepEqual(schemaCodes({ temperature_c: 0 }), []);
  assert.deepEqual(schemaCodes({ temperature_c: -20 }), []);
  assert.deepEqual(schemaCodes({ temperature_f: -459.67 }), []);

  const tooCold = schemaCodes({ temperature_c: -300 });
  assert.deepEqual(tooCold.map((item) => item.code), ['schema/minimum']);
  assert.match(tooCold[0].supportedFixes[0], /absolute zero/);
});

test('schema: power, gas flow and mass flow must be positive like every other quantity', () => {
  for (const name of ['power_kw', 'flow_nm3h', 'mass_flow_kgs']) {
    assert.deepEqual(schemaCodes({ [name]: 0 }).map((item) => item.code), ['schema/exclusiveMinimum'], name);
  }
});

test('schema: a quantity in both unit systems is refused with the unit-pair fix', () => {
  const found = schemaCodes({ temperature_c: 20, temperature_f: 68 });
  assert.deepEqual(found.map((item) => item.code), ['schema/not']);
  assert.match(found[0].supportedFixes[0], /SI or imperial units, never both/);
});

test('schema: a gas flow stated both as volume and as mass is refused with its own fix', () => {
  for (const pair of [['flow_nm3h', 'mass_flow_kgs'], ['flow_scfm', 'mass_flow_lbs'], ['flow_nm3h', 'mass_flow_lbs']]) {
    const found = schemaCodes({ [pair[0]]: 1000, [pair[1]]: 0.4 });
    assert.deepEqual(found.map((item) => item.code), ['schema/not'], pair.join(' + '));
    assert.match(found[0].supportedFixes[0], /state a gas flow once/, pair.join(' + '));
  }
});

test('schema: a liquid flow and a gas flow on one component are both allowed', () => {
  // A heat exchanger can carry cooling water in L/min and process air in Nm3/h.
  assert.deepEqual(schemaCodes({ flow_lpm: 120, flow_nm3h: 5000 }), []);
});
