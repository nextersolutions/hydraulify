// Hydraulic pump.
//
// ISO 1219: a circle with a solid triangle pointing OUT of it, toward the outlet.
// The triangle is what distinguishes a pump from a motor, whose triangle points in.
// A bidirectional pump carries a triangle at each port. Variable displacement adds
// an arrow drawn diagonally across the circle.
//
// A prime mover is drawn only when the author states one; nothing is added to the
// circuit that the description did not name.

import { line, circle, polygon, text } from '../shared/svg.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const BODY = 56;
const RADIUS = 22;
const DRIVE_WIDTH = 52;

export const type = 'pump';

export const defaults = {
  pump_type: 'fixed_displacement',
  drive: 'none',
  bidirectional: false,
  has_case_drain: false,
};

function bodyOffset(config) {
  return config.drive === 'none' ? 0 : DRIVE_WIDTH;
}

export function geometry(config) {
  const offsetX = bodyOffset(config);
  const width = offsetX + BODY;
  const centreX = offsetX + BODY / 2;

  const ports = {
    inlet: port('inlet', centreX, BODY, 'bottom', {
      criticality: CRITICALITY.REQUIRED,
      label: 'S',
    }),
    outlet: port('outlet', centreX, 0, 'top', {
      criticality: CRITICALITY.REQUIRED,
      label: 'P',
    }),
  };

  if (config.has_case_drain) {
    // A case drain is routinely plugged on pumps that have one but do not need it
    // routed, so an unconnected case drain is silent rather than a finding.
    ports.case_drain = port('case_drain', width, 16, 'right', {
      criticality: CRITICALITY.OPTIONAL,
      label: 'L',
      aliases: ['drain', 'L'],
    });
  }

  return { width, height: BODY, ports, labelAnchor: labelBelow(width, BODY, 16) };
}

function driveGlyph(config) {
  if (config.drive === 'none') return '';
  const centreY = BODY / 2;
  const driveRadius = 20;
  const driveCentreX = 22;
  const body = circle(driveCentreX, centreY, driveRadius, { cls: 'sym' });
  const shaft = line(driveCentreX + driveRadius, centreY, DRIVE_WIDTH + 6, centreY, { cls: 'sym' });

  if (config.drive === 'electric_motor') {
    return body + shaft + text(driveCentreX, centreY + 5, 'M', { cls: 'glyph-text', size: 14 });
  }
  if (config.drive === 'combustion_engine') {
    return body + shaft + text(driveCentreX, centreY + 5, 'IC', { cls: 'glyph-text', size: 11 });
  }
  // Manual drive: a lever on the shaft rather than a prime mover symbol.
  return shaft
    + line(driveCentreX, centreY, driveCentreX, centreY - 18, { cls: 'sym' })
    + line(driveCentreX - 8, centreY - 18, driveCentreX + 8, centreY - 18, { cls: 'sym' });
}

export function draw({ config }) {
  const offsetX = bodyOffset(config);
  const centreX = offsetX + BODY / 2;
  const centreY = BODY / 2;

  const body = circle(centreX, centreY, RADIUS, { cls: 'sym' });

  // Port stubs from the circle out to the frame edge, so routed lines meet the
  // symbol rather than stopping in space beside it.
  const outletStub = line(centreX, centreY - RADIUS, centreX, 0, { cls: 'sym' });
  const inletStub = line(centreX, centreY + RADIUS, centreX, BODY, { cls: 'sym' });

  // Solid triangle pointing out of the circle at the delivery port.
  const tip = 7;
  const outTriangle = polygon(
    [[centreX, centreY - RADIUS + 1], [centreX - tip, centreY - RADIUS + tip + 4], [centreX + tip, centreY - RADIUS + tip + 4]],
    { cls: 'sym', fill: 'currentColor' },
  );
  const inTriangle = config.bidirectional
    ? polygon(
      [[centreX, centreY + RADIUS - 1], [centreX - tip, centreY + RADIUS - tip - 4], [centreX + tip, centreY + RADIUS - tip - 4]],
      { cls: 'sym', fill: 'currentColor' },
    )
    : '';

  const variable = config.pump_type === 'variable_displacement'
    ? line(centreX - RADIUS - 4, centreY + RADIUS + 4, centreX + RADIUS + 4, centreY - RADIUS - 4, { cls: 'sym' })
      + polygon(
        [[centreX + RADIUS + 4, centreY - RADIUS - 4],
          [centreX + RADIUS - 3, centreY - RADIUS - 2],
          [centreX + RADIUS + 2, centreY - RADIUS + 3]],
        { cls: 'sym', fill: 'currentColor' },
      )
    : '';

  const caseDrain = config.has_case_drain
    ? line(centreX + RADIUS, 16, offsetX + BODY, 16, { cls: 'sym' })
    : '';

  return driveGlyph(config) + body + outletStub + inletStub + outTriangle + inTriangle + variable + caseDrain;
}

export function describe({ config }) {
  const displacement = config.pump_type === 'variable_displacement'
    ? 'Variable-displacement'
    : 'Fixed-displacement';
  const direction = config.bidirectional ? ' bidirectional' : '';
  const drive = {
    electric_motor: ', electric motor driven',
    combustion_engine: ', engine driven',
    manual: ', hand operated',
    none: '',
  }[config.drive] ?? '';
  return `${displacement}${direction} hydraulic pump${drive}`;
}
