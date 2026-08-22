export function createId(prefix = 'id', randomUUID) {
  const generate = randomUUID || (() => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
    return template.replace(/[xy]/g, character => {
      const random = Math.floor(Math.random() * 16);
      const value = character === 'x' ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  });
  return `${prefix}_${generate()}`;
}

export function createSequentialIdFactory(seed = 0) {
  let sequence = seed;
  return prefix => `${prefix}_${String(++sequence).padStart(4, '0')}`;
}
