// The two mixed-fluid worked examples.
//
// examples.test.mjs already holds every example to "validates, routes cleanly,
// renders deterministically". These tests pin what 06 and 07 exist to show:
// which fluid each line carries, where the drawing says so, and that a
// compressed-air plant and an oil circuit with a gas bottle both come out
// with no findings at all -- an example that ships with a warning teaches
// people that warnings are normal.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateModel } from '../validate/index.mjs';
import { analyse, renderSvg } from '../renderers/pipeline.mjs';
import { topologyChecklist } from '../validate/report.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const plant = () => load('examples/06-caes-plant.json');
const backup = () => load('examples/07-nitrogen-backup.json');

const mediaOf = (model) => new Map(validateModel(model).connections.map((item) => [item.id, item.medium]));

function connectionGroup(svg, edge) {
  const match = svg.match(new RegExp(`<g class="conn" data-edge="${edge}"[^>]*>([\\s\\S]*?)</g>(?=<g class="conn"|</g>)`));
  assert.ok(match, `connection ${edge} is drawn`);
  return match[1];
}

const labelOf = (svg, edge) => connectionGroup(svg, edge).match(/class="line-label"[^>]*>([^<]*)</)?.[1] ?? null;

test('example 06 raises no finding of any kind', () => {
  assert.deepEqual(analyse(plant()).diagnostics.map((item) => `${item.code}: ${item.message}`), []);
});

test('example 07 raises nothing that 05, the circuit it extends, does not', () => {
  const findings = (model) => analyse(model).diagnostics.map((item) => item.code).sort();
  assert.deepEqual(findings(backup()), findings(load('examples/05-filtered-power-unit.json')));
});

// --- 06: the compressed-air plant ---------------------------------------------------

test('06: every line carries the fluid its plant section does', () => {
  const media = mediaOf(plant());
  const expect = {
    air: ['intake', 'lp-discharge', 'intercooled', 'hp-discharge', 'aftercooled', 'safety-in', 'safety-vent',
      'charge', 'charge-store', 'store-air', 'store-out', 'isolated', 'regulated', 'hot-air', 'exhaust'],
    water: ['cw1-in', 'cw1-out', 'cw2-in', 'cw2-out', 'store-water'],
    flue_gas: ['flue-in', 'flue-out'],
    mechanical: ['expander-shaft', 'compressor-shaft', 'hp-drive'],
  };
  for (const [medium, ids] of Object.entries(expect)) {
    for (const id of ids) assert.equal(media.get(id), medium, id);
  }
  assert.equal(media.size, Object.values(expect).flat().length, 'every connection is accounted for');
});

test('06: the shared motor-generator is clutched to both ends, the HP drive is not', () => {
  const model = plant();
  const svg = renderSvg(model, analyse(model));
  const clutches = (edge) => (connectionGroup(svg, edge).match(/<g class="clutch">/g) ?? []).length;
  assert.equal(clutches('expander-shaft'), 1);
  assert.equal(clutches('compressor-shaft'), 1);
  assert.equal(clutches('hp-drive'), 0);
});

test('06: the report passes every compressed-air row and the safety valve', () => {
  const rows = topologyChecklist(analyse(plant())).map((row) => `${row.status} ${row.label}`);
  for (const label of [
    'Safety valve vents to atmosphere',
    'Turbine is supplied with air from a store or compressor',
    'Turbine exhausts to atmosphere',
    'Compressor draws from an intake',
    'Every shaft train has a driver',
  ]) {
    assert.ok(rows.includes(`pass ${label}`), `${label}: ${rows.join(' | ')}`);
  }
  assert.ok(!rows.some((row) => row.startsWith('fail')), rows.join(' | '));
});

test('06: each exchanger says what flows through each side', () => {
  const model = plant();
  const svg = renderSvg(model, analyse(model));
  assert.equal(labelOf(svg, 'cw1-in'), 'water');
  assert.equal(labelOf(svg, 'flue-in'), 'flue gas');
  assert.equal(labelOf(svg, 'hot-air'), 'air');
  assert.equal(labelOf(svg, 'store-water'), 'water');
  assert.equal(labelOf(svg, 'expander-shaft'), null);
});

// --- 07: oil with a nitrogen bottle -------------------------------------------------

test('07: the gas side is nitrogen and everything else is still oil', () => {
  const media = mediaOf(backup());
  assert.equal(media.get('gas-side'), 'nitrogen');
  assert.equal(media.get('bottle'), 'nitrogen');
  for (const [id, medium] of media) {
    if (!['gas-side', 'bottle'].includes(id)) assert.equal(medium, 'oil', id);
  }
});

test('07: the accumulator is where the fluid changes, and the drawing says so on both sides', () => {
  const model = backup();
  const svg = renderSvg(model, analyse(model));
  assert.equal(labelOf(svg, 'gas-side'), 'nitrogen');
  assert.equal(labelOf(svg, 'accumulator-tap'), 'oil');
});

test('07: an air bottle on an oil accumulator is refused, not silently drawn', () => {
  const model = backup();
  model.components.find((item) => item.id === 'NB1').config.gas = 'air';
  const codes = validateModel(model).diagnostics.map((item) => item.code);
  assert.ok(codes.includes('media/conflict'), codes.join(', '));
});

// --- the two rule changes these examples brought out --------------------------------

test('a compensation basin feeding a store by head is not asked for a suction line', () => {
  const codes = validateModel(plant()).diagnostics.map((item) => item.code);
  assert.ok(!codes.includes('hydraulic/line-type-unexpected'));

  // A reservoir outlet feeding anything else still is.
  const oil = load('examples/05-filtered-power-unit.json');
  oil.connections.find((item) => item.id === 'tank-to-filter').line = 'pressure';
  const found = validateModel(oil).diagnostics.filter((item) => item.code === 'hydraulic/line-type-unexpected');
  assert.equal(found.length, 1);
});

test('a direct-contact store has no pre-charge to ask for; a separated one still does', () => {
  const asks = (model) => validateModel(model).diagnostics
    .some((item) => item.code === 'parameters/unspecified' && item.subject.component === 'ACC1' && /pre-charge/.test(item.message));
  assert.equal(asks(plant()), false);

  const separated = plant();
  separated.components.find((item) => item.id === 'ACC1').config.accumulator_type = 'bladder';
  assert.equal(asks(separated), true);
});

test('an exchanger label sits upper left, clear of the process line and the utility label', async () => {
  const { resolveComponent } = await import('../renderers/symbols/index.mjs');
  const { geometry, ports } = resolveComponent({ id: 'HX', type: 'heat_exchanger', pos: [0, 0], config: { utility_medium: 'water' } });
  const anchor = geometry.labelAnchor;
  const lastCaption = anchor.y + 12 + 11; // the tag, then two captions 11 apart
  assert.ok(lastCaption + 4 < ports.in.y, 'the last caption clears the process line');
  assert.equal(anchor.anchor, 'end');
  assert.ok(anchor.x < ports.utility_out.x, 'left of the utility line, whose medium label goes on its right');
});
