// Routing geometry.
//
// Vendored from archify's renderers/shared/geometry.mjs and the routing helpers
// in renderers/architecture/render-architecture.mjs (MIT, author tt-a1i), reduced
// to what hydraulify needs and adapted in one substantive way:
//
//   archify anchors a route at the MIDPOINT of a rectangle side. A hydraulic
//   symbol has several named ports on the same side at specific coordinates, so
//   hydraulify supplies port anchors from its symbol definitions instead. The
//   candidate generation and side-honesty rules below never depended on the
//   anchor being a midpoint -- only on it being a point plus a side -- so they
//   transfer unchanged.
//
// Everything here is pure. Callers pass measured rects ({x, y, width, height}).

export function isFinitePoint(...coords) {
  return coords.every((value) => Number.isFinite(value));
}

function crossProduct(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function orientation(a, b, c) {
  const value = crossProduct(a, b, c);
  if (Math.abs(value) < 0.0000001) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return b[0] <= Math.max(a[0], c[0]) && b[0] >= Math.min(a[0], c[0])
    && b[1] <= Math.max(a[1], c[1]) && b[1] >= Math.min(a[1], c[1]);
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return o1 !== o2 && o3 !== o4;
}

function pointInBox(point, box) {
  return point[0] >= box.x1 && point[0] <= box.x2 && point[1] >= box.y1 && point[1] <= box.y2;
}

export function segmentIntersectsRect(segment, rect, gap = 0) {
  const box = {
    x1: rect.x - gap,
    y1: rect.y - gap,
    x2: rect.x + rect.width + gap,
    y2: rect.y + rect.height + gap,
  };
  const [a, b] = [segment.start, segment.end];
  if (pointInBox(a, box) || pointInBox(b, box)) return true;
  return segmentsIntersect(a, b, [box.x1, box.y1], [box.x2, box.y1])
    || segmentsIntersect(a, b, [box.x2, box.y1], [box.x2, box.y2])
    || segmentsIntersect(a, b, [box.x2, box.y2], [box.x1, box.y2])
    || segmentsIntersect(a, b, [box.x1, box.y2], [box.x1, box.y1]);
}

function collinearForward(a, b, c) {
  if (Math.abs(crossProduct(a, b, c)) > 0.0001) return false;
  return (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) >= -0.0001;
}

/**
 * Drop duplicate points and collapse collinear runs.
 *
 * This is the determinism workhorse: two routes that differ only by a redundant
 * intermediate point normalise to the same polyline, so the same model always
 * produces the same path data.
 */
export function normalizeRoutePoints(points) {
  const finite = (Array.isArray(points) ? points : [])
    .filter((point) => Array.isArray(point) && point.length === 2 && isFinitePoint(...point));
  const deduped = [];
  for (const point of finite) {
    const previous = deduped.at(-1);
    if (!previous || Math.abs(point[0] - previous[0]) > 0.0001 || Math.abs(point[1] - previous[1]) > 0.0001) {
      deduped.push(point);
    }
  }
  const normalized = [];
  for (const point of deduped) {
    while (normalized.length >= 2 && collinearForward(normalized.at(-2), normalized.at(-1), point)) {
      normalized.pop();
    }
    normalized.push(point);
  }
  return normalized;
}

const ENDPOINT_SIDE_RULES = {
  left: { axis: 'horizontal', sourceSign: -1, targetSign: 1 },
  right: { axis: 'horizontal', sourceSign: 1, targetSign: -1 },
  top: { axis: 'vertical', sourceSign: -1, targetSign: 1 },
  bottom: { axis: 'vertical', sourceSign: 1, targetSign: -1 },
};

function endpointSideIssue(points, endpoint, side) {
  const rule = ENDPOINT_SIDE_RULES[side];
  if (!rule) return null;
  const normalized = normalizeRoutePoints(points);
  if (normalized.length < 2) return null;
  const segmentIndex = endpoint === 'source' ? 0 : normalized.length - 2;
  const start = normalized[segmentIndex];
  const end = normalized[segmentIndex + 1];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const along = rule.axis === 'horizontal' ? dx : dy;
  const across = rule.axis === 'horizontal' ? dy : dx;
  const expectedSign = endpoint === 'source' ? rule.sourceSign : rule.targetSign;
  if (Math.abs(across) <= 0.0001 && along * expectedSign > 0.0001) return null;
  return { endpoint, side, segmentIndex, start, end };
}

/**
 * A side is a direction contract, not just a point on a border: the first and
 * final segments must leave and enter perpendicular to the declared side. A line
 * that grazes a port sideways reads as passing by rather than connecting.
 */
export function routeHonorsEndpointSides(points, fromSide, toSide) {
  return !endpointSideIssue(points, 'source', fromSide)
    && !endpointSideIssue(points, 'target', toSide);
}

const OUTWARD_SIDE_VECTOR = {
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
};

/** Step perpendicular away from a port before turning anywhere. */
export function outwardStub(point, side, distance = 20) {
  const [dx, dy] = OUTWARD_SIDE_VECTOR[side] ?? [0, 0];
  return [point[0] + dx * distance, point[1] + dy * distance];
}

function collinearBacktrack(a, b, c) {
  const first = [b[0] - a[0], b[1] - a[1]];
  const second = [c[0] - b[0], c[1] - b[1]];
  const cross = first[0] * second[1] - first[1] * second[0];
  const dot = first[0] * second[0] + first[1] * second[1];
  return Math.abs(cross) <= 0.0001 && dot < -0.0001;
}

const VERTICAL_SIDES = new Set(['top', 'bottom']);

function uniqueNumbers(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const key = value.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Candidate orthogonal routes between two port anchors, each honouring both
 * endpoint sides.
 *
 * archify generated two doglegs at stub level. That is too narrow here: a
 * hydraulic port often sits on a face the corridor has to reach around, and a
 * crossbar pinned to the stub level then doubles back through the port it was
 * aiming at. So the crossbar is tried at a spread of levels -- both stubs, the
 * midpoint, and channels clear of both endpoints -- and the side-honesty and
 * backtrack filters below throw away the ones that are geometrically wrong.
 * Generating more and filtering hard is what keeps this deterministic while
 * still finding a route when the obvious one is blocked.
 */
export function sideAwareBridgeCandidates(start, end, fromSide, toSide, { stub = 20 } = {}) {
  const startStub = outwardStub(start, fromSide, stub);
  const endStub = outwardStub(end, toSide, stub);
  const fromVertical = VERTICAL_SIDES.has(fromSide);
  const toVertical = VERTICAL_SIDES.has(toSide);
  const raw = [];

  if (fromVertical && toVertical) {
    const levels = uniqueNumbers([
      startStub[1],
      endStub[1],
      (start[1] + end[1]) / 2,
      Math.min(startStub[1], endStub[1]) - 20,
      Math.max(startStub[1], endStub[1]) + 20,
      Math.min(start[1], end[1]) - 36,
      Math.max(start[1], end[1]) + 36,
    ]);
    for (const y of levels) raw.push([[start[0], y], [end[0], y]]);
  } else if (!fromVertical && !toVertical) {
    const levels = uniqueNumbers([
      startStub[0],
      endStub[0],
      (start[0] + end[0]) / 2,
      Math.min(startStub[0], endStub[0]) - 20,
      Math.max(startStub[0], endStub[0]) + 20,
      Math.min(start[0], end[0]) - 36,
      Math.max(start[0], end[0]) + 36,
    ]);
    for (const x of levels) raw.push([[x, start[1]], [x, end[1]]]);
  } else {
    // One port faces along x, the other along y: the natural shape is a single
    // corner, with Z variants for when that corner is blocked.
    raw.push(fromVertical ? [[start[0], end[1]]] : [[end[0], start[1]]]);
    if (fromVertical) {
      for (const y of uniqueNumbers([startStub[1], Math.min(start[1], end[1]) - 36, Math.max(start[1], end[1]) + 36])) {
        raw.push([[start[0], y], [endStub[0], y], [endStub[0], end[1]]]);
      }
    } else {
      for (const x of uniqueNumbers([startStub[0], Math.min(start[0], end[0]) - 36, Math.max(start[0], end[0]) + 36])) {
        raw.push([[x, start[1]], [x, endStub[1]], [end[0], endStub[1]]]);
      }
    }
  }

  const seen = new Set();
  return raw
    .map((candidate) => normalizeRoutePoints([start, ...candidate, end]))
    .filter((points) => points.length >= 2)
    .filter((points) => !collinearBacktrack(points[0], points[1], points[2] ?? points[1]))
    .filter((points) => !collinearBacktrack(points.at(-3) ?? points.at(-2), points.at(-2), points.at(-1)))
    .filter((points) => routeHonorsEndpointSides(points, fromSide, toSide))
    .filter((points) => {
      const key = JSON.stringify(points);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((points) => points.slice(1, -1));
}

/**
 * How much of this route runs along the same line as something already placed.
 *
 * Two parallel lines sharing a corridor read as one line, which is worse than a
 * longer route. Returned as a length so it can be priced against route cost.
 */
export function collinearOverlap(points, placedSegments) {
  let overlap = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [ax1, ay1] = points[index];
    const [ax2, ay2] = points[index + 1];
    const aVertical = Math.abs(ax2 - ax1) < 0.001;

    for (const [[bx1, by1], [bx2, by2]] of placedSegments) {
      const bVertical = Math.abs(bx2 - bx1) < 0.001;
      if (aVertical !== bVertical) continue;
      if (aVertical) {
        if (Math.abs(ax1 - bx1) > 0.001) continue;
        const low = Math.max(Math.min(ay1, ay2), Math.min(by1, by2));
        const high = Math.min(Math.max(ay1, ay2), Math.max(by1, by2));
        if (high > low) overlap += high - low;
      } else {
        if (Math.abs(ay1 - by1) > 0.001) continue;
        const low = Math.max(Math.min(ax1, ax2), Math.min(bx1, bx2));
        const high = Math.min(Math.max(ax1, ax2), Math.max(bx1, bx2));
        if (high > low) overlap += high - low;
      }
    }
  }
  return overlap;
}

/** Split a polyline into its segments, for overlap accounting. */
export function toSegments(points) {
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push([points[index], points[index + 1]]);
  }
  return segments;
}

/** Does this polyline stay clear of every rect except its own two endpoints? */
export function routeClearsRects(points, rects, { clearance = 2 } = {}) {
  for (const rect of rects) {
    for (let index = 0; index < points.length - 1; index += 1) {
      if (segmentIntersectsRect({ start: points[index], end: points[index + 1] }, rect, clearance)) {
        return false;
      }
    }
  }
  return true;
}

/** Total orthogonal length plus a turn penalty: fewer corners reads better. */
export function routeCost(points) {
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    length += Math.abs(points[index + 1][0] - points[index][0])
      + Math.abs(points[index + 1][1] - points[index][1]);
  }
  return length + (points.length - 2) * 24;
}

/** Do two orthogonal polylines cross? Used to report, not to forbid. */
export function polylinesCross(left, right) {
  for (let i = 0; i < left.length - 1; i += 1) {
    for (let j = 0; j < right.length - 1; j += 1) {
      if (segmentsIntersect(left[i], left[i + 1], right[j], right[j + 1])) {
        // Shared endpoints are not crossings.
        const shared = [left[i], left[i + 1]].some(
          (a) => [right[j], right[j + 1]].some((b) => Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001),
        );
        if (!shared) return true;
      }
    }
  }
  return false;
}
