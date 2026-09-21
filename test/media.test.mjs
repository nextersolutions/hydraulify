// Media resolution.
//
// Most of these build port tables by hand rather than loading symbols, for two
// reasons: the air-side symbols do not exist yet when this layer is written, and
// a hand-built table states exactly the constraint under test with nothing else
// in the way. The last tests run real models, to prove every circuit written
// before media existed still resolves to oil with no new findings.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveMedia } from '../validate/media.mjs';
import { validateModel } from '../validate/index.mjs';
import { MEDIA, port } from '../renderers/symbols/contract.mjs';
import { resolveComponent } from '../renderers/symbols/index.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * components: { X1: { type, ports: { name: { medium, group } } } }
 * links:      [['X1.a', 'X2.b', line?], ...]
 */
function build(components, links) {
  const resolved = new Map();
  for (const [id, { type = 'thing', ports }] of Object.entries(components)) {
    const table = {};
    for (const [name, spec] of Object.entries(ports)) {
      table[name] = { id: name, medium: spec.medium ?? 'any', group: spec.group ?? 'main' };
    }
    resolved.set(id, { component: { id, type }, ports: table });
  }
  const connections = links.map(([from, to, line = 'pressure'], index) => {
    const end = (reference) => {
      const [componentId, portName] = reference.split('.');
      const target = resolved.get(componentId);
      return { componentId, port: target.ports[portName], target };
    };
    return { from, to, line, label: `c${index}`, endpoints: { from: end(from), to: end(to) } };
  });
  return { resolved, connections };
}

const run = (components, links) => {
  const { resolved, connections } = build(components, links);
  return resolveMedia(resolved, connections);
};

const codes = (result) => result.diagnostics.map((item) => item.code);

test('a run of medium-neutral parts resolves to oil, silently', () => {
  const result = run(
    { A: { ports: { out: {} } }, B: { ports: { in: {}, out: {} } }, C: { ports: { in: {} } } },
    [['A.out', 'B.in'], ['B.out', 'C.in']],
  );
  assert.deepEqual(codes(result), []);
  assert.deepEqual([...result.connectionMedia.values()], ['oil', 'oil']);
});

test('air passes through medium-neutral parts to every line of the run', () => {
  const result = run(
    {
      SRC: { ports: { out: { medium: 'air' } } },
      V: { ports: { in: {}, out: {} } },
      J: { ports: { left: {}, right: {}, top: {} } },
      SINK: { ports: { in: { medium: 'air' } } },
      G: { ports: { in: {} } },
    },
    [['SRC.out', 'V.in'], ['V.out', 'J.left'], ['J.right', 'SINK.in'], ['J.top', 'G.in']],
  );
  assert.deepEqual(codes(result), []);
  assert.deepEqual([...result.connectionMedia.values()], ['air', 'air', 'air', 'air']);
});

test('air meeting liquid is an error that names the ports on each side, not the neutral ones', () => {
  const result = run(
    {
      T: { ports: { in: { medium: 'air' } } },
      V: { ports: { in: {}, out: {} } },
      P: { ports: { out: { medium: 'liquid' } } },
    },
    [['P.out', 'V.in'], ['V.out', 'T.in']],
  );
  assert.deepEqual(codes(result), ['media/conflict']);
  const [finding] = result.diagnostics;
  assert.equal(finding.severity, 'error');
  assert.match(finding.message, /air \(T\.in\)/);
  assert.match(finding.message, /liquid \(P\.out\)/);
  assert.doesNotMatch(finding.message, /V\./, 'a neutral port never causes a conflict and should not be blamed');
  assert.deepEqual(finding.evidence.components, ['P', 'T', 'V']);
  assert.deepEqual([...result.connectionMedia.values()], [null, null]);
});

test('separate port groups carry separate fluids without conflict', () => {
  // An accumulator-shaped component: air on top, water below.
  const result = run(
    {
      ACC: { ports: { gas: { medium: 'air', group: 'gas' }, liquid: { medium: 'water', group: 'liquid' } } },
      AIR: { ports: { out: {} } },
      BASIN: { ports: { out: { medium: 'liquid' } } },
    },
    [['AIR.out', 'ACC.gas'], ['BASIN.out', 'ACC.liquid']],
  );
  assert.deepEqual(codes(result), []);
  assert.deepEqual([...result.connectionMedia.values()], ['air', 'water']);
  assert.equal(result.groupMedia.get('ACC#gas'), 'air');
  assert.equal(result.groupMedia.get('ACC#liquid'), 'water');
});

test('ports in one group share a fluid, so a component cannot pass air in and liquid out', () => {
  const result = run(
    {
      CV: { ports: { in: {}, out: {} } },
      SRC: { ports: { out: { medium: 'air' } } },
      DST: { ports: { in: { medium: 'water' } } },
    },
    [['SRC.out', 'CV.in'], ['CV.out', 'DST.in']],
  );
  assert.deepEqual(codes(result), ['media/conflict']);
});

test('a liquid class narrows to the concrete liquid it meets, and to oil when it meets none', () => {
  const water = run(
    { P: { ports: { out: { medium: 'liquid' } } }, R: { ports: { in: { medium: 'water' } } } },
    [['P.out', 'R.in']],
  );
  assert.deepEqual(codes(water), []);
  assert.equal(water.connectionMedia.get('c0'), 'water');

  const unstated = run(
    { P: { ports: { out: { medium: 'liquid' } } }, V: { ports: { in: {} } } },
    [['P.out', 'V.in']],
  );
  assert.deepEqual(codes(unstated), []);
  assert.equal(unstated.connectionMedia.get('c0'), 'oil');
});

test('a gas class nothing narrows is assumed, and says so', () => {
  const result = run(
    { X: { ports: { out: { medium: 'gas' } } }, V: { ports: { in: {} } } },
    [['X.out', 'V.in']],
  );
  assert.deepEqual(codes(result), ['media/unresolved']);
  assert.equal(result.diagnostics[0].severity, 'info');
  assert.equal(result.connectionMedia.get('c0'), 'air');
});

test('a shaft to shaft connection typed mechanical carries no fluid and raises nothing', () => {
  const result = run(
    {
      TURB: { ports: { inlet: { medium: 'air' }, shaft: { medium: 'mechanical' } } },
      GEN: { ports: { shaft: { medium: 'mechanical' } } },
    },
    [['TURB.shaft', 'GEN.shaft', 'mechanical']],
  );
  assert.deepEqual(codes(result), []);
  assert.equal(result.connectionMedia.get('c0'), 'mechanical');
  assert.equal(result.groupMedia.has('TURB#main'), true, 'the fluid side still resolves');
  assert.equal([...result.groupMedia.keys()].some((key) => key.startsWith('GEN')), false, 'a shaft is not a fluid group');
});

test('every way of mixing shafts and fluid is an error', () => {
  const machines = {
    M1: { ports: { shaft: { medium: 'mechanical' } } },
    M2: { ports: { shaft: { medium: 'mechanical' } } },
    V: { ports: { in: {}, out: {} } },
    W: { ports: { in: {} } },
  };
  const shaftAsPressure = run(machines, [['M1.shaft', 'M2.shaft', 'pressure']]);
  assert.deepEqual(codes(shaftAsPressure), ['media/mechanical-mismatch']);
  assert.match(shaftAsPressure.diagnostics[0].message, /must be typed "mechanical"/);

  const shaftToFluid = run(machines, [['M1.shaft', 'V.in', 'mechanical']]);
  assert.deepEqual(codes(shaftToFluid), ['media/mechanical-mismatch']);
  assert.match(shaftToFluid.diagnostics[0].message, /M1\.shaft is a shaft but V\.in carries fluid/);

  const fluidAsMechanical = run(machines, [['V.out', 'W.in', 'mechanical']]);
  assert.deepEqual(codes(fluidAsMechanical), ['media/mechanical-mismatch']);
  assert.match(fluidAsMechanical.diagnostics[0].message, /which is for shafts/);
});

test('a shaft routed into a junction is refused with the reason, not just the mismatch', () => {
  const result = run(
    {
      M: { ports: { shaft: { medium: 'mechanical' } } },
      J: { type: 'junction', ports: { left: {}, right: {} } },
    },
    [['M.shaft', 'J.left', 'mechanical']],
  );
  assert.deepEqual(codes(result), ['media/mechanical-mismatch']);
  assert.match(result.diagnostics[0].message, /cannot branch through junction J/);
});

test('resolution does not depend on the order connections were written in', () => {
  const components = {
    SRC: { ports: { out: { medium: 'air' } } },
    V: { ports: { in: {}, out: {} } },
    SINK: { ports: { in: {} } },
    P: { ports: { out: { medium: 'liquid' } } },
    Q: { ports: { in: {} } },
  };
  const links = [['SRC.out', 'V.in'], ['V.out', 'SINK.in'], ['P.out', 'Q.in']];
  const forward = run(components, links);
  const reversed = run(components, [...links].reverse());
  assert.deepEqual([...forward.groupMedia.entries()], [...reversed.groupMedia.entries()]);
  assert.deepEqual(forward.diagnostics, reversed.diagnostics);
});

test('a port refuses a medium it does not know', () => {
  assert.throws(() => port('x', 0, 0, 'top', { medium: 'hydrogen' }), /unknown medium hydrogen/);
  assert.equal(port('x', 0, 0, 'top').medium, 'any');
  assert.equal(port('x', 0, 0, 'top').group, 'main');
});

test('the schema and the symbol contract agree on the list of fluids', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'hydraulic-circuit.schema.json'), 'utf8'));
  assert.deepEqual([...schema.$defs.medium.enum].sort(), [...MEDIA].sort());
  assert.ok(schema.$defs.lineType.enum.includes('mechanical'));
});

test('every worked example still resolves to oil on every line, with no media findings', () => {
  const examples = fs.readdirSync(path.join(root, 'examples')).filter((name) => name.endsWith('.json'));
  assert.ok(examples.length >= 5);
  for (const name of examples) {
    const model = JSON.parse(fs.readFileSync(path.join(root, 'examples', name), 'utf8'));
    const result = validateModel(model);
    assert.equal(result.ok, true, `${name} should still validate`);
    assert.deepEqual(result.diagnostics.filter((item) => item.code.startsWith('media/')), [], name);
    for (const connection of result.connections) {
      assert.equal(connection.medium, 'oil', `${name}: ${connection.label}`);
    }
  }
});

test('real symbols carry their declarations: pump, motor and reservoir are liquid-only', () => {
  for (const [type, config] of [['pump', { has_case_drain: true }], ['motor', {}], ['reservoir', {}]]) {
    const { ports } = resolveComponent({ id: 'X', type, pos: [0, 0], config });
    for (const definition of Object.values(ports)) {
      assert.equal(definition.medium, 'liquid', `${type}.${definition.id}`);
    }
  }
  const { ports: valve } = resolveComponent({ id: 'V', type: 'check_valve', pos: [0, 0] });
  assert.equal(valve.inlet.medium, 'any');
});

test('a mechanical line on a real pump inlet is refused end to end', () => {
  const model = JSON.parse(fs.readFileSync(path.join(root, 'examples', '02-solenoid-cylinder.json'), 'utf8'));
  const suction = model.connections.find((connection) => connection.to === 'P1.inlet' || connection.from === 'P1.inlet');
  suction.line = 'mechanical';
  const result = validateModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'media/mechanical-mismatch'));
});
