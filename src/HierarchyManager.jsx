import { useEffect, useRef, useState } from 'react';
import { block as createBlock, duplicateBlock, duplicateTrial, moveItem, trial as createTrial } from './domain.js';
import { ConfirmDialog, AlertDialog } from './Modal.jsx';

export default function HierarchyManager({ protocol, onChange, onClose, onSelect }) {
  const locked = protocol.status === 'frozen';
  const protoRef = useRef(protocol);
  useEffect(() => { protoRef.current = protocol; }, [protocol]);
  const [confirmState, setConfirm] = useState(null);
  const [alertState, setAlert] = useState(null);

  const commit = mutate => { if (locked) return; const next = structuredClone(protoRef.current); mutate(next); next.updated_at = new Date().toISOString(); onChange(next); };
  const updateBlock = (index, values) => commit(next => Object.assign(next.blocks[index], values));
  const addBlock = () => commit(next => next.blocks.push(createBlock()));
  const copyBlock = index => commit(next => next.blocks.splice(index + 1, 0, duplicateBlock(next.blocks[index])));

  const removeBlock = index => {
    if (protocol.blocks.length <= 1) { setAlert({ title: 'Cannot delete', message: 'A protocol must contain at least one Block.' }); return; }
    setConfirm({ title: 'Delete block?', message: `Delete Block "${protocol.blocks[index].name}" and all of its Trials?`, confirmLabel: 'Delete', danger: true, onConfirm: () => { commit(next => next.blocks.splice(index, 1)); setConfirm(null); }, onCancel: () => setConfirm(null) });
  };
  const moveBlock = (index, direction) => commit(next => { next.blocks = moveItem(next.blocks, index, direction); });
  const addTrial = blockIndex => commit(next => { const created = createTrial(); next.blocks[blockIndex].trials.push(created); onSelect(created.trial_id); });
  const copyTrial = (blockIndex, trialIndex) => commit(next => { const created = duplicateTrial(next.blocks[blockIndex].trials[trialIndex]); next.blocks[blockIndex].trials.splice(trialIndex + 1, 0, created); onSelect(created.trial_id); });

  const removeTrial = (blockIndex, trialIndex) => {
    const target = protocol.blocks[blockIndex];
    if (target.trials.length <= 1) { setAlert({ title: 'Cannot delete', message: 'Each Block must contain at least one Trial.' }); return; }
    setConfirm({ title: 'Delete trial?', message: `Delete Trial "${target.trials[trialIndex].name}"?`, confirmLabel: 'Delete', danger: true, onConfirm: () => { commit(next => next.blocks[blockIndex].trials.splice(trialIndex, 1)); setConfirm(null); }, onCancel: () => setConfirm(null) });
  };
  const moveTrial = (blockIndex, trialIndex, direction) => commit(next => { next.blocks[blockIndex].trials = moveItem(next.blocks[blockIndex].trials, trialIndex, direction); });
  const updateTrial = (blockIndex, trialIndex, values) => commit(next => Object.assign(next.blocks[blockIndex].trials[trialIndex], values));

  return <>
    <div className="resource-library-backdrop">
      <section className="resource-library hierarchy-manager">
        <header><div><span>EXPERIMENT STRUCTURE</span><h2>Blocks and Trials</h2></div><button onClick={onClose}>Close</button></header>
        <p>Arrange the experiment hierarchy here. The visual canvas remains responsible for the event flow inside each Trial.</p>
        <div className="hierarchy-list">
          {protocol.blocks.map((block, blockIndex) => (
            <article key={block.block_id}>
              <div className="hierarchy-block-head">
                <b>Block {blockIndex + 1}</b>
                <input value={block.name} disabled={locked} onChange={e => updateBlock(blockIndex, { name: e.target.value })} />
                <select value={block.order_rule} disabled={locked} onChange={e => updateBlock(blockIndex, { order_rule: e.target.value })}><option value="fixed">Fixed</option><option value="random">Random</option><option value="latin_square">Latin square</option><option value="manual">Manual</option></select>
                <label>Repeat<input type="number" min="0" value={block.repeat_count ?? 1} disabled={locked} onChange={e => updateBlock(blockIndex, { repeat_count: Number(e.target.value) })} /></label>
                <button disabled={locked || blockIndex === 0} onClick={() => moveBlock(blockIndex, -1)} title="Move up">↑</button>
                <button disabled={locked || blockIndex === protocol.blocks.length - 1} onClick={() => moveBlock(blockIndex, 1)} title="Move down">↓</button>
                <button disabled={locked} onClick={() => copyBlock(blockIndex)}>Duplicate</button>
                <button className="danger" disabled={locked} onClick={() => removeBlock(blockIndex)}>Delete</button>
              </div>
              <div className="hierarchy-trials">
                {block.trials.map((trial, trialIndex) => (
                  <div key={trial.trial_id}>
                    <button className="trial-open" onClick={() => { onSelect(trial.trial_id); onClose(); }} aria-label={`Go to trial ${trialIndex + 1}`}>{trialIndex + 1}</button>
                    <input value={trial.name} disabled={locked} onChange={e => updateTrial(blockIndex, trialIndex, { name: e.target.value })} />
                    <input value={trial.condition || ''} placeholder="Condition" disabled={locked} onChange={e => updateTrial(blockIndex, trialIndex, { condition: e.target.value })} />
                    <label>Repeat<input type="number" min="1" value={trial.repeat_count || 1} disabled={locked} onChange={e => updateTrial(blockIndex, trialIndex, { repeat_count: Number(e.target.value) })} /></label>
                    <button disabled={locked || trialIndex === 0} onClick={() => moveTrial(blockIndex, trialIndex, -1)} title="Move up">↑</button>
                    <button disabled={locked || trialIndex === block.trials.length - 1} onClick={() => moveTrial(blockIndex, trialIndex, 1)} title="Move down">↓</button>
                    <button disabled={locked} onClick={() => copyTrial(blockIndex, trialIndex)}>Duplicate</button>
                    <button className="danger" disabled={locked} onClick={() => removeTrial(blockIndex, trialIndex)}>Delete</button>
                  </div>
                ))}
              </div>
              <button disabled={locked} onClick={() => addTrial(blockIndex)}>＋ Add Trial</button>
            </article>
          ))}
        </div>
        <button className="primary" disabled={locked} onClick={addBlock}>＋ Add Block</button>
      </section>
    </div>
    {confirmState && <ConfirmDialog {...confirmState} />}
    {alertState && <AlertDialog {...alertState} onClose={() => setAlert(null)} />}
  </>;
}
