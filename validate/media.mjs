// Media: which fluid each line carries.
//
// Nobody writes a medium on a connection. Ports declare what they can carry --
// a turbine's inlet is air, a pump's outlet is any liquid, a check valve carries
// whatever it sits in -- and this module works out the one fluid each connected
// run of ports must share.
//
// The mechanism is a union-find over port groups. A component's ports sit in
// named groups; ports in one group share a fluid (a check valve's inlet and
// outlet), ports in different groups do not (an accumulator's gas side and its
// liquid side). Every fluid connection unites the groups at its two ends. Each
// resulting set then has to agree on a fluid: the intersection of everything
// its ports admit. An empty intersection is a real error, reported with every
// port that constrained the set, because "air meets liquid" is useless without
// saying where the air and the liquid came from.
//
// Shafts are not fluid. A mechanical port takes a mechanical line and nothing
// else, and mechanical connections never take part in fluid resolution.

import { MEDIA, MECHANICAL, admittedMedia } from '../renderers/symbols/contract.mjs';
import { error, info } from '../renderers/shared/diagnostics.mjs';

const groupKey = (componentId, port) => `${componentId}#${port.group ?? 'main'}`;

function unionFind() {
  const parent = new Map();
  const find = (key) => {
    if (!parent.has(key)) parent.set(key, key);
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    // Path compression keeps repeated lookups flat.
    let node = key;
    while (parent.get(node) !== root) {
      const next = parent.get(node);
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a === b) return;
    // The lexically smaller root wins, so the result does not depend on the
    // order connections were authored in.
    if (a < b) parent.set(b, a); else parent.set(a, b);
  };
  return { find, union, keys: () => [...parent.keys()] };
}

function describeConstraint(medium) {
  return medium === 'any' ? 'any fluid' : medium.replace(/_/g, ' ');
}

/**
 * Resolve the fluid carried by every connection.
 *
 * @param {Map} resolved      component id -> resolved component (with ports)
 * @param {Array} connections validated connections (with endpoints)
 * @returns {{
 *   diagnostics: Array,
 *   connectionMedia: Map<string, string|null>,  connection label -> fluid, 'mechanical', or null on conflict
 *   groupMedia: Map<string, string|null>,       "C1#main" -> fluid, or null on conflict
 * }}
 */
export function resolveMedia(resolved, connections) {
  const diagnostics = [];
  const sets = unionFind();
  const constraints = new Map(); // group key -> [{ medium, port: "C1.inlet", type }]

  for (const [id, entry] of resolved) {
    for (const port of Object.values(entry.ports)) {
      if (port.medium === MECHANICAL) continue;
      const key = groupKey(id, port);
      sets.find(key);
      const list = constraints.get(key) ?? [];
      list.push({ medium: port.medium ?? 'any', port: `${id}.${port.id}`, type: entry.component.type });
      constraints.set(key, list);
    }
  }

  const connectionMedia = new Map();
  const fluidConnections = [];

  for (const connection of connections) {
    const { from, to } = connection.endpoints;
    const fromShaft = from.port.medium === MECHANICAL;
    const toShaft = to.port.medium === MECHANICAL;
    const mechanicalLine = connection.line === 'mechanical';

    if (fromShaft !== toShaft) {
      const shaft = fromShaft ? from : to;
      const fluid = fromShaft ? to : from;
      const junction = fluid.target.component.type === 'junction';
      diagnostics.push(error({
        code: 'media/mechanical-mismatch',
        subject: { connection: connection.label, between: `${connection.from} -> ${connection.to}` },
        message: junction
          ? `${shaft.componentId}.${shaft.port.id} is a shaft, and a shaft cannot branch through junction ${fluid.componentId}. Junctions join fluid lines only.`
          : `${shaft.componentId}.${shaft.port.id} is a shaft but ${fluid.componentId}.${fluid.port.id} carries fluid. A shaft connects only to another shaft.`,
        evidence: { shaft: `${shaft.componentId}.${shaft.port.id}`, fluidPort: `${fluid.componentId}.${fluid.port.id}` },
        supportedFixes: [
          'connect the shaft to the shaft port of the machine it drives or is driven by',
          'for a double-ended machine, use its second shaft port rather than a junction',
        ],
      }));
      connectionMedia.set(connection.label, null);
      continue;
    }

    if (fromShaft && !mechanicalLine) {
      diagnostics.push(error({
        code: 'media/mechanical-mismatch',
        subject: { connection: connection.label, between: `${connection.from} -> ${connection.to}` },
        message: `${connection.from} and ${connection.to} are shafts, so the connection must be typed "mechanical", not "${connection.line}".`,
        evidence: { line: connection.line },
        supportedFixes: ['set "line": "mechanical"'],
      }));
      connectionMedia.set(connection.label, null);
      continue;
    }

    if (!fromShaft && mechanicalLine) {
      diagnostics.push(error({
        code: 'media/mechanical-mismatch',
        subject: { connection: connection.label, between: `${connection.from} -> ${connection.to}` },
        message: `${connection.from} and ${connection.to} carry fluid, but the connection is typed "mechanical", which is for shafts.`,
        evidence: { line: connection.line },
        supportedFixes: ['type the line by its hydraulic function: suction, pressure, working, return, drain or pilot'],
      }));
      connectionMedia.set(connection.label, null);
      continue;
    }

    if (fromShaft) {
      connectionMedia.set(connection.label, MECHANICAL);
      continue;
    }

    sets.union(groupKey(from.componentId, from.port), groupKey(to.componentId, to.port));
    fluidConnections.push(connection);
  }

  // Gather each set's members, then settle the set.
  const members = new Map(); // root -> [group key]
  for (const key of sets.keys()) {
    const root = sets.find(key);
    const list = members.get(root) ?? [];
    list.push(key);
    members.set(root, list);
  }

  const setMedium = new Map(); // root -> fluid | null
  for (const root of [...members.keys()].sort()) {
    const all = members.get(root).flatMap((key) => constraints.get(key) ?? []);
    let allowed = [...MEDIA];
    for (const constraint of all) {
      const admitted = admittedMedia(constraint.medium);
      allowed = allowed.filter((medium) => admitted.includes(medium));
    }

    if (!allowed.length) {
      // Report the constraints that actually narrow the set; "any fluid" never
      // causes a conflict and would only bury the ports that did.
      const narrowing = new Map(); // medium -> [ports]
      for (const constraint of all) {
        if (constraint.medium === 'any') continue;
        const ports = narrowing.get(constraint.medium) ?? [];
        ports.push(constraint.port);
        narrowing.set(constraint.medium, ports);
      }
      const sources = [...narrowing.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([medium, ports]) => ({ medium, ports: ports.sort() }));
      const components = [...new Set(members.get(root).map((key) => key.split('#')[0]))].sort();

      diagnostics.push(error({
        code: 'media/conflict',
        subject: { components: components.join(', ') },
        message: 'These connected ports cannot share one fluid: '
          + sources.map((source) => `${describeConstraint(source.medium)} (${source.ports.join(', ')})`).join(' vs ')
          + '.',
        evidence: { constraints: sources, components },
        supportedFixes: [
          'check that each line joins the ports you meant: an air port and a liquid port are never on the same line',
          'where two fluids meet on purpose, they meet inside a component that separates them, such as an accumulator or heat exchanger',
        ],
      }));
      setMedium.set(root, null);
      continue;
    }

    // Oil first, so every model written before media existed still resolves to
    // what it always meant. Otherwise the only fluid left, or the first in
    // canonical order with a note saying the choice was not forced.
    const medium = allowed.includes('oil') ? 'oil' : allowed[0];
    if (!allowed.includes('oil') && allowed.length > 1) {
      const components = [...new Set(members.get(root).map((key) => key.split('#')[0]))].sort();
      diagnostics.push(info({
        code: 'media/unresolved',
        subject: { components: components.join(', ') },
        message: `Nothing fixes which fluid ${components.join(', ')} carry; ${medium.replace(/_/g, ' ')} was assumed from ${allowed.join(', ')}.`,
        evidence: { allowed, assumed: medium },
        supportedFixes: ['connect the run to a component that declares its fluid, or configure one that can'],
      }));
    }
    setMedium.set(root, medium);
  }

  for (const connection of fluidConnections) {
    const { from } = connection.endpoints;
    connectionMedia.set(connection.label, setMedium.get(sets.find(groupKey(from.componentId, from.port))) ?? null);
  }

  const groupMedia = new Map();
  for (const key of [...constraints.keys()].sort()) {
    groupMedia.set(key, setMedium.get(sets.find(key)) ?? null);
  }

  return { diagnostics, connectionMedia, groupMedia };
}
