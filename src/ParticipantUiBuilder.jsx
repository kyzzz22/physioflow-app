import ParticipantUiCanvas from './ParticipantUiCanvas.jsx';
import { mapUiElement, participantUiTemplate } from './core/index.js';
import { DEVICES, LIBRARY_GROUPS, TEMPLATE_KINDS, TYPE_HINTS } from './participantUi/constants.js';
import { ThemeEditor } from './participantUi/ThemeEditor.jsx';
import { StyleEditor } from './participantUi/StyleEditor.jsx';
import { UiPropertyEditor } from './participantUi/UiPropertyEditor.jsx';
import { UiIcon } from './participantUi/UiIcon.jsx';
import { StructureTree } from './participantUi/tree/StructureTree.jsx';
import { ParticipantPreview } from './participantUi/preview/ParticipantPreview.jsx';
import { useParticipantUiState } from './participantUi/useParticipantUiState.js';

export default function ParticipantUiBuilder({ schema, onChange, defaultTemplate }) {
  const s = useParticipantUiState({ schema, onChange, defaultTemplate });
  const {
    normalized, theme, commit, canUndo, canRedo, undo, redo,
    templateKind, setTemplateKind, selectElement,
    deviceId, setDeviceId, viewportCenter, zoomAt, zoom, fitView, resetView,
    snapEnabled, setSnapEnabled, preview, setPreview, structureOpen, setStructureOpen,
    addToRoot, viewportRef, handleViewportPointerDown, closeContextMenu,
    pan, panRef, deviceWidth,
    selectedId, selectedIds, dropElement, moveElement, moveElements, removeElement,
    duplicateElementById, moveStep, resizeElement, updateText, updateProp,
    openContextMenu, removeSelected, duplicateSelected, alignSelected,
    marquee, contextMenu, elements, copySelected, pasteClipboard, clipboardRef,
    zOrderSelected, focusStyle, selected, crumbs, updateProps, toggleFree,
    showPosition, setStyle, styleForceOpen, bindingTarget, validation,
  } = s;
  return <section className="participant-ui-builder">
    <div className="ui-builder-toolbar">
      <b className="ui-builder-title">Participant interface</b>
      <select aria-label="Template" value={templateKind} onChange={event => { const next = participantUiTemplate(event.target.value); setTemplateKind(event.target.value); commit(next); selectElement(next.root.id); }}>
        {TEMPLATE_KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
      </select>
      <button onClick={() => { const next = participantUiTemplate(templateKind); commit(next); selectElement(next.root.id); }}>Reset template</button>
      <span className="ui-toolbar-sep" />
      <button className="ui-history-btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">↶</button>
      <button className="ui-history-btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">↷</button>
      <span className="ui-toolbar-sep" />
      <div className="ui-device-switch" role="group" aria-label="Canvas width">
        {DEVICES.map(device => <button key={device.id} type="button" className={deviceId === device.id ? 'active' : ''} onClick={() => setDeviceId(device.id)}>{device.label}</button>)}
      </div>
      <span className="ui-toolbar-sep" />
      <div className="ui-zoom-controls" role="group" aria-label="Canvas zoom">
        <button type="button" onClick={() => { const c = viewportCenter(); zoomAt(c.x, c.y, 0.9); }} title="Zoom out (Ctrl+wheel)">−</button>
        <span className="ui-zoom-value">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => { const c = viewportCenter(); zoomAt(c.x, c.y, 1.1); }} title="Zoom in (Ctrl+wheel)">+</button>
        <button type="button" onClick={fitView} title="Fit to view">Fit</button>
        <button type="button" onClick={resetView} title="Reset to 100%">1:1</button>
      </div>
      <label className="ui-snap-toggle" title="Snap to 8px grid while dragging"><input type="checkbox" checked={snapEnabled} onChange={event => setSnapEnabled(event.target.checked)} /> Snap</label>
      <button onClick={() => setPreview(value => !value)}>{preview ? 'Edit' : 'Preview'}</button>
      <button onClick={() => setStructureOpen(value => !value)}>Structure</button>
      <ThemeEditor schema={normalized} theme={theme} onChange={commit} />
    </div>

    {preview ? <ParticipantPreview schema={normalized} />
      : <div className="ui-canvas-layout">
        <div className="ui-element-library">
          <b className="ui-library-title">Elements</b>
          {LIBRARY_GROUPS.map(group => <div key={group.label} className="ui-library-group">
            <span className="ui-library-label">{group.label}</span>
            {group.types.map(type => (
              <div key={type} className="ui-library-block" draggable
                onClick={() => addToRoot(type)}
                onDragStart={event => {
                  event.dataTransfer.setData('application/x-physioflow-ui', JSON.stringify({ action: 'add', type }));
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                title={TYPE_HINTS[type]}>
                <UiIcon name={type} />
                <span className="ui-library-name">{type}</span>
                <small>{TYPE_HINTS[type]}</small>
              </div>
            ))}
          </div>)}
          <small className="ui-library-tip">Click to append · drag onto canvas · Del to remove</small>
        </div>
        <div className="ui-canvas-wrap" ref={viewportRef} onPointerDown={handleViewportPointerDown} onContextMenu={event => { if (event.target === event.currentTarget || !event.target.closest('[data-ui-id]')) closeContextMenu(); }}>
          <div className="ui-canvas-pan" ref={panRef} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            <div className="ui-canvas-device" style={deviceWidth ? { maxWidth: deviceWidth } : undefined}>
              <ParticipantUiCanvas schema={normalized} selectedId={selectedId} selectedIds={selectedIds} zoom={zoom} snapEnabled={snapEnabled}
                onSelect={selectElement} onDropElement={dropElement} onMoveElement={moveElement} onMoveElements={moveElements}
                onRemoveElement={removeElement} onDuplicateElement={duplicateElementById} onMoveStep={moveStep} onResizeElement={resizeElement}
                onUpdateText={updateText} onUpdateProp={updateProp} onContextMenu={openContextMenu} onRemoveSelected={removeSelected} onDuplicateSelected={duplicateSelected} onAlignSelected={alignSelected} />
            </div>
          </div>
          {marquee && <div className="ui-marquee" style={{ left: Math.min(marquee.x0, marquee.x1) * zoom + pan.x, top: Math.min(marquee.y0, marquee.y1) * zoom + pan.y, width: Math.abs(marquee.x1 - marquee.x0) * zoom, height: Math.abs(marquee.y1 - marquee.y0) * zoom }} />}
          {contextMenu && (() => {
            const menuElement = elements.find(item => item.element.id === contextMenu.elementId)?.element;
            return <div className="ui-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
              <b>{menuElement?.type || 'Element'}</b>
              <button type="button" onClick={() => { duplicateElementById(contextMenu.elementId); closeContextMenu(); }}>Duplicate</button>
              <button type="button" onClick={() => { copySelected(); closeContextMenu(); }}>Copy</button>
              <button type="button" disabled={!clipboardRef.current} onClick={() => { pasteClipboard(); closeContextMenu(); }}>Paste</button>
              <button type="button" onClick={() => { moveStep(contextMenu.elementId, -1); closeContextMenu(); }}>Move up</button>
              <button type="button" onClick={() => { moveStep(contextMenu.elementId, 1); closeContextMenu(); }}>Move down</button>
              <button type="button" onClick={() => { zOrderSelected('front', [contextMenu.elementId]); closeContextMenu(); }}>Bring to front</button>
              <button type="button" onClick={() => { zOrderSelected('back', [contextMenu.elementId]); closeContextMenu(); }}>Send to back</button>
              <button type="button" onClick={() => { focusStyle(contextMenu.elementId); closeContextMenu(); }}>Edit style</button>
              <button type="button" className="danger" onClick={() => { removeElement(contextMenu.elementId); closeContextMenu(); }}>Delete</button>
            </div>;
          })()}
        </div>
        <aside className="ui-inspector">
          <div className="ui-inspector-head">
            <UiIcon name={selected.type} />
            <span className="ui-inspector-name">
              <b>{selected.type}</b>
              {crumbs.length > 1 && <small>{crumbs.slice(0, -1).map(item => item.type).join(' / ')}</small>}
            </span>
            {selected.id !== normalized.root.id && <div className="ui-inspector-actions">
              <button title="Duplicate (Ctrl+D)" onClick={duplicateSelected}>⧉</button>
              <button className="danger" title="Delete (Del)" onClick={removeSelected}>×</button>
            </div>}
          </div>
          <UiPropertyEditor element={selected} onUpdate={updateProps} onToggleFree={toggleFree} />
          {showPosition && <div className="ui-property-grid"><b>Position</b>
            <label>X<input type="number" value={selected.props?.x ?? 0} onChange={event => updateProps({ x: Number(event.target.value) })} /></label>
            <label>Y<input type="number" value={selected.props?.y ?? 0} onChange={event => updateProps({ y: Number(event.target.value) })} /></label>
            <label>Width<input type="number" value={selected.props?.width ?? ''} placeholder="auto" onChange={event => updateProps({ width: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
            <label>Height<input type="number" value={selected.props?.height ?? ''} placeholder="auto" onChange={event => updateProps({ height: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
          </div>}
          <StyleEditor element={selected} theme={theme} onSetStyle={setStyle} forceOpen={styleForceOpen} onToggle={open => { if (!open) s.setStyleForceOpen(false); }} />
          {bindingTarget && <label className="ui-binding-field">Runtime binding for {bindingTarget}<input value={selected.bindings?.[bindingTarget] || ''} placeholder="e.g. variables.score" onChange={event => commit(mapUiElement(normalized, selected.id, element => ({ ...element, bindings: { ...element.bindings, [bindingTarget]: event.target.value } })))} /></label>}
          {selected.type === 'Button' && <div className="ui-property-grid">
            <label>Click action<select value={selected.actions?.[0]?.action || 'submit'} onChange={event => commit(mapUiElement(normalized, selected.id, element => ({ ...element, actions: [{ ...(element.actions?.[0] || { event: 'click' }), action: event.target.value }] })))}><option value="submit">submit</option><option value="next">next</option><option value="setVariable">setVariable</option></select></label>
            {selected.actions?.[0]?.action === 'setVariable' && <><label>Variable name<input value={selected.actions[0].name || ''} onChange={event => commit(mapUiElement(normalized, selected.id, element => ({ ...element, actions: [{ ...element.actions[0], name: event.target.value }] })))} /></label><label>Value<input value={selected.actions[0].value ?? ''} onChange={event => commit(mapUiElement(normalized, selected.id, element => ({ ...element, actions: [{ ...element.actions[0], value: event.target.value }] })))} /></label></>}
          </div>}
        </aside>
      </div>}

    {structureOpen && <StructureTree s={s} />}

    <small className={validation.valid ? 'ui-valid' : 'ui-invalid'}>{validation.valid ? `${elements.length} elements · schema valid` : validation.errors[0]?.message}</small>
  </section>;
}
