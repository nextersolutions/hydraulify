// The editor's model operations, run in Node against the real validator.
//
// The editor must never be able to build something the CLI would not accept
// for the reason of how it was built: a tee the editor drew has to be a
// junction the validator agrees with, a renamed component has to take its
// lines along. So most of these build a circuit with the operations alone and
// hand it to the validator.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyse } from '../renderers/pipeline.mjs';
import { validateModel } from '../validate/index.mjs';
import { analyseDraft } from '../editor/draft.mjs';
import { createHistory } from '../editor/history.mjs';
import {
  PALETTE, SUPPORTED_TYPES, QUANTITY_FIELDS, PLACEMENT_CHOICES, SUGGESTED_PARAMS,
  configFields, allParamNames, configFromChoices, initialAnswers,
} from '../editor/catalog.mjs';
import {
  emptyModel, addComponent, connectPorts, connectToLine, deleteComponents, deleteConnections,
  renameComponent, setComponentField, moveComponents, dragSegment, splitConnection, setVia,
  inferLineType, nextComponentId, portAnchor,
} from '../editor/ops.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'hydraulic-circuit.schema.json'), 'utf8'));
const example = (name) => JSON.parse(fs.readFileSync(path.join(root, 'examples', `${name}.json`), 'utf8'));

function routesOf(model) {
  const draft = analyseDraft(model);
  return new Map(draft.layout.routed.map((route) => [route.connection.index, route.points]));
}

const codes = (model, severity) => validateModel(model).diagnostics
  .filter((item) => !severity || item.severity === severity)
  .map((item) => item.code);

// A small circuit built only through the operations.
function buildCircuit() {
  let model = emptyModel('Editor-built circuit');
  const place = (type, pos, config) => {
    const result = addComponent(model, { type, pos, config });
    model = result.model;
    return result.id;
  };
  const T = place('reservoir', [60, 520]);
  const P = place('pump', [40, 380], { pump_type: 'fixed_displacement', drive: 'electric_motor' });
  const RV = place('relief_valve', [240, 300]);
  const V = place('directional_control_valve', [380, 200], configFromChoices('directional_control_valve', initialAnswers('directional_control_valve')));
  const C = place('cylinder', [420, 60], { cylinder_type: 'double_acting' });
  const join = (from, to) => {
    const result = connectPorts(model, from, to, { routes: routesOf(model) });
    assert.ok(!result.error, result.error);
    model = result.model;
    return result;
  };
  join(`${T}.outlet`, `${P}.inlet`);
  join(`${P}.outlet`, `${V}.P`);
  join(`${V}.A`, `${C}.cap`);
  join(`${V}.B`, `${C}.rod`);
  join(`${V}.T`, `${T}.return`);
  // The pump outlet is taken, so this tees into the pressure line.
  const tee = join(`${P}.outlet`, `${RV}.inlet`);
  // So is the reservoir return: the relief's outlet tees into the return line.
  const back = join(`${RV}.outlet`, `${T}.return`);
  return { model, ids: { T, P, RV, V, C }, tee, back };
}

test('the palette offers every supported component exactly once', () => {
  const offered = PALETTE.flatMap((group) => group.types);
  assert.deepEqual([...offered].sort(), [...SUPPORTED_TYPES].sort());
  assert.equal(new Set(offered).size, offered.length);
  for (const type of SUPPORTED_TYPES) assert.ok(SUGGESTED_PARAMS[type], `no parameter suggestions for ${type}`);
});

test('every suggested parameter is one the schema accepts', () => {
  const names = new Set(allParamNames(schema));
  for (const field of Object.values(QUANTITY_FIELDS)) {
    assert.ok(names.has(field.si), `${field.si} is not a schema parameter`);
    assert.ok(names.has(field.imperial), `${field.imperial} is not a schema parameter`);
  }
});

test('inspector fields come from the schema, including nested actuation', () => {
  const fields = configFields(schema, 'directional_control_valve');
  const keys = fields.map((field) => field.key.join('.'));
  assert.ok(keys.includes('configuration'));
  assert.ok(keys.includes('actuation.left'));
  assert.ok(fields.find((field) => field.key.join('.') === 'actuation.left').options.includes('solenoid'));
  const boundary = configFields(schema, 'boundary');
  assert.ok(boundary.find((field) => field.key[0] === 'name').required);
  assert.deepEqual(configFields(schema, 'turbine'), []);
});

test('placement choices state every load-bearing choice, so nothing needs an assumption', () => {
  for (const type of Object.keys(PLACEMENT_CHOICES)) {
    const answers = initialAnswers(type);
    if (type === 'boundary') answers.name = 'ambient';
    const config = configFromChoices(type, answers);
    const { model } = addComponent(emptyModel(), { type, pos: [100, 100], config });
    assert.ok(!codes(model).includes('assumptions/undeclared'), `${type}: ${JSON.stringify(config)}`);
    assert.ok(!codes(model, 'error').some((code) => code.startsWith('schema')), `${type} config fails the schema`);
  }
});

test('a two-position valve is not asked for a centre condition', () => {
  const config = configFromChoices('directional_control_valve', {
    configuration: '4/2', center_condition: 'tandem', actuation: { left: 'solenoid', right: 'none', spring: 'right_return' },
  });
  assert.equal(config.center_condition, undefined);
  const { model } = addComponent(emptyModel(), { type: 'directional_control_valve', pos: [0, 0], config });
  assert.ok(!codes(model).includes('assumptions/undeclared'));
});

test('a valve made two-position loses its centring spring, and one made 4/3 gets it back', () => {
  const two = configFromChoices('directional_control_valve', {
    configuration: '4/2', center_condition: 'closed', actuation: { left: 'solenoid', right: 'solenoid', spring: 'centred' },
  });
  assert.equal(two.actuation.spring, 'right_return');
  const three = configFromChoices('directional_control_valve', {
    configuration: '4/3', center_condition: 'open', actuation: { left: 'lever', right: 'none', spring: 'left_return' },
  });
  assert.equal(three.actuation.spring, 'centred');
  assert.equal(three.center_condition, 'open');
});

test('ids are numbered per type and never reused while taken', () => {
  let model = emptyModel();
  model = addComponent(model, { type: 'pump', pos: [0, 0] }).model;
  model = addComponent(model, { type: 'pump', pos: [100, 0] }).model;
  assert.deepEqual(model.components.map((component) => component.id), ['P1', 'P2']);
  model = deleteComponents(model, ['P1']);
  assert.equal(nextComponentId(model, 'pump'), 'P1');
});

test('a circuit built with the editor operations validates, tees included', () => {
  const { model, tee, back } = buildCircuit();
  const errors = validateModel(model).diagnostics.filter((item) => item.severity === 'error');
  assert.deepEqual(errors.map((item) => item.message), []);
  assert.equal(tee.junctions.length, 1, 'the pump outlet tee got a junction');
  assert.equal(back.junctions.length, 1, 'the reservoir return tee got a junction');
  const junctions = model.components.filter((component) => component.type === 'junction');
  assert.equal(junctions.length, 2);
  for (const junction of junctions) assert.equal(junction.config.way, 3);
  // And it lays out and renders through the real pipeline.
  assert.equal(analyse(model).ok, true);
});

test('line types are proposed from the validator rules', () => {
  const { model, ids } = buildCircuit();
  const lineBetween = (a, b) => model.connections.find((connection) => (
    [connection.from, connection.to].some((ref) => ref.startsWith(`${a}.`))
    && [connection.from, connection.to].some((ref) => ref.startsWith(`${b}.`))
  ))?.line;
  assert.equal(lineBetween(ids.T, ids.P), 'suction');
  assert.equal(lineBetween(ids.V, ids.C), 'working');
  assert.equal(inferLineType(model, `${ids.V}.T`, `${ids.T}.return`), 'return');
  assert.ok(!codes(model).includes('hydraulic/line-type-unexpected'));
});

test('a junction sits exactly on the line it splits', () => {
  const { model } = buildCircuit();
  const draft = analyseDraft(model);
  for (const junction of model.components.filter((component) => component.type === 'junction')) {
    const centre = [junction.pos[0] + 4, junction.pos[1] + 4];
    const lines = draft.layout.routed.filter((route) => [route.connection.from, route.connection.to]
      .some((ref) => ref.startsWith(`${junction.id}.`)));
    assert.equal(lines.length, 3);
    for (const route of lines) {
      const touches = [route.points[0], route.points.at(-1)].some(([x, y]) => x === centre[0] && y === centre[1]);
      assert.ok(touches, `${route.connection.label} does not end at ${junction.id}`);
    }
  }
  assert.ok(!draft.diagnostics.some((item) => item.code === 'layout/junction-side-faces-away'));
});

test('connecting onto the middle of a line tees it with a junction', () => {
  let { model, ids } = buildCircuit();
  model = addComponent(model, { type: 'pressure_gauge', pos: [300, 470], id: 'PG1' }).model;
  const routes = routesOf(model);
  const index = model.connections.findIndex((connection) => connection.to === `${ids.V}.P` || connection.from === `${ids.V}.P`);
  const points = routes.get(index);
  const middle = [(points[1][0] + points[2][0]) / 2, (points[1][1] + points[2][1]) / 2];
  const result = connectToLine(model, 'PG1.inlet', index, points, middle);
  assert.ok(!result.error, result.error);
  assert.ok(!codes(result.model, 'error').length, codes(result.model, 'error').join(', '));
  const gaugeLine = result.model.connections.find((connection) => [connection.from, connection.to].includes('PG1.inlet'));
  assert.equal(gaugeLine.line, 'pressure', 'the branch carries the line type of the line it tees into');
});

test('deleting the branch dissolves its junction back into one line', () => {
  const built = buildCircuit();
  const before = built.model.connections.length;
  const model = deleteComponents(built.model, [built.ids.RV]);
  assert.equal(model.components.filter((component) => component.type === 'junction').length, 0);
  assert.equal(model.connections.length, before - 4, 'two branch lines gone, two pairs of halves merged');
  assert.ok(!codes(model, 'error').length, codes(model, 'error').join(', '));
});

test('deleting a line leaves a junction with three lines as a valid tee', () => {
  let { model } = buildCircuit();
  model = addComponent(model, { type: 'pressure_gauge', pos: [300, 470], id: 'PG1' }).model;
  const routes = routesOf(model);
  const index = model.connections.findIndex((connection) => connection.from.startsWith('J1.') || connection.to.startsWith('J1.'));
  const points = routes.get(index);
  const withGauge = connectToLine(model, 'PG1.inlet', index, points, pointNear(points)).model;
  const gaugeIndex = withGauge.connections.findIndex((connection) => [connection.from, connection.to].includes('PG1.inlet'));
  const after = deleteConnections(withGauge, [gaugeIndex]);
  assert.ok(!codes(after).includes('topology/junction-degree'));
});

function pointNear(points) {
  const [a, b] = [points[0], points[1]];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

test('a line cannot branch at its own end or onto a shaft', () => {
  const { model } = buildCircuit();
  const routes = routesOf(model);
  const points = routes.get(0);
  assert.ok(splitConnection(model, 0, points, points[0]).error);
  const plant = example('06-caes-plant');
  const shaft = plant.connections.findIndex((connection) => connection.line === 'mechanical');
  const shaftRoute = routesOf(plant).get(shaft);
  assert.match(splitConnection(plant, shaft, shaftRoute, pointNear(shaftRoute)).error, /shaft/);
});

test('renaming a component takes its lines and assumptions along', () => {
  const model = example('04-load-holding');
  const result = renameComponent(model, 'CB1', 'CBV1');
  assert.ok(!result.error);
  assert.ok(!JSON.stringify(result.model).includes('"CB1'), 'no reference to the old id survives');
  assert.deepEqual(codes(result.model), codes(model));
  assert.ok(renameComponent(model, 'CB1', 'V1').error, 'a taken id is refused');
  assert.ok(renameComponent(model, 'CB1', '1CB').error, 'an invalid id is refused');
});

test('changing a valve to 2/2 drops the lines on the ports it no longer has', () => {
  const { model, ids } = buildCircuit();
  const result = setComponentField(model, ids.V, ['config', 'configuration'], '2/2');
  assert.equal(result.removed.length, 2);
  assert.ok(!codes(result.model).includes('topology/unknown-port'));
});

test('clearing a field removes it, and empty config objects go with it', () => {
  const { model, ids } = buildCircuit();
  let next = setComponentField(model, ids.RV, ['params', 'setting_bar'], 180).model;
  assert.equal(next.components.find((component) => component.id === ids.RV).params.setting_bar, 180);
  next = setComponentField(next, ids.RV, ['params', 'setting_bar'], undefined).model;
  assert.equal(next.components.find((component) => component.id === ids.RV).params, undefined);
});

test('dragging a run keeps the route square and attached to its ports', () => {
  const route = [[0, 0], [100, 0], [100, 80], [200, 80]];
  const via = dragSegment(route, 1, 30);
  assert.deepEqual(via, [[130, 0], [130, 80]]);
  // A run that leaves a port keeps a stub, then jogs.
  const first = [[0, 0], ...dragSegment(route, 0, 20), [200, 80]];
  for (let index = 0; index < first.length - 1; index += 1) {
    const [a, b] = [first[index], first[index + 1]];
    assert.ok(a[0] === b[0] || a[1] === b[1], `segment ${index} is not orthogonal: ${JSON.stringify(first)}`);
  }
  assert.deepEqual(first[1][1], 0, 'the line still leaves the port horizontally');
  // A single straight line can be pulled into a detour.
  const straight = [[0, 0], ...dragSegment([[0, 0], [120, 0]], 0, 40), [120, 0]];
  assert.ok(straight.some(([, y]) => y === 40));
  assert.deepEqual(straight.at(-2)[1], 0, 'and still enters its far port horizontally');
});

test('moving a component drags the pinned waypoints next to it along', () => {
  const model = example('02-solenoid-cylinder');
  const index = model.connections.findIndex((connection) => connection.line === 'working');
  const route = routesOf(model).get(index);
  const pinned = setVia(model, index, dragSegment(route, 1, 12));
  const connection = pinned.connections[index];
  const moved = moveComponents(pinned, [connection.from.split('.')[0]], 0, 24);
  const draft = analyseDraft(moved);
  assert.ok(!draft.diagnostics.some((item) => item.code === 'layout/authored-route-side' && item.subject.connection === connection.id));
});

test('the draft of a valid example is exactly what the CLI analyses', () => {
  for (const name of ['02-solenoid-cylinder', '06-caes-plant']) {
    const model = example(name);
    const draft = analyseDraft(model);
    const cli = analyse(model);
    assert.deepEqual(draft.diagnostics, cli.diagnostics);
    assert.deepEqual(draft.layout.routed.map((route) => route.points), cli.layout.routed.map((route) => route.points));
    assert.deepEqual(draft.layout.viewBox, cli.layout.viewBox);
  }
});

test('a draft with errors is still drawn', () => {
  let model = example('02-solenoid-cylinder');
  model = addComponent(model, { type: 'pump', pos: [700, 500] }).model;
  const draft = analyseDraft(model);
  assert.equal(draft.ok, false);
  assert.equal(draft.drawable, true);
  assert.ok(draft.layout.frames.has('P2'));
  assert.ok(draft.diagnostics.some((item) => item.code === 'topology/required-port-unconnected'));
});

test('a schema failure does not blank the drawing', () => {
  const model = example('02-solenoid-cylinder');
  model.meta.title = '';
  const draft = analyseDraft(model);
  assert.equal(draft.drawable, true);
  assert.ok(draft.diagnostics.some((item) => item.severity === 'error'));
  assert.equal(analyseDraft(emptyModel()).drawable, true, 'an empty drawing is drawable too');
});

test('undo and redo walk whole models, and an unchanged state is not an edit', () => {
  const history = createHistory(emptyModel());
  const one = addComponent(history.current, { type: 'pump', pos: [0, 0] }).model;
  assert.equal(history.push(one), true);
  assert.equal(history.push(one), false);
  assert.equal(history.undo().components.length, 0);
  assert.equal(history.redo().components.length, 1);
  const current = history.current;
  current.components.push({ id: 'X', type: 'pump', pos: [0, 0] });
  assert.equal(history.current.components.length, 1, 'history is not reachable through a returned model');
});

test('port anchors follow position and mirroring', () => {
  const { model } = addComponent(emptyModel(), { type: 'filter', pos: [100, 50], id: 'F1' });
  const plain = portAnchor(model, 'F1.inlet');
  const mirrored = portAnchor(setComponentField(model, 'F1', ['mirror'], true).model, 'F1.inlet');
  assert.notDeepEqual(plain.point, mirrored.point);
  assert.equal(plain.side === 'left' ? 'right' : 'left', mirrored.side);
});
