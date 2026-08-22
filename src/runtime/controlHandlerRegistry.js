function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export class ControlHandlerRegistry {
  #handlers = new Map();

  register(definition) {
    if (!definition?.id?.match(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)) throw new Error('Control handler ID must use lowercase dot/dash notation');
    if (!definition.version?.match(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/)) throw new Error('Control handler version must use semantic versioning');
    if (typeof definition.execute !== 'function') throw new Error('Control handler needs an execute function');
    const key = this.keyOf(definition.id, definition.version);
    if (this.#handlers.has(key)) throw new Error(`Control handler ${key} is already registered`);
    this.#handlers.set(key, { id: definition.id, version: definition.version, allowedEvents: [...(definition.allowedEvents || [])], execute: definition.execute });
    return this;
  }

  has(id, version = '1.0.0') { return this.#handlers.has(this.keyOf(id, version)); }
  get(id, version = '1.0.0') { return this.#handlers.get(this.keyOf(id, version)) || null; }
  keyOf(id, version) { return `${id}@${version}`; }

  execute(id, version, context) {
    const handler = this.get(id, version);
    if (!handler) throw new Error(`Control handler ${id}@${version} is not registered`);
    const result = handler.execute(deepFreeze(structuredClone(context)));
    if (result && typeof result.then === 'function') throw new Error(`Control handler ${id} must execute synchronously`);
    if (!result || typeof result !== 'object' || !result.selectedPort?.trim()) throw new Error(`Control handler ${id} must return a selectedPort`);
    if (result.eventType && !handler.allowedEvents.includes(result.eventType)) throw new Error(`Control handler ${id} cannot emit ${result.eventType}`);
    return structuredClone({ selectedPort: result.selectedPort, eventType: result.eventType || 'control_handler_evaluated', payload: result.payload || {} });
  }
}

export function createCoreControlHandlerRegistry() {
  return new ControlHandlerRegistry().register({
    id: 'core.value-switch',
    version: '1.0.0',
    allowedEvents: ['control_handler_evaluated'],
    execute: context => {
      const matched = String(context.inputs.value ?? '') === String(context.config.match ?? '');
      return { selectedPort: matched ? 'match' : 'default', eventType: 'control_handler_evaluated', payload: { handlerId: 'core.value-switch', actual: context.inputs.value, expected: context.config.match, matched } };
    },
  });
}
