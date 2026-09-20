// Pressure gauge.
//
// ISO 1219: a circle with a pointer, connected to the line it measures by a short
// stem. A gauge is a measuring point, not a flow path: it has exactly one port.

import { line, circle } from '../shared/svg.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const WIDTH = 44;
const HEIGHT = 52;
const CENTRE_X = 22;
const CENTRE_Y = 18;
const RADIUS = 16;

export const type = 'pressure_gauge';

export const defaults = {
  with_isolator: false,
};

export function geometry() {
  return {
    width: WIDTH,
    height: HEIGHT,
    ports: {
      inlet: port('inlet', CENTRE_X, HEIGHT, 'bottom', { criticality: CRITICALITY.REQUIRED, label: 'M' }),
    },
    labelAnchor: labelBelow(WIDTH, HEIGHT, 12),
  };
}

export function draw({ config }) {
  const body = circle(CENTRE_X, CENTRE_Y, RADIUS, { cls: 'sym' });
  // Pointer, drawn away from the stem so the two are never confused.
  const pointer = line(CENTRE_X, CENTRE_Y, CENTRE_X + 11, CENTRE_Y - 11, { cls: 'sym' });
  const stem = line(CENTRE_X, CENTRE_Y + RADIUS, CENTRE_X, HEIGHT, { cls: 'sym' });
  // An isolator cock is drawn as a small bow-tie on the stem.
  const isolator = config.with_isolator
    ? line(CENTRE_X - 5, HEIGHT - 14, CENTRE_X + 5, HEIGHT - 6, { cls: 'sym' })
      + line(CENTRE_X - 5, HEIGHT - 6, CENTRE_X + 5, HEIGHT - 14, { cls: 'sym' })
    : '';
  return body + pointer + stem + isolator;
}

export function describe({ config }) {
  return config.with_isolator ? 'Pressure gauge with isolator cock' : 'Pressure gauge';
}
