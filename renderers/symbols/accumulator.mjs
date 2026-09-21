// Accumulator.
//
// A capsule standing on its port. The separating element distinguishes the type,
// and the type matters: a bladder and a spring accumulator behave differently and
// are specified differently, so the symbol says which one the author meant.
//
// Two extensions for compressed-air storage:
//
//   gas_port  The gas side becomes a real connection on top of the shell. In a
//             water-compensated air store the air side IS the circuit; in an
//             ordinary accumulator the gas is sealed behind a charging valve and
//             not drawn, which is the default. A declared gas port is required:
//             declaring one and leaving it open says two contradictory things.
//
//   none      No separator: gas sits directly on the liquid. Drawn as a free
//             liquid surface with the level marker, so it cannot be mistaken for
//             a diaphragm. Common in large water-compensated stores, which is
//             exactly where a bladder would be the wrong thing to buy.
//
// The two sides are separate port groups, so the gas side and the liquid side
// resolve their fluids independently. The liquid side is any liquid unless
// `liquid` fixes it.

import { line, rect, path, polyline, polygon } from '../shared/svg.mjs';
import { spring } from './glyphs.mjs';
import { port, labelRight, CRITICALITY } from './contract.mjs';

const WIDTH = 46;
const SHELL = { x: 5, width: 36, height: 54 };
const CENTRE_X = 23;
const STEM = 12; // liquid stem below the shell
const GAS_STEM = 10; // gas connection above the shell, when there is one

export const type = 'accumulator';

export const defaults = {
  accumulator_type: 'bladder',
};

function frame(config) {
  const top = config.gas_port ? GAS_STEM : 2;
  return { top, height: top + SHELL.height + STEM };
}

export function geometry(config) {
  const { height } = frame(config);
  const ports = {
    inlet: port('inlet', CENTRE_X, height, 'bottom', {
      criticality: CRITICALITY.REQUIRED,
      label: 'A',
      medium: config.liquid ?? 'liquid',
      group: 'liquid',
    }),
  };
  if (config.gas_port) {
    ports.gas = port('gas', CENTRE_X, 0, 'top', {
      criticality: CRITICALITY.REQUIRED,
      label: 'G',
      medium: 'air',
      group: 'gas',
    });
  }
  return { width: WIDTH, height, ports, labelAnchor: labelRight(WIDTH, height) };
}

function separator(kind, top) {
  const left = SHELL.x + 3;
  const right = SHELL.x + SHELL.width - 3;
  switch (kind) {
    case 'bladder':
      // Gas bladder: a closed curve in the upper part of the shell.
      return path(
        `M ${left} ${top + 24} Q ${CENTRE_X} ${top + 2} ${right} ${top + 24} Q ${CENTRE_X} ${top + 34} ${left} ${top + 24} Z`,
        { cls: 'sym' },
      );
    case 'diaphragm':
      return path(
        `M ${left} ${top + 24} Q ${CENTRE_X} ${top + 6} ${right} ${top + 24}`,
        { cls: 'sym' },
      );
    case 'piston':
      return rect(left, top + 20, right - left, 7, { cls: 'sym' });
    case 'spring':
      return spring(CENTRE_X, top + 6, CENTRE_X, top + 26, { coils: 3, amplitude: 7 })
        + line(left, top + 27, right, top + 27, { cls: 'sym' });
    case 'weight':
      return rect(CENTRE_X - 10, top + 4, 20, 10, { cls: 'sym', fill: 'currentColor' })
        + line(left, top + 22, right, top + 22, { cls: 'sym' });
    case 'none': {
      // Free liquid surface with the inverted-triangle level marker above it.
      const level = top + 26;
      const marker = polygon([[CENTRE_X - 4, level - 7], [CENTRE_X + 4, level - 7], [CENTRE_X, level - 1]], { cls: 'sym' });
      return line(SHELL.x, level, SHELL.x + SHELL.width, level, { cls: 'sym' }) + marker;
    }
    default:
      return '';
  }
}

export function draw({ config }) {
  const { top, height } = frame(config);
  const bottom = top + SHELL.height;
  const shell = rect(SHELL.x, top, SHELL.width, SHELL.height, { cls: 'sym', rx: 18 });
  const liquidStem = line(CENTRE_X, bottom, CENTRE_X, height, { cls: 'sym' });
  const gasStem = config.gas_port ? line(CENTRE_X, 0, CENTRE_X, top, { cls: 'sym' }) : '';
  return shell + separator(config.accumulator_type, top) + liquidStem + gasStem;
}

export function describe({ config }) {
  const kind = {
    bladder: 'Bladder accumulator',
    piston: 'Piston accumulator',
    diaphragm: 'Diaphragm accumulator',
    spring: 'Spring-loaded accumulator',
    weight: 'Weight-loaded accumulator',
    none: 'Accumulator, direct gas-liquid contact',
  }[config.accumulator_type] ?? 'Hydraulic accumulator';
  const liquid = config.liquid ? `, ${config.liquid.replace(/_/g, ' ')}` : '';
  return config.gas_port ? `${kind}${liquid}, with gas port` : `${kind}${liquid}`;
}

export { polyline };
