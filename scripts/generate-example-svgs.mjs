#!/usr/bin/env node
// The README shows the worked examples as drawings, and a drawing that no
// longer matches what the renderer produces is worse than no drawing at all:
// it advertises output nobody can reproduce.
//
// So the README's SVGs are generated from the same examples the tests run, and
// `npm test` fails if they have drifted. Rendering is deterministic, so a
// byte comparison is the whole check.
//
//   node scripts/generate-example-svgs.mjs           write docs/examples/*.svg
//   node scripts/generate-example-svgs.mjs --check   fail if any is stale

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyse, renderSvg } from '../renderers/pipeline.mjs';
import { formatDiagnostics } from '../renderers/shared/diagnostics.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = path.join(root, 'examples');
const outDir = path.join(root, 'docs', 'examples');

export function exampleNames() {
  return fs.readdirSync(examplesDir).filter((name) => name.endsWith('.json')).sort();
}

export function renderExample(name) {
  const model = JSON.parse(fs.readFileSync(path.join(examplesDir, name), 'utf8'));
  const analysis = analyse(model);
  if (!analysis.ok) {
    throw new Error(`${name} does not validate, so it cannot be shown in the README:\n${formatDiagnostics(analysis.diagnostics)}`);
  }
  return renderSvg(model, analysis);
}

const check = process.argv.includes('--check');
let stale = 0;

if (!check) fs.mkdirSync(outDir, { recursive: true });

for (const name of exampleNames()) {
  const target = path.join(outDir, name.replace(/\.json$/, '.svg'));
  const svg = renderExample(name);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
  if (current === svg) continue;

  if (check) {
    const why = current === null ? 'is missing' : 'is stale';
    console.error(`${path.relative(root, target)} ${why}. Run: npm run generate:examples`);
    stale += 1;
  } else {
    fs.writeFileSync(target, svg, 'utf8');
    console.log(`${path.relative(root, target)} written`);
  }
}

if (check) {
  if (stale) process.exit(1);
  console.log('README example drawings are current');
}
