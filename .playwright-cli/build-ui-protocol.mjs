import fs from 'node:fs';
import {
  createProtocolGraph,
  addNode,
  connect,
  createSequentialIdFactory,
  participantUiTemplate,
  createUiElement,
  appendUiElement,
  validateParticipantUi,
} from '../src/core/index.js';

const idFactory = createSequentialIdFactory();
const protocol = createProtocolGraph({ name: 'UI Verify', idFactory });

const start = protocol.graph.nodes.find(n => n.component.type === 'core.start');
const end = protocol.graph.nodes.find(n => n.component.type === 'core.end');

// 完整 UI schema：instruction 模板 + 全部组件类型
let ui = participantUiTemplate('instruction', { idFactory });
ui = appendUiElement(ui, ui.root.id, createUiElement('Media', {
  id: 'ui_media_youtube',
  props: { mediaType: 'video', sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', fit: 'contain', controls: true },
}));
ui = appendUiElement(ui, ui.root.id, createUiElement('Html', {
  id: 'ui_html_custom',
  props: { html: '<div style="text-align:center;padding:8px;background:#eef4ff">Custom HTML <strong>block</strong></div>' },
}));
ui = appendUiElement(ui, ui.root.id, createUiElement('Input', {
  id: 'ui_input_text',
  props: { name: 'response', inputType: 'text', label: 'Response', placeholder: 'Type here', required: false },
}));
ui = appendUiElement(ui, ui.root.id, createUiElement('Button', {
  id: 'ui_button_secondary',
  props: { label: 'Secondary', variant: 'secondary' },
  actions: [{ event: 'click', action: 'submit' }],
}));
ui = appendUiElement(ui, ui.root.id, createUiElement('Layout', {
  id: 'ui_layout_row',
  props: { direction: 'row', gap: 8 },
  children: [
    createUiElement('Button', { id: 'ui_layout_btn_a', props: { label: 'A', variant: 'primary' } }),
    createUiElement('Button', { id: 'ui_layout_btn_b', props: { label: 'B', variant: 'secondary' } }),
  ],
}));

const validation = validateParticipantUi(ui);
if (!validation.valid) {
  console.error('UI schema invalid:', validation.errors);
  process.exit(1);
}

// Free-layout texts used by the alignment/distribution acceptance step.
ui = appendUiElement(ui, ui.root.id, createUiElement('Text', {
  id: 'ui_t1',
  props: { text: 'Alpha', variant: 'body', x: 40, y: 40, width: 120 },
}));
ui = appendUiElement(ui, ui.root.id, createUiElement('Text', {
  id: 'ui_t2',
  props: { text: 'Bravo', variant: 'body', x: 240, y: 200, width: 120 },
}));
ui = appendUiElement(ui, ui.root.id, createUiElement('Text', {
  id: 'ui_t3',
  props: { text: 'Charlie', variant: 'body', x: 64, y: 340, width: 120 },
}));
ui = { ...ui, root: { ...ui.root, props: { ...ui.root.props, free: true } } };

// Overlapping free texts used by the z-order (stacking) acceptance step.
ui = appendUiElement(ui, ui.root.id, createUiElement('Text', {
  id: 'ui_z1',
  props: { text: 'Zeta', variant: 'body', x: 320, y: 420, width: 140 },
}));
ui = appendUiElement(ui, ui.root.id, createUiElement('Text', {
  id: 'ui_z2',
  props: { text: 'Yankee', variant: 'body', x: 320, y: 420, width: 140 },
}));
ui = appendUiElement(ui, ui.root.id, createUiElement('Text', {
  id: 'ui_z3',
  props: { text: 'Xray', variant: 'body', x: 320, y: 420, width: 140 },
}));

// Shapes & divider used by the shapes acceptance step.
ui = appendUiElement(ui, ui.root.id, createUiElement('Divider', {
  id: 'ui_d1',
  props: { orientation: 'horizontal', thickness: 2, x: 520, y: 40, width: 200 },
}));
ui = appendUiElement(ui, ui.root.id, createUiElement('Rectangle', {
  id: 'ui_r1',
  props: { x: 520, y: 90, width: 120, height: 80 },
}));
ui = appendUiElement(ui, ui.root.id, createUiElement('Ellipse', {
  id: 'ui_e1',
  props: { x: 700, y: 90, width: 120, height: 80 },
}));

// 移除初始 start->end 直连边，避免 end.in 多入边
const pruned = {
  ...protocol,
  graph: {
    ...protocol.graph,
    edges: protocol.graph.edges.filter(e => !(e.source.nodeId === start.id && e.target.nodeId === end.id)),
  },
};
const screenId = 'screen_verify_1';
const withScreen = addNode(pruned, 'display.screen', {
  id: screenId,
  idFactory,
  label: 'Screen',
  config: { ui },
}).protocol;
const screenNode = withScreen.graph.nodes.find(n => n.id === screenId);
if (!screenNode) {
  console.error('screen node missing; nodes=', withScreen.graph.nodes.map(n => n.id));
  process.exit(1);
}
const withEdge = connect(
  withScreen,
  'control',
  { nodeId: start.id, portId: 'next' },
  { nodeId: screenId, portId: 'in' },
).protocol;
const final = connect(
  withEdge,
  'control',
  { nodeId: screenId, portId: 'next' },
  { nodeId: end.id, portId: 'in' },
).protocol;

const out = 'public/__verify-protocol.json';
fs.writeFileSync(out, JSON.stringify([final]));
console.log('Wrote', out, 'elements:', ui.root.children.length);
