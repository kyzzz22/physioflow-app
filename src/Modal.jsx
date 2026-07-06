import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Shared focus trap & ESC handling
function useModalFocus(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    if (el) {
      const focusable = el.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length) focusable[0].focus();
    }
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const focusable = el.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      if (prev && prev.focus) prev.focus();
    };
  }, [onClose]);
  return ref;
}

export function Modal({ open = true, onClose, children }) {
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div className="modal-panel">
        {children}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({ open = true, title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel }) {
  const ref = useModalFocus(() => onCancel?.());
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }} role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="modal-panel modal-confirm" ref={ref}>
        <span className="modal-icon">{danger ? '⚠' : '?'}</span>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button className={danger ? 'danger' : 'primary'} onClick={onConfirm} autoFocus={danger}>{confirmLabel}</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function AlertDialog({ open = true, title, message, onClose }) {
  const ref = useModalFocus(() => onClose?.());
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }} role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="modal-panel modal-alert" ref={ref}>
        <span className="modal-icon">i</span>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="primary" onClick={onClose} autoFocus>OK</button>
        </div>
      </div>,
    </div>,
    document.body
  );
}

export function PromptDialog({ open = true, title, message, placeholder, defaultValue = '', onSubmit, onCancel }) {
  const ref = useModalFocus(() => onCancel?.());
  const [value, setValue] = useState(defaultValue);
  useEffect(() => { setValue(defaultValue); }, [open, defaultValue]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-panel modal-prompt" ref={ref}>
        <h3>{title}</h3>
        {message && <p>{message}</p>}
        <input
          value={value}
          placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); value.trim() && onSubmit(value.trim()); } }}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="modal-actions">
          <button className="primary" disabled={!value.trim()} onClick={() => onSubmit(value.trim())}>OK</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>,
    </div>,
    document.body
  );
}
