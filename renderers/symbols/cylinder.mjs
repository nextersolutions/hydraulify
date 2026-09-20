// Hydraulic cylinder.
//
// The barrel is a rectangle; the piston is a bar across the bore; the rod leaves
// through one end (or both, for a double-rod cylinder). Ports sit under the
// barrel at each end: `cap` at the blind end, `rod` at the rod end.
//
// A double-acting cylinder needs both ports connected, which is why both are
// REQUIRED -- a dead rod port is the failure Test 7 exists to catch. A
// single-acting cylinder has one port and, usually, a spring return.
//
// `A` and `B` are accepted as aliases for `cap` and `rod`, because the brief and
// most datasheets name them that way.

import { line, rect, polyline } from '../shared/svg.mjs';
import { spring } from './glyphs.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const BARREL_WIDTH = 112;
const BARREL_HEIGHT = 44;
const ROD_LENGTH = 30;
const PISTON_X = 64;
const PISTON_WIDTH = 6;
const CAP_PORT_X = 16;
const ROD_PORT_X = 96;

export const type = 'cylinder';

export const defaults = {
  cylinder_type: 'double_acting',
  rod: 'single',
  spring_return: false,
  cushioned: false,
};

export function geometry(config) {
  const doubleRod = config.rod === 'double';
  const width = doubleRod ? BARREL_WIDTH + ROD_LENGTH * 2 : BARREL_WIDTH + ROD_LENGTH;
  const barrelX = doubleRod ? ROD_LENGTH : 0;

  const ports = {
    cap: port('cap', barrelX + CAP_PORT_X, BARREL_HEIGHT, 'bottom', {
      criticality: CRITICALITY.REQUIRED,
      label: 'A',
      aliases: ['A', 'a'],
    }),
  };

  if (config.cylinder_type === 'double_acting') {
    ports.rod = port('rod', barrelX + ROD_PORT_X, BARREL_HEIGHT, 'bottom', {
      criticality: CRITICALITY.REQUIRED,
      label: 'B',
      aliases: ['B', 'b'],
    });
  } else {
    // A single-acting cylinder still breathes. On a spring-return cylinder the
    // rod chamber is vented, commonly to tank; leaving it undrawn is normal
    // practice, so the port is optional rather than expected.
    ports.vent = port('vent', barrelX + ROD_PORT_X, BARREL_HEIGHT, 'bottom', {
      criticality: CRITICALITY.OPTIONAL,
      label: 'V',
    });
  }

  return { width, height: BARREL_HEIGHT, ports, labelAnchor: labelBelow(width, BARREL_HEIGHT, 16) };
}

export function draw({ config }) {
  const doubleRod = config.rod === 'double';
  const barrelX = doubleRod ? ROD_LENGTH : 0;
  const centreY = BARREL_HEIGHT / 2;
  const pistonX = barrelX + PISTON_X;

  const barrel = rect(barrelX, 0, BARREL_WIDTH, BARREL_HEIGHT, { cls: 'sym' });
  const piston = rect(pistonX, 1, PISTON_WIDTH, BARREL_HEIGHT - 2, { cls: 'sym', fill: 'currentColor' });

  // Rod drawn as a narrow band so it reads as a solid shaft, not a centre line.
  const rodRight = rect(pistonX + PISTON_WIDTH, centreY - 3, (barrelX + BARREL_WIDTH + ROD_LENGTH) - (pistonX + PISTON_WIDTH), 6, { cls: 'sym' });
  const rodLeft = doubleRod
    ? rect(0, centreY - 3, pistonX, 6, { cls: 'sym' })
    : '';

  const springReturn = config.cylinder_type === 'single_acting' && config.spring_return
    ? spring(pistonX + PISTON_WIDTH + 4, centreY - 12, barrelX + BARREL_WIDTH - 4, centreY - 12, { coils: 4, amplitude: 4 })
    : '';

  // Cushioning is drawn as a small rectangle on the piston face at each end.
  const cushions = config.cushioned
    ? rect(pistonX - 10, centreY - 6, 10, 12, { cls: 'sym' })
      + rect(pistonX + PISTON_WIDTH, centreY - 6, 10, 12, { cls: 'sym' })
    : '';

  // Port stubs from the barrel wall down to the frame edge.
  const capStub = line(barrelX + CAP_PORT_X, BARREL_HEIGHT, barrelX + CAP_PORT_X, BARREL_HEIGHT, { cls: 'sym' });
  const rodEndStub = '';

  return barrel + piston + rodRight + rodLeft + cushions + springReturn + capStub + rodEndStub
    // Blind-end cap line, so the barrel reads as closed at the cap end.
    + (doubleRod ? '' : polyline([[barrelX, 0], [barrelX, BARREL_HEIGHT]], { cls: 'sym' }));
}

export function describe({ config }) {
  const acting = config.cylinder_type === 'single_acting' ? 'Single-acting' : 'Double-acting';
  const rod = config.rod === 'double' ? ' double-rod' : '';
  const spring = config.cylinder_type === 'single_acting' && config.spring_return ? ', spring return' : '';
  const cushioned = config.cushioned ? ', cushioned' : '';
  return `${acting}${rod} hydraulic cylinder${spring}${cushioned}`;
}
