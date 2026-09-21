// Paths: where a fluid can actually go.
//
// The first validator traced paths over components: if two components were
// joined by any line, flow could pass. That was true of an all-oil circuit and
// is false the moment a drawing carries two fluids. A pump would "reach" a
// reservoir through the utility side of a heat exchanger, and a turbine would
// "reach" a compressor along a shaft.
//
// So paths are traced over port groups instead -- the same groups media are
// resolved on. A group carries one fluid, a fluid line joins two groups, and a
// shaft joins none. A trace can therefore only ever follow the fluid it
// started in, which is what "can oil get from here to there" means.

import { MECHANICAL, MEDIUM_CLASSES } from '../renderers/symbols/contract.mjs';

export const isLiquid = (medium) => MEDIUM_CLASSES.liquid.includes(medium);
export const isGas = (medium) => MEDIUM_CLASSES.gas.includes(medium);

const groupKey = (componentId, port) => `${componentId}#${port.group ?? 'main'}`;
const componentOf = (key) => key.slice(0, key.lastIndexOf('#'));

/**
 * @returns {{ neighbours: Map<string, Set<string>>, attached: Map<string, string[]> }}
 *   neighbours: group -> groups one fluid line away
 *   attached:   "C1.inlet" -> groups at the far end of the lines on that port
 */
export function fluidGraph(connections) {
  const neighbours = new Map();
  const attached = new Map();
  const link = (from, to) => {
    const set = neighbours.get(from) ?? new Set();
    set.add(to);
    neighbours.set(from, set);
  };
  for (const connection of connections) {
    if (connection.line === 'mechanical') continue;
    const { from, to } = connection.endpoints;
    if (from.port.medium === MECHANICAL || to.port.medium === MECHANICAL) continue;
    const a = groupKey(from.componentId, from.port);
    const b = groupKey(to.componentId, to.port);
    link(a, b);
    link(b, a);
    for (const [end, far] of [[from, b], [to, a]]) {
      const key = `${end.componentId}.${end.port.id}`;
      attached.set(key, [...(attached.get(key) ?? []), far]);
    }
  }
  return { neighbours, attached };
}

/**
 * Does flow leaving (or entering) `componentId.portId` reach a component that
 * satisfies `predicate`, without passing back through the component it started
 * from? Starting from the port rather than the component is what keeps a
 * turbine's supply and its exhaust apart: both sit in one group of the turbine,
 * and a trace from the component would find a silencer when asked for a supply.
 *
 * @param predicate (componentId, groupKey) => boolean
 */
export function traces(graph, componentId, portId, predicate) {
  const starts = graph.attached.get(`${componentId}.${portId}`) ?? [];
  const seen = new Set();
  const queue = [];
  for (const start of starts) {
    if (componentOf(start) === componentId || seen.has(start)) continue;
    seen.add(start);
    queue.push(start);
  }
  while (queue.length) {
    const key = queue.shift();
    if (predicate(componentOf(key), key)) return true;
    for (const next of graph.neighbours.get(key) ?? []) {
      if (seen.has(next) || componentOf(next) === componentId) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * Shaft trains: machines joined by mechanical lines. A train needs something
 * that drives it; a train where nothing is driven wastes what drives it.
 */
const DRIVES = { turbine: true, electrical_machine: (config) => config.role !== 'generator' };
const DRIVEN = { compressor: true, electrical_machine: (config) => config.role !== 'motor' };

function plays(table, entry) {
  const rule = table[entry.component.type];
  return typeof rule === 'function' ? rule(entry.config) : Boolean(rule);
}

export function shaftTrains(resolved, connections) {
  const neighbours = new Map();
  for (const connection of connections) {
    if (connection.line !== 'mechanical') continue;
    const { from, to } = connection.endpoints;
    if (from.port.medium !== MECHANICAL || to.port.medium !== MECHANICAL) continue;
    for (const [a, b] of [[from.componentId, to.componentId], [to.componentId, from.componentId]]) {
      neighbours.set(a, new Set([...(neighbours.get(a) ?? []), b]));
    }
  }
  const trains = [];
  const seen = new Set();
  for (const start of [...neighbours.keys()].sort()) {
    if (seen.has(start)) continue;
    const members = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const id = queue.shift();
      members.push(id);
      for (const next of neighbours.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    members.sort();
    trains.push({
      members,
      drivers: members.filter((id) => plays(DRIVES, resolved.get(id))),
      driven: members.filter((id) => plays(DRIVEN, resolved.get(id))),
    });
  }
  return trains;
}
