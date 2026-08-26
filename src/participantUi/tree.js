import { createId, createUiElement } from '../core/index.js';

export function findParentAndIndex(root, id) {
  for (let i = 0; i < (root.children || []).length; i++) {
    const child = root.children[i];
    if (child.id === id) return { parentId: root.id, index: i };
    const found = findParentAndIndex(child, id);
    if (found) return found;
  }
  return null;
}

export function pathTo(root, id, path = []) {
  if (root.id === id) return path.concat(root);
  for (const child of root.children || []) {
    const found = pathTo(child, id, path.concat(root));
    if (found) return found;
  }
  return null;
}

export function flatten(root, depth = 0, result = [], parentId = null, childIndex = 0) {
  result.push({ element: root, depth, parentId, childIndex });
  (root.children || []).forEach((child, index) => flatten(child, depth + 1, result, root.id, index));
  return result;
}

export function elementLabel(element) {
  return element.props?.label || element.props?.text || element.props?.name || '';
}

export function normalizeColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
}

export function duplicateElementTree(element) {
  return createUiElement(element.type, {
    id: createId('ui'),
    props: element.props,
    style: element.style,
    bindings: element.bindings,
    actions: element.actions,
    children: (element.children || []).map(duplicateElementTree),
  });
}

export function findInTree(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findInTree(child, id);
    if (found) return found;
  }
  return null;
}

export function mapTree(node, fn) {
  const mapped = fn(node);
  return { ...mapped, children: (mapped.children || []).map(child => mapTree(child, fn)) };
}
