#!/usr/bin/env node
// Turn a ground-truth CSV into a labeled test CSV for batch mode.
//   node tools/make-cases.mjs ground-truth.csv > cases.csv
//   node tools/make-cases.mjs ground-truth.csv --pairs 3 --seed 7 --holdout 0.2
// Ground truth columns: id, structure_number, street_type, street_name, unit, urbanization, barrio,
// municipio, zip, lat, lon, and optionally postal_city.
// With --holdout, rows go to cases.csv or holdout.csv by a stable hash of their id, so the split never changes.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsvObjects, toCsv } from '../core/csv.js';
import { casesFor, rng, CASE_COLUMNS } from '../core/mutate.js';
import { hash } from '../core/text.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^\d/.test(a));
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : dflt; };
if (!file) {
  console.error('Usage: node tools/make-cases.mjs ground-truth.csv [--pairs 2] [--seed 1] [--holdout 0.2]');
  process.exit(1);
}
const { rows } = parseCsvObjects(readFileSync(file, 'utf8'));
const rand = rng(opt('seed', 1));
const pairs = opt('pairs', 2);
const holdout = opt('holdout', 0);
const train = [];
const held = [];
for (const g of rows) {
  if (!g.id || !g.municipio) continue;
  const cases = casesFor(g, { pairs, rand });
  const bucket = parseInt(hash(g.id).slice(0, 6), 16) / 0xffffff;
  (holdout && bucket < holdout ? held : train).push(...cases);
}
if (holdout) {
  writeFileSync('holdout.csv', toCsv(held, CASE_COLUMNS));
  console.error(`holdout.csv: ${held.length} cases`);
}
process.stdout.write(toCsv(train, CASE_COLUMNS));
console.error(`${train.length} cases from ${rows.length} ground-truth rows`);
