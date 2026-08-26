import { createUiElement, insertUiElement, moveUiElement } from '../../core/index.js';
import { CONTAINERS, defaults } from '../constants.js';
import { elementLabel, findInTree } from '../tree.js';
import { UiIcon } from '../UiIcon.jsx';

export function StructureTree({ s }) {
  const { elements, isHidden, dragOver, setDragOver, normalized, selectedId, collapsed, toggleCollapse, selectElement, commit, setCollapsed } = s;
  return <div className="ui-tree">
    {elements.filter(entry => !isHidden(entry)).map(entry => {
      const { element, depth } = entry;
      const hasChildren = (element.children || []).length > 0;
      const isDropBefore = dragOver?.where === 'before' && dragOver.parentId === entry.parentId && dragOver.index === entry.childIndex;
      const isDropAfter = dragOver?.where === 'after' && dragOver.parentId === entry.parentId && dragOver.index === entry.childIndex + 1;
      const isDropInside = dragOver?.where === 'inside' && dragOver.parentId === element.id;
      return <div key={element.id} data-ui-id={element.id} className={`ui-row${isDropBefore ? ' drop-before' : ''}${isDropAfter ? ' drop-after' : ''}${isDropInside ? ' drop-inside' : ''}`}
        draggable={element.id !== normalized.root.id}
        onDragStart={event => {
          if (element.id === normalized.root.id) return;
          event.dataTransfer.setData('application/x-physioflow-ui', JSON.stringify({ action: 'move', elementId: element.id }));
          event.dataTransfer.effectAllowed = 'move';
          selectElement(element.id);
        }}
        onDragOver={event => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const y = event.clientY - rect.top;
          const h = rect.height || 1;
          if (element.id === normalized.root.id) {
            // Root row: drop means appending to the end of the top-level list.
            setDragOver({ parentId: normalized.root.id, index: -1, where: 'inside' });
            return;
          }
          if (CONTAINERS.has(element.type) && y > h / 3 && y < (h * 2) / 3) {
            // Middle of a container row: nest the dragged element inside it.
            setDragOver({ parentId: element.id, index: -1, where: 'inside' });
          } else {
            const before = y < h / 2;
            setDragOver({ parentId: entry.parentId, index: before ? entry.childIndex : entry.childIndex + 1, where: before ? 'before' : 'after' });
          }
        }}
        onDrop={event => {
          event.preventDefault();
          const raw = event.dataTransfer.getData('application/x-physioflow-ui');
          setDragOver(null);
          if (!raw || !dragOver) return;
          try {
            const payload = JSON.parse(raw);
            const dropIndex = dragOver.where === 'inside' && dragOver.index === -1
              ? (findInTree(normalized.root, dragOver.parentId)?.children?.length ?? 0)
              : dragOver.index;
            if (payload.action === 'add' && payload.type) {
              const elementToAdd = createUiElement(payload.type, { props: defaults[payload.type], actions: payload.type === 'Button' ? [{ event: 'click', action: 'submit' }] : [] });
              commit(insertUiElement(normalized, dragOver.parentId, dropIndex, elementToAdd));
              setSelectedId(elementToAdd.id);
            } else if (payload.action === 'move' && payload.elementId) {
              commit(moveUiElement(normalized, payload.elementId, dragOver.parentId, dropIndex));
              if (dragOver.where === 'inside' && dragOver.parentId !== normalized.root.id) {
                setCollapsed(prev => { const next = new Set(prev); next.delete(dragOver.parentId); return next; });
              }
            }
          } catch (err) { console.error('[tree-drop-error]', err && err.message); }
        }}
        onDragLeave={() => setDragOver(null)}>
        <button className={`ui-tree-node${selectedId === element.id ? ' selected' : ''}`} style={{ paddingLeft: 8 + depth * 20 }} onClick={() => selectElement(element.id)}>
          {hasChildren
            ? <span className="ui-tree-toggle" onClick={event => { event.stopPropagation(); toggleCollapse(element.id); }}>{collapsed.has(element.id) ? '▸' : '▾'}</span>
            : <span className="ui-tree-toggle is-empty" />}
          <UiIcon name={element.type} />
          <span>{element.type}</span><small>{elementLabel(element)}</small>
        </button>
      </div>;
    })}
  </div>;
}
