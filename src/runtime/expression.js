const OPERATORS = new Set(['equals', 'not_equals', 'contains', 'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal', 'is_truthy', 'is_falsy']);

export function evaluateExpression(expression, actualValue) {
  const operator = expression?.operator || 'equals';
  if (!OPERATORS.has(operator)) throw new Error(`Unsupported expression operator ${operator}`);
  const expected = expression?.expected;
  if (operator === 'is_truthy') return Boolean(actualValue);
  if (operator === 'is_falsy') return !actualValue;
  if (operator === 'not_equals') return String(actualValue ?? '') !== String(expected ?? '');
  if (operator === 'contains') {
    if (Array.isArray(actualValue)) return actualValue.some(value => String(value) === String(expected));
    return String(actualValue ?? '').includes(String(expected ?? ''));
  }
  if (operator === 'greater_than') return Number(actualValue) > Number(expected);
  if (operator === 'greater_than_or_equal') return Number(actualValue) >= Number(expected);
  if (operator === 'less_than') return Number(actualValue) < Number(expected);
  if (operator === 'less_than_or_equal') return Number(actualValue) <= Number(expected);
  return String(actualValue ?? '') === String(expected ?? '');
}

export function resolveBinding(binding, state, fallback) {
  if (!binding) return fallback;
  if (binding.kind === 'literal') return binding.value;
  if (binding.kind === 'variable') return state.variables[binding.variable];
  if (binding.kind === 'output') return state.outputs[binding.nodeId]?.[binding.portId];
  throw new Error(`Unsupported binding kind ${binding.kind}`);
}
