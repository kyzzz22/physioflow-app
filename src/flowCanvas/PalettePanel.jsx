import { useMemo } from 'react';
import { FLOW_PRESETS, PALETTE } from '../constants.js';

export default function PalettePanel({ search, onSearchChange, onCloseSearch, disabled, paletteSize, addPreset, addEvent, addLogic, addNote, addJunction, onPalettePresetDragStart, onPaletteDragStart, t, NodeGlyph, nodeBadgeStyle }) {
  const query = search.trim().toLowerCase();
  const filteredPalette = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return PALETTE;
    return PALETTE.map(group => ({ ...group, items: group.items.filter(([type, , label]) => type.toLowerCase().includes(q) || label.toLowerCase().includes(q)) })).filter(group => group.items.length > 0);
  }, [search]);
  const flowControlMatches = ['condition', 'loop'].some(t => t.includes(query));
  const utilControlMatches = ['note', 'junction'].some(t => t.includes(query));
  return (
    <aside className="studio-palette">
      <div className="studio-brand"><span>＋</span><div><b>Add to flow</b><small>Drag nodes to arrange</small></div></div>
      <div className="palette-search"><input value={search} placeholder={t('Search steps…')} onChange={e => onSearchChange(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onCloseSearch(); }} /></div>
      {!query && <section><h4>Presets</h4><div className="palette-grid">{FLOW_PRESETS.map(p => <button key={p.id} className="palette-card" draggable={!disabled} onDragStart={e => onPalettePresetDragStart(e, p.id)} disabled={disabled} onClick={() => addPreset(p, 260, 140 + paletteSize * 24)} title={t(p.description)}><i className="preset-glyph">{p.glyph}</i><span>{p.label}</span></button>)}</div></section>}
      {filteredPalette.length === 0 && <p className="palette-empty">{t('No steps match')} “{search}”</p>}
      {filteredPalette.map(group => <section key={group.title}><h4>{group.title}</h4><div className="palette-grid">{group.items.map(([type, , label]) => <button key={type} className="palette-card" draggable={!disabled} onDragStart={e => onPaletteDragStart(e, type)} disabled={disabled} onClick={() => addEvent(type)} title={t('Drag to canvas, or click to add')}><i style={nodeBadgeStyle(type)}><NodeGlyph type={type} /></i><span>{label}</span></button>)}</div></section>)}
      {(!query || flowControlMatches) && <section><h4>Flow</h4><div className="palette-grid"><button className="palette-card" draggable={!disabled} onDragStart={e => onPaletteDragStart(e, 'condition')} disabled={disabled} onClick={() => addLogic('condition')}><i style={nodeBadgeStyle('condition')}><NodeGlyph type="condition" /></i><span>Condition</span></button><button className="palette-card" draggable={!disabled} onDragStart={e => onPaletteDragStart(e, 'loop')} disabled={disabled} onClick={() => addLogic('loop')}><i style={nodeBadgeStyle('loop')}><NodeGlyph type="loop" /></i><span>Loop</span></button></div></section>}
      {(!query || utilControlMatches) && <section><h4>Utils</h4><div className="palette-grid"><button className="palette-card" draggable={!disabled} onDragStart={e => onPaletteDragStart(e, 'note')} disabled={disabled} onClick={addNote}><i style={nodeBadgeStyle('note')}><NodeGlyph type="note" /></i><span>Note</span></button><button className="palette-card" draggable={!disabled} onDragStart={e => onPaletteDragStart(e, 'junction')} disabled={disabled} onClick={addJunction}><i style={nodeBadgeStyle('junction')}><NodeGlyph type="junction" /></i><span>Junction</span></button></div></section>}
    </aside>
  );
}
