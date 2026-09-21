// Air turbine (expander).
//
// ISO 1219 has no turbine. Its nearest form is the pneumatic motor: a circle
// with a HOLLOW triangle pointing in from the inlet -- hollow because the energy
// carrier is a gas; the solid triangle is reserved for liquids. That is the
// default, and it keeps the drawing inside one standard. A fluid-power reader
// will see an air motor there; the tag and the parts list carry that it is a
// turbine, a dynamic machine rather than a displacement one.
//
// `meta.machine_style: iso10628` draws the process-plant turbine instead: a
// trapezoid widening in the direction of flow, which anyone from power or
// process work reads as a turbine at a glance. Both styles share one frame and
// one port table, so switching convention never moves a line.
//
// Power flows left to right on a hydraulify drawing, as it does from the drive
// motor into a pump: a turbine is a driver, so its shaft leaves on the right.
// Mirror it to drive something on its left.

import { line, circle, polygon } from '../shared/svg.mjs';
import { shaft } from './glyphs.mjs';
import { port, labelLeft, CRITICALITY, MECHANICAL } from './contract.mjs';

const BODY = 56;
const RADIUS = 22;
const WIDTH = BODY + 16;
const CENTRE_X = BODY / 2;
const CENTRE_Y = BODY / 2;

// The trapezoid: narrow where the air enters, wide where it leaves.
const INLET_HALF = 8;
const EXHAUST_HALF = 22;
const TRAPEZOID_TOP = 8;
const TRAPEZOID_BOTTOM = BODY - 8;

export const type = 'turbine';

export const defaults = {};

export function geometry() {
  return {
    width: WIDTH,
    height: BODY,
    ports: {
      inlet: port('inlet', CENTRE_X, 0, 'top', { criticality: CRITICALITY.REQUIRED, label: 'IN', medium: 'air' }),
      exhaust: port('exhaust', CENTRE_X, BODY, 'bottom', { criticality: CRITICALITY.REQUIRED, label: 'EX', medium: 'air' }),
      shaft: port('shaft', WIDTH, CENTRE_Y, 'right', { criticality: CRITICALITY.REQUIRED, label: 'S', medium: MECHANICAL }),
    },
    labelAnchor: labelLeft(BODY),
  };
}

function iso1219() {
  const body = circle(CENTRE_X, CENTRE_Y, RADIUS, { cls: 'sym' });
  const tip = 7;
  // Hollow triangle pointing inward from the inlet.
  const inTriangle = polygon(
    [[CENTRE_X, CENTRE_Y - RADIUS + tip + 4], [CENTRE_X - tip, CENTRE_Y - RADIUS + 1], [CENTRE_X + tip, CENTRE_Y - RADIUS + 1]],
    { cls: 'sym' },
  );
  return body
    + line(CENTRE_X, 0, CENTRE_X, CENTRE_Y - RADIUS, { cls: 'sym' })
    + line(CENTRE_X, CENTRE_Y + RADIUS, CENTRE_X, BODY, { cls: 'sym' })
    + inTriangle
    + shaft(CENTRE_X + RADIUS, CENTRE_Y, WIDTH, CENTRE_Y);
}

function iso10628() {
  const outline = polygon([
    [CENTRE_X - INLET_HALF, TRAPEZOID_TOP],
    [CENTRE_X + INLET_HALF, TRAPEZOID_TOP],
    [CENTRE_X + EXHAUST_HALF, TRAPEZOID_BOTTOM],
    [CENTRE_X - EXHAUST_HALF, TRAPEZOID_BOTTOM],
  ], { cls: 'sym' });
  // The right-hand side of the trapezoid at mid-height, where the shaft leaves.
  const sideX = CENTRE_X + INLET_HALF
    + (EXHAUST_HALF - INLET_HALF) * ((CENTRE_Y - TRAPEZOID_TOP) / (TRAPEZOID_BOTTOM - TRAPEZOID_TOP));
  return outline
    + line(CENTRE_X, 0, CENTRE_X, TRAPEZOID_TOP, { cls: 'sym' })
    + line(CENTRE_X, TRAPEZOID_BOTTOM, CENTRE_X, BODY, { cls: 'sym' })
    + shaft(sideX, CENTRE_Y, WIDTH, CENTRE_Y);
}

export function draw({ style }) {
  return style?.machine === 'iso10628' ? iso10628() : iso1219();
}

export function describe() {
  return 'Air turbine (expander)';
}
