import { memo } from 'react';
import { stepContentIssues } from '../domain';
import { NodeGlyph, nodeBadgeStyle } from '../flowIcons.jsx';
import { useT } from '../i18n.jsx';
import { branchesFor } from './layout.js';

// Memoized node card so that drag/pan/selection updates only re-render
// affected nodes instead of the whole 500-node canvas on every frame.
function NodeCard({
  node,
  step,
  isSelected,
  isDimmed,
  isDragging,
  isDisabled,
  disabled,
  stimuli,
  questionnaires,
  isAwaitingConnection,
  activeBranch,
  onPointerDown,
  onClick,
  onDoubleClick,
  onContextMenu,
  onPortPointerDown,
  onInputClick,
  onPreview,
  onDuplicate,
  onDelete,
}) {
  const t = useT();
  const nodeIssues = node.type === 'event' && step && !disabled ? stepContentIssues(step, stimuli, questionnaires) : [];
  const hasError = nodeIssues.some(i => i.kind === 'error');
  const hasWarn = !hasError && nodeIssues.some(i => i.kind === 'warn');
  const highlightStyle = isDimmed ? { opacity: 0.15 } : {};

  // Sticky note node
  if (node.type === 'note') {
    return <div className={`clean-node note ${isSelected ? 'selected' : ''}`} data-node-id={node.id}
      style={{ left: node.x, top: node.y, pointerEvents: 'auto', background: node.color || '#fff9c4', width: node.width || 180, minWidth: node.width || 180, maxWidth: node.width || 180, height: node.height || 100, minHeight: node.height || 100, ...highlightStyle }}
      onPointerDown={e => onPointerDown(e, node)}
      onClick={e => onClick(e, node)}
    >
      <div className="sticky-content" style={{ padding: '8px 12px', fontSize: '13px', color: '#333', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: '"Comic Sans MS", "Marker Felt", cursive', height: '100%', overflow: 'hidden' }}>
        {node.content || node.label || 'Note'}
      </div>
    </div>;
  }

  // Junction node
  if (node.type === 'junction') {
    return <div className={`clean-node junction ${isSelected ? 'selected' : ''}`} data-node-id={node.id}
      style={{ left: node.x, top: node.y, pointerEvents: 'auto', ...highlightStyle }}
      onPointerDown={e => onPointerDown(e, node)}
      onClick={e => onClick(e, node)}
    >
      <button className="node-input" title="Connect a wire to here" onClick={e => onInputClick(e, node)} />
      <div className="junction-dot" />
      <div className="node-outputs">{branchesFor(node).map(branch => <button key={branch} onPointerDown={e => onPortPointerDown(e, node, branch)} title={`Drag from ${branch} port`}>{branch}<i /></button>)}</div>
    </div>;
  }

  // Standard node
  const ruleText = node.type === 'condition' && node.rule?.variable
    ? `if ${node.rule.variable} ${node.rule.operator || '='} ${node.rule.value || ''}`.trim()
    : node.type === 'loop'
    ? `repeat ≤ ${node.max_iterations ?? 1}×` + (node.rule?.variable ? ` while ${node.rule.variable}` : '')
    : '';

  return (
    <div className={`clean-node ${node.type} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDisabled ? 'disabled' : ''}`}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y, pointerEvents: 'auto', ...(node.color ? { borderColor: node.color } : {}), ...highlightStyle }}
      onPointerDown={e => onPointerDown(e, node)}
      onClick={e => onClick(e, node)}
      onDoubleClick={e => onDoubleClick(e, node)}
      onContextMenu={e => onContextMenu(e, node)}
    >
      {!['start', 'end'].includes(node.type) && <button className={`node-input ${isAwaitingConnection ? 'awaiting' : ''}`} title="Connect a wire to here" onClick={e => onInputClick(e, node)} />}
      {!['start', 'end'].includes(node.type) && (
        <div className="node-hover-actions" onClick={e => e.stopPropagation()}>
          {node.type === 'event' && step && (
            <button title={t('Preview (double-click)')} onClick={e => onPreview(e, node)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></svg>
            </button>
          )}
          <button title={t('Duplicate (⌘D)')} onClick={e => onDuplicate(e, node)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
          </button>
          <button className="danger" title={t('Delete')} onClick={e => onDelete(e, node)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
          </button>
        </div>
      )}
      <div className="node-title">
        <i style={nodeBadgeStyle(node.type)}><NodeGlyph type={node.type} /></i>
        <div><small>{node.type}</small><b>{node.label}</b></div>
      </div>
      {ruleText && <div className="rule-caption" title={ruleText}>{ruleText}</div>}
      {node.type === 'event' && <span className="event-kind">
        <span className="step-type-badge">{step?.type}</span>
        {hasError && <span className="node-issue-dot error" title={nodeIssues.filter(i => i.kind === 'error').map(i => i.message).join('; ')}>!</span>}
        {hasWarn && <span className="node-issue-dot warn" title={nodeIssues.map(i => i.message).join('; ')}>△</span>}
      </span>}
      {branchesFor(node).length > 0 && <div className="node-outputs">
        {branchesFor(node).map(branch => <button className={activeBranch === branch ? 'active' : ''} key={branch} onPointerDown={e => onPortPointerDown(e, node, branch)} title={`${branch} → drag to connect`}>{branch}<i className={`branch-${branch}`} /></button>)}
      </div>}
    </div>
  );
}

export default memo(NodeCard);
