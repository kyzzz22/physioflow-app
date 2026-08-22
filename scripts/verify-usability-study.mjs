#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summarizeUsabilityStudy } from '../src/usability/studyMetrics.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run verify:usability-study -- <results.json>');
  process.exit(2);
}

try {
  const study = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
  const report = summarizeUsabilityStudy(study);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.passed ? 0 : 1);
} catch (error) {
  console.error(`Could not verify usability study: ${error.message}`);
  process.exit(2);
}
