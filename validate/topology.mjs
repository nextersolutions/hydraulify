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
};

// Parameters whose absence a reviewer would raise. Everything else that is
// unspecified is reported at info level instead, so the warning list stays
// meaningful.
const KEY_PARAMS = {
  pump: [['flow_lpm', 'flow_gpm', 'displacement_cm3_rev', 'displacement_in3_rev'], 'delivery (flow or displacement)'],
  relief_valve: [['setting_bar', 'setting_psi'], 'pressure setting'],
  counterbalance_valve: [['setting_bar', 'setting_psi'], 'pressure setting'],
  cylinder: [['bore_mm', 'bore_in'], 'bore'],
};

const SECONDARY_PARAMS = {
  cylinder: [[['stroke_mm', 'stroke_in'], 'stroke'], [['rod_mm', 'rod_in'], 'rod diameter']],
  motor: [[['displacement_cm3_rev', 'displacement_in3_rev'], 'displacement']],
  accumulator: [[['volume_l', 'volume_gal'], 'volume'], [['precharge_bar', 'precharge_psi'], 'pre-charge pressure']],
  filter: [[['rating_micron'], 'filtration rating']],
  reservoir: [[['volume_l', 'volume_gal'], 'volume']],
  pressure_gauge: [[['range_bar', 'range_psi'], 'range']],
  flow_control_valve: [[['flow_lpm', 'flow_gpm'], 'flow setting']],
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

    connections.push({ ...connection, index, label, endpoints });
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
  diagnostics.push(...checkHydraulicPaths(connections, resolved, adjacency));
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
function checkLineSemantics(connections, resolved) {
  const diagnostics = [];

  const expectation = (componentType, portId) => {
    if (portId === 'pilot') return { required: ['pilot'], why: 'a pilot port carries a control line' };
    if (portId === 'case_drain') return { preferred: ['drain'], why: 'a case drain carries leakage back to tank' };
    if (componentType === 'reservoir' && portId === 'outlet') return { preferred: ['suction'], why: 'a pump draws from the reservoir through a suction line' };
    if (componentType === 'reservoir' && portId === 'return') return { preferred: ['return', 'drain'], why: 'lines entering the reservoir are return or drain lines' };
    if (componentType === 'pump' && portId === 'inlet') return { preferred: ['suction'], why: 'a pump inlet is fed by a suction line' };
    if (componentType === 'pump' && portId === 'outlet') return { preferred: ['pressure'], why: 'a pump delivers into a pressure line' };
    if (componentType === 'directional_control_valve' && portId === 'P') return { preferred: ['pressure'], why: 'the P port is fed from the pressure line' };
    if (componentType === 'directional_control_valve' && portId === 'T') return { preferred: ['return'], why: 'the T port returns to tank' };
    if (componentType === 'cylinder' && (portId === 'cap' || portId === 'rod')) return { preferred: ['working'], why: 'an actuator line reverses with the spool, so it is a working line' };
    return null;
  };

  for (const connection of connections) {
    for (const end of ['from', 'to']) {
      const { componentId, port, target } = connection.endpoints[end];
      const rule = expectation(target.component.type, port.id);
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

/** Whole-circuit paths: where oil comes from, and where it goes back to. */
function checkHydraulicPaths(connections, resolved, adjacency) {
  const diagnostics = [];
  const typeOf = (id) => resolved.get(id)?.component.type;
  const reservoirs = [...resolved.keys()].filter((id) => typeOf(id) === 'reservoir');

  // Reach ignoring nothing: a hydraulic path exists if the graph connects them.
  const reaches = (startId, predicate) => {
    const seen = new Set([startId]);
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift();
      if (id !== startId && predicate(id)) return true;
      for (const neighbour of adjacency.get(id) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
    return false;
  };

  if (reservoirs.length === 0) {
    diagnostics.push(warning({
      code: 'hydraulic/no-reservoir',
      subject: { scope: 'circuit' },
      message: 'The circuit shows no reservoir, so there is nowhere for oil to be drawn from or returned to.',
      evidence: {},
      supportedFixes: [
        'add a reservoir and connect the suction and return lines',
        'if this drawing is a fragment of a larger circuit, no change is needed',
      ],
    }));
  }

  for (const [id, entry] of resolved) {
    if (entry.component.type !== 'pump') continue;
    const suctionConnected = connections.some((connection) => (
      ['from', 'to'].some((end) => connection.endpoints[end].componentId === id
        && connection.endpoints[end].port.id === 'inlet')
    ));
    if (suctionConnected && reservoirs.length && !reaches(id, (other) => typeOf(other) === 'reservoir')) {
      diagnostics.push(warning({
        code: 'hydraulic/pump-without-source',
        subject: { component: id },
        message: `${id} has a suction connection but no traceable path to a reservoir.`,
        evidence: {},
        supportedFixes: [`route ${id}.inlet to a reservoir outlet, through a suction filter if one is fitted`],
      }));
    }
  }

  const returnsToTank = connections.some((connection) => (
    ['from', 'to'].some((end) => (
      end === 'to'
        ? connection.endpoints.to.target.component.type === 'reservoir' && connection.endpoints.to.port.id === 'return'
        : connection.endpoints.from.target.component.type === 'reservoir' && connection.endpoints.from.port.id === 'return'
    ))
  ));
  if (reservoirs.length && !returnsToTank) {
    diagnostics.push(warning({
      code: 'hydraulic/no-return-path',
      subject: { scope: 'circuit' },
      message: 'No line returns to the reservoir. Oil delivered by the pump has nowhere to go.',
      evidence: {},
      supportedFixes: [
        'connect the directional valve T port, and the relief valve outlet, back to the reservoir return',
      ],
    }));
  }

  for (const [id, entry] of resolved) {
    if (entry.component.type !== 'relief_valve') continue;
    if (!reservoirs.length) continue;
    const outletConnected = connections.some((connection) => ['from', 'to'].some((end) => (
      connection.endpoints[end].componentId === id && connection.endpoints[end].port.id === 'outlet'
    )));
    if (outletConnected && !reaches(id, (other) => typeOf(other) === 'reservoir')) {
      diagnostics.push(warning({
        code: 'hydraulic/relief-not-to-tank',
        subject: { component: id },
        message: `${id} discharges to a point with no traceable path to the reservoir.`,
        evidence: {},
        supportedFixes: [`route ${id}.outlet back to the reservoir return`],
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
    const defaulted = entry.defaulted.filter((keyName) => loadBearing.includes(keyName));
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
