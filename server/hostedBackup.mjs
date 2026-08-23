import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { FileHostedStateStore } from './fileHostedStateStore.mjs';

export const HOSTED_BACKUP_SCHEMA_VERSION = '1.0.0';
const MANIFEST_FILE = 'manifest.json';
const STATE_FILE = 'state.json';

function sha256(content) { return createHash('sha256').update(content).digest('hex'); }

function safeRelativePath(value) {
  if (!value || value.startsWith('/') || value.includes('\\')) throw new Error(`Hosted backup contains an unsafe path: ${value || '(missing)'}`);
  const normalized = value.split('/');
  if (normalized.some(part => !part || part === '.' || part === '..')) throw new Error(`Hosted backup contains an unsafe path: ${value}`);
  return normalized.join('/');
}

function inside(root, relativePath) {
  const target = resolve(root, safeRelativePath(relativePath));
  if (!target.startsWith(`${resolve(root)}${sep}`)) throw new Error(`Hosted backup path escapes its root: ${relativePath}`);
  return target;
}

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function assertNewTarget(path, label) {
  if (await exists(path)) throw new Error(`${label} already exists: ${path}`);
}

async function assetFiles(root, directory = root) {
  const files = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return files; throw error; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const source = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Hosted backup refuses symbolic link asset: ${source}`);
    if (entry.isDirectory()) files.push(...await assetFiles(root, source));
    else if (entry.isFile()) files.push({ source, relativePath: `assets/${relative(root, source).split(sep).join('/')}` });
    else throw new Error(`Hosted backup refuses unsupported asset entry: ${source}`);
  }
  return files;
}

async function assertRegularSource(path, label, allowDirectory = false) {
  const details = await lstat(path);
  if (details.isSymbolicLink()) throw new Error(`Hosted backup refuses symbolic link ${label}: ${path}`);
  if (allowDirectory ? !details.isDirectory() : !details.isFile()) throw new Error(`Hosted backup requires a ${allowDirectory ? 'directory' : 'file'} ${label}: ${path}`);
}

async function writePrivate(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600, flag: 'wx' });
}

async function copyVerified(source, destination) {
  const before = await readFile(source);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  const after = await readFile(destination);
  if (sha256(before) !== sha256(after)) throw new Error(`Hosted backup copy checksum changed: ${source}`);
  await chmod(destination, 0o600);
  return { checksum: sha256(after), size: after.length };
}

async function listedFiles(root, directory = root) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Hosted backup contains a symbolic link: ${path}`);
    if (entry.isDirectory()) files.push(...await listedFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'));
    else throw new Error(`Hosted backup contains an unsupported entry: ${path}`);
  }
  return files;
}

export async function verifyHostedBackup(backupDirectory) {
  const root = resolve(backupDirectory);
  const manifest = JSON.parse(await readFile(resolve(root, MANIFEST_FILE), 'utf8'));
  if (manifest.schemaVersion !== HOSTED_BACKUP_SCHEMA_VERSION) throw new Error(`Unsupported hosted backup version ${manifest.schemaVersion || '(missing)'}`);
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Hosted backup manifest requires files');
  const declared = new Set();
  for (const entry of manifest.files) {
    const relativePath = safeRelativePath(entry?.path);
    if (declared.has(relativePath)) throw new Error(`Hosted backup repeats file ${relativePath}`);
    declared.add(relativePath);
    if (!/^[a-f0-9]{64}$/.test(entry.checksum || '') || !Number.isInteger(entry.size) || entry.size < 0) throw new Error(`Hosted backup has invalid metadata for ${relativePath}`);
    const content = await readFile(inside(root, relativePath));
    if (content.length !== entry.size || sha256(content) !== entry.checksum) throw new Error(`Hosted backup checksum mismatch for ${relativePath}`);
  }
  if (!declared.has(STATE_FILE)) throw new Error('Hosted backup is missing its state snapshot');
  const actual = (await listedFiles(root)).filter(path => path !== MANIFEST_FILE);
  const unexpected = actual.filter(path => !declared.has(path));
  const missing = [...declared].filter(path => !actual.includes(path));
  if (unexpected.length || missing.length) throw new Error(`Hosted backup file inventory mismatch${unexpected.length ? `; unexpected: ${unexpected.join(', ')}` : ''}${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
  await new FileHostedStateStore(inside(root, STATE_FILE)).load();
  return { valid: true, manifest, fileCount: manifest.files.length, totalBytes: manifest.files.reduce((total, entry) => total + entry.size, 0) };
}

export async function createHostedBackup(options = {}) {
  if (!options.stateFile || !options.destination) throw new Error('Hosted backup requires stateFile and destination');
  const destination = resolve(options.destination);
  await assertNewTarget(destination, 'Hosted backup destination');
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = resolve(parent, `.${basename(destination)}.${process.pid}.${globalThis.crypto.randomUUID()}.tmp`);
  await assertNewTarget(temporary, 'Hosted backup temporary directory');
  try {
    await mkdir(temporary, { mode: 0o700 });
    await assertRegularSource(resolve(options.stateFile), 'state source');
    const state = await new FileHostedStateStore(options.stateFile).load();
    if (!state) throw new Error(`Hosted state file does not exist: ${resolve(options.stateFile)}`);
    const stateContent = Buffer.from(`${JSON.stringify(state, null, 2)}\n`);
    await writePrivate(resolve(temporary, STATE_FILE), stateContent);
    const files = [{ path: STATE_FILE, checksum: sha256(stateContent), size: stateContent.length }];
    if (options.assetDirectory) {
      if (await exists(resolve(options.assetDirectory))) await assertRegularSource(resolve(options.assetDirectory), 'asset source', true);
      for (const asset of await assetFiles(resolve(options.assetDirectory))) {
        const copied = await copyVerified(asset.source, inside(temporary, asset.relativePath));
        files.push({ path: asset.relativePath, ...copied });
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    const manifest = {
      schemaVersion: HOSTED_BACKUP_SCHEMA_VERSION,
      createdAt: options.createdAt || new Date().toISOString(),
      source: { stateSchemaVersion: state.schemaVersion, includesAssets: files.some(entry => entry.path.startsWith('assets/')) },
      files,
    };
    await writePrivate(resolve(temporary, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    await verifyHostedBackup(temporary);
    await rename(temporary, destination);
    return { destination, manifest };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function restoreHostedBackup(options = {}) {
  if (!options.backupDirectory || !options.stateFile) throw new Error('Hosted restore requires backupDirectory and stateFile');
  const verified = await verifyHostedBackup(options.backupDirectory);
  const targetState = resolve(options.stateFile);
  await assertNewTarget(targetState, 'Hosted restore state target');
  const assetEntries = verified.manifest.files.filter(entry => entry.path.startsWith('assets/'));
  const targetAssets = options.assetDirectory ? resolve(options.assetDirectory) : null;
  if (assetEntries.length && !targetAssets) throw new Error('Hosted restore requires assetDirectory for a backup containing assets');
  if (targetAssets) await assertNewTarget(targetAssets, 'Hosted restore asset target');
  let assetsCreated = false;
  try {
    if (targetAssets) {
      const parent = dirname(targetAssets);
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const temporaryAssets = resolve(parent, `.${basename(targetAssets)}.${process.pid}.${globalThis.crypto.randomUUID()}.tmp`);
      await mkdir(temporaryAssets, { mode: 0o700 });
      try {
        for (const entry of assetEntries) await copyVerified(inside(options.backupDirectory, entry.path), inside(temporaryAssets, entry.path.slice('assets/'.length)));
        await rename(temporaryAssets, targetAssets);
        assetsCreated = true;
      } catch (error) {
        await rm(temporaryAssets, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    }
    const state = JSON.parse(await readFile(inside(options.backupDirectory, STATE_FILE), 'utf8'));
    await new FileHostedStateStore(targetState).save(state);
    return { stateFile: targetState, assetDirectory: targetAssets, manifest: verified.manifest };
  } catch (error) {
    if (assetsCreated) await rm(targetAssets, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
