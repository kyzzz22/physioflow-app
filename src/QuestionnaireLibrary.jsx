import { useEffect, useRef, useState } from 'react';
import QuestionnaireDesigner, { createQuestionnaire } from './QuestionnaireDesigner.jsx';
import { ConfirmDialog, AlertDialog } from './Modal.jsx';

const duplicate = value => { const copy = structuredClone(value); copy.questionnaire_id = `questionnaire_${crypto.randomUUID()}`; copy.name = `${value.name} Copy`; copy.questions = (copy.questions || []).map(q => ({ ...q, question_id: `question_${crypto.randomUUID()}` })); return copy; };

export default function QuestionnaireLibrary({ protocol, onChange, onClose }) {
  const locked = protocol.status === 'frozen', items = protocol.questionnaires || [];
  const protoRef = useRef(protocol);
  useEffect(() => { protoRef.current = protocol; }, [protocol]);
  const [confirmState, setConfirm] = useState(null);
  const [alertState, setAlert] = useState(null);
  const commit = questionnaires => onChange({ ...protoRef.current, questionnaires, updated_at: new Date().toISOString() });
  const update = (index, value) => commit(items.map((item, i) => i === index ? value : item));

  const remove = index => {
    const target = items[index];
    const used = protocol.blocks.some(b => b.trials.some(t => t.steps.some(s => s.questionnaire_id === target.questionnaire_id && !s.questionnaire)));
    if (used) { setAlert({ title: 'Cannot delete', message: 'This shared questionnaire is still used by one or more nodes.' }); return; }
    setConfirm({ title: 'Delete questionnaire?', message: `Delete questionnaire "${target.name}"?`, confirmLabel: 'Delete', danger: true, onConfirm: () => { commit(items.filter((_, i) => i !== index)); setConfirm(null); }, onCancel: () => setConfirm(null) });
  };

  return <>
    <div className="resource-library-backdrop"><section className="resource-library questionnaire-library">
      <header><div><span>QUESTIONNAIRE LIBRARY</span><h2>Reusable questionnaires</h2></div><button onClick={onClose}>Close</button></header>
      <p>Create multilingual forms once and reference them from multiple questionnaire nodes. Editing a shared form updates every linked node in the current draft.</p>
      <div className="questionnaire-library-list">
        {items.map((item, index) => <article key={item.questionnaire_id}><QuestionnaireDesigner value={item} disabled={locked} onChange={value => update(index, value)} /><div><button disabled={locked} onClick={() => commit([...items.slice(0, index + 1), duplicate(item), ...items.slice(index + 1)])}>Duplicate</button><button className="danger" disabled={locked} onClick={() => remove(index)}>Delete</button></div></article>)}
        {!items.length && <div className="empty">No shared questionnaires yet. Node-local questionnaires remain available.</div>}
      </div>
      <button className="primary" disabled={locked} onClick={() => commit([...items, createQuestionnaire()])}>＋ Add questionnaire</button>
    </section></div>
    {confirmState && <ConfirmDialog {...confirmState} />}
    {alertState && <AlertDialog {...alertState} onClose={() => setAlert(null)} />}
  </>;
}
