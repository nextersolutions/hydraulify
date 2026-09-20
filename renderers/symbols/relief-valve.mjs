// Pressure relief valve (normally closed).
//
// The defining convention: the flow arrow inside the envelope is OFFSET from the
// port line. A reader takes that offset to mean the path is blocked at rest, and
// that the valve only connects inlet to outlet once the pressure sensed through
// the internal pilot line overcomes the spring. Drawing the arrow in line with
// the ports would state the opposite.
//
// A pilot-operated (two-stage) relief valve is drawn as the same element inside a
// dash-dot enclosure, which is the standard way to show a complete unit assembled
// from more than one stage.

import { line, polyline, rect } from '../shared/svg.mjs';
import { spring, flowArrow, adjustmentArrow } from './glyphs.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const WIDTH = 74;
const HEIGHT = 72;
const ENVELOPE = { x: 8, y: 18, size: 36 };
const PORT_X = 26;

export const type = 'relief_valve';

export const defaults = {
  pilot_operated: false,
  remote_pilot: false,
};

export function geometry(config) {
  const ports = {
    inlet: port('inlet', PORT_X, HEIGHT, 'bottom', { criticality: CRITICALITY.REQUIRED, label: 'P' }),
    outlet: port('outlet', PORT_X, 0, 'top', { criticality: CRITICALITY.REQUIRED, label: 'T' }),
  };
  if (config.remote_pilot) {
    // A remote pilot port is routinely plugged, so leaving it unconnected is not
    // a finding.
    ports.pilot = port('pilot', WIDTH, 12, 'right', { criticality: CRITICALITY.OPTIONAL, label: 'X' });
  }
  return { width: WIDTH, height: HEIGHT, ports, labelAnchor: labelBelow(WIDTH, HEIGHT, 16) };
}

export function draw({ config }) {
  const { x, y, size } = ENVELOPE;
  const envelope = rect(x, y, size, size, { cls: 'sym' });

  // Offset from the port line: blocked at rest.
  const arrowX = x + 12;
  const arrow = flowArrow(arrowX, y + size - 4, arrowX, y + 4);

  const inletStub = line(PORT_X, HEIGHT, PORT_X, y + size, { cls: 'sym' });
  const outletStub = line(PORT_X, 0, PORT_X, y, { cls: 'sym' });

  const springGlyph = spring(x + size, y + size / 2, x + size + 20, y + size / 2, { coils: 3, amplitude: 5 });
  // Diagonal through the spring: adjustable setting.
  const adjustable = adjustmentArrow(x + size + 22, y + size / 2 + 14, x + size + 2, y + size / 2 - 14);

  // Internal pilot: senses inlet pressure and acts on the envelope against the
  // spring. Long-dashed, because it is a control line and not a working line.
  const internalPilot = polyline(
    [[PORT_X, HEIGHT - 8], [4, HEIGHT - 8], [4, y + size / 2], [x, y + size / 2]],
    { cls: 'pilot-line' },
  );

  const remotePilot = config.remote_pilot
    ? polyline([[x + size / 2, y], [x + size / 2, 12], [WIDTH, 12]], { cls: 'pilot-line' })
    : '';

  const enclosure = config.pilot_operated
    ? rect(1, 1, WIDTH - 2, HEIGHT - 2, { cls: 'enclosure' })
    : '';

  return enclosure + envelope + arrow + inletStub + outletStub
    + springGlyph + adjustable + internalPilot + remotePilot;
}

export function describe({ config }) {
  const stage = config.pilot_operated ? 'Pilot-operated pressure relief valve' : 'Pressure relief valve';
  return config.remote_pilot ? `${stage} with remote pilot port` : stage;
}
