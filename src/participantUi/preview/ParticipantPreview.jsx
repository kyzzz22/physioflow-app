import ParticipantRenderer from '../../ParticipantRenderer.jsx';

export function ParticipantPreview({ schema }) {
  return <div className="ui-builder-preview"><ParticipantRenderer schema={schema} context={{ progress: { percent: 40 } }} preview /></div>;
}
