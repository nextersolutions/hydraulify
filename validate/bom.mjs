// Bill of materials.
//
// Two rules decide everything here.
//
// Aggregation identity is the component's type plus its full configuration and
// its full authored parameter set -- never the type alone. Two 180 bar relief
// valves are one line item; a 180 bar and a 210 bar relief valve are two. Merging
// them would put a part in the list that nobody can order.
//
// Nothing is invented. No manufacturer, no model number, no substituted value.
// A parameter the author did not state appears as "not specified", because a
// blank in a parts list reads as "no requirement" and that is a different claim.

import { presentParams } from '../renderers/shared/units.mjs';

/**
 * Stable identity for aggregation. Keys are sorted so two components written in
 * a different field order still collapse to one line.
 */
function identityOf(component, config) {
  const sortedConfig = Object.fromEntries(
    Object.entries(config ?? {}).sort(([left], [right]) => (left < right ? -1 : 1)),
  );
  const sortedParams = Object.fromEntries(
    Object.entries(component.params ?? {}).sort(([left], [right]) => (left < right ? -1 : 1)),
  );
  return JSON.stringify({ type: component.type, config: sortedConfig, params: sortedParams });
}

/**
 * @returns {{ items: Array, junctions: number, reservoirVessels: number }}
 */
export function buildBom(model, analysis, { units } = {}) {
  const system = units ?? model.meta?.units ?? 'si';
  const groups = new Map();
  let junctions = 0;

  // A reservoir may legitimately be drawn more than once to keep return lines
  // short. `same_reservoir_as` says those symbols are one vessel, so the parts
  // list counts one.
  const reservoirAliases = new Set();
  for (const [, entry] of analysis.resolved) {
    if (entry.component.type === 'reservoir' && entry.config.same_reservoir_as) {
      reservoirAliases.add(entry.component.id);
    }
  }

  for (const [id, entry] of analysis.resolved) {
    // Junctions and drawing boundaries are not parts. Only a junction implies a
    // fitting, so only a junction is counted as a tee.
    if (entry.geometry.excludeFromBom) {
      if (entry.component.type === 'junction') junctions += 1;
      continue;
    }
    if (reservoirAliases.has(id)) continue;

    const key = identityOf(entry.component, entry.config);
    const existing = groups.get(key);
    if (existing) {
      existing.tags.push(id);
      continue;
    }
    groups.set(key, {
      key,
      type: entry.component.type,
      description: entry.symbol.describe({ config: entry.config, params: entry.component.params ?? {} }),
      config: entry.config,
      params: entry.component.params ?? {},
      parameterText: presentParams(entry.component.type, entry.component.params, system),
      tags: [id],
    });
  }

  const items = [...groups.values()]
    .map((group) => ({ ...group, tags: [...group.tags].sort(), quantity: group.tags.length }))
    // Stable order: by type, then by the first tag, so the list never reshuffles
    // between runs of the same model.
    .sort((left, right) => {
      if (left.type !== right.type) return left.type < right.type ? -1 : 1;
      return left.tags[0] < right.tags[0] ? -1 : 1;
    });

  return { items, junctions, reservoirAliases: reservoirAliases.size, units: system };
}

export function renderBomMarkdown(model, bom) {
  const lines = [
    '# Bill of materials',
    '',
    `Circuit: ${model.meta?.title ?? '(untitled)'}`,
    `Units: ${bom.units === 'si' ? 'SI' : 'imperial'}`,
    '',
    '| Qty | Item | Tags | Parameters |',
    '| --- | --- | --- | --- |',
  ];

  for (const item of bom.items) {
    const parameters = item.parameterText.length ? item.parameterText.join(', ') : '_not specified_';
    lines.push(`| ${item.quantity} | ${item.description} | ${item.tags.join(', ')} | ${parameters} |`);
  }

  lines.push('');
  const notes = [];
  if (bom.junctions) {
    notes.push(`The circuit implies ${bom.junctions} tee point${bom.junctions === 1 ? '' : 's'}. Fittings are not listed: their type and size depend on the plumbing, which the schematic does not specify.`);
  }
  if (bom.reservoirAliases) {
    notes.push(`${bom.reservoirAliases} additional reservoir symbol${bom.reservoirAliases === 1 ? '' : 's'} refer to the same vessel and ${bom.reservoirAliases === 1 ? 'is' : 'are'} counted once.`);
  }
  notes.push('No manufacturer or model number is proposed. Parameters are reproduced exactly as they were specified; "not specified" means the description did not state one.');

  lines.push('## Notes');
  lines.push('');
  for (const note of notes) lines.push(`- ${note}`);
  lines.push('');
  return lines.join('\n');
}

/** Machine-readable BOM, for a later component-selection step to consume. */
export function renderBomJson(model, bom) {
  return `${JSON.stringify({
    title: model.meta?.title ?? null,
    units: bom.units,
    generated_by: 'hydraulify',
    items: bom.items.map((item) => ({
      quantity: item.quantity,
      type: item.type,
      description: item.description,
      tags: item.tags,
      config: item.config,
      params: item.params,
    })),
    junction_points: bom.junctions,
    notes: [
      'Parameters are reproduced as authored. A null value means explicitly unknown.',
      'No manufacturer or model number is proposed.',
    ],
  }, null, 2)}\n`;
}
