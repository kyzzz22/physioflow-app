import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createId } from '../src/core/ids.js';
import { migrateLegacyProtocolV1 } from '../src/legacy/migrateProtocolV1.js';

const [, , sourcePath, outputPath] = process.argv;
if (!sourcePath || !outputPath) {
  console.error('Usage: npm run migrate:v1 -- source.protocol.json migrated.protocol-graph.json');
  process.exitCode = 1;
} else {
  const source = JSON.parse(await readFile(resolve(sourcePath), 'utf8'));
  const { protocol, report } = migrateLegacyProtocolV1(source, { idFactory: createId });
  const target = resolve(outputPath);
  await writeFile(target, `${JSON.stringify(protocol, null, 2)}\n`, 'utf8');
  await writeFile(`${target}.migration-report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Migrated ${report.counts.steps} steps with ${report.coverage.mappedPercent}% native component coverage.`);
  if (report.requiresReview) console.log(`${report.issues.length} item(s) require review; output remains a draft.`);
}
