import { DarkModeToggle, LanguageToggle } from '../i18n';

export default function Header({ hasUnsaved, canUndo, canRedo, onUndo, onRedo, onSave, saveAnim, onGuide }) {
  return <header>
    <div className="brand"><span>PF</span> PhysioFlow{hasUnsaved && <small className="unsaved-dot">●</small>}</div>
    <div className="header-tools">
      <div className="local">● Local-first workspace</div>
      {onGuide && <button className="hint" onClick={() => onGuide('workflow')}>Help</button>}
      {onSave && <button className={`hint${saveAnim ? ' saved' : ''}`} onClick={onSave} title="Ctrl+S">{saveAnim ? '✓ Saved' : 'Save'}</button>}
      {canUndo !== undefined && <button className="hint" disabled={!canUndo} onClick={onUndo} title="Ctrl+Z">↩</button>}
      {canRedo !== undefined && <button className="hint" disabled={!canRedo} onClick={onRedo} title="Ctrl+Shift+Z">↪</button>}
      <DarkModeToggle />
      <LanguageToggle />
    </div>
  </header>;
}
