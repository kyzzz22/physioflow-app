import { createUiElement, participantUiTemplate } from '../core/index.js';
import { resolveParticipantResourceUrl } from '../hosted/index.js';

// Local (non-hosted) run: turn the protocol asset library into the resource shape the
// media resolver expects, so `assetId`-only media nodes render their source locally.
export function localResourceManifest(assets = []) {
  return assets
    .filter(asset => asset?.sourceUrl || asset?.url)
    .map(asset => ({
      assetId: asset.id || asset.assetId,
      nodeId: null,
      name: asset.name || asset.fileName || '',
      mediaType: asset.mediaType || asset.type || null,
      checksum: asset.checksum || asset.hash || null,
      status: 'ready',
      delivery: { url: asset.sourceUrl || asset.url || '' },
    }));
}

// Shared "what does this node show to the participant" resolver.
// Single source of truth for both the Runtime V2 runner and the Composer V2
// node-level preview — a node previews exactly what the runner renders.

export function findUiElement(element, type) {
  if (element?.type === type) return element;
  for (const child of element?.children || []) {
    const found = findUiElement(child, type);
    if (found) return found;
  }
  return null;
}

// Keep specialized node settings and their visual element in one model. Without
// this synchronization the builder could show an edit that schemaForNode later
// replaced with stale node.config values at run time.
export function configFromParticipantUi(node, ui) {
  const config = { ...node.config, ui };
  if (node.component.type === 'display.media') {
    const media = findUiElement(ui.root, 'Media');
    if (media) Object.assign(config, { mediaType: media.props?.mediaType || 'image', sourceUrl: media.props?.sourceUrl || '', assetId: media.props?.assetId || config.assetId || null });
  } else if (node.component.type === 'input.rating') {
    const input = findUiElement(ui.root, 'Input');
    if (input) Object.assign(config, { min: Number(input.props?.min ?? 1), max: Number(input.props?.max ?? 7), required: input.props?.required !== false });
  } else if (node.component.type === 'input.text') {
    const input = findUiElement(ui.root, 'Input');
    if (input) Object.assign(config, { placeholder: input.props?.placeholder || '', required: Boolean(input.props?.required), multiline: input.props?.inputType === 'textarea' });
  } else if (node.component.type === 'stimulus.custom-html') {
    const html = findUiElement(ui.root, 'Html');
    if (html) config.html = html.props?.html || '';
  }
  return config;
}

export function schemaForNode(node, definition, resources) {
  const adapter = definition?.runtime?.uiAdapter || 'schema';
  if (node.component.type === 'input.questionnaire' && node.config?.questionnaire?.questions?.length) {
    const schema = structuredClone(node.config?.ui || participantUiTemplate('form'));
    schema.root.children = [
      createUiElement('Text', { props: { text: node.label, variant: 'heading' } }),
      createUiElement('Input', { props: { name: `questionnaire:${node.config.questionnaire.questionnaire_id}`, inputType: 'text', label: 'Questionnaire', required: false } }),
      createUiElement('Button', { props: { label: 'Continue', variant: 'primary' }, actions: [{ event: 'click', action: 'submit' }] }),
    ];
    return schema;
  }
  if (node.component.type === 'stimulus.fixation') {
    const schema = structuredClone(node.config?.ui || participantUiTemplate('fixation'));
    const text = findUiElement(schema.root, 'Text');
    if (text) {
      const glyph = node.config?.shape === 'dot' ? '●' : node.config?.shape === 'diamond' ? '◆' : '+';
      text.props = { ...(text.props || {}), text: glyph, ...(node.config?.pulse ? { pulse: true } : {}) };
      text.style = { ...(text.style || {}), fontSize: `${node.config?.sizePx || 48}px`, color: node.config?.color || '#17231d', textAlign: 'center' };
    }
    // manual completion needs an advance control; inject one when the designer's
    // schema has none (fixed mode keeps the bare fixation cross).
    if (node.config?.completion?.mode === 'manual' && !findUiElement(schema.root, 'Button')) {
      schema.root.children.push(createUiElement('Button', { props: { label: 'Continue', variant: 'primary' }, actions: [{ event: 'click', action: 'submit' }] }));
    }
    return schema;
  }
  if (node.component.type === 'stimulus.attention-check') {
    const schema = structuredClone(node.config?.ui || participantUiTemplate('attention'));
    if (node.config?.prompt) {
      const heading = findUiElement(schema.root, 'Text');
      if (heading?.props?.variant === 'heading') heading.props = { ...heading.props, text: node.config.prompt };
    }
    return schema;
  }
  if (node.component.type === 'setup.device-check') {
    const items = (node.config?.checklist || '').split('\n').map(item => item.trim()).filter(Boolean);
    const schema = structuredClone(node.config?.ui || participantUiTemplate('device'));
    // Keep the designer's custom children (headings, instructions, buttons); drop the
    // template's placeholder body line and append one required checkbox per item.
    const kept = (schema.root.children || []).filter(child => !(child.type === 'Text' && child.props?.variant === 'body'));
    if (items.length) {
      schema.root.children = [...kept, ...items.map((item, index) => createUiElement('Input', { props: { name: `check_${index}`, inputType: 'checkbox', label: item, required: true } }))];
    } else {
      schema.root.children = [...kept, createUiElement('Text', { props: { text: 'No checklist items configured.', variant: 'body' } })];
    }
    if (!schema.root.children.some(child => child.type === 'Button')) {
      schema.root.children.push(createUiElement('Button', { props: { label: 'Ready', variant: 'primary' }, actions: [{ event: 'click', action: 'submit' }] }));
    }
    return schema;
  }
  if (node.component.type === 'operator.manual-event') {
    const schema = structuredClone(node.config?.ui || participantUiTemplate('manual'));
    if (node.config?.confirmLabel) {
      const button = findUiElement(schema.root, 'Button');
      if (button) button.props = { ...button.props, label: node.config.confirmLabel };
    }
    if (node.config?.requireNote) {
      const button = findUiElement(schema.root, 'Button');
      const note = createUiElement('Input', { props: { name: 'note', inputType: 'textarea', label: 'Operator note', required: true } });
      if (button) {
        const index = schema.root.children.findIndex(child => child.id === button.id);
        if (index >= 0) schema.root.children.splice(index, 0, note);
        else schema.root.children.push(note);
      } else {
        schema.root.children.push(note);
      }
    }
    return schema;
  }
  if (node.component.type === 'stimulus.custom-html') {
    const schema = structuredClone(node.config?.ui || participantUiTemplate('html'));
    const htmlElement = findUiElement(schema.root, 'Html');
    if (htmlElement && node.config?.html) htmlElement.props = { ...htmlElement.props, html: node.config.html };
    return schema;
  }
  if (adapter === 'screen' || adapter === 'schema') return structuredClone(node.config?.ui || participantUiTemplate('instruction'));
  if (adapter === 'media') {
    const schema = structuredClone(node.config?.ui || participantUiTemplate('media'));
    const media = findUiElement(schema.root, 'Media');
    const sourceUrl = resolveParticipantResourceUrl(resources, {
      assetId: node.config?.assetId || null,
      nodeId: node.id,
      fallbackUrl: node.config?.sourceUrl || '',
    });
    if (media) media.props = { ...media.props, mediaType: node.config?.mediaType || 'image', sourceUrl, assetId: node.config?.assetId || null };
    // media-ended must not let the participant advance before playback finishes.
    if (node.config?.completion?.mode === 'media-ended') {
      schema.root.children = schema.root.children.filter(child => child.type !== 'Button');
    }
    return schema;
  }
  if (adapter === 'rating') {
    const schema = structuredClone(node.config?.ui || participantUiTemplate('form'));
    const input = findUiElement(schema.root, 'Input');
    if (input) input.props = { ...input.props, name: 'value', label: node.label, min: node.config?.min ?? 1, max: node.config?.max ?? 7, required: node.config?.required !== false };
    return schema;
  }
  if (adapter === 'text') {
    const schema = structuredClone(node.config?.ui || participantUiTemplate('form'));
    const input = findUiElement(schema.root, 'Input');
    if (input) input.props = { ...input.props, name: 'value', label: node.label, inputType: node.config?.multiline ? 'textarea' : 'text', placeholder: node.config?.placeholder || '', required: Boolean(node.config?.required) };
    return schema;
  }
  if (adapter !== 'wait') return structuredClone(node.config?.ui || participantUiTemplate('instruction'));
  const schema = structuredClone(node.config?.ui || participantUiTemplate('instruction'));
  schema.root.children = [
    createUiElement('Text', { props: { text: node.label, variant: 'heading' } }),
    createUiElement('Progress', { props: { value: 0, max: Math.max(1, Number(node.config?.durationMs || 1000)), label: 'Please wait…' }, bindings: { value: 'timer.elapsedMs' } }),
  ];
  return schema;
}
