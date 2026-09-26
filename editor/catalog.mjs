// What the editor offers: the palette, the choices asked when a component is
// placed, the parameters worth suggesting, and inspector fields read from the
// schema. Pure data and small functions, so Node tests and the page share it.

import { SUPPORTED_TYPES } from '../renderers/symbols/index.mjs';

export const PALETTE = [
  {
    title: 'Hydraulic',
    types: [
      'reservoir', 'pump', 'motor', 'cylinder', 'directional_control_valve', 'relief_valve',
      'check_valve', 'pilot_operated_check_valve', 'counterbalance_valve', 'flow_control_valve',
      'filter', 'pressure_gauge', 'accumulator',
    ],
  },
  {
    title: 'Air and plant',
    types: [
      'compressor', 'turbine', 'electrical_machine', 'heat_exchanger', 'air_receiver',
      'pressure_regulator', 'shut_off_valve', 'silencer',
    ],
  },
  { title: 'Topology', types: ['junction', 'boundary'] },
];

export const TYPE_NAMES = {
  reservoir: 'Reservoir',
  pump: 'Pump',
  motor: 'Hydraulic motor',
  cylinder: 'Cylinder',
  directional_control_valve: 'Directional valve',
  relief_valve: 'Relief valve',
  check_valve: 'Check valve',
  pilot_operated_check_valve: 'Pilot-operated check',
  counterbalance_valve: 'Counterbalance valve',
  flow_control_valve: 'Flow control valve',
  filter: 'Filter',
  pressure_gauge: 'Pressure gauge',
  accumulator: 'Accumulator',
  junction: 'Junction',
  turbine: 'Turbine',
  compressor: 'Compressor',
  electrical_machine: 'Electrical machine',
  heat_exchanger: 'Heat exchanger',
  air_receiver: 'Air receiver',
  pressure_regulator: 'Pressure regulator',
  shut_off_valve: 'Shut-off valve',
  silencer: 'Silencer',
  boundary: 'Boundary',
};

export const ID_PREFIX = {
  reservoir: 'T',
  pump: 'P',
  motor: 'M',
  cylinder: 'C',
  directional_control_valve: 'V',
  relief_valve: 'RV',
  check_valve: 'CV',
  pilot_operated_check_valve: 'POC',
  counterbalance_valve: 'CB',
  flow_control_valve: 'FC',
  filter: 'F',
  pressure_gauge: 'PG',
  accumulator: 'ACC',
  junction: 'J',
  turbine: 'TB',
  compressor: 'CP',
  electrical_machine: 'EM',
  heat_exchanger: 'HX',
  air_receiver: 'AR',
  pressure_regulator: 'PR',
  shut_off_valve: 'SV',
  silencer: 'SIL',
  boundary: 'BD',
};

export const LINE_TYPES = ['pressure', 'working', 'return', 'suction', 'drain', 'pilot', 'mechanical'];

export const MEDIA = ['oil', 'water', 'thermal_oil', 'air', 'nitrogen', 'steam', 'flue_gas'];

const ACTUATORS = [
  ['solenoid', 'Solenoid'],
  ['lever', 'Lever'],
  ['push_button', 'Push button'],
  ['pedal', 'Pedal'],
  ['mechanical', 'Mechanical (plunger/roller)'],
  ['pilot', 'Hydraulic pilot'],
  ['pneumatic_pilot', 'Pneumatic pilot'],
  ['solenoid_pilot', 'Solenoid-pilot'],
  ['none', 'None'],
];

const option = (value, label, hint) => ({ value, label, hint });

/**
 * The choices that change how a circuit behaves, asked when a component is
 * dropped. They have no safe default, so the editor asks rather than writes one
 * in -- the same rule the skill follows when it takes a description. Every
 * answer is written into the component's config, so nothing is left defaulted.
 *
 * `when` hides a question that does not apply to the answers so far.
 */
export const PLACEMENT_CHOICES = {
  directional_control_valve: [
    {
      key: ['configuration'],
      label: 'Configuration',
      options: [
        option('4/3', '4/3', 'Three positions: the actuator can be stopped mid-stroke'),
        option('4/2', '4/2', 'Two positions: always driven one way or the other'),
        option('3/2', '3/2', 'One working port: single-acting cylinders, pilot signals'),
        option('2/2', '2/2', 'On/off: opens or closes a single line'),
      ],
      initial: '4/3',
    },
    {
      key: ['center_condition'],
      label: 'Centre condition',
      when: (config) => config.configuration === '4/3',
      options: [
        option('closed', 'Closed', 'All ports blocked: holds the actuator, the pump deadheads over the relief'),
        option('tandem', 'Tandem', 'P to T open: unloads the pump at rest, still holds the actuator'),
        option('open', 'Open', 'All ports joined: actuator free, pump unloaded'),
        option('float', 'Float', 'A, B and T joined: actuator free, pump deadheads'),
      ],
      initial: 'closed',
    },
    {
      key: ['actuation', 'left'],
      label: 'Left actuator',
      options: ACTUATORS.map(([value, label]) => option(value, label)),
      initial: 'solenoid',
    },
    {
      key: ['actuation', 'right'],
      label: 'Right actuator',
      options: ACTUATORS.map(([value, label]) => option(value, label)),
      initial: 'solenoid',
    },
    {
      key: ['actuation', 'spring'],
      label: 'Springs',
      options: [
        option('centred', 'Spring centred', 'Returns to the middle position (three-position valves)'),
        option('left_return', 'Spring return, left', 'The left spring pushes the spool back'),
        option('right_return', 'Spring return, right', 'The right spring pushes the spool back'),
        option('none', 'No spring (detented)', 'Stays where it was last shifted'),
      ],
      initial: 'centred',
    },
  ],
  cylinder: [
    {
      key: ['cylinder_type'],
      label: 'Cylinder',
      options: [
        option('double_acting', 'Double-acting', 'Powered both ways: a cap and a rod port'),
        option('single_acting', 'Single-acting', 'Powered one way, returned by load or spring: a cap port and a vent'),
      ],
      initial: 'double_acting',
    },
  ],
  electrical_machine: [
    {
      key: ['role'],
      label: 'Role',
      options: [
        option('motor', 'Motor', 'Drives a compressor or pump; shaft out on the right'),
        option('generator', 'Generator', 'Driven by a turbine; shaft in on the left'),
        option('motor_generator', 'Motor-generator', 'A shaft each side, shared by a compressor and a turbine through clutches'),
      ],
      initial: 'motor',
    },
  ],
  heat_exchanger: [
    {
      key: ['function'],
      label: 'Function',
      options: [
        option('cooling', 'Cooler', 'Removes heat: intercooler, aftercooler, oil cooler'),
        option('heating', 'Heater', 'Adds heat: preheater ahead of a turbine'),
      ],
      initial: 'cooling',
    },
    {
      key: ['utility_medium'],
      label: 'Heating or cooling medium',
      options: [
        option('water', 'Water', 'Cooling water, or hot water from a thermal store'),
        option('air', 'Air', 'Air-blast cooler'),
        option('thermal_oil', 'Thermal oil', 'Stored compression heat (adiabatic plant)'),
        option('flue_gas', 'Flue gas', 'Combustion (diabatic plant)'),
        option('steam', 'Steam', 'Steam heating'),
        option('oil', 'Oil', 'Oil-to-oil exchanger'),
      ],
      initial: 'water',
    },
  ],
  boundary: [
    {
      key: ['direction'],
      label: 'Flow',
      options: [
        option('from', 'Enters the drawing', 'Ambient intake, supply from outside, sheet reference'),
        option('to', 'Leaves the drawing', 'Stack, atmosphere, return, sheet reference'),
      ],
      initial: 'from',
    },
    { key: ['name'], label: 'Where to or from', text: true, maxLength: 24, initial: '' },
  ],
};

export function needsPlacementChoice(type) {
  return Boolean(PLACEMENT_CHOICES[type]);
}

/** The config a set of placement answers produces, with inapplicable ones dropped. */
export function configFromChoices(type, answers) {
  const config = {};
  for (const question of PLACEMENT_CHOICES[type] ?? []) {
    if (question.when && !question.when(config)) continue;
    const value = getPath(answers, question.key);
    if (value === undefined || value === '') continue;
    setPath(config, question.key, value);
  }
  return config;
}

/** Default answers for a placement chooser, before the user changes any. */
export function initialAnswers(type) {
  const answers = {};
  for (const question of PLACEMENT_CHOICES[type] ?? []) setPath(answers, question.key, question.initial);
  return answers;
}

// Quantities, and which of them each component is usually specified by. The
// inspector suggests these; any other parameter the schema knows can be added.
export const QUANTITY_FIELDS = {
  setting: { label: 'Pressure setting', si: 'setting_bar', imperial: 'setting_psi', unit: ['bar', 'psi'] },
  cracking_pressure: { label: 'Cracking pressure', si: 'cracking_pressure_bar', imperial: 'cracking_pressure_psi', unit: ['bar', 'psi'] },
  max_pressure: { label: 'Maximum pressure', si: 'max_pressure_bar', imperial: 'max_pressure_psi', unit: ['bar', 'psi'] },
  precharge: { label: 'Pre-charge', si: 'precharge_bar', imperial: 'precharge_psi', unit: ['bar', 'psi'] },
  range: { label: 'Range', si: 'range_bar', imperial: 'range_psi', unit: ['bar', 'psi'] },
  flow: { label: 'Flow', si: 'flow_lpm', imperial: 'flow_gpm', unit: ['L/min', 'gpm'] },
  displacement: { label: 'Displacement', si: 'displacement_cm3_rev', imperial: 'displacement_in3_rev', unit: ['cm3/rev', 'in3/rev'] },
  volume: { label: 'Volume', si: 'volume_l', imperial: 'volume_gal', unit: ['L', 'gal'] },
  bore: { label: 'Bore', si: 'bore_mm', imperial: 'bore_in', unit: ['mm', 'in'] },
  rod: { label: 'Rod diameter', si: 'rod_mm', imperial: 'rod_in', unit: ['mm', 'in'] },
  stroke: { label: 'Stroke', si: 'stroke_mm', imperial: 'stroke_in', unit: ['mm', 'in'] },
  temperature: { label: 'Temperature', si: 'temperature_c', imperial: 'temperature_f', unit: ['degC', 'degF'] },
  power: { label: 'Power', si: 'power_kw', imperial: 'power_hp', unit: ['kW', 'hp'] },
  gas_flow: { label: 'Air flow (normal volume)', si: 'flow_nm3h', imperial: 'flow_scfm', unit: ['Nm3/h', 'scfm'] },
  mass_flow: { label: 'Mass flow', si: 'mass_flow_kgs', imperial: 'mass_flow_lbs', unit: ['kg/s', 'lb/s'] },
  rating: { label: 'Filtration rating', si: 'rating_micron', imperial: 'rating_micron', unit: ['micron', 'micron'] },
  speed: { label: 'Speed', si: 'speed_rpm', imperial: 'speed_rpm', unit: ['rpm', 'rpm'] },
  pilot_ratio: { label: 'Pilot ratio', si: 'pilot_ratio', imperial: 'pilot_ratio', unit: [':1', ':1'] },
};

export const SUGGESTED_PARAMS = {
  reservoir: ['volume'],
  pump: ['flow', 'displacement', 'speed', 'max_pressure'],
  motor: ['displacement', 'speed'],
  cylinder: ['bore', 'rod', 'stroke'],
  directional_control_valve: ['flow'],
  relief_valve: ['setting'],
  check_valve: ['cracking_pressure'],
  pilot_operated_check_valve: ['cracking_pressure', 'pilot_ratio'],
  counterbalance_valve: ['setting', 'pilot_ratio'],
  flow_control_valve: ['flow'],
  filter: ['rating'],
  pressure_gauge: ['range'],
  accumulator: ['volume', 'precharge', 'max_pressure'],
  junction: [],
  turbine: ['power', 'mass_flow', 'temperature'],
  compressor: ['gas_flow', 'max_pressure', 'power'],
  electrical_machine: ['power', 'speed'],
  heat_exchanger: ['power', 'temperature'],
  air_receiver: ['volume', 'max_pressure'],
  pressure_regulator: ['setting'],
  shut_off_valve: [],
  silencer: [],
  boundary: [],
};

/** The quantity a parameter name belongs to, and which unit system it is in. */
export function quantityOfParam(name) {
  for (const [base, field] of Object.entries(QUANTITY_FIELDS)) {
    if (field.si === name) return { base, field, system: 'si' };
    if (field.imperial === name) return { base, field, system: 'imperial' };
  }
  return null;
}

function resolveRef(schema, node) {
  if (node?.$ref) {
    const name = node.$ref.replace('#/$defs/', '');
    return { ...schema.$defs[name], ...Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$ref')) };
  }
  return node;
}

/**
 * Inspector fields for a component type's config, read from the schema so the
 * editor can never offer a key the validator would then reject.
 */
export function configFields(schema, type) {
  const rule = schema.$defs.configByType[type];
  const properties = rule?.then?.properties?.config?.properties ?? {};
  const required = rule?.then?.properties?.config?.required ?? [];
  const fields = [];
  const visit = (props, prefix) => {
    for (const [key, raw] of Object.entries(props)) {
      const node = resolveRef(schema, raw);
      const path = [...prefix, key];
      if (node.type === 'object' && node.properties) {
        visit(node.properties, path);
        continue;
      }
      const base = { key: path, description: node.description ?? null, required: prefix.length === 0 && required.includes(key) };
      if (node.enum) fields.push({ ...base, kind: 'enum', options: node.enum });
      else if (node.type === 'boolean') fields.push({ ...base, kind: 'boolean' });
      else fields.push({ ...base, kind: 'string', maxLength: node.maxLength ?? null });
    }
  };
  visit(properties, []);
  return fields;
}

/** Every parameter name the schema accepts. */
export function allParamNames(schema) {
  return Object.keys(schema.$defs.params.properties);
}

export function getPath(object, path) {
  let cursor = object;
  for (const key of path) {
    if (cursor === undefined || cursor === null) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

export function setPath(object, path, value) {
  let cursor = object;
  for (const key of path.slice(0, -1)) {
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[path.at(-1)] = value;
}

export { SUPPORTED_TYPES };
