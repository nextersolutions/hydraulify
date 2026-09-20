// Units.
//
// The model stores exactly what the author wrote, in a unit-suffixed field. This
// module is the only place a value is ever converted, and conversion happens on
// the way to a drawing or a report -- never back into the model. That keeps the
// model a faithful record: a user who wrote 2500 psi never finds 172.369 bar in
// their file.
//
// Two rules keep a conversion from overstating what is known:
//
//   1. A converted value is rounded to the significant figures of its source.
//      180 bar becomes 2610 psi, not 2610.6878 psi -- the second states a
//      four-decimal specification nobody made.
//   2. A converted value is marked with a tilde, so a reader can tell a
//      conversion from a specification at a glance.
//
// Significant figures are counted by an explicit rule, because inferring them
// from a JSON number is otherwise ambiguous: count the digits of the decimal
// representation, ignoring sign, decimal point and leading zeros. 180 -> 3,
// 0.5 -> 1, 20 -> 2. Trailing zeros in an integer are treated as significant,
// which keeps a stated 180 bar from decaying into 2600 psi.

export const QUANTITIES = {
  pressure: { si: 'bar', imperial: 'psi', factor: 14.503773773, siLabel: 'bar', imperialLabel: 'psi' },
  flow: { si: 'lpm', imperial: 'gpm', factor: 0.2641720524, siLabel: 'L/min', imperialLabel: 'gpm' },
  length: { si: 'mm', imperial: 'in', factor: 1 / 25.4, siLabel: 'mm', imperialLabel: 'in' },
  volume: { si: 'l', imperial: 'gal', factor: 1 / 3.785411784, siLabel: 'L', imperialLabel: 'gal' },
  displacement: {
    si: 'cm3_rev', imperial: 'in3_rev', factor: 1 / 16.387064, siLabel: 'cm3/rev', imperialLabel: 'in3/rev',
  },
};

// Every parameter name, mapped to its quantity and the base name shared by its
// SI and imperial spellings.
export const PARAM_QUANTITY = {
  setting: 'pressure',
  cracking_pressure: 'pressure',
  max_pressure: 'pressure',
  precharge: 'pressure',
  range: 'pressure',
  flow: 'flow',
  displacement: 'displacement',
  volume: 'volume',
  bore: 'length',
  rod: 'length',
  stroke: 'length',
};

const SUFFIXES = {
  pressure: ['bar', 'psi'],
  flow: ['lpm', 'gpm'],
  length: ['mm', 'in'],
  volume: ['l', 'gal'],
  displacement: ['cm3_rev', 'in3_rev'],
};

/** Split "setting_bar" into { base: "setting", suffix: "bar" } when it is a convertible quantity. */
export function splitParamName(name) {
  for (const [base, quantity] of Object.entries(PARAM_QUANTITY)) {
    for (const suffix of SUFFIXES[quantity]) {
      if (name === `${base}_${suffix}`) return { base, quantity, suffix };
    }
  }
  return null;
}

export function significantFigures(value) {
  const digits = String(Math.abs(value))
    .replace('.', '')
    .replace(/e[+-]?\d+$/i, '')
    .replace(/^0+/, '');
  return Math.max(digits.length, 1);
}

/** Round to a number of significant figures, formatted without an exponent. */
export function toSignificant(value, figures) {
  if (value === 0) return '0';
  const rounded = Number(value.toPrecision(figures));
  // toPrecision can produce exponential notation for large or small magnitudes;
  // engineering drawings never want that.
  if (Math.abs(rounded) >= 1e-4 && Math.abs(rounded) < 1e21) {
    return String(rounded);
  }
  return rounded.toFixed(Math.max(0, figures - 1 - Math.floor(Math.log10(Math.abs(rounded)))));
}

/**
 * Present one parameter in the requested unit system.
 *
 * @returns {null|{ text: string, converted: boolean, unit: string, value: number }}
 *   null when the value is unknown, which is printed as nothing rather than a guess.
 */
export function presentParam(name, value, system = 'si') {
  if (value === null || value === undefined) return null;

  const split = splitParamName(name);
  if (!split) {
    // Dimensionless or system-independent: micron, rpm, ratio.
    const unit = { rating_micron: 'um', speed_rpm: 'rpm', pilot_ratio: ':1' }[name] ?? '';
    return { text: unit === ':1' ? `${value}:1` : `${value}${unit ? ` ${unit}` : ''}`, converted: false, unit, value };
  }

  const quantity = QUANTITIES[split.quantity];
  const authoredIsSi = split.suffix === quantity.si;
  const wantSi = system === 'si';

  if (authoredIsSi === wantSi) {
    const unit = wantSi ? quantity.siLabel : quantity.imperialLabel;
    return { text: `${value} ${unit}`, converted: false, unit, value };
  }

  const converted = authoredIsSi ? value * quantity.factor : value / quantity.factor;
  const figures = significantFigures(value);
  const shown = toSignificant(converted, figures);
  const unit = wantSi ? quantity.siLabel : quantity.imperialLabel;
  return { text: `~${shown} ${unit}`, converted: true, unit, value: Number(shown) };
}

const PREFIXES = {
  max_pressure: 'max ',
  cracking_pressure: 'crack ',
  precharge: 'pre-charge ',
  range: '0-',
  rod: 'rod ',
  stroke: 'stroke ',
};

/**
 * All of a component's parameters as display strings, in a stable order.
 * A cylinder's bore, rod and stroke are combined, because three separate
 * captions under one symbol is noise on a drawing.
 */
export function presentParams(type, params = {}, system = 'si') {
  const entries = Object.entries(params).filter(([, value]) => value !== null && value !== undefined);
  if (!entries.length) return [];

  const shown = [];
  const used = new Set();

  if (type === 'cylinder') {
    const bore = presentParam('bore_mm' in params ? 'bore_mm' : 'bore_in', params.bore_mm ?? params.bore_in, system);
    const rod = presentParam('rod_mm' in params ? 'rod_mm' : 'rod_in', params.rod_mm ?? params.rod_in, system);
    const stroke = presentParam('stroke_mm' in params ? 'stroke_mm' : 'stroke_in', params.stroke_mm ?? params.stroke_in, system);
    if (bore || rod || stroke) {
      const unit = (bore ?? rod ?? stroke).unit;
      const bores = [bore?.value, rod?.value].filter((value) => value !== undefined).join('/');
      const approx = [bore, rod, stroke].some((item) => item?.converted) ? '~' : '';
      const strokeText = stroke ? ` x ${stroke.value}` : '';
      shown.push(`${approx}${bores ? `D${bores}` : ''}${strokeText} ${unit}`.trim());
      for (const key of ['bore_mm', 'bore_in', 'rod_mm', 'rod_in', 'stroke_mm', 'stroke_in']) used.add(key);
    }
  }

  for (const [name, value] of entries) {
    if (used.has(name)) continue;
    const presented = presentParam(name, value, system);
    if (!presented) continue;
    const split = splitParamName(name);
    const prefix = PREFIXES[split?.base ?? name] ?? '';
    shown.push(prefix === '0-' ? `0-${presented.text}` : `${prefix}${presented.text}`);
  }

  return shown;
}

/** Parameters explicitly present but unknown, for the report's unspecified list. */
export function unknownParams(params = {}) {
  return Object.entries(params).filter(([, value]) => value === null).map(([name]) => name);
}
