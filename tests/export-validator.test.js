import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REQUIRED_GRAPH_EXPORT_FILES, validateGraphExportDirectory } from '../scripts/validate-graph-export.mjs';

test('independent export validator accepts a complete contiguous package', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'physioflow-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of REQUIRED_GRAPH_EXPORT_FILES) {
    let content = '{}';
    if (name === 'events.jsonl') content = '{"sequence":1}\n{"sequence":2}\n';
    if (name === 'responses.jsonl') content = '';
    if (name.endsWith('.csv')) content = 'id\n';
    if (name === 'quality_report.json') content = '{"validity_status":"valid","errors":[]}';
    await writeFile(join(directory, name), content);
  }
  const result = await validateGraphExportDirectory(directory);
  assert.deepEqual(result, { valid: true, errors: [], eventCount: 2, qualityStatus: 'valid' });
});

test('independent export validator rejects sequence gaps', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'physioflow-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of REQUIRED_GRAPH_EXPORT_FILES) {
    const content = name === 'events.jsonl' ? '{"sequence":2}\n' : name === 'quality_report.json' ? '{"validity_status":"valid"}' : '';
    await writeFile(join(directory, name), content);
  }
  const result = await validateGraphExportDirectory(directory);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /not contiguous/);
});
