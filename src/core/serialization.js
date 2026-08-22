function canonicalize(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) throw new TypeError('Protocol graph cannot contain circular references');
    seen.add(value);
  }
  if (Array.isArray(value)) return value.map(item => canonicalize(item, seen));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key], seen)]));
  }
  return value;
}

export function serializeProtocolGraph(protocol, space = 2) {
  return JSON.stringify(canonicalize(protocol), null, space);
}

export function parseProtocolGraph(source, registry, validate) {
  const protocol = typeof source === 'string' ? JSON.parse(source) : structuredClone(source);
  const validation = validate ? validate(protocol, registry) : null;
  return { protocol, validation };
}
