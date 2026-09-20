// Unit layer: the symbol contract.
//
// These assertions are the ones that catch a port drifting off its graphic, a
// symbol the schema allows but nothing can draw, and non-deterministic output --
// the failures that are invisible in review and expensive later.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYMBOLS, SUPPORTED_TYPES, resolveComponent, getSymbol, findPort } from '../renderers/symbols/index.mjs';
import { CRITICALITY } from '../renderers/symbols/contract.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'hydraulic-circuit.schema.json'), 'utf8'));

const CRITICALITIES = new Set(Object.values(CRITICALITY));
const SIDES = new Set(['left', 'right', 'top', 'bottom']);

test('registry and schema agree on the supported component types', () => {
  const schemaTypes = [...schema.$defs.componentType.enum].sort();
  assert.deepEqual(SUPPORTED_TYPES, schemaTypes);
});

test('an unsupported type is refused with the supported list, not drawn as a box', () => {
  assert.throws(() => getSymbol('vane_pump'), (error) => {
    assert.match(error.message, /Unsupported component type "vane_pump"/);
    assert.match(error.message, /directional_control_valve/);
    return true;
  });
});

for (const [type, symbol] of SYMBOLS) {
  test(`${type}: geometry is well formed and ports sit on the frame`, () => {
    const geometry = symbol.geometry(symbol.defaults);
    assert.ok(geometry.width > 0, 'width must be positive');
    assert.ok(geometry.height > 0, 'height must be positive');
    assert.ok(Object.keys(geometry.ports).length > 0, 'a symbol must declare at least one port');

    for (const [name, port] of Object.entries(geometry.ports)) {
      assert.equal(port.id, name, `port key ${name} must match its id`);
      assert.ok(SIDES.has(port.side), `${name}: unknown side ${port.side}`);
      assert.ok(CRITICALITIES.has(port.criticality), `${name}: unknown criticality ${port.criticality}`);
      assert.ok(Number.isFinite(port.x) && Number.isFinite(port.y), `${name}: non-finite coordinate`);

      // A port must lie within the frame. Junction ports sit at the centre by
      // design; every other port lies on the boundary edge it names, because a
      // port set back from the edge leaves a visible gap where the line meets
      // the symbol.
      assert.ok(port.x >= 0 && port.x <= geometry.width, `${name}: x outside frame`);
      assert.ok(port.y >= 0 && port.y <= geometry.height, `${name}: y outside frame`);

      if (type !== 'junction') {
        const onEdge = {
          left: port.x === 0,
          right: port.x === geometry.width,
          top: port.y === 0,
          bottom: port.y === geometry.height,
        }[port.side];
        assert.ok(onEdge, `${name}: declares side ${port.side} but does not sit on that edge`);
      }
    }
  });

  test(`${type}: draws deterministically and emits no inline colour`, () => {
    const component = { id: 'X1', type, pos: [0, 0] };
    const { config, geometry } = resolveComponent(component);
    const first = symbol.draw({ config, geometry, component });
    const second = symbol.draw({ config, geometry, component });

    assert.equal(typeof first, 'string');
    assert.ok(first.length > 0, 'a symbol must draw something');
    assert.equal(first, second, 'two draws of the same config must be byte-identical');

    // Styling is semantic so the same SVG inverts correctly in the viewer's dark
    // mode. currentColor is the one permitted fill, since it inherits.
    const inlineColour = first.match(/(?:fill|stroke)="(?!none|currentColor)[^"]+"/);
    assert.equal(inlineColour, null, `inline colour found: ${inlineColour?.[0]}`);
  });

  test(`${type}: describes itself for the bill of materials`, () => {
    const { config } = resolveComponent({ id: 'X1', type, pos: [0, 0] });
    const description = symbol.describe({ config, params: {} });
    assert.equal(typeof description, 'string');
    assert.ok(description.length > 3, 'BOM description must be meaningful');
  });
}

test('cylinder: both working ports are required, so a dead rod port is an error', () => {
  const { ports } = resolveComponent({ id: 'C1', type: 'cylinder', pos: [0, 0] });
  assert.equal(ports.cap.criticality, CRITICALITY.REQUIRED);
  assert.equal(ports.rod.criticality, CRITICALITY.REQUIRED);
});

test('cylinder: A and B resolve to cap and rod', () => {
  const { ports } = resolveComponent({ id: 'C1', type: 'cylinder', pos: [0, 0] });
  assert.equal(findPort(ports, 'A').id, 'cap');
  assert.equal(findPort(ports, 'B').id, 'rod');
  assert.equal(findPort(ports, 'nonexistent'), null);
});

test('single-acting cylinder has no rod port to connect', () => {
  const { ports } = resolveComponent({
    id: 'C1', type: 'cylinder', pos: [0, 0], config: { cylinder_type: 'single_acting', spring_return: true },
  });
  assert.equal(ports.rod, undefined);
  assert.equal(ports.cap.criticality, CRITICALITY.REQUIRED);
  assert.equal(ports.vent.criticality, CRITICALITY.OPTIONAL);
});

test('pump case drain is optional, because a real one is routinely plugged', () => {
  const withDrain = resolveComponent({ id: 'P1', type: 'pump', pos: [0, 0], config: { has_case_drain: true } });
  assert.equal(withDrain.ports.case_drain.criticality, CRITICALITY.OPTIONAL);
  const without = resolveComponent({ id: 'P1', type: 'pump', pos: [0, 0] });
  assert.equal(without.ports.case_drain, undefined);
});

test('an authored plug silences a port without changing the symbol', () => {
  const { ports } = resolveComponent({
    id: 'V1', type: 'directional_control_valve', pos: [0, 0], ports: { B: { plugged: true } },
  });
  assert.equal(ports.B.plugged, true);
  assert.equal(ports.A.plugged, false);
});

test('applied defaults are reported so they can become recorded assumptions', () => {
  const bare = resolveComponent({ id: 'V1', type: 'directional_control_valve', pos: [0, 0] });
  assert.ok(bare.defaulted.includes('configuration'));
  assert.ok(bare.defaulted.includes('center_condition'));

  const authored = resolveComponent({
    id: 'V1', type: 'directional_control_valve', pos: [0, 0], config: { configuration: '4/2' },
  });
  assert.ok(!authored.defaulted.includes('configuration'));
  assert.ok(authored.defaulted.includes('center_condition'));
});
