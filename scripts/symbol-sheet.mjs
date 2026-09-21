#!/usr/bin/env node
// Render every symbol, and every directional-valve variant, onto one sheet at a
// readable scale.
//
// No automated test can tell you a spool arrow points the wrong way or that a
// spring sits on the wrong end. This sheet exists so a human can check that in
// one pass, and so the same check can be repeated after any change to a symbol.
//
//   node scripts/symbol-sheet.mjs [output.svg]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SYMBOLS, resolveComponent } from '../renderers/symbols/index.mjs';
import { STYLESHEET, DARK_OVERRIDES } from '../renderers/render-svg.mjs';
import { group, text, circle, n } from '../renderers/shared/svg.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ?? path.join(root, 'tmp', 'symbol-sheet.svg');

// One entry per thing worth eyeballing. Directional valves get a row of their
// own per configuration, because those are the ones that can be silently wrong.
const CASES = [
  ['reservoir', {}, 'reservoir (vented)'],
  ['reservoir', { vented: false }, 'reservoir (pressurised)'],
  ['pump', {}, 'pump, fixed'],
  ['pump', { drive: 'electric_motor' }, 'pump + motor'],
  ['pump', { pump_type: 'variable_displacement', has_case_drain: true }, 'pump, variable + drain'],
  ['motor', {}, 'motor'],
  ['motor', { bidirectional: true }, 'motor, bidirectional'],
  ['cylinder', {}, 'cylinder, double-acting'],
  ['cylinder', { cylinder_type: 'single_acting', spring_return: true }, 'cylinder, single-acting'],
  ['cylinder', { rod: 'double' }, 'cylinder, double-rod'],
  ['relief_valve', {}, 'relief valve'],
  ['relief_valve', { pilot_operated: true, remote_pilot: true }, 'relief, pilot-op + remote'],
  ['check_valve', {}, 'check valve'],
  ['check_valve', { spring_loaded: true }, 'check, spring-loaded'],
  ['pilot_operated_check_valve', {}, 'pilot-operated check'],
  ['counterbalance_valve', {}, 'counterbalance'],
  ['flow_control_valve', { flow_control_type: 'fixed_throttle' }, 'throttle, fixed'],
  ['flow_control_valve', { flow_control_type: 'variable_throttle' }, 'throttle, variable'],
  ['flow_control_valve', { flow_control_type: 'one_way' }, 'flow control, one-way'],
  ['flow_control_valve', { flow_control_type: 'pressure_compensated' }, 'flow control, compensated'],
  ['filter', {}, 'filter'],
  ['filter', { with_bypass: true }, 'filter + bypass'],
  ['pressure_gauge', {}, 'pressure gauge'],
  ['accumulator', {}, 'accumulator, bladder'],
  ['accumulator', { accumulator_type: 'piston' }, 'accumulator, piston'],
  ['accumulator', { accumulator_type: 'spring' }, 'accumulator, spring'],
  ['accumulator', { gas_port: true, liquid: 'water' }, 'accumulator, bladder + gas port'],
  ['accumulator', { accumulator_type: 'none', gas_port: true, liquid: 'water' }, 'accumulator, direct contact + gas port'],
  ['accumulator', { accumulator_type: 'none' }, 'accumulator, direct contact'],
  ['junction', {}, 'junction'],
  ['turbine', {}, 'air turbine, ISO 1219'],
  ['turbine', {}, 'air turbine, ISO 10628', { machine: 'iso10628' }],
  ['compressor', {}, 'air compressor'],
  ['electrical_machine', { role: 'generator' }, 'generator'],
  ['electrical_machine', { role: 'motor' }, 'electric motor'],
  ['electrical_machine', { role: 'motor_generator' }, 'motor-generator'],
  ['heat_exchanger', { function: 'heating', utility_medium: 'flue_gas' }, 'preheater'],
  ['heat_exchanger', { function: 'cooling', utility_medium: 'water' }, 'cooler'],
  ['air_receiver', {}, 'air receiver'],
  ['air_receiver', { gas: 'nitrogen', single_port: true }, 'nitrogen bottle'],
  ['pressure_regulator', {}, 'pressure regulator'],
  ['shut_off_valve', {}, 'shut-off valve, open'],
  ['shut_off_valve', { normal_position: 'closed' }, 'shut-off valve, closed'],
  ['silencer', {}, 'silencer'],
  ['boundary', { direction: 'from', name: 'TES', medium: 'thermal_oil' }, 'boundary, from'],
  ['boundary', { direction: 'to', name: 'stack', medium: 'flue_gas' }, 'boundary, to'],
  ['directional_control_valve', { configuration: '2/2', normal_position: 'closed', actuation: { left: 'solenoid', right: 'none', spring: 'right_return' } }, '2/2 NC, solenoid/spring'],
  ['directional_control_valve', { configuration: '3/2', normal_position: 'closed', actuation: { left: 'solenoid', right: 'none', spring: 'right_return' } }, '3/2 NC, solenoid/spring'],
  ['directional_control_valve', { configuration: '3/2', normal_position: 'open', actuation: { left: 'push_button', right: 'none', spring: 'right_return' } }, '3/2 NO, button/spring'],
  ['directional_control_valve', { configuration: '4/2', actuation: { left: 'solenoid', right: 'solenoid', spring: 'none' } }, '4/2, double solenoid'],
  ['directional_control_valve', { configuration: '4/3', center_condition: 'closed', actuation: { left: 'lever', right: 'none', spring: 'centred' } }, '4/3 closed centre, lever'],
  ['directional_control_valve', { configuration: '4/3', center_condition: 'open', actuation: { left: 'solenoid', right: 'solenoid', spring: 'centred' } }, '4/3 open centre, 2x solenoid'],
  ['directional_control_valve', { configuration: '4/3', center_condition: 'tandem', actuation: { left: 'pilot', right: 'pilot', spring: 'centred' } }, '4/3 tandem centre, pilot'],
  ['directional_control_valve', { configuration: '4/3', center_condition: 'float', actuation: { left: 'solenoid_pilot', right: 'mechanical', spring: 'centred' } }, '4/3 float centre'],
];

// A filter keeps a review pass focused: `node scripts/symbol-sheet.mjs out.svg dcv`
// draws only the directional valves, large enough to read every internal path.
// Several filters separated by commas select anything matching any of them:
// `turbine,compressor,machine` for the machine train.
const filters = (process.argv[3] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
const selected = filters.length
  ? CASES.filter(([type, , caption]) => filters.some((filter) => type.includes(filter) || caption.includes(filter)))
  : CASES;

const CELL_W = 430;
const CELL_H = 320;
const COLUMNS = 2;
const MAX_SCALE = 3;

const cells = selected.map(([type, config, caption, style = { machine: 'iso1219' }], index) => {
  const symbol = SYMBOLS.get(type);
  const component = { id: 'X1', type, pos: [0, 0], config };
  const resolvedComponent = resolveComponent(component);
  const { geometry, ports } = resolvedComponent;

  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const originX = column * CELL_W;
  const originY = row * CELL_H;

  // Scale each cell to fill the space it has: a review sheet is useless if the
  // small symbols are drawn at the size the largest one needs.
  const scale = Math.min(
    MAX_SCALE,
    (CELL_W - 90) / geometry.width,
    (CELL_H - 90) / Math.max(geometry.height, 1),
  );

  const offsetX = (CELL_W - geometry.width * scale) / 2;
  const offsetY = (CELL_H - 60 - geometry.height * scale) / 2;

  const drawing = group(
    [symbol.draw({ config: resolvedComponent.config, geometry, component, style })],
    { transform: `translate(${n(offsetX)} ${n(offsetY)}) scale(${n(scale)})` },
  );

  // Port markers: a hollow dot at every declared anchor, so a port that has
  // drifted off its graphic is visible immediately.
  const markers = Object.values(ports).map((port) => group([
    circle(port.x, port.y, 3.4, { cls: 'port-marker' }),
    text(
      port.x + (port.side === 'left' ? -7 : port.side === 'right' ? 7 : 0),
      port.y + (port.side === 'top' ? -6 : port.side === 'bottom' ? 12 : -6),
      port.id,
      { cls: 'port-label', anchor: port.side === 'left' ? 'end' : port.side === 'right' ? 'start' : 'middle' },
    ),
  ]));

  return group([
    `<rect x="0" y="0" width="${CELL_W}" height="${CELL_H}" class="cell"/>`,
    drawing,
    group(markers, { transform: `translate(${n(offsetX)} ${n(offsetY)}) scale(${n(scale)})` }),
    text(CELL_W / 2, CELL_H - 14, caption, { cls: 'caption', anchor: 'middle' }),
  ], { transform: `translate(${n(originX)} ${n(originY)})` });
});

const rows = Math.ceil(selected.length / COLUMNS);
const width = COLUMNS * CELL_W;
const height = rows * CELL_H + 60;

const svg = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="hy-root">`,
  `<style>${STYLESHEET}
    .cell { fill: none; stroke: #d7dbe0; stroke-width: 1; }
    .port-marker { fill: none; stroke: #c2410c; stroke-width: 1.2; }
    .caption { font-size: 11px; fill: #6b7480; }
    .sheet-title { font-size: 16px; font-weight: 600; }
    @media (prefers-color-scheme: dark) { ${DARK_OVERRIDES} .cell { stroke: #2b323a; } }
  </style>`,
  `<rect width="${width}" height="${height}" fill="var(--paper)"/>`,
  text(16, 30, 'hydraulify symbol sheet - port anchors marked in orange', { cls: 'sheet-title', anchor: 'start' }),
  group(cells, { transform: 'translate(0 48)' }),
  '</svg>',
  '',
].join('\n');

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, svg, 'utf8');
console.log(`${output} (${selected.length} cases, ${svg.length} bytes)`);
