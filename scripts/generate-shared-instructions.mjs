#!/usr/bin/env node
// SKILL.md and AGENTS.md carry the same instructions, and must not drift.
//
// They differ in exactly one place: how the agent asks a clarifying question.
// Claude Code has a structured picker; Codex asks in prose. That single
// intended difference is what makes a plain equality check useless, so instead
// one source file is written verbatim into both between markers, and the test
// suite asserts the marked block is byte-identical in each.
//
//   node scripts/generate-shared-instructions.mjs           write both files
//   node scripts/generate-shared-instructions.mjs --check   fail if either is stale

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedPath = path.join(root, 'docs', 'shared-instructions.md');

export const BEGIN = '<!-- BEGIN SHARED: generated from docs/shared-instructions.md, do not edit here -->';
export const END = '<!-- END SHARED -->';

const TARGETS = [path.join(root, 'SKILL.md'), path.join(root, 'AGENTS.md')];

function normalize(text) {
  return text.replace(/\r\n/g, '\n');
}

export function sharedBlock() {
  const body = normalize(fs.readFileSync(sharedPath, 'utf8')).trim();
  return `${BEGIN}\n\n${body}\n\n${END}`;
}

export function replaceBlock(document, block) {
  const start = document.indexOf(BEGIN);
  const end = document.indexOf(END);
  if (start === -1 || end === -1) return null;
  return `${document.slice(0, start)}${block}${document.slice(end + END.length)}`;
}

const block = sharedBlock();
const check = process.argv.includes('--check');
let stale = 0;

for (const target of TARGETS) {
  if (!fs.existsSync(target)) {
    console.error(`${path.relative(root, target)} does not exist.`);
    process.exit(1);
  }
  const current = normalize(fs.readFileSync(target, 'utf8'));
  const updated = replaceBlock(current, block);
  if (updated === null) {
    console.error(`${path.relative(root, target)} has no shared block markers. Add:\n${BEGIN}\n${END}`);
    process.exit(1);
  }
  if (updated === current) continue;

  if (check) {
    console.error(`${path.relative(root, target)} is stale. Run: npm run generate:docs`);
    stale += 1;
  } else {
    fs.writeFileSync(target, updated, 'utf8');
    console.log(`${path.relative(root, target)} updated`);
  }
}

if (check) {
  if (stale) process.exit(1);
  console.log('SKILL.md and AGENTS.md carry the current shared block');
}
