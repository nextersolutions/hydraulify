// Electrical machine: generator, motor, or motor-generator.
//
// A circle with its letter -- G, M, or M/G -- as ISO 1219 draws the electric
// motor on a pump. Here the machine stands alone and its shaft is a real
// connection, because a compressed-air plant routinely shares one machine
// between two others: it motors the compressor while charging and generates
// from the turbine while discharging, through a clutch on each side.
//
// Power flows left to right: a generator is driven, so its shaft enters on the
// left; a motor drives, so its shaft leaves on the right. A motor-generator sits
// between two machines and has a shaft on each side. Mirror a single-shaft
// machine to put its shaft on the other side.

import { circle } from '../shared/svg.mjs';
import { shaft, uprightText } from './glyphs.mjs';
import { port, labelBelow, CRITICALITY, MECHANICAL } from './contract.mjs';

const BODY = 56;
const RADIUS = 20;
const SHAFT = 16;
const CENTRE_Y = BODY / 2;

export const type = 'electrical_machine';

export const defaults = {
  role: 'generator',
};

function layout(role) {
  if (role === 'motor_generator') return { width: SHAFT + BODY + SHAFT, centreX: SHAFT + BODY / 2, left: true, right: true };
  if (role === 'motor') return { width: BODY + SHAFT, centreX: BODY / 2, left: false, right: true };
  return { width: SHAFT + BODY, centreX: SHAFT + BODY / 2, left: true, right: false };
}

export function geometry(config) {
  const { width, left, right } = layout(config.role);
  const shaftPort = (id, x, side) => port(id, x, CENTRE_Y, side, { criticality: CRITICALITY.REQUIRED, label: 'S', medium: MECHANICAL });
  const ports = {};
  if (left && right) {
    ports.shaft_a = shaftPort('shaft_a', 0, 'left');
    ports.shaft_b = shaftPort('shaft_b', width, 'right');
  } else {
    ports.shaft = left ? shaftPort('shaft', 0, 'left') : shaftPort('shaft', width, 'right');
  }
  return { width, height: BODY, ports, labelAnchor: labelBelow(width, BODY) };
}

const LETTERS = { generator: 'G', motor: 'M', motor_generator: 'M/G' };

export function draw({ config, geometry }) {
  const { width, centreX, left, right } = layout(config.role);
  const letters = LETTERS[config.role] ?? 'G';
  return circle(centreX, CENTRE_Y, RADIUS, { cls: 'sym' })
    + uprightText(centreX, CENTRE_Y + 5, letters, geometry?.mirrored, { size: letters.length > 1 ? 11 : 14 })
    + (left ? shaft(0, CENTRE_Y, centreX - RADIUS, CENTRE_Y) : '')
    + (right ? shaft(centreX + RADIUS, CENTRE_Y, width, CENTRE_Y) : '');
}

export function describe({ config }) {
  return {
    generator: 'Electrical generator',
    motor: 'Electric motor',
    motor_generator: 'Motor-generator',
  }[config.role] ?? 'Electrical machine';
}
