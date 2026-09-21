// Structural validation against schemas/hydraulic-circuit.schema.json, using the
// committed standalone validator so nothing needs installing. Domain rules (ports,
// topology, hydraulic coherence) live in validate/, not here: this layer only
// answers "is this a well-formed model".

import validateCircuit from './generated-validators.mjs';
import { error } from './diagnostics.mjs';

// ajv reports `instancePath` as a JSON Pointer. Turn it into something an author
// can act on without counting array indices.
function describeLocation(model, instancePath) {
  if (!instancePath) return { at: 'model root' };
  const segments = instancePath.split('/').filter(Boolean)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  const [collection, indexText, ...rest] = segments;
  const index = Number(indexText);

  if (collection === 'components' && Number.isInteger(index)) {
    const component = model?.components?.[index];
    return {
      at: instancePath,
      component: component?.id ?? `components[${index}]`,
      ...(component?.type ? { type: component.type } : {}),
      ...(rest.length ? { field: rest.join('.') } : {}),
    };
  }
  if (collection === 'connections' && Number.isInteger(index)) {
    const connection = model?.connections?.[index];
    return {
      at: instancePath,
      connection: connection?.id ?? `connections[${index}]`,
      ...(connection?.from && connection?.to ? { between: `${connection.from} -> ${connection.to}` } : {}),
      ...(rest.length ? { field: rest.join('.') } : {}),
    };
  }
  return { at: instancePath };
}

function fixesFor(ajvError) {
  switch (ajvError.keyword) {
    case 'required':
      return [`add the required property "${ajvError.params.missingProperty}"`];
    case 'additionalProperties':
      return [
        `remove the unknown property "${ajvError.params.additionalProperty}"`,
        'check it against the schema: a misspelled field is silently meaningless, so the schema rejects it',
      ];
    case 'enum':
      return [`use one of: ${(ajvError.params.allowedValues ?? []).join(', ')}`];
    case 'const':
      if (/^\/connections\/\d+\/line$/.test(ajvError.instancePath)) {
        return [
          'a clutch couples two shafts, so it belongs on a line typed "mechanical"',
          'remove "clutch" if the line carries fluid',
        ];
      }
      if (ajvError.instancePath.endsWith('/gas_port')) {
        return [
          'a spring- or weight-loaded accumulator contains no gas, so it has no gas side: remove gas_port',
          'or choose a gas-charged type: bladder, piston, diaphragm, or none for direct contact',
        ];
      }
      return [`set this to ${JSON.stringify(ajvError.params.allowedValue)}`];
    case 'pattern':
      return [`match the required pattern ${ajvError.params.pattern}`];
    case 'type':
      return [`use a value of type ${ajvError.params.type}`];
    case 'not':
      if (ajvError.schemaPath.includes('airFlowExclusive')) {
        return [
          'state a gas flow once: normal volume flow (flow_nm3h or flow_scfm) or mass flow (mass_flow_kgs or mass_flow_lbs), not both',
          'keep whichever the source document gives; never derive one from the other',
        ];
      }
      return [
        'a quantity may be given in SI or imperial units, never both',
        'delete whichever of the two unit fields was not authored by the user',
      ];
    case 'exclusiveMinimum':
      return ['use a positive number, or null to state that the value is unknown'];
    case 'minimum':
      return ajvError.instancePath.includes('temperature')
        ? [`use a value of at least ${ajvError.params.limit}: nothing is colder than absolute zero`]
        : [`use a value of at least ${ajvError.params.limit}`];
    default:
      return ['correct the value so it satisfies the schema'];
  }
}

/**
 * @returns {{ ok: boolean, diagnostics: Array }}
 */
export function validateModelSchema(model) {
  const valid = validateCircuit(model);
  if (valid) return { ok: true, diagnostics: [] };

  const diagnostics = (validateCircuit.errors ?? [])
    // `if/then` branches and the unit-pair `not` guards produce a cascade of
    // parent errors that repeat the same fact. Keep the leaf findings.
    .filter((item) => !['if', 'allOf', 'anyOf', 'oneOf'].includes(item.keyword))
    .map((item) => error({
      code: `schema/${item.keyword}`,
      subject: describeLocation(model, item.instancePath),
      message: `${item.instancePath || 'model'} ${item.message}`,
      evidence: { keyword: item.keyword, params: item.params, schemaPath: item.schemaPath },
      supportedFixes: fixesFor(item),
    }));

  // Deduplicate identical findings that ajv can emit more than once through
  // separate branches of the same allOf.
  const seen = new Set();
  const unique = diagnostics.filter((item) => {
    const key = `${item.code}|${JSON.stringify(item.subject)}|${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ok: false, diagnostics: unique };
}
