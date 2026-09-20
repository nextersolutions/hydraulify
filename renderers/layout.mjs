// Layout: turn a validated model into placed frames, absolute port anchors and
// routed polylines.
//
// The author owns placement (`pos` per component). This layer owns everything
// derived from it, which is the part that must be deterministic: the same model
// produces the same anchors, the same routes and the same bounding box on every
// run and every platform.
//
// Routing is automatic with an explicit escape hatch. `via` waypoints are used
// verbatim when present, because a route the author pinned should never be
// silently re-derived.

import {
  sideAwareBridgeCandidates,
  normalizeRoutePoints,
  routeClearsRects,
  routeCost,
  routeHonorsEndpointSides,
  polylinesCross,
  outwardStub,
  collinearOverlap,
  toSegments,
} from './shared/geometry.mjs';
import { findPort } from './symbols/index.mjs';
import { parsePortRef } from '../validate/topology.mjs';
import { warning, info } from './shared/diagnostics.mjs';

const MARGIN = 48;
const LABEL_BAND = 34;
// The title block and the assumptions block are part of the drawing, so the
// canvas reserves room for them rather than letting them land on a symbol.
const TITLE_BAND = 54;
const NOTE_LINE = 12;

/** Absolute frame rect for a resolved component. */
function frameOf(entry) {
  const [x, y] = entry.component.pos;
  return {
    id: entry.component.id,
    x,
    y,
    width: entry.geometry.width,
    height: entry.geometry.height,
  };
}

/** Absolute coordinates of one port. */
function anchorOf(entry, port) {
  const [x, y] = entry.component.pos;
  return [x + port.x, y + port.y];
}

/**
 * The side a line should leave a junction by. A junction's four ports sit at the
 * same point and differ only in approach direction, so an author who picks a
 * side that points away from the other endpoint gets a route that loops back on
 * itself. Report it rather than silently overriding the author's choice.
 */
function junctionSideMismatch(entry, port, anchor, otherAnchor) {
  if (entry.component.type !== 'junction') return null;
  const dx = otherAnchor[0] - anchor[0];
  const dy = otherAnchor[1] - anchor[1];
  const natural = Math.abs(dx) >= Math.abs(dy)
    ? (dx >= 0 ? 'right' : 'left')
    : (dy >= 0 ? 'bottom' : 'top');
  const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[natural];
  return port.side === opposite ? { chosen: port.side, natural } : null;
}

export function layoutCircuit(model, resolved, connections) {
  const diagnostics = [];
  const frames = new Map();
  for (const [id, entry] of resolved) frames.set(id, frameOf(entry));

  const routed = [];
  // Segments already committed, so each route can be priced against the ones
  // before it. Connection order comes from the model and is stable.
  const placedSegments = [];

  for (const connection of connections) {
    const fromEntry = connection.endpoints.from.target;
    const toEntry = connection.endpoints.to.target;
    const fromPort = connection.endpoints.from.port;
    const toPort = connection.endpoints.to.port;

    const start = anchorOf(fromEntry, fromPort);
    const end = anchorOf(toEntry, toPort);
    const fromSide = connection.fromSide ?? fromPort.side;
    const toSide = connection.toSide ?? toPort.side;

    for (const [end_, entry, port, anchor, other] of [
      ['from', fromEntry, fromPort, start, end],
      ['to', toEntry, toPort, end, start],
    ]) {
      const mismatch = junctionSideMismatch(entry, port, anchor, other);
      if (mismatch) {
        diagnostics.push(warning({
          code: 'layout/junction-side-faces-away',
          subject: { connection: connection.label, port: `${entry.component.id}.${port.id}` },
          message: `${connection[end_]} leaves the junction toward ${mismatch.chosen}, but the other end lies to the ${mismatch.natural}. The line will double back.`,
          evidence: { chosen: mismatch.chosen, natural: mismatch.natural },
          supportedFixes: [`use ${entry.component.id}.${mismatch.natural} instead`],
        }));
      }
    }

    // Rects the route must avoid: everything except its own two endpoints.
    const obstacles = [...frames.values()].filter(
      (frame) => frame.id !== fromEntry.component.id && frame.id !== toEntry.component.id,
    );

    let points;
    let routeKind;

    if (connection.via?.length) {
      points = normalizeRoutePoints([start, ...connection.via, end]);
      routeKind = 'authored';
      if (!routeHonorsEndpointSides(points, fromSide, toSide)) {
        diagnostics.push(warning({
          code: 'layout/authored-route-side',
          subject: { connection: connection.label },
          message: `The authored route for ${connection.from} -> ${connection.to} does not leave or enter perpendicular to its port sides.`,
          evidence: { fromSide, toSide, via: connection.via },
          supportedFixes: [
            'add a waypoint directly outward from the port before turning',
            'remove "via" and let the route be derived automatically',
          ],
        }));
      }
      if (!routeClearsRects(points, obstacles)) {
        diagnostics.push(warning({
          code: 'layout/authored-route-collides',
          subject: { connection: connection.label },
          message: `The authored route for ${connection.from} -> ${connection.to} passes through another symbol.`,
          evidence: { via: connection.via },
          supportedFixes: ['move the waypoints clear of the symbol', 'remove "via" to route automatically'],
        }));
      }
    } else {
      const candidates = sideAwareBridgeCandidates(start, end, fromSide, toSide)
        .map((interior) => normalizeRoutePoints([start, ...interior, end]));

      const clear = candidates.filter((candidate) => routeClearsRects(candidate, obstacles));
      const pool = clear.length ? clear : candidates;

      if (!pool.length) {
        // Nothing honoured both sides: fall back to a plain stub-and-dogleg so a
        // line still exists, and say so rather than dropping the connection.
        points = normalizeRoutePoints([
          start,
          outwardStub(start, fromSide),
          [outwardStub(end, toSide)[0], outwardStub(start, fromSide)[1]],
          outwardStub(end, toSide),
          end,
        ]);
        routeKind = 'fallback';
        diagnostics.push(warning({
          code: 'layout/no-clean-route',
          subject: { connection: connection.label },
          message: `No clean orthogonal route was found for ${connection.from} -> ${connection.to}.`,
          evidence: { fromSide, toSide },
          supportedFixes: [
            'move one of the components so the ports face each other',
            'pin the route with explicit "via" waypoints',
          ],
        }));
      } else {
        // Deterministic choice: lowest cost, where cost prices in how much of
        // the route would share a corridor with lines already placed. Two
        // parallel lines drawn on top of each other read as one line, which is
        // a worse drawing than a slightly longer detour. Ties break on the
        // serialised path, so the result never depends on generation order.
        const score = (candidate) => routeCost(candidate) + collinearOverlap(candidate, placedSegments) * 6;
        points = pool.slice().sort((left, right) => {
          const byScore = score(left) - score(right);
          if (Math.abs(byScore) > 0.0001) return byScore;
          return JSON.stringify(left) < JSON.stringify(right) ? -1 : 1;
        })[0];
        routeKind = clear.length ? 'auto' : 'auto-obstructed';
        if (!clear.length) {
          diagnostics.push(warning({
            code: 'layout/route-crosses-symbol',
            subject: { connection: connection.label },
            message: `Every automatic route for ${connection.from} -> ${connection.to} passes through another symbol.`,
            evidence: { fromSide, toSide },
            supportedFixes: [
              'move the obstructing component out of the corridor',
              'pin the route with explicit "via" waypoints',
            ],
          }));
        }
      }
    }

    routed.push({ connection, points, fromSide, toSide, routeKind });
    placedSegments.push(...toSegments(points));
  }

  // Line crossings are reported, never forbidden: a dense circuit legitimately
  // has some, and an author needs to know how many rather than be blocked.
  let crossings = 0;
  for (let i = 0; i < routed.length; i += 1) {
    for (let j = i + 1; j < routed.length; j += 1) {
      if (polylinesCross(routed[i].points, routed[j].points)) crossings += 1;
    }
  }
  if (crossings > 0) {
    diagnostics.push(info({
      code: 'layout/line-crossings',
      subject: { scope: 'drawing' },
      message: `${crossings} line crossing${crossings === 1 ? '' : 's'} in the drawing.`,
      evidence: { crossings },
      supportedFixes: ['reposition components to reduce crossings, if the drawing reads poorly'],
    }));
  }

  const viewBox = computeViewBox(model, frames, routed, resolved);
  return { frames, routed, viewBox, diagnostics };
}

function computeViewBox(model, frames, routed, resolved) {
  if (model.meta?.viewBox) {
    return { x: 0, y: 0, width: model.meta.viewBox[0], height: model.meta.viewBox[1], authored: true };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const include = (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const [id, frame] of frames) {
    include(frame.x, frame.y);
    include(frame.x + frame.width, frame.y + frame.height);
    // Component labels sit below the frame and must not be clipped.
    if (resolved.get(id)?.geometry.labelAnchor) {
      include(frame.x, frame.y + frame.height + LABEL_BAND);
    }
  }
  for (const route of routed) {
    for (const [x, y] of route.points) include(x, y);
  }

  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 800, height: 600, authored: false };

  const noteCount = (model.assumptions ?? []).length;
  const topBand = MARGIN + TITLE_BAND + (model.meta?.subtitle ? 16 : 0);
  const bottomBand = MARGIN + (noteCount ? noteCount * NOTE_LINE + 26 : 0);

  return {
    x: Math.floor(minX - MARGIN),
    y: Math.floor(minY - topBand),
    width: Math.ceil(maxX - minX + MARGIN * 2),
    height: Math.ceil(maxY - minY + topBand + bottomBand),
    authored: false,
  };
}

/**
 * A normalised, human-readable snapshot of everything layout derived.
 *
 * This is the primary golden artifact. A diff here names what moved -- "C1.rod
 * anchor moved 3px" -- where an SVG diff would only show changed path data, and
 * it is stable against cosmetic changes to the drawing.
 */
export function layoutReport(model, resolved, layout) {
  const components = [...resolved.entries()]
    .map(([id, entry]) => ({
      id,
      type: entry.component.type,
      pos: entry.component.pos,
      size: [entry.geometry.width, entry.geometry.height],
      config: entry.config,
      ports: Object.fromEntries(
        Object.entries(entry.ports).map(([name, port]) => [
          name,
          {
            anchor: [entry.component.pos[0] + port.x, entry.component.pos[1] + port.y],
            side: port.side,
            criticality: port.criticality,
            plugged: port.plugged || undefined,
          },
        ]),
      ),
    }))
    .sort((left, right) => (left.id < right.id ? -1 : 1));

  const connections = layout.routed
    .map((route) => ({
      id: route.connection.label,
      from: route.connection.from,
      to: route.connection.to,
      line: route.connection.line,
      route: route.routeKind,
      sides: [route.fromSide, route.toSide],
      points: route.points,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : 1));

  return {
    title: model.meta.title,
    units: model.meta.units ?? 'si',
    viewBox: layout.viewBox,
    components,
    connections,
  };
}
