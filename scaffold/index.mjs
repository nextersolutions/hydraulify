// scaffold: turn an unpositioned circuit into a positioned starting point.
//
// `pos` is required by the schema, which is deliberate -- placement is the
// author's job and a silent fallback would quietly become the layout engine.
// This command is the on-ramp that makes that requirement workable.
//
// What it does is deliberately crude and deliberately documented as crude: fixed
// hydraulic bands, components spread along each band in declaration order, no
// crossing reduction, no obstacle avoidance. It gets a circuit on the page so the
// author can see it and move things. Anything cleverer here would become the
// solver this project decided not to build, in its least-tested form.
//
// A component that already has `pos` keeps it, so scaffold can be re-run on a
// partly-placed model without undoing work.

import { resolveComponent } from '../renderers/symbols/index.mjs';

// Bands run top to bottom, the way a hydraulic schematic is normally read:
// actuators at the top, control in the middle, power and reservoir at the
// bottom.
const BAND = {
  cylinder: 0,
  motor: 0,
  accumulator: 1,
  pressure_gauge: 1,
  counterbalance_valve: 1,
  pilot_operated_check_valve: 1,
  directional_control_valve: 2,
  flow_control_valve: 2,
  check_valve: 3,
  relief_valve: 3,
  junction: 3,
  filter: 4,
  pump: 4,
  reservoir: 5,
  // Compressed-air plant: the machine train on the top band like any actuator,
  // the air path through the middle, stores and exhausts toward the bottom.
  turbine: 0,
  compressor: 0,
  electrical_machine: 0,
  silencer: 1,
  heat_exchanger: 2,
  pressure_regulator: 2,
  shut_off_valve: 3,
  boundary: 3,
  air_receiver: 5,
};

const BAND_GAP = 80;
const COLUMN_GAP = 56;
const ORIGIN = [60, 60];

export function scaffoldModel(input) {
  const model = JSON.parse(JSON.stringify(input));
  const components = model.components ?? [];

  // Measure every component. A component needs a pos to resolve, so measure
  // against a throwaway origin.
  const measured = components.map((component) => {
    const { geometry } = resolveComponent({ ...component, pos: [0, 0] });
    return {
      component,
      band: BAND[component.type] ?? 2,
      width: geometry.width,
      height: geometry.height,
      // Labels sit under most symbols; leave room so bands do not collide.
      labelHeight: geometry.labelAnchor ? 34 : 0,
    };
  });

  const bands = new Map();
  for (const item of measured) {
    if (!bands.has(item.band)) bands.set(item.band, []);
    bands.get(item.band).push(item);
  }

  const orderedBands = [...bands.keys()].sort((left, right) => left - right);
  let cursorY = ORIGIN[1];
  const placed = [];

  for (const band of orderedBands) {
    const items = bands.get(band);
    const bandHeight = Math.max(...items.map((item) => item.height));
    const labelRoom = Math.max(...items.map((item) => item.labelHeight));

    let cursorX = ORIGIN[0];
    for (const item of items) {
      if (!item.component.pos) {
        // Sit each symbol on the band's baseline so a row of mixed heights
        // still reads as a row.
        item.component.pos = [cursorX, cursorY + (bandHeight - item.height)];
        placed.push(item.component.id);
      }
      cursorX += item.width + COLUMN_GAP;
    }
    cursorY += bandHeight + labelRoom + BAND_GAP;
  }

  if (placed.length) {
    model.notes = [
      ...(model.notes ?? []),
      `Positions for ${placed.join(', ')} were scaffolded into hydraulic bands and are provisional. `
      + 'Move components so the pressure path reads clearly, then re-render.',
    ];
  }

  return { model, placed };
}
