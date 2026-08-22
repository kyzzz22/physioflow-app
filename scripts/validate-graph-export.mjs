import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_GRAPH_EXPORT_FILES = ['manifest.json', 'protocol_snapshot.json', 'runtime_snapshot.json', 'events.jsonl', 'responses.jsonl', 'events.csv', 'responses.csv', 'data_dictionary.json', 'quality_report.json'];

export async function validateGraphExportDirectory(directory) {
  const target = resolve(directory || '.');
  const missing = [];
  for (const name of REQUIRED_GRAPH_EXPORT_FILES) {
    try { if (!(await stat(resolve(target, name))).isFile()) missing.push(name); }
    catch { missing.push(name); }
  }
  if (missing.length) return { valid: false, errors: [`Missing required export files: ${missing.join(', ')}`], missing };

  try {
    const lines = (await readFile(resolve(target, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean);
    const events = lines.map((line, index) => {
      try { return JSON.parse(line); }
      catch { throw new Error(`Invalid JSON on events.jsonl line ${index + 1}`); }
    });
    if (!events.every((event, index) => event.sequence === index + 1)) return { valid: false, errors: ['Event sequence is not contiguous.'] };
    const quality = JSON.parse(await readFile(resolve(target, 'quality_report.json'), 'utf8'));
    if (quality.validity_status === 'invalid') return { valid: false, errors: [`Quality report is invalid: ${(quality.errors || []).join(' · ')}`] };
    return { valid: true, errors: [], eventCount: events.length, qualityStatus: quality.validity_status };
  } catch (error) {
    return { valid: false, errors: [error.message || String(error)] };
  }
}

async function main() {
  const result = await validateGraphExportDirectory(process.argv[2] || '.');
  if (!result.valid) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Valid PhysioFlow graph export: ${result.eventCount} events · quality ${result.qualityStatus}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
