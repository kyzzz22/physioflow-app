const SHORTCUT_ROWS = [
  ['Ctrl+C/V/D', 'Copy / Paste / Duplicate'], ['Ctrl+A', 'Select all'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'], ['Ctrl+F', 'Search nodes'],
  ['Del', 'Delete selected'], ['Shift+Click', 'Toggle selection'],
  ['Double-click node', 'Preview step full-size'], ['Drag output port', 'Connect nodes'], ['Space/Middle+Drag', 'Pan canvas'],
  ['Scroll', 'Zoom in/out'], ['Alt+Drag', 'Disable snap'], ['Escape', 'Cancel'],
];

export default function ShortcutsModal({ open, onClose }) {
  if (!open) return null;
  return <>
    <div className="guide-backdrop" style={{ zIndex: 150 }} onClick={onClose} />
    <div className="guide-panel" style={{ zIndex: 151, position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', maxWidth: '440px', maxHeight: '80vh' }}>
      <div className="guide-head"><div><span>SHORTCUTS</span></div><button onClick={onClose} style={{ width: 34, height: 34, fontSize: 22 }}>×</button></div>
      <div className="guide-content" style={{ padding: '12px 16px' }}>
        <div className="guide-table">
          {SHORTCUT_ROWS.map(([key, desc], i) => <div key={i}><code>{key}</code><span>{desc}</span></div>)}
        </div>
      </div>
    </div>
  </>;
}
