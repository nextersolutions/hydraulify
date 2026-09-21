// Pressure regulator (pressure-reducing valve).
//
// ISO 1219 draws it as the relief valve's opposite, and the differences are the
// meaning:
//
//   - the path is OPEN at rest, so the arrow is in line with the ports, where
//     the relief valve's is offset to show a blocked path;
//   - the pilot senses the OUTLET, because the valve holds downstream pressure;
//     a relief valve senses its inlet.
//
// The spring sits on top with its adjustment arrow; the pilot pushes up from
// below against it. Drawn in-line and horizontal, because a regulator sits in a
// run -- receiver to turbine -- rather than being tapped off one.

import { line, rect, polyline } from '../shared/svg.mjs';
import { spring, flowArrow, adjustmentArrow } from './glyphs.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const ENVELOPE = { x: 14, y: 18, size: 34 };
const WIDTH = ENVELOPE.x * 2 + ENVELOPE.size;
const CENTRE_X = ENVELOPE.x + ENVELOPE.size / 2;
const PORT_Y = ENVELOPE.y + ENVELOPE.size / 2;
const PILOT_Y = ENVELOPE.y + ENVELOPE.size + 8;
const HEIGHT = PILOT_Y + 2;

export const type = 'pressure_regulator';

export const defaults = {};

export function geometry() {
  return {
    width: WIDTH,
    height: HEIGHT,
    ports: {
      inlet: port('inlet', 0, PORT_Y, 'left', { criticality: CRITICALITY.REQUIRED, label: 'IN' }),
      outlet: port('outlet', WIDTH, PORT_Y, 'right', { criticality: CRITICALITY.REQUIRED, label: 'OUT' }),
    },
    labelAnchor: labelBelow(WIDTH, HEIGHT, 12),
  };
}

export function draw() {
  const right = ENVELOPE.x + ENVELOPE.size;
  const envelope = rect(ENVELOPE.x, ENVELOPE.y, ENVELOPE.size, ENVELOPE.size, { cls: 'sym' });
  const stubs = line(0, PORT_Y, ENVELOPE.x, PORT_Y, { cls: 'sym' }) + line(right, PORT_Y, WIDTH, PORT_Y, { cls: 'sym' });
  // Open at rest: the arrow runs straight from inlet to outlet.
  const path = flowArrow(ENVELOPE.x + 4, PORT_Y, right - 4, PORT_Y);
  const adjustable = spring(CENTRE_X, ENVELOPE.y, CENTRE_X, 2, { coils: 3, amplitude: 5 })
    + adjustmentArrow(CENTRE_X - 9, ENVELOPE.y - 2, CENTRE_X + 9, 1);
  // The pilot senses the outlet and pushes up against the spring.
  const pilotX = right + 7;
  const pilot = polyline(
    [[pilotX, PORT_Y], [pilotX, PILOT_Y], [CENTRE_X, PILOT_Y], [CENTRE_X, ENVELOPE.y + ENVELOPE.size]],
    { cls: 'pilot-line' },
  );
  return envelope + stubs + path + adjustable + pilot;
}

export function describe() {
  return 'Pressure regulator (reducing valve)';
}
