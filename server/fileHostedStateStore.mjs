import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { validateHostedState } from '../src/hosted/hostedStateStore.js';

export class FileHostedStateStore {
  constructor(filePath) {
    if (!filePath) throw new Error('Hosted file state store requires a file path');
    this.filePath = resolve(filePath);
  }

  async load() {
    try {
      const state = JSON.parse(await readFile(this.filePath, 'utf8'));
      const check = validateHostedState(state);
      if (!check.valid) throw new Error(`Invalid hosted state:\n${check.errors.join('\n')}`);
      return state;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) throw new Error(`Hosted state file is not valid JSON: ${this.filePath}`);
      throw error;
    }
  }

  async save(state) {
    const check = validateHostedState(state);
    if (!check.valid) throw new Error(`Invalid hosted state:\n${check.errors.join('\n')}`);
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${globalThis.crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}
