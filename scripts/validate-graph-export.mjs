import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = resolve(process.argv[2] || '.');
const required = ['manifest.json', 'protocol_snapshot.json', 'runtime_snapshot.json', 'events.jsonl', 'responses.jsonl', 'events.csv', 'responses.csv', 'data_dictionary.json', 'quality_report.json'];
const missing = [];
for (const name of required) {
  try { if (!(await stat(resolve(target, name))).isFile()) missing.push(name); }
  catch { missing.push(name); }
}
if (missing.length) {
  console.error(`Missing required export files: ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  const lines = (await readFile(resolve(target, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean);
  const events = lines.map((line, index) => { try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON on events.jsonl line ${index + 1}`); } });
  const sequenceValid = events.every((event, index) => event.sequence === index + 1);
  const quality = JSON.parse(await readFile(resolve(target, 'quality_report.json'), 'utf8'));
  if (!sequenceValid) {
    console.error('Event sequence is not contiguous.');
    process.exitCode = 1;
  } else if (quality.validity_status === 'invalid') {
    console.error(`Quality report is invalid: ${(quality.errors || []).join(' · ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Valid PhysioFlow graph export: ${events.length} events · quality ${quality.validity_status}`);
  }
}
