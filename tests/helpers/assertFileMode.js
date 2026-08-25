import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';

/**
 * Assert a file carries the expected POSIX permission bits (e.g. 0o600).
 *
 * On win32 the NTFS filesystem cannot express POSIX mode bits — every regular
 * file reports 0o666 regardless of intent — so the strict bit check is skipped
 * while the rest of the calling test keeps running. The file is still required
 * to exist and be stat-able on all platforms.
 *
 * @param {string} filePath absolute or cwd-relative path to the file
 * @param {number} expectedMode permission bits, e.g. 0o600
 */
export async function assertFileMode(filePath, expectedMode) {
  const actual = (await stat(filePath)).mode & 0o777;
  if (process.platform === 'win32') return; // NTFS cannot express POSIX mode bits
  assert.equal(actual, expectedMode, `mode of ${filePath}: 0o${actual.toString(8)}`);
}
