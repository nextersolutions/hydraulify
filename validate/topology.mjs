// Domain validation: does this circuit hold together hydraulically?
//
// The schema layer already proved the model is well formed. This layer asks the
// questions a reviewer would ask, and grades them honestly:
//
//   error   - the topology is clearly invalid; nothing is drawn
//   warning - it may be valid, but something is suspicious or unspecified
//   info    - a design decision is missing but it does not prevent drawing
//
// Two principles run through every rule here. Nothing is ever invented to make a
// circuit pass, and no rule rejects a construction that competent engineers
// actually use -- a validator that flags legitimate work teaches people to ignore
// it, which is worse than having none.

import { resolveComponent, findPort } from '../renderers/symbols/index.mjs';
import { error, warning, info } from '../renderers/shared/diagnostics.mjs';
import { resolveMedia } from './media.mjs';
import { fluidGraph, traces, shaftTrains, isLiquid, isGas } from './paths.mjs';

/** Parse "P1.outlet" into its two halves. */
export function parsePortRef(reference) {
  const dot = reference.indexOf('.');
  return { componentId: reference.slice(0, dot), portName: reference.slice(dot + 1) };
}

// Config choices that change how the circuit behaves. When one of these is
// defaulted rather than authored, an assumption must be on the record.
const LOAD_BEARING_CONFIG = {
  directional_control_valve: ['configuration', 'center_condition', 'actuation'],
  cylinder: ['cylinder_type'],
  // Generator, motor or motor-generator decides the shaft arrangement: how many
  // machines there are and which way power flows through the train.
  electrical_machine: ['role'],
};

// Parameters whose absence a reviewer would raise. Everything else that is
// unspecified is reported at info level instead, so the warning list stays
// meaningful.
const KEY_PARAMS = {
  pump: [['flow_lpm', 'flow_gpm', 'displacement_cm3_rev', 'displacement_in3_rev'], 'delivery (flow or displacement)'],
  relief_valve: [['setting_bar', 'setting_psi'], 'pressure setting'],
  counterbalance_valve: [['setting_bar', 'setting_psi'], 'pressure setting'],
  cylinder: [['bore_mm', 'bore_in'], 'bore'],
  turbine: [['power_kw', 'power_hp'], 'rated power'],
  compressor: [['flow_nm3h', 'flow_scfm', 'mass_flow_kgs', 'mass_flow_lbs'], 'delivery (normal volume or mass flow)'],
  electrical_machine: [['power_kw', 'power_hp'], 'rated power'],
  pressure_regulator: [['setting_bar', 'setting_psi'], 'pressure setting'],
  air_receiver: [['volume_l', 'volume_gal'], 'volume'],
};

const SECONDARY_PARAMS = {
  cylinder: [[['stroke_mm', 'stroke_in'], 'stroke'], [['rod_mm', 'rod_in'], 'rod diameter']],
  motor: [[['displacement_cm3_rev', 'displacement_in3_rev'], 'displacement']],
  accumulator: [[['volume_l', 'volume_gal'], 'volume'], [['precharge_bar', 'precharge_psi'], 'pre-charge pressure']],
  filter: [[['rating_micron'], 'filtration rating']],
  reservoir: [[['volume_l', 'volume_gal'], 'volume']],
  pressure_gauge: [[['range_bar', 'range_psi'], 'range']],
  flow_control_valve: [[['flow_lpm', 'flow_gpm'], 'flow setting']],
  turbine: [[['mass_flow_kgs', 'mass_flow_lbs', 'flow_nm3h', 'flow_scfm'], 'air flow']],
  compressor: [[['max_pressure_bar', 'max_pressure_psi'], 'discharge pressure']],
  heat_exchanger: [[['power_kw', 'power_hp'], 'duty']],
  air_receiver: [[['max_pressure_bar', 'max_pressure_psi'], 'maximum pressure']],
};

function hasValue(params, names) {
  return names.some((name) => params?.[name] !== undefined && params?.[name] !== null);
}

/**
 * Validate a schema-valid model.
 * @returns {{ diagnostics: Array, resolved: Map, connections: Array }}
 */
export function validateTopology(model) {
  const diagnostics = [];
  const resolved = new Map();

  // --- components resolve, ids are unique -----------------------------------
  const seenIds = new Set();
  for (const component of model.components) {
    if (seenIds.has(component.id)) {
      diagnostics.push(error({
        code: 'model/duplicate-component-id',
        subject: { component: component.id },
        message: `Component id ${component.id} is used more than once.`,
        evidence: { id: component.id },
        supportedFixes: ['give each component a unique id'],
      }));
      continue;
    }
    seenIds.add(component.id);
    try {
      resolved.set(component.id, { component, ...resolveComponent(component) });
    } catch (resolutionError) {
      diagnostics.push(error({
        code: 'model/unsupported-component-type',
        subject: { component: component.id, type: component.type },
        message: resolutionError.message,
        evidence: { type: component.type },
        supportedFixes: ['use a supported component type, or model the function with supported components'],
      }));
    }
  }

  // --- connections resolve to real ports ------------------------------------
  const connections = [];
  const portUsage = new Map(); // "C1.cap" -> [connection index, ...]
  const seenConnectionIds = new Set();

  model.connections.forEach((connection, index) => {
    if (connection.id) {
      if (seenConnectionIds.has(connection.id)) {
        diagnostics.push(error({
          code: 'model/duplicate-connection-id',
          subject: { connection: connection.id },
          message: `Connection id ${connection.id} is used more than once.`,
          evidence: { id: connection.id },
          supportedFixes: ['give each connection a unique id, or omit the id'],
        }));
      }
      seenConnectionIds.add(connection.id);
    }

    const label = connection.id ?? `connections[${index}]`;
    const endpoints = {};
    let resolvable = true;

    for (const end of ['from', 'to']) {
      const { componentId, portName } = parsePortRef(connection[end]);
      const target = resolved.get(componentId);
      if (!target) {
        diagnostics.push(error({
          code: 'topology/unknown-component',
          subject: { connection: label, [end]: connection[end] },
          message: `${connection[end]} refers to component ${componentId}, which is not in the model.`,
          evidence: { componentId, known: [...resolved.keys()] },
          supportedFixes: [`add component ${componentId}`, 'correct the component id in the port reference'],
        }));
        resolvable = false;
        continue;
      }
      const port = findPort(target.ports, portName);
      if (!port) {
        diagnostics.push(error({
          code: 'topology/unknown-port',
          subject: { connection: label, [end]: connection[end], component: componentId },
          message: `${componentId} (${target.component.type}) has no port "${portName}".`,
          evidence: { available: Object.keys(target.ports), configuration: target.config },
          supportedFixes: [
            `use one of: ${Object.keys(target.ports).join(', ')}`,
            'check the component configuration: the available ports depend on it',
          ],
        }));
        resolvable = false;
        continue;
      }
      endpoints[end] = { componentId, port, target };
    }

    if (!resolvable) return;

    // A port takes exactly one connection. Branching happens at an explicit
    // junction, so that the tee has a position the author chose rather than one
    // the router invented.
    for (const end of ['from', 'to']) {
      const key = `${endpoints[end].componentId}.${endpoints[end].port.id}`;
      const users = portUsage.get(key) ?? [];
      users.push(label);
      portUsage.set(key, users);
    }

    if (endpoints.from.componentId === endpoints.to.componentId) {
      diagnostics.push(error({
        code: 'topology/self-connection',
        subject: { connection: label, component: endpoints.from.componentId },
        message: `${connection.from} is connected to ${connection.to} on the same component.`,
        evidence: { from: connection.from, to: connection.to },
        supportedFixes: ['connect the port to a different component', 'remove the connection'],
      }));
      return;
    }

    // `label` becomes the identifier findings use; what the author wrote to be
    // printed beside the line travels on as `authoredLabel`.
    connections.push({ ...connection, authoredLabel: connection.label, index, label, endpoints });
  });

  for (const [portKey, users] of portUsage) {
    if (users.length > 1) {
      diagnostics.push(error({
        code: 'topology/port-overloaded',
        subject: { port: portKey },
        message: `${portKey} carries ${users.length} connections. A port takes one line; a branch needs an explicit junction.`,
        evidence: { connections: users },
        supportedFixes: [
          'add a junction component and route each branch to one of its ports',
          'remove the surplus connection',
        ],
      }));
    }
  }

  // --- unconnected ports, graded by criticality -----------------------------
  for (const [id, entry] of resolved) {
    for (const port of Object.values(entry.ports)) {
      const key = `${id}.${port.id}`;
      if (portUsage.has(key) || port.plugged) continue;
      if (port.criticality === 'optional') continue;

      const shared = {
        subject: { component: id, port: port.id, type: entry.component.type },
        evidence: { criticality: port.criticality, portLabel: port.label },
      };
      if (port.criticality === 'required') {
        diagnostics.push(error({
          ...shared,
          code: 'topology/required-port-unconnected',
          message: `${id}.${port.id} is not connected, and ${entry.component.type} cannot function without it.`,
          supportedFixes: [
            `connect ${id}.${port.id} to the rest of the circuit`,
            'if the port really is plugged in the assembly, mark it: "ports": { "' + port.id + '": { "plugged": true } }',
          ],
        }));
      } else {
        diagnostics.push(warning({
          ...shared,
          code: 'topology/port-unconnected',
          message: `${id}.${port.id} is not connected.`,
          supportedFixes: [
            `connect ${id}.${port.id}`,
            `mark it plugged if that is intended: "ports": { "${port.id}": { "plugged": true } }`,
          ],
        }));
      }
    }
  }

  // --- isolated components and disconnected sub-circuits --------------------
  const adjacency = new Map([...resolved.keys()].map((id) => [id, new Set()]));
  for (const connection of connections) {
    adjacency.get(connection.endpoints.from.componentId)?.add(connection.endpoints.to.componentId);
    adjacency.get(connection.endpoints.to.componentId)?.add(connection.endpoints.from.componentId);
  }

  for (const [id, neighbours] of adjacency) {
    if (neighbours.size === 0) {
      diagnostics.push(error({
        code: 'topology/isolated-component',
        subject: { component: id, type: resolved.get(id)?.component.type },
        message: `${id} has no connections at all.`,
        evidence: {},
        supportedFixes: [`connect ${id} to the circuit`, `remove ${id} from the model`],
      }));
    }
  }

  const islands = connectedGroups(adjacency);
  if (islands.length > 1) {
    const sorted = [...islands].sort((left, right) => right.length - left.length);
    for (const island of sorted.slice(1)) {
      if (island.length === 1 && adjacency.get(island[0])?.size === 0) continue; // already reported
      diagnostics.push(warning({
        code: 'topology/disconnected-subcircuit',
        subject: { components: island.join(', ') },
        message: `${island.join(', ')} form a sub-circuit with no hydraulic path to the rest of the drawing.`,
        evidence: { island, islandCount: islands.length },
        supportedFixes: [
          'connect the sub-circuit to the main circuit',
          'if two independent circuits on one drawing is intended, no change is needed',
        ],
      }));
    }
  }

  // --- junction degree ------------------------------------------------------
  for (const [id, entry] of resolved) {
    if (entry.component.type !== 'junction') continue;
    const degree = [...portUsage.keys()].filter((key) => key.startsWith(`${id}.`)).length;
    const declared = entry.config.way;
    if (degree !== declared) {
      diagnostics.push(error({
        code: 'topology/junction-degree',
        subject: { component: id },
        message: `Junction ${id} is declared ${declared}-way but carries ${degree} connection${degree === 1 ? '' : 's'}.`,
        evidence: { declared, actual: degree },
        supportedFixes: [
          `set "config": { "way": ${degree} } if that is the intended tee`,
          'connect the missing branch',
          degree < 2 ? `remove junction ${id} and connect the two ends directly` : 'remove the surplus branch',
        ],
      }));
    }
  }

  // --- media: which fluid each line carries ---------------------------------
  const media = resolveMedia(resolved, connections);
  diagnostics.push(...media.diagnostics);
  for (const connection of connections) {
    connection.medium = media.connectionMedia.get(connection.label) ?? null;
  }

  diagnostics.push(...checkLineSemantics(connections, resolved));
  diagnostics.push(...checkHydraulicPaths(connections, resolved, media.groupMedia));
  diagnostics.push(...checkShafts(connections, resolved));
  diagnostics.push(...checkHeatSources(resolved, connections, media.groupDefaulted));
  diagnostics.push(...checkParameters(resolved));
  diagnostics.push(...checkAssumptions(model, resolved));

  return { diagnostics, resolved, connections, groupMedia: media.groupMedia };
}

function connectedGroups(adjacency) {
  const seen = new Set();
  const groups = [];
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const group = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const id = queue.shift();
      group.push(id);
      for (const neighbour of adjacency.get(id) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
    groups.push(group.sort());
  }
  return groups;
}

/**
 * Line type against the ports it joins. Getting this wrong is not cosmetic: a
 * control line rendered as a working line tells the reader the circuit does
 * something it does not do.
 */
/**
 * The line type a port expects, or null when any will do. `required` is a hard
 * rule, `preferred` a strong convention. Exported so the editor proposes a new
 * line's type from the same rules the validator then checks it against.
 */
export function lineExpectation(componentType, portId, farType) {
  if (portId === 'pilot') return { required: ['pilot'], why: 'a pilot port carries a control line' };
  if (portId === 'case_drain') return { preferred: ['drain'], why: 'a case drain carries leakage back to tank' };
  // A compensation basin feeds a water-compensated store by head, not through
  // a pump, so its outlet line is not a suction line.
  if (componentType === 'reservoir' && portId === 'outlet' && farType !== 'accumulator') return { preferred: ['suction'], why: 'a pump draws from the reservoir through a suction line' };
  if (componentType === 'reservoir' && portId === 'return') return { preferred: ['return', 'drain'], why: 'lines entering the reservoir are return or drain lines' };
  if (componentType === 'pump' && portId === 'inlet') return { preferred: ['suction'], why: 'a pump inlet is fed by a suction line' };
  if (componentType === 'pump' && portId === 'outlet') return { preferred: ['pressure'], why: 'a pump delivers into a pressure line' };
  if (componentType === 'directional_control_valve' && portId === 'P') return { preferred: ['pressure'], why: 'the P port is fed from the pressure line' };
  if (componentType === 'directional_control_valve' && portId === 'T') return { preferred: ['return'], why: 'the T port returns to tank' };
  if (componentType === 'cylinder' && (portId === 'cap' || portId === 'rod')) return { preferred: ['working'], why: 'an actuator line reverses with the spool, so it is a working line' };
  return null;
}

function checkLineSemantics(connections, resolved) {
  const diagnostics = [];
  const expectation = lineExpectation;

  for (const connection of connections) {
    for (const end of ['from', 'to']) {
      const { componentId, port, target } = connection.endpoints[end];
      const far = connection.endpoints[end === 'from' ? 'to' : 'from'].target.component.type;
      const rule = expectation(target.component.type, port.id, far);
      if (!rule) continue;

      if (rule.required && !rule.required.includes(connection.line)) {
        diagnostics.push(error({
          code: 'hydraulic/line-type-invalid',
          subject: { connection: connection.label, port: `${componentId}.${port.id}` },
          message: `${componentId}.${port.id} is a control port but the line is typed "${connection.line}". It must be a pilot line, because ${rule.why}.`,
          evidence: { line: connection.line, required: rule.required },
          supportedFixes: [`set "line": "${rule.required[0]}"`],
        }));
      } else if (rule.preferred && !rule.preferred.includes(connection.line)) {
        diagnostics.push(warning({
          code: 'hydraulic/line-type-unexpected',
          subject: { connection: connection.label, port: `${componentId}.${port.id}` },
          message: `${componentId}.${port.id} is connected by a "${connection.line}" line; ${rule.why}.`,
          evidence: { line: connection.line, expected: rule.preferred },
          supportedFixes: [
            `set "line": "${rule.preferred[0]}" if that is what the line is`,
            'leave it if the circuit really works this way',
          ],
        }));
      }
    }

    // Obvious port-compatibility failures, from the brief's own examples.
    const pair = [connection.endpoints.from, connection.endpoints.to];
    const cylinderEnd = pair.find((end) => end.target.component.type === 'cylinder' && ['cap', 'rod'].includes(end.port.id));
    const reservoirEnd = pair.find((end) => end.target.component.type === 'reservoir');
    if (cylinderEnd && reservoirEnd) {
      diagnostics.push(error({
        code: 'hydraulic/actuator-to-tank',
        subject: { connection: connection.label, between: `${connection.from} -> ${connection.to}` },
        message: `${cylinderEnd.componentId}.${cylinderEnd.port.id} is connected straight to the reservoir. A working port tied to tank cannot hold or move a load.`,
        evidence: { from: connection.from, to: connection.to },
        supportedFixes: [
          'route the actuator port through a directional valve',
          'if this is a vent on a single-acting cylinder, use the vent port instead',
        ],
      }));
    }

    const pumpOutlet = pair.find((end) => end.target.component.type === 'pump' && end.port.id === 'outlet');
    const pumpInlet = pair.find((end) => end.target.component.type === 'pump' && end.port.id === 'inlet');
    if (pumpOutlet && pumpInlet) {
      diagnostics.push(error({
        code: 'hydraulic/pump-to-pump',
        subject: { connection: connection.label, between: `${connection.from} -> ${connection.to}` },
        message: `${pumpOutlet.componentId} delivers directly into the inlet of ${pumpInlet.componentId}.`,
        evidence: { from: connection.from, to: connection.to },
        supportedFixes: [
          'feed the second pump from the reservoir',
          'if a boost circuit is intended, show the charge and relief arrangement explicitly',
        ],
      }));
    }
  }

  return diagnostics;
}

const MEDIUM_WORDS = { oil: 'oil', water: 'water', thermal_oil: 'thermal oil', air: 'air', nitrogen: 'nitrogen', steam: 'steam', flue_gas: 'flue gas' };

/**
 * Whole-circuit paths: where each fluid comes from, and where it goes.
 *
 * Traced per fluid, over port groups (see paths.mjs), so a trace never crosses
 * from air to water through a heat exchanger or along a shaft. Liquids circulate:
 * they are drawn from a reservoir and returned to one. Gases flow through: air
 * comes from a compressor, a store or an intake, and leaves to atmosphere. A
 * boundary stands in for either end, because the drawing honestly stops there.
 */
function checkHydraulicPaths(connections, resolved, groupMedia) {
  const diagnostics = [];
  const graph = fluidGraph(connections);
  const typeOf = (id) => resolved.get(id)?.component.type;
  const idsOfType = (type) => [...resolved.keys()].filter((id) => typeOf(id) === type);
  const connected = (id, port) => graph.attached.has(`${id}.${port}`);
  const boundaryIs = (id, direction) => typeOf(id) === 'boundary' && resolved.get(id).config.direction === direction;
  const mediumOf = (id, group = 'main') => groupMedia?.get(`${id}#${group}`) ?? null;

  const reservoirs = idsOfType('reservoir');
  const liquidBoundaries = idsOfType('boundary').filter((id) => isLiquid(mediumOf(id)));
  const liquidLines = connections.filter((connection) => isLiquid(connection.medium));

  // Liquid ends: where liquid can be drawn from, and where it can go back to.
  const liquidSource = (id) => typeOf(id) === 'reservoir' || (boundaryIs(id, 'from') && isLiquid(mediumOf(id)));
  const liquidSink = (id) => typeOf(id) === 'reservoir' || (boundaryIs(id, 'to') && isLiquid(mediumOf(id)));
  // Gas ends: a compressor, a store or an intake supplies it; atmosphere takes it.
  const airSource = (id, key) => typeOf(id) === 'compressor' || typeOf(id) === 'air_receiver'
    || (typeOf(id) === 'accumulator' && key.endsWith('#gas'))
    || (boundaryIs(id, 'from') && isGas(mediumOf(id)));
  const atmosphere = (id) => typeOf(id) === 'silencer' || (boundaryIs(id, 'to') && isGas(mediumOf(id)));

  if (liquidLines.length && !reservoirs.length && !liquidBoundaries.length) {
    const word = MEDIUM_WORDS[liquidLines[0].medium];
    diagnostics.push(warning({
      code: 'hydraulic/no-reservoir',
      subject: { scope: 'circuit' },
      message: `The circuit carries ${word} but shows no reservoir, so there is nowhere for it to be drawn from or returned to.`,
      evidence: { liquids: [...new Set(liquidLines.map((connection) => connection.medium))] },
      supportedFixes: [
        'add a reservoir and connect the suction and return lines',
        'if the liquid comes from and goes to somewhere this drawing does not show, end those lines on a boundary',
        'if this drawing is a fragment of a larger circuit, no change is needed',
      ],
    }));
  }

  const pumps = idsOfType('pump');
  if (reservoirs.length || liquidBoundaries.length) {
    for (const id of pumps) {
      if (connected(id, 'inlet') && !traces(graph, id, 'inlet', liquidSource)) {
        diagnostics.push(warning({
          code: 'hydraulic/pump-without-source',
          subject: { component: id },
          message: `${id} has a suction connection but no traceable path to a reservoir.`,
          evidence: {},
          supportedFixes: [`route ${id}.inlet to a reservoir outlet, through a suction filter if one is fitted`],
        }));
      }
    }
  }

  // A tank with a pump on it needs a way back. A tank with no pump -- a
  // compensation basin that fills and empties through one line -- does not.
  const returnsToTank = connections.some((connection) => ['from', 'to'].some((end) => (
    connection.endpoints[end].target.component.type === 'reservoir' && connection.endpoints[end].port.id === 'return'
  ))) || liquidBoundaries.some((id) => boundaryIs(id, 'to'));
  if (reservoirs.length && pumps.length && !returnsToTank) {
    diagnostics.push(warning({
      code: 'hydraulic/no-return-path',
      subject: { scope: 'circuit' },
      message: 'No line returns to the reservoir. Liquid delivered by the pump has nowhere to go.',
      evidence: {},
      supportedFixes: [
        'connect the directional valve T port, and the relief valve outlet, back to the reservoir return',
      ],
    }));
  }

  for (const id of idsOfType('relief_valve')) {
    if (!connected(id, 'outlet')) continue;
    const medium = mediumOf(id);
    if (isGas(medium)) {
      if (!traces(graph, id, 'outlet', atmosphere)) {
        diagnostics.push(warning({
          code: 'pneumatic/relief-not-to-atmosphere',
          subject: { component: id },
          message: `${id} relieves ${MEDIUM_WORDS[medium]} to a point with no traceable path to atmosphere.`,
          evidence: { medium },
          supportedFixes: [`vent ${id}.outlet through a silencer`, 'or end it on a boundary marked "to"'],
        }));
      }
    } else if ((reservoirs.length || liquidBoundaries.length) && !traces(graph, id, 'outlet', liquidSink)) {
      diagnostics.push(warning({
        code: 'hydraulic/relief-not-to-tank',
        subject: { component: id },
        message: `${id} discharges to a point with no traceable path to the reservoir.`,
        evidence: {},
        supportedFixes: [`route ${id}.outlet back to the reservoir return`],
      }));
    }
  }

  for (const id of idsOfType('turbine')) {
    if (connected(id, 'inlet') && !traces(graph, id, 'inlet', airSource)) {
      diagnostics.push(warning({
        code: 'pneumatic/turbine-without-supply',
        subject: { component: id },
        message: `${id} has no traceable supply of air: nothing upstream of its inlet stores, compresses or brings in air.`,
        evidence: {},
        supportedFixes: [
          `route ${id}.inlet back to an air receiver, the accumulator's gas side, or a compressor`,
          'or, if the supply is not drawn, end the line on a boundary marked "from"',
        ],
      }));
    }
    if (connected(id, 'exhaust') && !traces(graph, id, 'exhaust', atmosphere)) {
      diagnostics.push(warning({
        code: 'pneumatic/exhaust-not-to-atmosphere',
        subject: { component: id },
        message: `${id} exhausts to a point with no traceable path to atmosphere.`,
        evidence: {},
        supportedFixes: [`end ${id}.exhaust in a silencer`, 'or on a boundary marked "to", for a recuperator or stack not drawn'],
      }));
    }
  }

  for (const id of idsOfType('compressor')) {
    const intake = (other, key) => boundaryIs(other, 'from') || typeOf(other) === 'silencer' || airSource(other, key);
    if (connected(id, 'inlet') && !traces(graph, id, 'inlet', intake)) {
      diagnostics.push(warning({
        code: 'pneumatic/compressor-without-intake',
        subject: { component: id },
        message: `${id} has no traceable intake: nothing upstream of its inlet brings air in.`,
        evidence: {},
        supportedFixes: [`draw the intake: end ${id}.inlet on a boundary marked "from" (ambient air)`],
      }));
    }
  }

  // A declared filter position that contradicts the lines it is wired into.
  for (const [id, entry] of resolved) {
    if (entry.component.type !== 'filter' || !entry.config.position) continue;
    const lines = connections
      .filter((connection) => ['from', 'to'].some((end) => connection.endpoints[end].componentId === id))
      .map((connection) => connection.line);
    if (!lines.length) continue;
    const expected = { suction: 'suction', return: 'return', pressure: 'pressure' }[entry.config.position];
    if (expected && !lines.includes(expected)) {
      diagnostics.push(warning({
        code: 'hydraulic/filter-position-mismatch',
        subject: { component: id },
        message: `${id} is declared a ${entry.config.position} filter but is wired into ${[...new Set(lines)].join(' and ')} line(s).`,
        evidence: { declared: entry.config.position, connectedLines: [...new Set(lines)] },
        supportedFixes: [
          `set "config": { "position": "${[...new Set(lines)][0]}" } to match where it is fitted`,
          'move the filter into the line its declared position implies',
        ],
      }));
    }
  }

  return diagnostics;
}

/**
 * Shaft trains. Every machine's shaft port is required, so an unconnected shaft
 * is already an error; what is left to check is the train as a whole. Nothing
 * driving it cannot turn -- a compressor coupled only to a generator. Nothing
 * driven by it absorbs no power, which is suspicious but not impossible, so it
 * is a warning.
 */
function checkShafts(connections, resolved) {
  const diagnostics = [];
  for (const train of shaftTrains(resolved, connections)) {
    const names = train.members.join(', ');
    if (!train.drivers.length) {
      diagnostics.push(error({
        code: 'mechanical/nothing-drives',
        subject: { components: names },
        message: `${names} are coupled by shafts, but none of them drives the train, so nothing can turn it.`,
        evidence: { members: train.members, driven: train.driven },
        supportedFixes: [
          'couple a driver into the train: a turbine, or an electrical machine with role motor or motor_generator',
          'check the electrical machine role: a generator is driven, it does not drive',
        ],
      }));
    } else if (!train.driven.length) {
      diagnostics.push(warning({
        code: 'mechanical/nothing-driven',
        subject: { components: names },
        message: `${names} are coupled by shafts, but nothing in the train is driven: the power has nowhere to go.`,
        evidence: { members: train.members, drivers: train.drivers },
        supportedFixes: [
          'couple the load the train drives: a compressor, or an electrical machine with role generator or motor_generator',
        ],
      }));
    }
  }
  return diagnostics;
}

/**
 * What heats a preheater is load-bearing: it decides whether the plant burns
 * fuel, draws on stored heat, or recovers its own exhaust. When nothing states
 * it, the utility side falls to the default fluid -- oil -- and the drawing
 * would print "oil" on a line nobody said carries oil. So it is raised. A
 * cooler's medium changes less, and is only noted.
 */
function checkHeatSources(resolved, connections, groupDefaulted) {
  const diagnostics = [];
  const utilityConnected = (id) => connections.some((connection) => ['from', 'to'].some((end) => (
    connection.endpoints[end].componentId === id && connection.endpoints[end].port.group === 'utility'
  )));
  for (const [id, entry] of resolved) {
    if (entry.component.type !== 'heat_exchanger') continue;
    if (!utilityConnected(id) || !groupDefaulted?.has(`${id}#utility`)) continue;
    const heating = entry.config.function !== 'cooling';
    const make = heating ? warning : info;
    diagnostics.push(make({
      code: heating ? 'media/heat-source-unstated' : 'media/cooling-medium-unstated',
      subject: { component: id },
      message: heating
        ? `${id}: nothing states what heats it, so its heating side is drawn as oil by default.`
        : `${id}: nothing states what cools it, so its cooling side is drawn as oil by default.`,
      evidence: { function: entry.config.function },
      supportedFixes: heating
        ? [
          'state it: "config": { "utility_medium": "flue_gas" } for a fired plant, "thermal_oil" or "water" from thermal storage, "steam"',
          'or give the boundary the heat comes from a medium',
        ]
        : ['state it: "config": { "utility_medium": "water" }, or give the cooling boundary a medium'],
    }));
  }
  return diagnostics;
}

/** Unspecified engineering parameters. Never filled in, always reported. */
function checkParameters(resolved) {
  const diagnostics = [];
  for (const [id, entry] of resolved) {
    const { type } = entry.component;
    const params = entry.component.params ?? {};

    const key = KEY_PARAMS[type];
    if (key) {
      const [names, description] = key;
      if (!hasValue(params, names)) {
        diagnostics.push(warning({
          code: 'parameters/key-unspecified',
          subject: { component: id, parameter: description },
          message: `${id}: ${description} is not specified.`,
          evidence: { accepts: names },
          supportedFixes: [
            `state it, for example "params": { "${names[0]}": <value> }`,
            `state it as explicitly unknown: "params": { "${names[0]}": null }`,
          ],
        }));
      }
    }

    for (const [names, description] of SECONDARY_PARAMS[type] ?? []) {
      // A direct-contact store has no gas charge sealed behind a separator, so
      // there is no pre-charge to state.
      if (names.includes('precharge_bar') && entry.config.accumulator_type === 'none') continue;
      if (!hasValue(params, names)) {
        diagnostics.push(info({
          code: 'parameters/unspecified',
          subject: { component: id, parameter: description },
          message: `${id}: ${description} is not specified.`,
          evidence: { accepts: names },
          supportedFixes: [`state it if it is known: "params": { "${names[0]}": <value> }`],
        }));
      }
    }
  }
  return diagnostics;
}

/**
 * Load-bearing choices must be on the record.
 *
 * When a valve configuration, centre condition, actuation or cylinder type was
 * defaulted rather than stated, an assumption entry naming that component has to
 * exist. This is the mechanical half of the rule that engineering assumptions are
 * never hidden -- the other half is that the renderer prints them on the drawing.
 */
function checkAssumptions(model, resolved) {
  const diagnostics = [];
  const assumptions = model.assumptions ?? [];

  for (const [id, entry] of resolved) {
    const loadBearing = LOAD_BEARING_CONFIG[entry.component.type] ?? [];
    // Only a three-position valve has a centre, so a two-position valve that
    // leaves it unstated has not left anything open.
    const applies = (keyName) => keyName !== 'center_condition' || entry.config.configuration === '4/3';
    const defaulted = entry.defaulted.filter((keyName) => loadBearing.includes(keyName) && applies(keyName));
    if (!defaulted.length) continue;

    const covered = assumptions.some((assumption) => assumption.subject === id
      || assumption.subject.startsWith(`${id}.`));
    if (!covered) {
      diagnostics.push(warning({
        code: 'assumptions/undeclared',
        subject: { component: id, defaulted: defaulted.join(', ') },
        message: `${id}: ${defaulted.join(', ')} ${defaulted.length === 1 ? 'was' : 'were'} defaulted rather than stated, with no assumption on the record.`,
        evidence: { defaulted, appliedValues: Object.fromEntries(defaulted.map((keyName) => [keyName, entry.config[keyName]])) },
        supportedFixes: [
          `state the choice in the component config`,
          `record it in "assumptions": [{ "subject": "${id}", "statement": "..." }] so the drawing carries it`,
        ],
      }));
    }
  }

  return diagnostics;
}
