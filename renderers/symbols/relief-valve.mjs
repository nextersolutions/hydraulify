// Pressure relief valve (normally closed).
//
// The defining convention: the flow arrow inside the envelope is OFFSET from the
// port line. A reader takes that offset to mean the path is blocked at rest, and
// that the valve only connects inlet to outlet once the pressure sensed through
// the internal pilot line overcomes the spring. Drawing the arrow in line with
// the ports would state the opposite.
//
// Flow runs top to bottom: inlet at the top, outlet at the bottom. ISO symbols
// carry no fixed orientation, and this one matches how relief valves are almost
// always placed -- tapped off a pressure line that runs above, discharging down
// to a reservoir that sits at the bottom of the drawing.
//
// A pilot-operated (two-stage) relief valve is drawn as the same element inside a
// dash-dot enclosure, which is the standard way to show a complete unit assembled
// from more than one stage.

import { line, polyline, rect } from '../shared/svg.mjs';
import { spring, flowArrow, adjustmentArrow } from './glyphs.mjs';
import { port, labelRight, CRITICALITY } from './contract.mjs';

// The envelope is inset from the left edge far enough for the internal pilot
// line to run beside it as its own leg. At a tighter inset the pilot reads as a
// stray dashed box against the envelope wall rather than as a control line.
const WIDTH = 92;
const HEIGHT = 72;
const ENVELOPE = { x: 26, y: 18, size: 36 };
const PORT_X = 44;
const PILOT_X = 12;

export const type = 'relief_valve';

export const defaults = {
  pilot_operated: false,
  remote_pilot: false,
};

export function geometry(config) {
  const ports = {
    inlet: port('inlet', PORT_X, 0, 'top', { criticality: CRITICALITY.REQUIRED, label: 'P' }),
    outlet: port('outlet', PORT_X, HEIGHT, 'bottom', { criticality: CRITICALITY.REQUIRED, label: 'T' }),
  };
  if (config.remote_pilot) {
    // A remote pilot port is routinely plugged, so leaving it unconnected is not
    // a finding.
    ports.pilot = port('pilot', WIDTH, 12, 'right', { criticality: CRITICALITY.OPTIONAL, label: 'X' });
  }
  return { width: WIDTH, height: HEIGHT, ports, labelAnchor: labelRight(WIDTH, HEIGHT) };
}

export function draw({ config }) {
  const { x, y, size } = ENVELOPE;
  const envelope = rect(x, y, size, size, { cls: 'sym' });

  // Offset from the port line: blocked at rest. Arrow points the way oil goes
  // once the valve cracks, which is inlet (top) to outlet (bottom).
  const arrowX = x + 12;
  const arrow = flowArrow(arrowX, y + 4, arrowX, y + size - 4);

  const inletStub = line(PORT_X, 0, PORT_X, y, { cls: 'sym' });
  const outletStub = line(PORT_X, y + size, PORT_X, HEIGHT, { cls: 'sym' });

  const springGlyph = spring(x + size, y + size / 2, x + size + 20, y + size / 2, { coils: 3, amplitude: 5 });
  // Diagonal through the spring: adjustable setting.
  const adjustable = adjustmentArrow(x + size + 22, y + size / 2 + 14, x + size + 2, y + size / 2 - 14);

  // Internal pilot: senses inlet pressure and acts on the envelope against the
  // spring. Long-dashed, because it is a control line and not a working line.
  const internalPilot = polyline(
    [[PORT_X, 9], [PILOT_X, 9], [PILOT_X, y + size / 2], [x, y + size / 2]],
    { cls: 'pilot-line' },
  );

  // A remote pilot acts on the spring chamber, so it joins at the spring end.
  const remotePilot = config.remote_pilot
    ? polyline([[x + size + 20, y + size / 2], [x + size + 24, y + size / 2], [x + size + 24, 12], [WIDTH, 12]], { cls: 'pilot-line' })
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
