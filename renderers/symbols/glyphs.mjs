// Sub-glyphs shared between symbols: springs, internal flow arrows, seats, and the
// actuation glyphs that hang off a directional valve's envelope ends.
//
// These follow ISO 1219 principles. Where an exact rendering is uncertain, the
// conservative standard form is used rather than a more decorative one -- a reader
// misinterpreting a non-standard glyph is a worse failure than an austere drawing.

import { line, polyline, polygon, circle, rect, path, arrowhead, text } from '../shared/svg.mjs';

/**
 * Text drawn inside a symbol that stays readable when the symbol is mirrored.
 *
 * A mirrored symbol is drawn inside a horizontal flip, so ordinary text would
 * come out backwards -- a generator's G, a boundary's name. This counter-flips
 * the text about its own anchor, which cancels the outer flip exactly and leaves
 * it where the mirrored frame puts it. Every glyph letter must go through here.
 */
export function uprightText(x, y, content, mirrored, { cls = 'glyph-text', size, anchor = 'middle' } = {}) {
  if (!mirrored) return text(x, y, content, { cls, size, anchor });
  const flipped = anchor === 'start' ? 'end' : (anchor === 'end' ? 'start' : 'middle');
  return text(x, y, content, {
    cls,
    size,
    anchor: flipped,
    extra: [['transform', `matrix(-1 0 0 1 ${2 * x} 0)`]],
  });
}

/**
 * A shaft: ISO 1219 draws a mechanical connection as a double line. Horizontal
 * or vertical only, like every other line in the library.
 */
export function shaft(x1, y1, x2, y2, { gap = 3, cls = 'sym' } = {}) {
  const half = gap / 2;
  if (y1 === y2) {
    return line(x1, y1 - half, x2, y2 - half, { cls }) + line(x1, y1 + half, x2, y2 + half, { cls });
  }
  return line(x1 - half, y1, x2 - half, y2, { cls }) + line(x1 + half, y1, x2 + half, y2, { cls });
}

/**
 * Spring: a zigzag along an axis. Springs appear on relief valves, spring-centred
 * and spring-returned directional valves, and spring-loaded check valves.
 */
export function spring(x1, y1, x2, y2, { coils = 4, amplitude = 4, cls = 'sym' } = {}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return '';
  const ux = dx / length;
  const uy = dy / length;
  // Perpendicular unit vector for the zigzag amplitude.
  const px = -uy;
  const py = ux;
  const steps = coils * 2;
  const points = [[x1, y1]];
  for (let index = 1; index <= steps; index += 1) {
    const t = (index - 0.5) / steps;
    const sign = index % 2 === 1 ? 1 : -1;
    points.push([
      x1 + ux * length * t + px * amplitude * sign,
      y1 + uy * length * t + py * amplitude * sign,
    ]);
  }
  points.push([x2, y2]);
  return polyline(points, { cls });
}

/**
 * A straight internal flow path with an arrowhead at its midpoint. Used inside
 * valve envelopes, where the arrow states which way fluid moves in that position.
 */
export function flowArrow(x1, y1, x2, y2, { cls = 'sym', size = 4 } = {}) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const direction = Math.abs(x2 - x1) >= Math.abs(y2 - y1)
    ? (x2 >= x1 ? 'right' : 'left')
    : (y2 >= y1 ? 'down' : 'up');
  // Nudge the head forward so the triangle sits on the midpoint rather than
  // behind it, keeping short paths legible.
  const offsets = { right: [size, 0], left: [-size, 0], down: [0, size], up: [0, -size] };
  const [ox, oy] = offsets[direction];
  return line(x1, y1, x2, y2, { cls }) + arrowhead(midX + ox, midY + oy, direction, { size, cls: `${cls} arrow-head` });
}

/**
 * A multi-segment internal flow path with a direction arrow.
 *
 * Used for the spool conditions whose path turns a corner -- a 3/2 venting to
 * tank, a tandem centre joining P to T. Without the arrow a reader can see that
 * two ports are joined but not which way oil moves, which is half the
 * information the envelope exists to carry.
 */
export function flowPath(points, { cls = 'sym', size = 4 } = {}) {
  const body = polyline(points, { cls });
  const last = points.at(-1);
  const previous = points.at(-2);
  if (!last || !previous) return body;
  const dx = last[0] - previous[0];
  const dy = last[1] - previous[1];
  const direction = Math.abs(dx) >= Math.abs(dy)
    ? (dx >= 0 ? 'right' : 'left')
    : (dy >= 0 ? 'down' : 'up');
  // Place the head short of the endpoint so it does not sit on the envelope edge.
  const inset = 6;
  const headX = Math.abs(dx) >= Math.abs(dy) ? last[0] - Math.sign(dx) * inset : last[0];
  const headY = Math.abs(dx) >= Math.abs(dy) ? last[1] : last[1] - Math.sign(dy) * inset;
  return body + arrowhead(headX, headY, direction, { size, cls: `${cls} arrow-head` });
}

/** A blocked port inside a valve envelope: a stub ending in a perpendicular bar. */
export function blockedStub(x, y, side, { length = 9, bar = 7, cls = 'sym' } = {}) {
  const vectors = { top: [0, 1], bottom: [0, -1], left: [1, 0], right: [-1, 0] };
  const [dx, dy] = vectors[side];
  const endX = x + dx * length;
  const endY = y + dy * length;
  const barX = Math.abs(dx) ? 0 : bar / 2;
  const barY = Math.abs(dx) ? bar / 2 : 0;
  return line(x, y, endX, endY, { cls })
    + line(endX - barX, endY - barY, endX + barX, endY + barY, { cls });
}

/** Ball-and-seat check element. Free flow runs from `from` toward `to`. */
export function ballSeat(cx, cy, { radius = 6, horizontal = true, freeFlow = 'right', cls = 'sym' } = {}) {
  const ball = circle(cx, cy, radius, { cls, fill: 'none' });
  // The seat sits on the side the ball is pushed against when flow is blocked,
  // i.e. opposite the free-flow direction.
  const seatOffset = radius + 1;
  let seat;
  if (horizontal) {
    const sx = freeFlow === 'right' ? cx - seatOffset : cx + seatOffset;
    seat = line(sx, cy - radius - 2, sx, cy + radius + 2, { cls });
  } else {
    const sy = freeFlow === 'down' ? cy - seatOffset : cy + seatOffset;
    seat = line(cx - radius - 2, sy, cx + radius + 2, sy, { cls });
  }
  return ball + seat;
}

/** A variable-restriction arrow drawn diagonally across an element. */
export function adjustmentArrow(x1, y1, x2, y2, { cls = 'sym', size = 4 } = {}) {
  const direction = Math.abs(x2 - x1) >= Math.abs(y2 - y1)
    ? (x2 >= x1 ? 'right' : 'left')
    : (y2 >= y1 ? 'down' : 'up');
  return line(x1, y1, x2, y2, { cls }) + arrowhead(x2, y2, direction, { size, cls: `${cls} arrow-head` });
}

/** Throttle restriction: two opposed arcs pinching the flow path. */
export function restriction(cx, cy, { width = 14, height = 12, cls = 'sym' } = {}) {
  const half = width / 2;
  const top = path(
    `M ${cx - half} ${cy - height} Q ${cx} ${cy - height / 3} ${cx + half} ${cy - height}`,
    { cls },
  );
  const bottom = path(
    `M ${cx - half} ${cy + height} Q ${cx} ${cy + height / 3} ${cx + half} ${cy + height}`,
    { cls },
  );
  return top + bottom;
}

// ---------------------------------------------------------------------------
// Actuation glyphs
//
// Drawn in a box of ACTUATION_WIDTH x envelope height, butted against the end of
// a directional valve's envelope block. `facing` is the direction the glyph
// pushes: 'right' for a glyph on the left end, 'left' for one on the right end.
// ---------------------------------------------------------------------------

export const ACTUATION_WIDTH = 24;

function stem(x1, y, x2, cls) {
  return line(x1, y, x2, y, { cls });
}

const ACTUATORS = {
  solenoid(x, y, height, facing, cls) {
    const boxWidth = 16;
    const boxX = facing === 'right' ? x : x + (ACTUATION_WIDTH - boxWidth);
    const boxY = y + height / 2 - 8;
    const stemFrom = facing === 'right' ? boxX + boxWidth : boxX;
    const stemTo = facing === 'right' ? x + ACTUATION_WIDTH : x;
    return rect(boxX, boxY, boxWidth, 16, { cls })
      + line(boxX, boxY + 16, boxX + boxWidth, boxY, { cls })
      + stem(stemFrom, y + height / 2, stemTo, cls);
  },
  pilot(x, y, height, facing, cls) {
    const boxWidth = 16;
    const boxX = facing === 'right' ? x : x + (ACTUATION_WIDTH - boxWidth);
    const boxY = y + height / 2 - 8;
    const headX = facing === 'right' ? boxX + boxWidth - 3 : boxX + 3;
    const stemFrom = facing === 'right' ? boxX + boxWidth : boxX;
    const stemTo = facing === 'right' ? x + ACTUATION_WIDTH : x;
    return rect(boxX, boxY, boxWidth, 16, { cls })
      + arrowhead(headX, boxY + 8, facing, { size: 4, cls: `${cls} arrow-head` })
      + stem(stemFrom, y + height / 2, stemTo, cls);
  },
  pneumatic_pilot(x, y, height, facing, cls) {
    // Same envelope as a hydraulic pilot, with an open (unfilled) arrow.
    const boxWidth = 16;
    const boxX = facing === 'right' ? x : x + (ACTUATION_WIDTH - boxWidth);
    const boxY = y + height / 2 - 8;
    const tipX = facing === 'right' ? boxX + boxWidth - 3 : boxX + 3;
    const tailX = facing === 'right' ? tipX - 7 : tipX + 7;
    const stemFrom = facing === 'right' ? boxX + boxWidth : boxX;
    const stemTo = facing === 'right' ? x + ACTUATION_WIDTH : x;
    return rect(boxX, boxY, boxWidth, 16, { cls })
      + polyline([[tailX, boxY + 3], [tipX, boxY + 8], [tailX, boxY + 13]], { cls })
      + stem(stemFrom, y + height / 2, stemTo, cls);
  },
  solenoid_pilot(x, y, height, facing, cls) {
    // Solenoid-operated pilot: solenoid box and pilot box stacked against the end.
    const boxWidth = 12;
    const first = facing === 'right' ? x : x + ACTUATION_WIDTH - boxWidth * 2;
    const second = first + boxWidth;
    const boxY = y + height / 2 - 8;
    const solenoidBox = facing === 'right' ? first : second;
    const pilotBox = facing === 'right' ? second : first;
    return rect(solenoidBox, boxY, boxWidth, 16, { cls })
      + line(solenoidBox, boxY + 16, solenoidBox + boxWidth, boxY, { cls })
      + rect(pilotBox, boxY, boxWidth, 16, { cls })
      + arrowhead(pilotBox + (facing === 'right' ? boxWidth - 2 : 2), boxY + 8, facing, { size: 3, cls: `${cls} arrow-head` });
  },
  lever(x, y, height, facing, cls) {
    const baseX = facing === 'right' ? x + ACTUATION_WIDTH : x;
    const tipX = facing === 'right' ? x + 4 : x + ACTUATION_WIDTH - 4;
    const midY = y + height / 2;
    return stem(baseX, midY, tipX, cls)
      + line(tipX, midY, tipX + (facing === 'right' ? 6 : -6), midY - 14, { cls })
      + circle(tipX + (facing === 'right' ? 6 : -6), midY - 16, 2.5, { cls, fill: 'currentColor' });
  },
  push_button(x, y, height, facing, cls) {
    const baseX = facing === 'right' ? x + ACTUATION_WIDTH : x;
    const tipX = facing === 'right' ? x + 6 : x + ACTUATION_WIDTH - 6;
    const midY = y + height / 2;
    return stem(baseX, midY, tipX, cls)
      + line(tipX, midY - 7, tipX, midY + 7, { cls });
  },
  pedal(x, y, height, facing, cls) {
    const baseX = facing === 'right' ? x + ACTUATION_WIDTH : x;
    const tipX = facing === 'right' ? x + 5 : x + ACTUATION_WIDTH - 5;
    const midY = y + height / 2;
    const plateEnd = facing === 'right' ? tipX + 12 : tipX - 12;
    return stem(baseX, midY, tipX, cls)
      + line(tipX, midY, tipX, midY - 8, { cls })
      + line(tipX, midY - 8, plateEnd, midY - 11, { cls });
  },
  mechanical(x, y, height, facing, cls) {
    const baseX = facing === 'right' ? x + ACTUATION_WIDTH : x;
    const tipX = facing === 'right' ? x + 8 : x + ACTUATION_WIDTH - 8;
    const midY = y + height / 2;
    return stem(baseX, midY, tipX, cls) + circle(tipX, midY, 4, { cls });
  },
  none() {
    return '';
  },
};

/**
 * Draw one actuation glyph.
 *
 * @param {string} kind   actuationGlyph enum value
 * @param {number} x      left edge of the glyph box
 * @param {number} y      top edge of the envelope block
 * @param {number} height envelope height
 * @param {'left'|'right'} facing direction the actuator pushes the spool
 */
export function actuationGlyph(kind, x, y, height, facing, cls = 'sym') {
  const draw = ACTUATORS[kind];
  if (!draw) throw new Error(`glyphs: unknown actuation ${kind}`);
  return draw(x, y, height, facing, cls);
}

/** A spring drawn at an envelope end, as a return or centring element. */
export function actuationSpring(x, y, height, facing, cls = 'sym') {
  const midY = y + height / 2;
  const from = facing === 'right' ? x + ACTUATION_WIDTH : x;
  const to = facing === 'right' ? x + 3 : x + ACTUATION_WIDTH - 3;
  return spring(from, midY, to, midY, { coils: 3, amplitude: 5, cls });
}

/** A dot marking a real hydraulic junction where lines meet. */
export function junctionDot(x, y, { radius = 3.2, cls = 'sym junction-dot' } = {}) {
  return circle(x, y, radius, { cls, fill: 'currentColor' });
}

export { polygon };
