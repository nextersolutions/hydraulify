// The validation report.
//
// Two audiences: a person deciding whether the circuit is sound, and an agent
// deciding what to fix. So the report states the verdict, the counts, and then
// every finding with the fixes attached to it.
//
// The topology checklist is computed from the graph, not inferred from the
// absence of errors. "Pump connected to reservoir: yes" means a path was
// actually traced; a check that cannot be evaluated says so rather than
// reporting a pass it did not earn.

import { formatDiagnostic } from '../renderers/shared/diagnostics.mjs';
import { unknownParams } from '../renderers/shared/units.mjs';
import { fluidGraph, traces, shaftTrains, isLiquid, isGas } from './paths.mjs';

const MARK = { pass: '[ok]', fail: '[--]', unknown: '[??]' };

function buildGraph(resolved, connections) {
  const adjacency = new Map([...resolved.keys()].map((id) => [id, new Set()]));
  for (const connection of connections) {
    adjacency.get(connection.endpoints.from.componentId)?.add(connection.endpoints.to.componentId);
    adjacency.get(connection.endpoints.to.componentId)?.add(connection.endpoints.from.componentId);
  }
  return adjacency;
}

function reaches(adjacency, startId, predicate) {
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
}

/**
 * Facts about the circuit, each traced rather than assumed.
 * A check with nothing to test returns `unknown` and says why.
 */
export function topologyChecklist(analysis) {
  const { resolved, connections } = analysis;
  if (!resolved) return [];

  const adjacency = buildGraph(resolved, connections);
  // Fluid paths are traced per fluid, so a pump never "reaches" a tank through
  // the far side of a heat exchanger. See paths.mjs.
  const graph = fluidGraph(connections);
  const typeOf = (id) => resolved.get(id)?.component.type;
  const mediumOf = (id) => analysis.groupMedia?.get(`${id}#main`) ?? null;
  const boundaryIs = (id, direction) => typeOf(id) === 'boundary' && resolved.get(id).config.direction === direction;
  const toReservoir = (id) => typeOf(id) === 'reservoir' || (boundaryIs(id, 'to') && isLiquid(mediumOf(id)));
  const fromReservoir = (id) => typeOf(id) === 'reservoir' || (boundaryIs(id, 'from') && isLiquid(mediumOf(id)));
  const toAtmosphere = (id) => typeOf(id) === 'silencer' || (boundaryIs(id, 'to') && isGas(mediumOf(id)));
  const idsOfType = (type) => [...resolved.keys()].filter((id) => typeOf(id) === type);
  const connected = new Set();
  for (const connection of connections) {
    for (const end of ['from', 'to']) {
      connected.add(`${connection.endpoints[end].componentId}.${connection.endpoints[end].port.id}`);
    }
  }

  const portConnected = (id, port) => connected.has(`${id}.${port}`);
  const checks = [];
  const add = (status, label, detail) => checks.push({ status, label, detail });

  const pumps = idsOfType('pump');
  const reservoirs = idsOfType('reservoir');
  const cylinders = idsOfType('cylinder');
  const motors = idsOfType('motor');
  const valves = idsOfType('directional_control_valve');
  const reliefs = idsOfType('relief_valve');

  if (!pumps.length) {
    add('unknown', 'Pump connected to reservoir', 'no pump in the circuit');
  } else if (!reservoirs.length) {
    add('unknown', 'Pump connected to reservoir', 'no reservoir in the circuit');
  } else {
    const all = pumps.every((id) => portConnected(id, 'inlet') && traces(graph, id, 'inlet', fromReservoir));
    add(all ? 'pass' : 'fail', 'Pump draws from a reservoir', pumps.join(', '));
  }

  if (pumps.length) {
    const all = pumps.every((id) => portConnected(id, 'outlet'));
    add(all ? 'pass' : 'fail', 'Pump outlet connected to the pressure circuit', pumps.join(', '));
  }

  // A relief valve on a liquid line returns to the tank; one on a gas line --
  // a receiver's safety valve -- vents to atmosphere. Each is checked against
  // the end its own fluid has.
  const liquidReliefs = reliefs.filter((id) => !isGas(mediumOf(id)));
  const gasReliefs = reliefs.filter((id) => isGas(mediumOf(id)));
  if (!reliefs.length) {
    add('unknown', 'Relief valve returns to the reservoir', 'no relief valve in the circuit');
  } else if (liquidReliefs.length && !reservoirs.length) {
    add('unknown', 'Relief valve returns to the reservoir', 'no reservoir in the circuit');
  } else if (liquidReliefs.length) {
    const all = liquidReliefs.every((id) => portConnected(id, 'outlet') && traces(graph, id, 'outlet', toReservoir));
    add(all ? 'pass' : 'fail', 'Relief valve discharges to the reservoir', liquidReliefs.join(', '));
  }
  if (gasReliefs.length) {
    const all = gasReliefs.every((id) => portConnected(id, 'outlet') && traces(graph, id, 'outlet', toAtmosphere));
    add(all ? 'pass' : 'fail', 'Safety valve vents to atmosphere', gasReliefs.join(', '));
  }

  const actuators = [...cylinders, ...motors];
  if (!valves.length || !actuators.length) {
    add('unknown', 'Directional valve connected to an actuator', 'no valve/actuator pair in the circuit');
  } else {
    const all = actuators.every((id) => reaches(adjacency, id, (other) => typeOf(other) === 'directional_control_valve'));
    add(all ? 'pass' : 'fail', 'Every actuator is reachable from a directional valve', actuators.join(', '));
  }

  if (cylinders.length) {
    const all = cylinders.every((id) => {
      const entry = resolved.get(id);
      return Object.values(entry.ports)
        .filter((port) => port.criticality === 'required')
        .every((port) => portConnected(id, port.id) || port.plugged);
    });
    add(all ? 'pass' : 'fail', 'Every cylinder working port is connected', cylinders.join(', '));
  }

  // Only a pumped circuit has flow that must come back. A compensation basin
  // under a compressed-air store has nothing returning to it, by design; the
  // validator's no-return-path rule makes the same distinction.
  if (reservoirs.length && pumps.length) {
    const hasReturn = connections.some((connection) => ['from', 'to'].some((end) => (
      connection.endpoints[end].target.component.type === 'reservoir'
      && connection.endpoints[end].port.id === 'return'
    )));
    add(hasReturn ? 'pass' : 'fail', 'Flow returns to the reservoir', '');
  }

  // Compressed-air plant. These rows appear only when the drawing has the
  // machines they describe, so a hydraulic report is exactly what it was.
  const turbines = idsOfType('turbine');
  const compressors = idsOfType('compressor');
  const airSource = (id, key) => ['compressor', 'air_receiver'].includes(typeOf(id))
    || (typeOf(id) === 'accumulator' && key.endsWith('#gas'))
    || (boundaryIs(id, 'from') && isGas(mediumOf(id)));
  if (turbines.length) {
    const supplied = turbines.every((id) => portConnected(id, 'inlet') && traces(graph, id, 'inlet', airSource));
    add(supplied ? 'pass' : 'fail', 'Turbine is supplied with air from a store or compressor', turbines.join(', '));
    const vented = turbines.every((id) => portConnected(id, 'exhaust') && traces(graph, id, 'exhaust', toAtmosphere));
    add(vented ? 'pass' : 'fail', 'Turbine exhausts to atmosphere', turbines.join(', '));
  }
  if (compressors.length) {
    const intake = (id, key) => boundaryIs(id, 'from') || typeOf(id) === 'silencer' || airSource(id, key);
    const all = compressors.every((id) => portConnected(id, 'inlet') && traces(graph, id, 'inlet', intake));
    add(all ? 'pass' : 'fail', 'Compressor draws from an intake', compressors.join(', '));
  }
  const trains = shaftTrains(resolved, connections);
  if (trains.length) {
    const undriven = trains.filter((train) => !train.drivers.length).flatMap((train) => train.members);
    add(undriven.length ? 'fail' : 'pass', 'Every shaft train has a driver', undriven.join(', '));
  }

  const requiredUnconnected = [];
  for (const [id, entry] of resolved) {
    for (const port of Object.values(entry.ports)) {
      if (port.criticality === 'required' && !port.plugged && !portConnected(id, port.id)) {
        requiredUnconnected.push(`${id}.${port.id}`);
      }
    }
  }
  add(
    requiredUnconnected.length ? 'fail' : 'pass',
    'Every required port is connected or explicitly plugged',
    requiredUnconnected.join(', '),
  );

  const obstructed = (analysis.layout?.routed ?? []).filter((route) => route.routeKind !== 'auto' && route.routeKind !== 'authored');
  if (analysis.layout) {
    add(
      obstructed.length ? 'fail' : 'pass',
      'No line is routed through a symbol',
      obstructed.map((route) => route.connection.label).join(', '),
    );
  }

  return checks;
}

function section(title, lines) {
  if (!lines.length) return '';
  return `\n## ${title}\n\n${lines.join('\n')}\n`;
}

/**
 * Render validation.md.
 *
 * Deterministic: diagnostics arrive already sorted, and every list below is
 * either derived from that order or sorted here.
 */
export function renderValidationReport(model, analysis) {
  const counts = analysis.counts ?? { error: 0, warning: 0, info: 0 };
  const componentCount = model.components?.length ?? 0;
  const connectionCount = model.connections?.length ?? 0;
  const junctions = (model.components ?? []).filter((component) => component.type === 'junction').length;

  const lines = [];
  lines.push('# Hydraulic circuit validation');
  lines.push('');
  lines.push(`**STATUS: ${analysis.status}**`);
  lines.push('');
  lines.push(`- Title: ${model.meta?.title ?? '(untitled)'}`);
  lines.push(`- Components: ${componentCount}${junctions ? ` (${junctions} of them junctions)` : ''}`);
  lines.push(`- Hydraulic connections: ${connectionCount}`);
  lines.push(`- Errors: ${counts.error}`);
  lines.push(`- Warnings: ${counts.warning}`);
  lines.push(`- Notes: ${counts.info}`);

  if (analysis.stage === 'schema') {
    lines.push('');
    lines.push('The model is not structurally valid, so no hydraulic rules were run.');
    lines.push('Fix the schema errors below and validate again.');
  }

  const grouped = { error: [], warning: [], info: [] };
  for (const diagnostic of analysis.diagnostics ?? []) {
    const body = [`- ${formatDiagnostic(diagnostic)}`];
    for (const fix of diagnostic.supportedFixes ?? []) body.push(`  - fix: ${fix}`);
    grouped[diagnostic.severity]?.push(body.join('\n'));
  }

  let out = `${lines.join('\n')}\n`;
  out += section('Errors', grouped.error);
  out += section('Warnings', grouped.warning);
  out += section('Notes', grouped.info);

  const checklist = topologyChecklist(analysis);
  if (checklist.length) {
    out += section('Topology', checklist.map((check) => {
      const detail = check.detail ? ` (${check.detail})` : '';
      return `- ${MARK[check.status]} ${check.label}${check.status === 'unknown' ? detail : (check.status === 'fail' ? detail : '')}`;
    }));
  }

  // Unspecified parameters, listed rather than guessed. A value written as null
  // is a deliberate statement that it is unknown, so it is listed separately
  // from one that was simply never mentioned.
  if (analysis.resolved) {
    const declaredUnknown = [];
    for (const [id, entry] of analysis.resolved) {
      for (const name of unknownParams(entry.component.params)) {
        declaredUnknown.push(`- ${id}: ${name} is explicitly unknown`);
      }
    }
    const missing = (analysis.diagnostics ?? [])
      .filter((item) => item.code === 'parameters/key-unspecified' || item.code === 'parameters/unspecified')
      .map((item) => `- ${item.subject.component}: ${item.subject.parameter}`);
    out += section('Unspecified parameters', [...missing, ...declaredUnknown].sort());
  }

  const assumptions = model.assumptions ?? [];
  if (assumptions.length) {
    out += section('Assumptions', assumptions.map((assumption) => {
      const why = assumption.rationale ? `\n  - because: ${assumption.rationale}` : '';
      return `- **${assumption.subject}** ${assumption.statement}${why}`;
    }));
  }

  out += `\n## Scope of this check\n\n${scopeNote(model, analysis)}\n`;
  return out;
}

/**
 * What this report does and does not claim.
 *
 * The brief is explicit that a schematic must never be described as safe. It is
 * equally explicit that every drawing should not be buried under a standing
 * disclaimer, so the concerns raised here are the ones this particular circuit
 * actually raises.
 */
function scopeNote(model, analysis) {
  const lines = [
    'This checks that the circuit is topologically consistent with the information provided.',
    'It is not a safety assessment, and no part of it is a certification.',
    '',
    'Relevant to this circuit:',
  ];

  const types = new Set((model.components ?? []).map((component) => component.type));
  const concerns = [];

  if (types.has('relief_valve') || types.has('counterbalance_valve')) {
    concerns.push('Relief and counterbalance settings must be verified against the weakest component in the circuit, not chosen from the drawing.');
  }
  if (types.has('cylinder') || types.has('motor')) {
    concerns.push('Actuator load holding, stability and end-of-stroke behaviour need engineering review; a schematic cannot show them.');
  }
  if (types.has('accumulator')) {
    concerns.push('An accumulator stores energy. Discharge, isolation and pre-charge handling are safety-relevant and are not represented here.');
  }
  if (types.has('counterbalance_valve') || types.has('pilot_operated_check_valve')) {
    concerns.push('Load-holding valves must be sized and piloted for the actual load; the pilot ratio determines whether the load can creep or drop.');
  }
  if (!types.has('filter')) {
    concerns.push('No filtration is shown. Contamination control is normally required and was not part of the description.');
  }
  if ((analysis.counts?.warning ?? 0) > 0) {
    concerns.push('Warnings above describe parts of the circuit that may be valid but were not fully specified.');
  }
  concerns.push('Pressure ratings, hose and tube selection, thermal behaviour and machine safety functions are out of scope.');

  return [...lines, ...concerns.map((concern) => `- ${concern}`)].join('\n');
}
