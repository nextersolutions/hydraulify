// The compressed-air symbols.
//
// The generic symbol tests only check each symbol's defaults. These cover every
// variant, and the conventions that carry meaning and could silently flip: which
// side a shaft is on, hollow versus solid triangles, heating versus cooling,
// open versus blocked paths, and text that must stay readable when mirrored.
// Whether each drawing is right to the eye is still the symbol sheet's job.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveComponent, getSymbol } from '../renderers/symbols/index.mjs';
import { MECHANICAL } from '../renderers/symbols/contract.mjs';
import { validateModel } from '../validate/index.mjs';
import { analyse, renderSvg } from '../renderers/pipeline.mjs';
import { buildBom } from '../validate/bom.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const resolve = (type, config, extra = {}) => resolveComponent({ id: 'X1', type, pos: [0, 0], config, ...extra });
const draw = (type, config, { style, mirror } = {}) => {
  const entry = resolve(type, config, mirror ? { mirror: true } : {});
  return getSymbol(type).draw({ config: entry.config, geometry: entry.geometry, component: { id: 'X1' }, style });
};

const VARIANTS = [
  ['turbine', {}],
  ['compressor', {}],
  ['electrical_machine', { role: 'generator' }],
  ['electrical_machine', { role: 'motor' }],
  ['electrical_machine', { role: 'motor_generator' }],
  ['heat_exchanger', { function: 'heating', utility_medium: 'flue_gas' }],
  ['heat_exchanger', { function: 'cooling' }],
  ['air_receiver', {}],
  ['air_receiver', { single_port: true, gas: 'nitrogen' }],
  ['pressure_regulator', {}],
  ['shut_off_valve', { normal_position: 'closed' }],
  ['silencer', {}],
  ['boundary', { direction: 'from', name: 'TES' }],
  ['boundary', { direction: 'to', name: 'cooling water return' }],
];

for (const [type, config] of VARIANTS) {
  for (const mirror of [false, true]) {
    test(`${type} ${JSON.stringify(config)}${mirror ? ' mirrored' : ''}: every port sits on the edge it names`, () => {
      const { geometry, ports } = resolve(type, config, mirror ? { mirror: true } : {});
      for (const port of Object.values(ports)) {
        const onEdge = {
          left: port.x === 0,
          right: port.x === geometry.width,
          top: port.y === 0,
          bottom: port.y === geometry.height,
        }[port.side];
        assert.ok(onEdge, `${port.id}: side ${port.side} but at (${port.x}, ${port.y}) in ${geometry.width}x${geometry.height}`);
      }
    });
  }
}

test('shafts follow power left to right: drivers out on the right, driven machines in on the left', () => {
  assert.equal(resolve('turbine', {}).ports.shaft.side, 'right', 'a turbine drives');
  assert.equal(resolve('compressor', {}).ports.shaft.side, 'left', 'a compressor is driven');
  assert.equal(resolve('electrical_machine', { role: 'generator' }).ports.shaft.side, 'left', 'a generator is driven');
  assert.equal(resolve('electrical_machine', { role: 'motor' }).ports.shaft.side, 'right', 'a motor drives');
  const mg = resolve('electrical_machine', { role: 'motor_generator' }).ports;
  assert.deepEqual([mg.shaft_a.side, mg.shaft_b.side], ['left', 'right'], 'a motor-generator sits between two machines');
  assert.equal(resolve('turbine', {}, { mirror: true }).ports.shaft.side, 'left', 'mirroring moves the shaft');
});

test('machine ports declare their media: air on the gas path, a shaft on the shaft', () => {
  for (const type of ['turbine', 'compressor']) {
    const { ports } = resolve(type, {});
    assert.equal(ports.shaft.medium, MECHANICAL, type);
    for (const port of Object.values(ports).filter((item) => item.id !== 'shaft')) {
      assert.equal(port.medium, 'air', `${type}.${port.id}`);
    }
  }
  for (const port of Object.values(resolve('electrical_machine', { role: 'motor_generator' }).ports)) {
    assert.equal(port.medium, MECHANICAL);
  }
});

test('a heat exchanger keeps its process and utility sides in separate groups', () => {
  const { ports } = resolve('heat_exchanger', { utility_medium: 'thermal_oil' });
  assert.equal(ports.in.group, 'process');
  assert.equal(ports.out.group, 'process');
  assert.equal(ports.in.medium, 'any', 'the process side takes whatever passes through it');
  assert.equal(ports.utility_in.group, 'utility');
  assert.equal(ports.utility_in.medium, 'thermal_oil');
  assert.equal(ports.utility_out.medium, 'thermal_oil');
  assert.equal(resolve('heat_exchanger', {}).ports.utility_in.medium, 'any');
});

test('receiver, silencer and boundary admit what they should', () => {
  assert.deepEqual(resolve('air_receiver', {}).ports.inlet.medium, ['air', 'nitrogen']);
  assert.equal(resolve('air_receiver', { gas: 'nitrogen', single_port: true }).ports.port.medium, 'nitrogen');
  assert.deepEqual(Object.keys(resolve('air_receiver', { single_port: true }).ports), ['port']);
  assert.equal(resolve('silencer', {}).ports.inlet.medium, 'gas');
  assert.equal(resolve('boundary', { direction: 'to', name: 'stack', medium: 'flue_gas' }).ports.port.medium, 'flue_gas');
  assert.equal(resolve('boundary', { direction: 'to', name: 'stack' }).ports.port.medium, 'any');
});

test('compressor and turbine triangles are hollow; the pump and motor keep theirs solid', () => {
  // Hollow is the only thing that says "gas" on these symbols.
  for (const type of ['compressor', 'turbine']) {
    const polygons = draw(type, {}).match(/<polygon[^>]*>/g) ?? [];
    assert.ok(polygons.length >= 1, `${type} draws a triangle`);
    assert.ok(polygons.every((item) => !item.includes('currentColor')), `${type} triangle must be hollow`);
  }
  assert.match(draw('pump', {}), /<polygon[^>]*currentColor/, 'the pump triangle stays solid');
});

test('the turbine draws two conventions from one frame and one port table', () => {
  const iso1219 = draw('turbine', {}, { style: { machine: 'iso1219' } });
  const iso10628 = draw('turbine', {}, { style: { machine: 'iso10628' } });
  assert.match(iso1219, /<circle/);
  assert.doesNotMatch(iso10628, /<circle/);
  assert.notEqual(iso1219, iso10628);
  assert.equal(draw('turbine', {}), iso1219, 'iso1219 is the default');

  // The trapezoid is narrow at the inlet (top) and wide at the exhaust (bottom).
  const points = iso10628.match(/<polygon points="([^"]+)"/)[1].split(' ').map((pair) => pair.split(',').map(Number));
  const widthAt = (y) => {
    const xs = points.filter(([, py]) => py === y).map(([px]) => px);
    return Math.max(...xs) - Math.min(...xs);
  };
  const ys = points.map(([, py]) => py);
  assert.ok(widthAt(Math.min(...ys)) < widthAt(Math.max(...ys)), 'it widens in the direction of flow');
});

test('heating triangles point at the centre; cooling triangles point away from it', () => {
  const tips = (svg) => (svg.match(/<polygon points="([^"]+)"[^>]*currentColor/g) ?? [])
    .map((item) => item.match(/points="([^"]+)"/)[1].split(' ').map((pair) => pair.split(',').map(Number)))
    .map((triangle) => {
      // The tip is the vertex whose y differs from the other two.
      const [a, b, c] = triangle;
      if (a[1] === b[1]) return { tip: c[1], base: a[1] };
      if (a[1] === c[1]) return { tip: b[1], base: a[1] };
      return { tip: a[1], base: b[1] };
    });
  const centre = resolve('heat_exchanger', {}).geometry.height / 2;
  const towardCentre = ({ tip, base }) => Math.abs(tip - centre) < Math.abs(base - centre);

  const heating = tips(draw('heat_exchanger', { function: 'heating' }));
  const cooling = tips(draw('heat_exchanger', { function: 'cooling' }));
  assert.equal(heating.length, 2);
  assert.equal(cooling.length, 2);
  assert.ok(heating.every(towardCentre), 'a heater adds heat: triangles point in');
  assert.ok(cooling.every((item) => !towardCentre(item)), 'a cooler removes heat: triangles point out');
});

test('the regulator path is open at rest and its pilot senses the outlet', () => {
  const { geometry, ports } = resolve('pressure_regulator', {});
  const svg = draw('pressure_regulator', {});
  // A flow arrow on the port axis: in line, not offset like a relief valve's.
  assert.match(svg, new RegExp(`<line x1="\\d+" y1="${ports.inlet.y}" x2="\\d+" y2="${ports.inlet.y}"`));
  const pilot = svg.match(/<polyline points="([^"]+)" class="pilot-line"/)[1].split(' ').map((pair) => pair.split(',').map(Number));
  assert.ok(pilot[0][0] > geometry.width / 2, 'the pilot starts on the outlet side');
});

test('a normally closed shut-off valve is filled; an open one is not', () => {
  assert.match(draw('shut_off_valve', { normal_position: 'closed' }), /currentColor/);
  assert.doesNotMatch(draw('shut_off_valve', {}), /currentColor/);
});

test('letters stay readable when a symbol is mirrored', () => {
  assert.doesNotMatch(draw('electrical_machine', { role: 'generator' }), /matrix\(-1/);
  assert.match(draw('electrical_machine', { role: 'generator' }, { mirror: true }), /transform="matrix\(-1 0 0 1 \d+ 0\)"/);
  assert.match(draw('boundary', { direction: 'to', name: 'stack' }, { mirror: true }), />stack</);
  assert.match(draw('boundary', { direction: 'to', name: 'stack' }, { mirror: true }), /matrix\(-1/);
  // The pump's drive letter had the same latent flaw.
  assert.match(draw('pump', { drive: 'electric_motor' }, { mirror: true }), /matrix\(-1/);
});

test('a boundary sizes to its name and points the way the flow goes', () => {
  const short = resolve('boundary', { direction: 'to', name: 'TES' }).geometry.width;
  const long = resolve('boundary', { direction: 'to', name: 'cooling water return' }).geometry.width;
  assert.ok(long > short);
  const tipX = (svg) => {
    const points = svg.match(/<polygon points="([^"]+)"/)[1].split(' ').map((pair) => pair.split(',').map(Number));
    return points.find(([, y]) => y === 10)[0];
  };
  assert.equal(tipX(draw('boundary', { direction: 'from', name: 'TES' })), 0, 'from: pointed at its port');
  assert.equal(tipX(draw('boundary', { direction: 'to', name: 'TES' })), short, 'to: pointed away from it');
});

// ---------------------------------------------------------------------------
// A compressed-air circuit, end to end.

// The same fragment the shaft tests draw; kept as a fixture so both agree.
function caesFragment() {
  return JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'caes-fragment.json'), 'utf8'));
}

test('a compressed-air circuit resolves every line to the fluid it really carries', () => {
  const result = validateModel(caesFragment());
  assert.deepEqual(result.diagnostics.filter((item) => item.severity === 'error').map((item) => `${item.code}: ${item.message}`), []);
  const medium = Object.fromEntries(result.connections.map((connection) => [connection.id, connection.medium]));
  for (const id of ['intake', 'discharge', 'cooled', 'store-out', 'isolated', 'regulated', 'hot-air', 'exhaust']) {
    assert.equal(medium[id], 'air', id);
  }
  assert.equal(medium['cw-in'], 'water');
  assert.equal(medium['cw-out'], 'water');
  assert.equal(medium['heat-in'], 'thermal_oil');
  assert.equal(medium.drive, 'mechanical');
  assert.equal(medium.output, 'mechanical');
});

test('cooling water piped into the compressor intake is refused, naming both ends', () => {
  const model = caesFragment();
  model.components.find((component) => component.id === 'CWS').config.medium = 'water';
  model.connections = model.connections.filter((connection) => connection.id !== 'cw-in');
  model.connections.find((connection) => connection.id === 'intake').from = 'CWS.port';
  const conflicts = validateModel(model).diagnostics.filter((item) => item.code === 'media/conflict');
  assert.equal(conflicts.length, 1, 'one mistake, one finding');
  assert.match(conflicts[0].message, /air \([^)]*C1\.inlet/);
  assert.match(conflicts[0].message, /water \(CWS\.port\)/);
});

test('boundaries are not parts, and are not counted as tees', () => {
  const model = caesFragment();
  const analysis = analyse(model);
  const bom = buildBom(model, analysis);
  assert.equal(bom.items.some((item) => item.type === 'boundary'), false);
  assert.equal(bom.junctions, 0);
  const descriptions = bom.items.map((item) => item.description);
  assert.ok(descriptions.includes('Cooler (heat exchanger), water side'));
  assert.ok(descriptions.includes('Preheater (heat exchanger), thermal oil side'));
  assert.ok(descriptions.includes('Air turbine (expander)'));
});

test('the title block says when the turbine is drawn to another standard', () => {
  const model = caesFragment();
  const plain = renderSvg(model, analyse(model));
  assert.match(plain, /ISO 1219-style schematic</);
  assert.doesNotMatch(plain, /ISO 10628/);

  model.meta.machine_style = 'iso10628';
  assert.match(renderSvg(model, analyse(model)), /ISO 1219-style schematic; turbine per ISO 10628/);

  // Without a turbine there is nothing borrowed, so nothing is claimed.
  const noTurbine = caesFragment();
  noTurbine.meta.machine_style = 'iso10628';
  noTurbine.components = noTurbine.components.filter((component) => !['T1', 'SIL', 'G1'].includes(component.id));
  noTurbine.connections = noTurbine.connections.filter((connection) => !['hot-air', 'exhaust', 'output'].includes(connection.id));
  noTurbine.components.push({ id: 'SIL2', type: 'silencer', pos: [1000, 300] });
  noTurbine.connections.push({ id: 'vent', from: 'HX2.out', to: 'SIL2.inlet', line: 'return' });
  assert.doesNotMatch(renderSvg(noTurbine, analyse(noTurbine)), /ISO 10628/);
});
