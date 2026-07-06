export function isTauriRuntime() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

async function invoke(command, args = {}) {
  const api = await import('@tauri-apps/api/core');
  return api.invoke(command, args);
}

export async function storageInfo() {
  return invoke('storage_info');
}

export async function selectDataDirectory() {
  return invoke('select_data_directory');
}

export async function openDataDirectory() {
  return invoke('open_data_directory');
}

export async function readText(path) {
  return invoke('read_text', { path });
}

export async function writeText(path, text) {
  return invoke('write_text', { path, text });
}

export async function readBlob(path) {
  const bytes = await invoke('read_binary', { path });
  return bytes ? new Blob([new Uint8Array(bytes)]) : null;
}

export async function writeBlob(path, blob) {
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  return invoke('write_binary', { path, bytes });
}

export async function removeEntry(path) {
  return invoke('remove_entry', { path });
}

export async function listFiles(path) {
  return invoke('list_files', { path });
}

export async function listDirectories(path) {
  return invoke('list_directories', { path });
}
