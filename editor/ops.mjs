// Edit operations on the circuit model.
//
// Every operation takes a model and returns a new one; nothing is mutated in
// place, so undo is a stack of models and a failed operation leaves the model
// it was given untouched. The operations keep the model's own rules as they
// go: a port takes one line, so a branch gets a junction; a junction's `way`
// always equals the lines on it; a renamed component takes its references with
// it. Whatever they cannot keep valid, the validator reports.

import { resolveComponent, findPort } from '../renderers/symbols/index.mjs';
import { parsePortRef, lineExpectation } from '../validate/index.mjs';
import { normalizeRoutePoints } from '../renderers/shared/geometry.mjs';
import { ID_PREFIX, getPath, setPath } from './catalog.mjs';

const JUNCTION_CENTRE = 4;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const SIDES = ['left', 'right', 'top', 'bottom'];
const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

export const clone = (value) => JSON.parse(JSON.stringify(value));

export function emptyModel(title = 'Untitled circuit') {
  return {
    schema_version: 1,
    diagram_type: 'hydraulic_circuit',
    meta: { title, units: 'si' },
    components: [],
    connections: [],
    assumptions: [],
  };
}

// --- ids ----------------------------------------------------------------------

function usedIds(model) {
  return new Set(model.components.map((component) => component.id));
}

export function nextComponentId(model, type) {
  const prefix = ID_PREFIX[type] ?? 'X';
  const used = usedIds(model);
  let number = 1;
  while (used.has(`${prefix}${number}`)) number += 1;
  return `${prefix}${number}`;
}

export function nextConnectionId(model, line) {
  const used = new Set(model.connections.map((connection) => connection.id).filter(Boolean));
  let number = 1;
  while (used.has(`${line}-${number}`)) number += 1;
  return `${line}-${number}`;
}

export function isValidId(id) {
  return typeof id === 'string' && id.length <= 32 && ID_PATTERN.test(id);
}

// --- lookups ------------------------------------------------------------------

export function componentIndex(model, id) {
  return model.components.findIndex((component) => component.id === id);
}

function resolved(model, id) {
  const component = model.components.find((item) => item.id === id);
  if (!component) return null;
  try {
    return { component, ...resolveComponent(component) };
  } catch {
    return null;
  }
}

/** The canonical port id a reference names, honouring aliases ("C1.A" -> "cap"). */
export function canonicalRef(model, reference) {
  const { componentId, portName } = parsePortRef(reference);
  const entry = resolved(model, componentId);
  const port = entry && findPort(entry.ports, portName);
  return port ? `${componentId}.${port.id}` : null;
}

/** Indices of the connections that use a port. */
export function connectionsAtPort(model, reference) {
  const canonical = canonicalRef(model, reference);
  if (!canonical) return [];
  const out = [];
  model.connections.forEach((connection, index) => {
    if (canonicalRef(model, connection.from) === canonical || canonicalRef(model, connection.to) === canonical) out.push(index);
  });
  return out;
}

export function portAnchor(model, reference) {
  const { componentId, portName } = parsePortRef(reference);
  const entry = resolved(model, componentId);
  const port = entry && findPort(entry.ports, portName);
  if (!port) return null;
  return { point: [entry.component.pos[0] + port.x, entry.component.pos[1] + port.y], side: port.side, port, entry };
}

// --- line type ----------------------------------------------------------------

/**
 * The line type to propose for a new connection: the same rules the validator
 * checks a line against, so a line drawn in the editor starts out agreeing with
 * them. It is only a proposal; the inspector shows it for changing.
 */
export function inferLineType(model, fromRef, toRef, fallback = 'pressure') {
  const ends = [fromRef, toRef].map((reference) => portAnchor(model, reference));
  if (ends.some((end) => !end)) return fallback;
  if (ends.some((end) => end.port.medium === 'mechanical')) return 'mechanical';

  const rules = ends.map((end, index) => lineExpectation(
    end.entry.component.type,
    end.port.id,
    ends[1 - index].entry.component.type,
  ));
  const required = rules.find((rule) => rule?.required);
  if (required) return required.required[0];
  const preferred = rules.find((rule) => rule?.preferred);
  if (preferred) return preferred.preferred[0];

  for (const end of ends) {
    const { type } = end.entry.component;
    if (type === 'directional_control_valve' && ['A', 'B'].includes(end.port.id)) return 'working';
    if (type === 'relief_valve' && end.port.id === 'outlet') return 'return';
  }
  return fallback;
}

// --- components -----------------------------------------------------------------

export function addComponent(model, { type, pos, config, id }) {
  const next = clone(model);
  const componentId = id ?? nextComponentId(next, type);
  const component = { id: componentId, type, pos: [Math.round(pos[0]), Math.round(pos[1])] };
  if (config && Object.keys(config).length) component.config = clone(config);
  next.components.push(component);
  return { model: next, id: componentId };
}

/**
 * Move components by a delta. A pinned route keeps its waypoints, but the ones
 * next to a moved end follow it along the axis that keeps the line square to
 * its port; a route whose two ends both move is carried along whole.
 */
export function moveComponents(model, ids, dx, dy) {
  const next = clone(model);
  const moving = new Set(ids);
  for (const component of next.components) {
    if (moving.has(component.id)) component.pos = [Math.round(component.pos[0] + dx), Math.round(component.pos[1] + dy)];
  }
  for (const connection of next.connections) {
    if (!connection.via?.length) continue;
    const fromMoves = moving.has(parsePortRef(connection.from).componentId);
    const toMoves = moving.has(parsePortRef(connection.to).componentId);
    if (fromMoves && toMoves) {
      connection.via = connection.via.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)]);
      continue;
    }
    if (fromMoves) followEnd(next, connection, connection.from, 0, dx, dy);
    if (toMoves) followEnd(next, connection, connection.to, connection.via.length - 1, dx, dy);
  }
  return next;
}

function followEnd(model, connection, reference, index, dx, dy) {
  const anchor = portAnchor(model, reference);
  if (!anchor) return;
  const point = connection.via[index];
  if (anchor.side === 'left' || anchor.side === 'right') point[1] = Math.round(point[1] + dy);
  else point[0] = Math.round(point[0] + dx);
}

export function moveComponentTo(model, id, pos) {
  const component = model.components.find((item) => item.id === id);
  if (!component) return model;
  return moveComponents(model, [id], pos[0] - component.pos[0], pos[1] - component.pos[1]);
}

/**
 * Delete components with every line on them. A junction left joining two lines
 * of one type is dissolved into a single line, and assumptions about a deleted
 * component go with it: a note printed on the drawing about a part that is no
 * longer there would state something false.
 */
export function deleteComponents(model, ids) {
  const gone = new Set(ids);
  let next = clone(model);
  next.components = next.components.filter((component) => !gone.has(component.id));
  next.connections = next.connections.filter((connection) => (
    !gone.has(parsePortRef(connection.from).componentId) && !gone.has(parsePortRef(connection.to).componentId)
  ));
  if (next.assumptions) {
    next.assumptions = next.assumptions.filter((assumption) => ![...gone].some((id) => (
      assumption.subject === id || assumption.subject.startsWith(`${id}.`)
    )));
  }
  next = tidyJunctions(next);
  return next;
}

export function renameComponent(model, oldId, newId) {
  if (oldId === newId) return { model };
  if (!isValidId(newId)) return { error: `${newId || 'An empty id'} is not a valid id: start with a letter, then letters, digits, _ or -.` };
  if (usedIds(model).has(newId)) return { error: `${newId} is already used by another component.` };
  const next = clone(model);
  const rewrite = (reference) => {
    const { componentId, portName } = parsePortRef(reference);
    return componentId === oldId ? `${newId}.${portName}` : reference;
  };
  for (const component of next.components) {
    if (component.id === oldId) component.id = newId;
    if (component.config?.same_reservoir_as === oldId) component.config.same_reservoir_as = newId;
  }
  for (const connection of next.connections) {
    connection.from = rewrite(connection.from);
    connection.to = rewrite(connection.to);
  }
  for (const assumption of next.assumptions ?? []) {
    if (assumption.subject === oldId) assumption.subject = newId;
    else if (assumption.subject.startsWith(`${oldId}.`)) assumption.subject = `${newId}${assumption.subject.slice(oldId.length)}`;
  }
  return { model: next };
}

function prune(object) {
  for (const [key, value] of Object.entries(object)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      prune(value);
      if (!Object.keys(value).length) delete object[key];
    }
  }
}

/**
 * Set or clear one field of a component: ['config', 'actuation', 'left'],
 * ['params', 'setting_bar'], ['label']. `undefined` removes the field.
 *
 * A config change can take ports away -- a 4/3 valve made 2/2 has no B or T --
 * and a line on a port that no longer exists is dropped rather than left
 * pointing at nothing. The dropped lines are returned so the page can say so.
 */
export function setComponentField(model, id, path, value) {
  const next = clone(model);
  const component = next.components.find((item) => item.id === id);
  if (!component) return { model, removed: [] };
  if (value === undefined) {
    const parent = getPath(component, path.slice(0, -1));
    if (parent && typeof parent === 'object') delete parent[path.at(-1)];
  } else {
    setPath(component, path, value);
  }
  if (component.config) prune(component.config);
  if (component.config && !Object.keys(component.config).length) delete component.config;
  if (component.params && !Object.keys(component.params).length) delete component.params;
  if (component.ports) {
    prune(component.ports);
    if (!Object.keys(component.ports).length) delete component.ports;
  }

  const removed = [];
  const entry = resolved(next, id);
  if (entry) {
    next.connections = next.connections.filter((connection) => {
      for (const end of ['from', 'to']) {
        const { componentId, portName } = parsePortRef(connection[end]);
        if (componentId === id && !findPort(entry.ports, portName)) {
          removed.push(connection.id ?? `${connection.from} - ${connection.to}`);
          return false;
        }
      }
      return true;
    });
  }
  return { model: removed.length ? tidyJunctions(next) : next, removed };
}

// --- connections ----------------------------------------------------------------

export function setConnectionField(model, index, key, value) {
  const next = clone(model);
  const connection = next.connections[index];
  if (!connection) return model;
  if (value === undefined || value === '') delete connection[key];
  else connection[key] = value;
  if (key === 'line' && value !== 'mechanical') delete connection.clutch;
  return next;
}

export function deleteConnections(model, indices) {
  const gone = new Set(indices);
  const next = clone(model);
  next.connections = next.connections.filter((_, index) => !gone.has(index));
  return tidyJunctions(next);
}

export function setVia(model, index, via) {
  const next = clone(model);
  const connection = next.connections[index];
  if (!connection) return model;
  if (via?.length) connection.via = via.map(([x, y]) => [Math.round(x), Math.round(y)]);
  else delete connection.via;
  return next;
}

/** Which side of a point another point lies on, by its dominant axis. */
export function sideToward(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** The next-best side when the natural one is taken: the other axis first. */
function sidePreference(from, to) {
  const natural = sideToward(from, to);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const horizontal = natural === 'left' || natural === 'right';
  const cross = horizontal ? (dy >= 0 ? 'bottom' : 'top') : (dx >= 0 ? 'right' : 'left');
  return [natural, cross, OPPOSITE[cross], OPPOSITE[natural]];
}

function junctionSidesUsed(model, junctionId) {
  const used = new Set();
  for (const connection of model.connections) {
    for (const end of ['from', 'to']) {
      const { componentId, portName } = parsePortRef(connection[end]);
      if (componentId === junctionId) used.add(portName);
    }
  }
  return used;
}

/** A free side of a junction for a line toward `target`, or null if all four are taken. */
export function freeJunctionSide(model, junctionId, target) {
  const junction = model.components.find((component) => component.id === junctionId);
  if (!junction) return null;
  const used = junctionSidesUsed(model, junctionId);
  const centre = [junction.pos[0] + JUNCTION_CENTRE, junction.pos[1] + JUNCTION_CENTRE];
  const order = target ? sidePreference(centre, target) : SIDES;
  return order.find((side) => !used.has(side)) ?? null;
}

function routeLength(points) {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    total += Math.abs(points[index + 1][0] - points[index][0]) + Math.abs(points[index + 1][1] - points[index][1]);
  }
  return total;
}

/** The point a given distance along a polyline, with the segment it falls on. */
export function pointAlong(points, distance) {
  let remaining = distance;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[index + 1];
    const length = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    if (remaining <= length || index === points.length - 2) {
      const ratio = length === 0 ? 0 : Math.min(1, remaining / length);
      return { point: [x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio], segment: index };
    }
    remaining -= length;
  }
  return { point: points[0], segment: 0 };
}

/** The nearest point on a polyline to `point`, with its segment and distance. */
export function nearestOnRoute(points, point) {
  let best = null;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[index + 1];
    const length2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - x1) * (x2 - x1) + (point[1] - y1) * (y2 - y1)) / length2));
    const candidate = [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    const distance = Math.hypot(candidate[0] - point[0], candidate[1] - point[1]);
    if (!best || distance < best.distance) best = { point: candidate, segment: index, distance };
  }
  return best;
}

/**
 * Split a line into two at a point on its route, with a junction there. The
 * junction takes the two sides the route runs through, and the halves keep the
 * line's type. Pinned waypoints are shared out between the halves; an
 * automatic route stays automatic.
 *
 * @param routePoints the line's drawn route, from its `from` end to its `to` end
 * @returns {{ model, junctionId } | { error }}
 */
export function splitConnection(model, index, routePoints, at, { grid = 1 } = {}) {
  const connection = model.connections[index];
  if (!connection) return { error: 'That line no longer exists.' };
  if (connection.line === 'mechanical') return { error: 'A shaft cannot branch: it joins one machine to the next.' };
  if (!routePoints || routePoints.length < 2) return { error: 'That line has no drawn route to split.' };

  const hit = nearestOnRoute(routePoints, at);
  const [x1, y1] = routePoints[hit.segment];
  const [x2, y2] = routePoints[hit.segment + 1];
  // Snap along the segment only, so the junction stays exactly on the line.
  let point = hit.point;
  if (y1 === y2) point = [Math.max(Math.min(x1, x2), Math.min(Math.max(x1, x2), Math.round(point[0] / grid) * grid)), y1];
  else if (x1 === x2) point = [x1, Math.max(Math.min(y1, y2), Math.min(Math.max(y1, y2), Math.round(point[1] / grid) * grid))];

  // The junction must not sit on either end: it would be a zero-length half.
  const atStart = Math.hypot(point[0] - routePoints[0][0], point[1] - routePoints[0][1]) < 2;
  const atEnd = Math.hypot(point[0] - routePoints.at(-1)[0], point[1] - routePoints.at(-1)[1]) < 2;
  if (atStart || atEnd) return { error: 'Drop the branch further along the line, clear of the ports.' };

  // The sides the route passes through, toward each end.
  const before = routePoints.slice(0, hit.segment + 1).filter((p) => Math.hypot(p[0] - point[0], p[1] - point[1]) > 0.5).at(-1) ?? routePoints[0];
  const after = routePoints.slice(hit.segment + 1).find((p) => Math.hypot(p[0] - point[0], p[1] - point[1]) > 0.5) ?? routePoints.at(-1);
  const sideIn = sideToward(point, before);
  let sideOut = sideToward(point, after);
  if (sideOut === sideIn) sideOut = OPPOSITE[sideIn];

  let next = clone(model);
  const junctionId = nextComponentId(next, 'junction');
  next.components.push({
    id: junctionId,
    type: 'junction',
    pos: [Math.round(point[0] - JUNCTION_CENTRE), Math.round(point[1] - JUNCTION_CENTRE)],
    config: { way: 3 },
  });

  const original = next.connections[index];
  const first = { ...original, to: `${junctionId}.${sideIn}` };
  const second = { ...original, id: nextConnectionId(next, original.line), from: `${junctionId}.${sideOut}` };
  delete first.via;
  delete second.via;
  delete second.label;
  if (original.via?.length) {
    const viaFirst = routePoints.slice(1, hit.segment + 1);
    const viaSecond = routePoints.slice(hit.segment + 1, -1);
    if (viaFirst.length) first.via = viaFirst.map(([x, y]) => [Math.round(x), Math.round(y)]);
    if (viaSecond.length) second.via = viaSecond.map(([x, y]) => [Math.round(x), Math.round(y)]);
  }
  next.connections.splice(index, 1, first, second);
  next = setJunctionWay(next, junctionId);
  return { model: next, junctionId };
}

/**
 * Connect two ports. A port takes one line, so a port that already has one
 * gets a junction on its existing line, near the port, and the new line
 * branches from there; a junction that is dropped on takes the free side that
 * faces the other end.
 *
 * @param routes connection index -> drawn route points, for placing junctions
 * @returns {{ model, index, junctions } | { error }}
 */
export function connectPorts(model, fromRef, toRef, { routes = new Map(), line, grid = 1 } = {}) {
  let next = model;
  const junctions = [];
  const refs = { from: fromRef, to: toRef };
  // Routes are looked up by the line's two ends, not its index: splitting one
  // line shifts the indices of every line after it.
  const routeKey = (connection) => `${connection.from}|${connection.to}`;
  const routesByEnds = new Map();
  for (const [index, points] of routes) {
    const connection = model.connections[index];
    if (connection) routesByEnds.set(routeKey(connection), points);
  }

  for (const end of ['from', 'to']) {
    const anchor = portAnchor(next, refs[end]);
    if (!anchor) return { error: `${refs[end]} is not a port.` };
  }
  if (parsePortRef(fromRef).componentId === parsePortRef(toRef).componentId) {
    return { error: 'A line joins two different components.' };
  }
  const shaftEnds = ['from', 'to'].filter((end) => portAnchor(next, refs[end]).port.medium === 'mechanical');
  if (shaftEnds.length === 1) return { error: 'A shaft port joins only another shaft port.' };

  for (const end of ['from', 'to']) {
    const reference = refs[end];
    const otherPoint = portAnchor(next, refs[end === 'from' ? 'to' : 'from']).point;
    const anchor = portAnchor(next, reference);
    const { componentId } = parsePortRef(reference);

    if (anchor.entry.component.type === 'junction') {
      const busy = connectionsAtPort(next, reference).length > 0;
      if (busy) {
        const side = freeJunctionSide(next, componentId, otherPoint);
        if (!side) return { error: `${componentId} already joins four lines.` };
        refs[end] = `${componentId}.${side}`;
      }
      continue;
    }

    const existing = connectionsAtPort(next, reference);
    if (!existing.length) continue;
    if (anchor.port.medium === 'mechanical') return { error: `${reference} already has a shaft, and a shaft cannot branch.` };

    // Branch off the existing line a short way from this port, past its stub.
    const index = existing[0];
    const connection = next.connections[index];
    const points = routesByEnds.get(routeKey(connection));
    if (!points) return { error: `The line on ${reference} has no drawn route to branch from.` };
    const fromThisEnd = canonicalRef(next, connection.from) === canonicalRef(next, reference);
    const ordered = fromThisEnd ? points : [...points].reverse();
    const distance = Math.min(32, routeLength(ordered) / 2);
    const { point } = pointAlong(ordered, distance);
    const split = splitConnection(next, index, points, point, { grid });
    if (split.error) return split;
    next = split.model;
    junctions.push(split.junctionId);
    const side = freeJunctionSide(next, split.junctionId, otherPoint);
    refs[end] = `${split.junctionId}.${side}`;
  }

  // A branch off a junction carries what the line it tees into carries,
  // unless a port on it says otherwise.
  const junctionEnds = ['from', 'to']
    .map((end) => parsePortRef(refs[end]).componentId)
    .filter((id) => next.components.find((component) => component.id === id)?.type === 'junction');
  const fallback = junctionEnds.length ? lineOfJunction(next, junctionEnds[0]) : 'pressure';
  const lineType = line ?? inferLineType(next, refs.from, refs.to, fallback);
  next = clone(next);
  next.connections.push({ id: nextConnectionId(next, lineType), from: refs.from, to: refs.to, line: lineType });
  for (const junctionId of new Set([...junctions, ...junctionEnds])) {
    next = setJunctionWay(next, junctionId);
  }
  return { model: next, index: next.connections.length - 1, junctions };
}

/** Branch a port onto the middle of an existing line. */
export function connectToLine(model, portRef, index, routePoints, at, { grid = 1, line } = {}) {
  if (!portAnchor(model, portRef)) return { error: `${portRef} is not a port.` };
  const connection = model.connections[index];
  if (!connection) return { error: 'That line no longer exists.' };
  const { componentId } = parsePortRef(portRef);
  if ([connection.from, connection.to].some((reference) => parsePortRef(reference).componentId === componentId)) {
    return { error: 'That line already ends on this component.' };
  }
  const split = splitConnection(model, index, routePoints, at, { grid });
  if (split.error) return split;
  const side = freeJunctionSide(split.model, split.junctionId, portAnchor(split.model, portRef).point);
  const joined = connectPorts(split.model, portRef, `${split.junctionId}.${side}`, { line, grid });
  if (joined.error) return joined;
  return { ...joined, junctions: [split.junctionId, ...joined.junctions] };
}

function lineOfJunction(model, junctionId) {
  const connection = model.connections.find((item) => [item.from, item.to]
    .some((reference) => parsePortRef(reference).componentId === junctionId));
  return connection?.line ?? 'pressure';
}

function junctionDegree(model, junctionId) {
  return model.connections.reduce((count, connection) => count + [connection.from, connection.to]
    .filter((reference) => parsePortRef(reference).componentId === junctionId).length, 0);
}

function setJunctionWay(model, junctionId) {
  const degree = junctionDegree(model, junctionId);
  if (degree !== 3 && degree !== 4) return model;
  const next = clone(model);
  const junction = next.components.find((component) => component.id === junctionId);
  junction.config = { ...(junction.config ?? {}), way: degree };
  return next;
}

/**
 * Keep junctions honest after a deletion: `way` follows the lines on it, and a
 * junction left joining exactly two lines of the same type is no longer a tee,
 * so it is dissolved back into one line. One left with a single line, or with
 * two of different types, is left for the validator to report -- guessing
 * which line the author meant to keep would delete work.
 */
export function tidyJunctions(model) {
  let next = model;
  for (const junction of model.components.filter((component) => component.type === 'junction')) {
    const lines = next.connections
      .map((connection, index) => ({ connection, index }))
      .filter(({ connection }) => [connection.from, connection.to].some((reference) => parsePortRef(reference).componentId === junction.id));
    if (lines.length === 2 && lines[0].connection.line === lines[1].connection.line) {
      next = clone(next);
      const [a, b] = lines;
      const outer = (connection) => (parsePortRef(connection.from).componentId === junction.id ? connection.to : connection.from);
      const aFirst = parsePortRef(a.connection.to).componentId === junction.id;
      const merged = {
        ...a.connection,
        from: aFirst ? outer(a.connection) : outer(b.connection),
        to: aFirst ? outer(b.connection) : outer(a.connection),
      };
      delete merged.via;
      next.connections = next.connections.filter((_, index) => index !== a.index && index !== b.index);
      next.connections.splice(Math.min(a.index, b.index), 0, merged);
      next.components = next.components.filter((component) => component.id !== junction.id);
    } else if (lines.length >= 3) {
      next = setJunctionWay(next, junction.id);
    }
  }
  return next;
}

// --- routes ---------------------------------------------------------------------

const STUB = 16;

function offset(point, horizontal, delta) {
  return horizontal ? [point[0], point[1] + delta] : [point[0] + delta, point[1]];
}

function towards(from, to, distance) {
  const length = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]);
  const ratio = length === 0 ? 0 : Math.min(1, distance / length);
  return [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio];
}

/**
 * Drag one straight run of a route sideways, the way an orthogonal connector
 * is edited: the run moves, its neighbours stretch. A run that leaves a port
 * keeps a short stub square to the port and jogs after it, so the line never
 * comes away from its port at an angle.
 *
 * @returns the new interior waypoints (the route minus its two ends)
 */
export function dragSegment(points, segment, delta) {
  const route = points.map(([x, y]) => [x, y]);
  const last = route.length - 2;
  const [a, b] = [route[segment], route[segment + 1]];
  const horizontal = a[1] === b[1];
  if (!horizontal && a[0] !== b[0]) return route.slice(1, -1);

  const length = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  const stub = Math.min(STUB, length / 3);
  const out = [];
  out.push(...route.slice(0, segment));
  if (segment === 0) {
    const s = towards(a, b, stub);
    out.push(a, s, offset(s, horizontal, delta));
  } else {
    out.push(offset(a, horizontal, delta));
  }
  if (segment === last) {
    const e = towards(b, a, stub);
    out.push(offset(e, horizontal, delta), e, b);
  } else {
    out.push(offset(b, horizontal, delta));
    out.push(...route.slice(segment + 2));
  }
  const normalized = normalizeRoutePoints(out);
  return normalized.slice(1, -1).map(([x, y]) => [Math.round(x), Math.round(y)]);
}

// --- meta and assumptions -------------------------------------------------------

export function setMetaField(model, key, value) {
  const next = clone(model);
  if (value === undefined || value === '') delete next.meta[key];
  else next.meta[key] = value;
  return next;
}

export function setAssumptions(model, assumptions) {
  const next = clone(model);
  next.assumptions = assumptions.map((assumption) => {
    const out = { subject: assumption.subject, statement: assumption.statement };
    if (assumption.rationale) out.rationale = assumption.rationale;
    if (assumption.id) out.id = assumption.id;
    return out;
  });
  return next;
}
