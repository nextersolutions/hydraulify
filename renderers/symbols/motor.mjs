// Hydraulic motor.
//
// ISO 1219: a circle with a solid triangle pointing INTO it, from the inlet. The
// inward triangle is the only thing distinguishing a motor from a pump, so it is
// drawn deliberately and never softened.
//
// A bidirectional motor carries a triangle at each port and its ports are named
// A and B rather than inlet and outlet, because neither is fixed.

import { line, circle, polygon } from '../shared/svg.mjs';
import { port, labelRight, CRITICALITY } from './contract.mjs';

const BODY = 56;
const RADIUS = 22;

export const type = 'motor';

export const defaults = {
  motor_type: 'fixed_displacement',
  bidirectional: false,
  has_case_drain: false,
};

export function geometry(config) {
  const centreX = BODY / 2;
  const ports = config.bidirectional
    ? {
      A: port('A', centreX, 0, 'top', { criticality: CRITICALITY.REQUIRED, label: 'A' }),
      B: port('B', centreX, BODY, 'bottom', { criticality: CRITICALITY.REQUIRED, label: 'B' }),
    }
    : {
      inlet: port('inlet', centreX, 0, 'top', { criticality: CRITICALITY.REQUIRED, label: 'A' }),
      outlet: port('outlet', centreX, BODY, 'bottom', { criticality: CRITICALITY.REQUIRED, label: 'B' }),
    };

  if (config.has_case_drain) {
    ports.case_drain = port('case_drain', BODY, 16, 'right', {
      criticality: CRITICALITY.OPTIONAL,
      label: 'L',
      aliases: ['drain', 'L'],
    });
  }

  return { width: BODY, height: BODY, ports, labelAnchor: labelRight(BODY, BODY) };
}

export function draw({ config }) {
  const centreX = BODY / 2;
  const centreY = BODY / 2;
  const body = circle(centreX, centreY, RADIUS, { cls: 'sym' });
  const topStub = line(centreX, centreY - RADIUS, centreX, 0, { cls: 'sym' });
  const bottomStub = line(centreX, centreY + RADIUS, centreX, BODY, { cls: 'sym' });

  // Triangle points inward from the inlet: down from the top of the circle.
  const tip = 7;
  const inTriangle = polygon(
    [[centreX, centreY - RADIUS + tip + 4], [centreX - tip, centreY - RADIUS + 1], [centreX + tip, centreY - RADIUS + 1]],
    { cls: 'sym', fill: 'currentColor' },
  );
  const secondTriangle = config.bidirectional
    ? polygon(
      [[centreX, centreY + RADIUS - tip - 4], [centreX - tip, centreY + RADIUS - 1], [centreX + tip, centreY + RADIUS - 1]],
      { cls: 'sym', fill: 'currentColor' },
    )
    : '';

  const variable = config.motor_type === 'variable_displacement'
    ? line(centreX - RADIUS - 4, centreY + RADIUS + 4, centreX + RADIUS + 4, centreY - RADIUS - 4, { cls: 'sym' })
      + polygon(
        [[centreX + RADIUS + 4, centreY - RADIUS - 4],
          [centreX + RADIUS - 3, centreY - RADIUS - 2],
          [centreX + RADIUS + 2, centreY - RADIUS + 3]],
        { cls: 'sym', fill: 'currentColor' },
      )
    : '';

  const caseDrain = config.has_case_drain
    ? line(centreX + RADIUS, 16, BODY, 16, { cls: 'sym' })
    : '';

  return body + topStub + bottomStub + inTriangle + secondTriangle + variable + caseDrain;
}

export function describe({ config }) {
  const displacement = config.motor_type === 'variable_displacement'
    ? 'Variable-displacement'
    : 'Fixed-displacement';
  const direction = config.bidirectional ? ' bidirectional' : '';
  return `${displacement}${direction} hydraulic motor`;
}
