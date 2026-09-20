// Check valve (non-return valve).
//
// Ball and seat. Free flow runs inlet -> outlet and lifts the ball off its seat;
// reverse flow pushes the ball back onto the seat and is blocked. The seat is
// therefore drawn on the inlet side of the ball, which is what tells a reader
// which way the valve passes.

import { line } from '../shared/svg.mjs';
import { ballSeat, spring } from './glyphs.mjs';
import { port, labelBelow, CRITICALITY } from './contract.mjs';

const WIDTH = 58;
const HEIGHT = 36;
const CENTRE_Y = HEIGHT / 2;
const BALL_X = 26;
const RADIUS = 7;

export const type = 'check_valve';

export const defaults = {
  spring_loaded: false,
};

export function geometry() {
  return {
    width: WIDTH,
    height: HEIGHT,
    ports: {
      inlet: port('inlet', 0, CENTRE_Y, 'left', { criticality: CRITICALITY.REQUIRED, label: 'A' }),
      outlet: port('outlet', WIDTH, CENTRE_Y, 'right', { criticality: CRITICALITY.REQUIRED, label: 'B' }),
    },
    labelAnchor: labelBelow(WIDTH, HEIGHT, 12),
  };
}

export function draw({ config }) {
  const seatX = BALL_X - RADIUS - 1;
  const inletRun = line(0, CENTRE_Y, seatX, CENTRE_Y, { cls: 'sym' });
  const element = ballSeat(BALL_X, CENTRE_Y, { radius: RADIUS, horizontal: true, freeFlow: 'right' });
  const springGlyph = config.spring_loaded
    ? spring(BALL_X + RADIUS, CENTRE_Y, WIDTH - 8, CENTRE_Y, { coils: 3, amplitude: 4 })
    : '';
  const outletRun = line(config.spring_loaded ? WIDTH - 8 : BALL_X + RADIUS, CENTRE_Y, WIDTH, CENTRE_Y, { cls: 'sym' });

  return inletRun + element + springGlyph + outletRun;
}

export function describe({ config }) {
  return config.spring_loaded ? 'Spring-loaded check valve' : 'Check valve';
}
