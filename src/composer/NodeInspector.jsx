import { useRef, useState } from 'react';
import {
  generateGonogoTrials,
  generateStroopTrials,
  mapUiElement,
} from '../core/index.js';
import { parseResponseOptions, serializeResponseOptions } from '../core/responseOptions.js';
import { findUiElement, localResourceManifest, schemaForNode } from '../runtime/index.js';
import { translate, useLanguage } from '../i18n.jsx';
import ParticipantRenderer from '../ParticipantRenderer.jsx';
import QuestionnaireEditor from '../QuestionnaireEditorV2.jsx';
import QuestionnaireForm from '../QuestionnaireFormV2.jsx';
import { bindingValue, getPath, isValidMediaUrl, parseBindingValue, setPath } from './toolbox.js';

export function CodeView({ text, error, locked, dirty, onChange, onApply, onFormat, onClose }) {
  const lineNumbers = Array.from({ length: Math.max(1, text.split('\n').length) }, (_, index) => index + 1).join('\n');
  const gutterRef = useRef(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const updateCursor = event => {
    const before = text.slice(0, event.currentTarget.selectionStart);
    const lines = before.split('\n');
    setCursor({ line: lines.length, column: lines.at(-1).length + 1 });
  };
  return <div className="composer-code-view">
    <div className="composer-code-toolbar">
      <b>Protocol JSON</b>
      <span>{dirty ? '● Unapplied changes' : 'Edit the full protocol graph. Changes apply only after validation.'}</span>
      <button type="button" disabled={locked} onClick={onFormat}>Format JSON</button>
      <button disabled={locked} onClick={onApply}>Apply changes</button>
      <button type="button" onClick={onClose}>Close</button>
    </div>
    {error && <div className="composer-code-error">{error}</div>}
    <div className="composer-code-editor"><pre ref={gutterRef} aria-hidden="true">{lineNumbers}</pre><textarea disabled={locked} value={text} onChange={event => onChange(event.target.value)} onClick={updateCursor} onKeyUp={updateCursor} onScroll={event => { if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop; }} onKeyDown={event => { if (event.key !== 'Tab') return; event.preventDefault(); const start = event.currentTarget.selectionStart, end = event.currentTarget.selectionEnd; onChange(`${text.slice(0, start)}  ${text.slice(end)}`); requestAnimationFrame(() => { event.target.selectionStart = event.target.selectionEnd = start + 2; }); }} spellCheck={false} aria-label="Protocol JSON" /></div>
    <small className="composer-code-status">Ln {cursor.line}, Col {cursor.column} · {text.length.toLocaleString()} characters</small>
  </div>;
}

export function NodeInspector({ node, definition, variables, groups, mode, onUpdate, onAssignGroup, onCreateGroup, onEditParticipantUi, questionnaireLibrary, onLibraryChange, assets, resources, stimulusPools = [], dataOutputOptions }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);
  const currentGroup = groups.find(group => group.nodeIds.includes(node.id));
  const boundValueType = () => {
    if (node.component.type !== 'logic.condition') return null;
    const binding = node.bindings?.value;
    if (!binding) return null;
    if (binding.kind === 'variable') return variables.find(variable => variable.name === binding.variable)?.type || null;
    if (binding.kind === 'output') {
      const option = (dataOutputOptions || []).find(item => item.nodeId === binding.nodeId);
      const port = option?.ports.find(item => item.id === binding.portId);
      return ['number', 'boolean'].includes(port?.dataType) ? port.dataType : port?.dataType || null;
    }
    return null;
  };
  const renderOutputOptions = () => (dataOutputOptions || []).flatMap(option =>
    option.ports.map(port => <option key={`output:${option.nodeId}:${port.id}`} value={`output:${option.nodeId}:${port.id}`}>{option.label} · {port.label}{port.dataType ? ` (${port.dataType})` : ''}</option>));
  const renderVariableOptions = (withScope = false) => variables.map(variable =>
    <option key={`variable:${variable.name}`} value={`variable:${variable.name}`}>{variable.name} · {variable.type}{withScope ? ` / ${variable.scope}` : ''}</option>);

  const contentSpec = {
    'display.media': { elementType: 'Media', fields: [{ key: 'mediaType', label: 'Media type', type: 'select', options: ['image', 'audio', 'video'] }, { key: 'sourceUrl', label: 'Source URL', type: 'text' }, { key: 'assetId', label: 'Asset', type: 'asset' }] },
    'input.rating': { elementType: 'Input', fields: [{ key: 'min', label: 'Minimum', type: 'number' }, { key: 'max', label: 'Maximum', type: 'number' }, { key: 'required', label: 'Required', type: 'boolean' }] },
    'input.text': { elementType: 'Input', fields: [{ key: 'placeholder', label: 'Placeholder', type: 'text' }, { key: 'required', label: 'Required', type: 'boolean' }, { key: 'multiline', label: 'Multiline', type: 'boolean' }] },
  }[node.component.type] || null;
  const contentKeys = contentSpec ? new Set(contentSpec.fields.map(field => field.key)) : null;
  const usesStimulusPool = node.component.type === 'display.media' && Boolean(node.config?.stimulusPoolId);
  const visibleContentFields = usesStimulusPool
    ? contentSpec?.fields.filter(field => !['mediaType', 'sourceUrl', 'assetId'].includes(field.key))
    : contentSpec?.fields;

  const updateContentField = (key, value) => {
    if (!node.config?.ui || !contentSpec) return;
    const element = findUiElement(node.config.ui.root, contentSpec.elementType);
    if (!element) return;
    const ui = mapUiElement(node.config.ui, element.id, el => ({ ...el, props: { ...el.props, [key]: value } }));
    // Picking an asset also bakes its source URL into the node so local runs and the
    // inline preview render without a hosted resource resolver.
    const extra = {};
    if (key === 'assetId' && value) {
      const asset = (assets || []).find(item => (item.id || item.assetId) === value);
      if (asset?.sourceUrl) extra.sourceUrl = asset.sourceUrl;
    }
    onUpdate({ config: { ...node.config, ui, [key]: value, ...extra } });
  };

  const fieldGroups = [];
  const groupIndex = new Map();
  for (const field of definition?.editorFields || []) {
    if (contentKeys?.has(field.path)) continue;
    const group = field.group || 'General';
    if (!groupIndex.has(group)) { groupIndex.set(group, fieldGroups.length); fieldGroups.push([group, []]); }
    fieldGroups[groupIndex.get(group)][1].push(field);
  }

  const renderField = field => {
    if (field.showWhen && getPath(node.config, field.showWhen.path) !== field.showWhen.equals) return null;
    // Type-aware Expected value for conditions: follow the bound input variable's type
    // (protocol variable or upstream node output).
    if (node.component.type === 'logic.condition' && field.path === 'expected' && node.bindings?.value?.kind) {
      const boundType = boundValueType();
      const expected = node.config?.expected;
      if (boundType === 'number') {
        return <label key={field.path}>{field.label}<input type="number" value={typeof expected === 'number' ? expected : Number.isFinite(Number(expected)) ? Number(expected) : ''} onChange={event => onUpdate({ config: setPath(node.config, 'expected', event.target.value === '' ? '' : Number(event.target.value)) })} />{field.help && <small className="field-help">{field.help}</small>}</label>;
      }
      if (boundType === 'boolean') {
        const boolValue = String(expected) === 'true' ? 'true' : String(expected) === 'false' ? 'false' : '';
        return <label key={field.path}>{field.label}<select value={boolValue} onChange={event => onUpdate({ config: setPath(node.config, 'expected', event.target.value === '' ? null : event.target.value === 'true') })}><option value="">choose…</option><option value="true">true</option><option value="false">false</option></select>{field.help && <small className="field-help">{field.help}</small>}</label>;
      }
    }
    const value = getPath(node.config, field.path);
    const change = raw => {
      const nextValue = field.type === 'number' ? Number(raw) : field.type === 'boolean' ? Boolean(raw) : raw;
      const patch = setPath(node.config, field.path, nextValue);
      if (field.type === 'asset' && raw && field.path === 'assetId') {
        const asset = (assets || []).find(item => (item.id || item.assetId) === raw);
        if (asset?.sourceUrl) patch.sourceUrl = asset.sourceUrl;
      }
      onUpdate({ config: patch });
    };
    let control;
    if (field.type === 'textarea') {
      const isArrayValue = Array.isArray(value);
      control = <textarea value={isArrayValue ? serializeResponseOptions(value) : value ?? ''} onChange={event => change(isArrayValue ? parseResponseOptions(event.target.value) : event.target.value)} />;
    }
    else if (field.type === 'select') control = <select value={value ?? ''} onChange={event => change(event.target.value)}>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>;
    else if (field.type === 'color') control = <span className="color-field"><input type="color" value={toHexColor(value)} onChange={event => change(event.target.value)} /><input value={value ?? ''} onChange={event => change(event.target.value)} /></span>;
    else if (field.type === 'asset') control = <select value={value ?? ''} onChange={event => change(event.target.value || null)}><option value="">— none —</option>{(assets || []).map(asset => <option key={asset.id || asset.assetId} value={asset.id || asset.assetId}>{asset.name || asset.id}</option>)}</select>;
    else if (field.type === 'variable') control = <select value={value ?? ''} onChange={event => change(event.target.value)}><option value="">— choose —</option>{variables.map(variable => <option key={variable.name} value={variable.name}>{variable.name} · {variable.type}</option>)}</select>;
    else if (field.type === 'boolean') control = <input type="checkbox" checked={Boolean(value)} onChange={event => change(event.target.checked)} />;
    else control = <input type={field.type || 'text'} min={field.min} max={field.max} step={field.step} value={value ?? ''} onChange={event => change(event.target.value)} />;
    return <label key={field.path}>{field.label}{control}{field.help && <small className="field-help">{field.help}</small>}</label>;
  };

  const emptyHint = node.component.type === 'display.media' && !node.config?.sourceUrl && !node.config?.assetId && !node.config?.stimulusPoolId && !node.config?.stimulusPool?.enabled
    ? 'Add a source URL, pick an asset, or enable a stimulus pool below.'
    : node.component.type === 'input.questionnaire' && !node.config?.questionnaire?.questions?.length
      ? 'Open the Questionnaire editor to add questions.'
      : node.component.type === 'stimulus.custom-html' && !node.config?.html
        ? 'Paste an HTML fragment below.'
        : null;

  return <div className="inspector-card">
    <label>{t('Label')}<input value={node.label} onChange={event => onUpdate({ label: event.target.value })} /></label>
    <small>{node.component.type}@{node.component.version}</small>
    {emptyHint && <div className="node-empty-hint">▶ {emptyHint}</div>}
    {node.config?.ui && !['core.start', 'core.end', 'input.questionnaire', 'timing.wait'].includes(node.component.type) && <><div className="node-inline-preview"><ParticipantRenderer key={node.id} schema={schemaForNode(node, definition, resources || localResourceManifest(assets || []))} preview /></div><button type="button" className="edit-participant-ui" onClick={onEditParticipantUi}>Edit participant screen</button></>}
    {contentSpec && visibleContentFields.length > 0 && <div className="content-fields"><b>Content</b>{visibleContentFields.map(field => <ContentField key={field.key} field={field} value={node.config?.[field.key]} assets={assets} onChange={value => updateContentField(field.key, value)} invalid={field.key === 'sourceUrl' && Boolean(node.config?.sourceUrl) && !isValidMediaUrl(node.config.sourceUrl)} hint={field.key === 'sourceUrl' && Boolean(node.config?.sourceUrl) && !isValidMediaUrl(node.config.sourceUrl) ? 'Invalid URL — fix it or pick an asset instead.' : undefined} />)}</div>}
    {node.component.type === 'display.media' && mode !== 'quick' && <div className="content-fields stimulus-pool-fields">
      <b>Stimulus randomization</b>
      <label>Stimulus pool<select value={node.config?.stimulusPoolId || ''} onChange={event => { const pool = stimulusPools.find(item => item.id === event.target.value); onUpdate({ config: { ...node.config, stimulusPoolId: pool?.id || null, ...(pool?.mediaType ? { mediaType: pool.mediaType } : {}) } }); }}><option value="">— fixed stimulus —</option>{stimulusPools.map(pool => <option key={pool.id} value={pool.id}>{pool.name} ({pool.assetIds?.length || 0})</option>)}</select><small className="field-help">Choose a shared pool created in Design mode. Every session reshuffles its assets without changing the flow.</small></label>
    </div>}
    {fieldGroups.map(([group, fields], groupIndex) => <details key={group} className="field-group" open={group === 'General' || groupIndex === 0 || fieldGroups.length === 1}><summary>{group}</summary>{fields.map(renderField)}</details>)}
    {node.component.type === 'logic.condition' && <label>Input variable<select aria-label="Condition input variable" value={bindingValue(node.bindings?.value)} onChange={event => { const binding = parseBindingValue(event.target.value); onUpdate({ bindings: binding ? { ...node.bindings, value: binding } : Object.fromEntries(Object.entries(node.bindings || {}).filter(([key]) => key !== 'value')) }); }}>
      <option value="">Choose a variable…</option>
      <optgroup label="Protocol variables">{renderVariableOptions(true)}</optgroup>
      {(dataOutputOptions || []).length > 0 && <optgroup label="Node outputs (upstream)">{renderOutputOptions()}</optgroup>}
    </select></label>}
    {node.component.type === 'logic.condition' && <label>Compare with variable<select aria-label="Condition compare variable" value={bindingValue(node.bindings?.compare)} onChange={event => { const binding = parseBindingValue(event.target.value); onUpdate({ bindings: binding ? { ...node.bindings, compare: binding } : Object.fromEntries(Object.entries(node.bindings || {}).filter(([key]) => key !== 'compare')) }); }}>
      <option value="">— none (use Expected value) —</option>
      <optgroup label="Protocol variables">{renderVariableOptions(true)}</optgroup>
      {(dataOutputOptions || []).length > 0 && <optgroup label="Node outputs (upstream)">{renderOutputOptions()}</optgroup>}
    </select></label>}
    {node.component.type === 'logic.loop' && <label>Until variable<select aria-label="Loop until variable" value={bindingValue(node.bindings?.until)} onChange={event => { const binding = parseBindingValue(event.target.value); onUpdate({ bindings: binding ? { ...node.bindings, until: binding } : Object.fromEntries(Object.entries(node.bindings || {}).filter(([key]) => key !== 'until')) }); }}>
      <option value="">— none (iterate by maxIterations) —</option>
      <optgroup label="Protocol variables">{renderVariableOptions(true)}</optgroup>
      {(dataOutputOptions || []).length > 0 && <optgroup label="Node outputs (upstream)">{renderOutputOptions()}</optgroup>}
    </select></label>}
    {node.component.type === 'input.questionnaire' && <><QuestionnaireEditor value={node.config.questionnaire} onChange={questionnaire => onUpdate({ config: { ...node.config, questionnaire } })} library={questionnaireLibrary} onLibraryChange={onLibraryChange} /><details className="questionnaire-live-preview"><summary>Live participant preview · {language.toUpperCase()}</summary><QuestionnaireForm key={`${node.id}:${language}:${JSON.stringify(node.config.questionnaire)}`} questionnaire={node.config.questionnaire} language={language} randomSeed="editor-preview" onSubmit={() => {}} /></details></>}
    {node.component.type === 'experiment.cognitive-task' && <div className="cognitive-generate">
      <button type="button" onClick={() => {
        const kind = node.config?.taskKind === 'gonogo' ? 'gonogo' : 'stroop';
        const generator = kind === 'gonogo' ? generateGonogoTrials : generateStroopTrials;
        const trials = generator({ trials: kind === 'gonogo' ? 40 : 16, goRatio: Number(node.config?.goRatio ?? 70), seed: Number(node.config?.seed ?? 1), jitter: Number(node.config?.jitterMs ?? 0) });
        onUpdate({ config: { ...node.config, trials } });
      }}>Generate trials</button>
      <small>{node.config?.trials?.length || 0} trial(s) · {node.config?.taskKind || 'stroop'}</small>
    </div>}
    {mode !== 'quick' && node.config && <details className="advanced-fields"><summary>Analysis & recovery</summary>
      <label>Analysis role<select aria-label="Analysis role" value={node.config.analysisRole || ''} onChange={event => onUpdate({ config: { ...node.config, analysisRole: event.target.value } })}><option value="">none</option>{['baseline', 'stimulus', 'recovery', 'task', 'exclude', 'custom'].map(role => <option key={role} value={role}>{role}</option>)}</select></label>
      <label>Analysis label<input aria-label="Analysis label" value={node.config.analysisLabel || ''} onChange={event => onUpdate({ config: { ...node.config, analysisLabel: event.target.value } })} /></label>
      <label>Recovery after interruption<select aria-label="Recovery behavior" value={node.config.recoveryBehavior || ''} onChange={event => onUpdate({ config: { ...node.config, recoveryBehavior: event.target.value } })}><option value="">default</option>{['resume', 'restart', 'wait-operator'].map(behavior => <option key={behavior} value={behavior}>{behavior}</option>)}</select></label>
    </details>}
    {mode !== 'quick' && !['core.start', 'core.end'].includes(node.component.type) && <label>{t('Node group')}<select aria-label={t('Node group')} value={currentGroup?.id || ''} onChange={event => onAssignGroup(event.target.value || null)}><option value="">{t('No group')}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
    {mode !== 'quick' && !currentGroup && !['core.start', 'core.end'].includes(node.component.type) && <button onClick={onCreateGroup}>{t('Create group from node')}</button>}
    {mode !== 'quick' && definition?.events?.length > 0 && <details className="node-data-note"><summary>Records</summary>
      <small>Events: {definition.events.join(', ')}</small>
      {definition.dataFields?.length > 0 && <small>Data columns: {definition.dataFields.join(', ')}</small>}
    </details>}
    {mode === 'advanced' && <details className="field-group"><summary>Node raw data</summary><small>Node ID: <code>{node.id}</code></small><pre>{JSON.stringify(node, null, 2)}</pre></details>}
  </div>;
}

export function ContentField({ field, value, assets, onChange, invalid, hint }) {
  if (field.type === 'select') return <label className={invalid ? 'field-invalid' : undefined}>{field.label}<select value={value ?? ''} onChange={event => onChange(event.target.value)}>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>{invalid && hint && <small className="field-hint">{hint}</small>}</label>;
  if (field.type === 'asset') return <label>{field.label}<select value={value ?? ''} onChange={event => onChange(event.target.value || null)}><option value="">— none / direct URL —</option>{(assets || []).map(asset => <option key={asset.id || asset.assetId} value={asset.id || asset.assetId}>{asset.name || asset.id}</option>)}</select></label>;
  if (field.type === 'boolean') return <label className="checkbox-row"><input type="checkbox" checked={Boolean(value)} onChange={event => onChange(event.target.checked)} /> {field.label}</label>;
  return <label className={invalid ? 'field-invalid' : undefined}>{field.label}<input type={field.type || 'text'} value={value ?? ''} onChange={event => onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)} />{invalid && hint && <small className="field-hint">{hint}</small>}</label>;
}

export function toHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
}
export function groupDataPorts(group, nodes, direction, componentRegistry) {
  return group.nodeIds.flatMap(nodeId => {
    const node = nodes.find(item => item.id === nodeId);
    const definition = node && componentRegistry.get(node.component.type, node.component.version);
    return (definition?.ports || []).filter(port => port.kind === 'data' && port.direction === direction).map(port => ({ nodeId, portId: port.id, dataType: port.dataType, label: `${node.label} · ${port.label || port.id}` }));
  });
}

export function endpointValue(endpoint) {
  return endpoint ? `${endpoint.nodeId}::${endpoint.portId}` : '';
}

export function parseEndpoint(value) {
  const [nodeId, portId] = value.split('::');
  return nodeId && portId ? { nodeId, portId } : null;
}
