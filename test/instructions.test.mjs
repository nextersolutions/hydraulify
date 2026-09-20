// SKILL.md and AGENTS.md are supposed to differ in exactly one place: how the
// agent asks a clarifying question. That intended difference is what makes a
// plain equality check useless, and AGENTS.md is the file least likely to be
// noticed when it rots, because nothing here runs Codex.
//
// So: assert the generated block is byte-identical in both, and assert the
// facts that must hold in each file separately.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_TYPES } from '../renderers/symbols/index.mjs';
import { BEGIN, END, sharedBlock } from '../scripts/generate-shared-instructions.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');

function extractShared(document) {
  const start = document.indexOf(BEGIN);
  const end = document.indexOf(END);
  assert.notEqual(start, -1, 'missing BEGIN marker');
  assert.notEqual(end, -1, 'missing END marker');
  return document.slice(start, end + END.length);
}

const skill = read('SKILL.md');
const agents = read('AGENTS.md');

test('both instruction files carry a byte-identical shared block', () => {
  const fromSkill = extractShared(skill);
  const fromAgents = extractShared(agents);
  assert.equal(fromSkill, fromAgents, 'the shared block has drifted; run npm run generate:docs');
  assert.equal(fromSkill, sharedBlock(), 'the shared block is stale; run npm run generate:docs');
});

test('the shared block lists exactly the component types the registry supports', () => {
  const block = extractShared(skill);
  for (const type of SUPPORTED_TYPES) {
    assert.ok(block.includes(`\`${type}\``), `${type} is supported but not documented`);
  }
});

test('every CLI verb the instructions mention actually exists', () => {
  const cli = read('bin/hydraulify.mjs');
  const verbs = [...cli.matchAll(/^\s{4}case '([a-z-]+)':/gm)].map((match) => match[1]);
  assert.ok(verbs.length >= 12, `expected 12 or more verbs, found ${verbs.length}`);

  const block = extractShared(skill);
  for (const mentioned of [...block.matchAll(/hydraulify\.mjs ([a-z-]+)/g)].map((match) => match[1])) {
    assert.ok(verbs.includes(mentioned), `the instructions mention "${mentioned}", which is not a verb`);
  }
});

test('SKILL.md names the structured asking tool; AGENTS.md does not', () => {
  const skillPreamble = skill.slice(0, skill.indexOf(BEGIN));
  const agentsPreamble = agents.slice(0, agents.indexOf(BEGIN));
  assert.match(skillPreamble, /AskUserQuestion/);
  assert.ok(!agentsPreamble.includes('AskUserQuestion'), 'AGENTS.md must not depend on a Claude-only tool');
  assert.match(agentsPreamble, /numbered list|prose/i);
});

test('both files tell a non-interactive run to proceed rather than stop', () => {
  for (const [name, document] of [['SKILL.md', skill], ['AGENTS.md', agents]]) {
    const preamble = document.slice(0, document.indexOf(BEGIN));
    assert.match(preamble, /do not stop/i, `${name} must cover the case where nobody can answer`);
  }
});

test('SKILL.md front matter is present and describes when to use the skill', () => {
  assert.match(skill, /^---\nname: hydraulify\n/);
  const description = skill.match(/^description: (.+)$/m)?.[1] ?? '';
  assert.ok(description.length > 120, 'the description is what decides whether the skill is reached for');
  assert.match(description, /hydraulic/i);
  assert.match(description, /ISO 1219/);
});

test('every reference document the instructions point at exists', () => {
  for (const document of [skill, agents]) {
    for (const match of document.matchAll(/`(references\/[a-z-]+\.md)`/g)) {
      const target = path.join(root, match[1]);
      assert.ok(fs.existsSync(target), `${match[1]} is referenced but missing`);
    }
  }
});
