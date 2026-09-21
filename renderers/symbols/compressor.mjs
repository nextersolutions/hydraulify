// Air compressor.
//
// ISO 1219: a circle with a HOLLOW triangle pointing OUT, toward the delivery
// port. It is the pneumatic counterpart of the pump -- same circle, same
// outward triangle -- and the hollow fill is the whole difference, so it is
// never drawn solid.
//
// Power flows left to right, as from the drive motor into a pump: a compressor
// is driven, so its shaft enters on the left. Mirror it to be driven from the
// right, as the compression side of a shared motor-generator train is.

import { line, circle, polygon } from '../shared/svg.mjs';
import { shaft } from './glyphs.mjs';
import { port, labelRight, CRITICALITY, MECHANICAL } from './contract.mjs';

const BODY = 56;
const RADIUS = 22;
const SHAFT = 16;
const WIDTH = SHAFT + BODY;
const CENTRE_X = SHAFT + BODY / 2;
const CENTRE_Y = BODY / 2;

export const type = 'compressor';

export const defaults = {};

export function geometry() {
  return {
    width: WIDTH,
    height: BODY,
    ports: {
      inlet: port('inlet', CENTRE_X, BODY, 'bottom', { criticality: CRITICALITY.REQUIRED, label: 'IN', medium: 'air' }),
      outlet: port('outlet', CENTRE_X, 0, 'top', { criticality: CRITICALITY.REQUIRED, label: 'OUT', medium: 'air' }),
      shaft: port('shaft', 0, CENTRE_Y, 'left', { criticality: CRITICALITY.REQUIRED, label: 'S', medium: MECHANICAL }),
    },
    labelAnchor: labelRight(WIDTH, BODY),
  };
}

export function draw() {
  const tip = 7;
  const outTriangle = polygon(
    [[CENTRE_X, CENTRE_Y - RADIUS + 1], [CENTRE_X - tip, CENTRE_Y - RADIUS + tip + 4], [CENTRE_X + tip, CENTRE_Y - RADIUS + tip + 4]],
    { cls: 'sym' },
  );
  return circle(CENTRE_X, CENTRE_Y, RADIUS, { cls: 'sym' })
    + line(CENTRE_X, 0, CENTRE_X, CENTRE_Y - RADIUS, { cls: 'sym' })
    + line(CENTRE_X, CENTRE_Y + RADIUS, CENTRE_X, BODY, { cls: 'sym' })
    + outTriangle
    + shaft(0, CENTRE_Y, CENTRE_X - RADIUS, CENTRE_Y);
}

export function describe() {
  return 'Air compressor';
}
