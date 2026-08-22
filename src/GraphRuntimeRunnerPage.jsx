import { useEffect, useMemo, useRef, useState } from 'react';
import ParticipantRenderer from './ParticipantRenderer.jsx';
import { createCoreComponentRegistry, createUiElement, participantUiTemplate, protocolNameOf, protocolStatusOf, protocolVersionOf } from './core/index.js';
import {
  completeCurrentNode,
  createRuntimeState,
  pauseRuntime,
  restoreRuntime,
  resumeRuntime,
  retryCurrentNode,
  skipCurrentNode,
  snapshotRuntime,
  startRuntime,
} from './runtime/index.js';
import { clearCurrentRun, saveCurrentRun, saveSession } from './storage.js';
import { buildGraphSessionFiles } from './data/index.js';
import { downloadBundle } from './exporter.js';

const registry = createCoreComponentRegistry();

function runtimeServices() {
  return {
    idFactory: prefix => `${prefix}_${crypto.randomUUID()}`,
    clock: { now: () => { const epochMs = Date.now(); return { epochMs, monotonicMs: performance.now(), iso: new Date(epochMs).toISOString() }; } },
  };
}

function schemaForNode(node) {
  if (node.component.type === 'display.screen') return node.config?.ui || participantUiTemplate('instruction');
  if (node.component.type === 'display.media') {
    const schema = participantUiTemplate('media');
    const media = schema.root.children.find(element => element.type === 'Media');
    media.props = { ...media.props, mediaType: node.config?.mediaType || 'image', sourceUrl: node.config?.sourceUrl || '', assetId: node.config?.assetId || null };
    return schema;
  }
  if (node.component.type === 'input.rating') {
    const schema = participantUiTemplate('form');
    const input = schema.root.children.find(element => element.type === 'Input');
    input.props = { ...input.props, name: 'value', label: node.label, min: node.config?.min ?? 1, max: node.config?.max ?? 7, required: node.config?.required !== false };
    return schema;
  }
  if (node.component.type === 'input.text') {
    const schema = participantUiTemplate('form');
    const input = schema.root.children.find(element => element.type === 'Input');
    input.props = { ...input.props, name: 'value', label: node.label, inputType: node.config?.multiline ? 'textarea' : 'text', placeholder: node.config?.placeholder || '', required: Boolean(node.config?.required) };
    return schema;
  }
  const schema = participantUiTemplate('instruction');
  schema.root.children = [
    createUiElement('Text', { props: { text: node.label, variant: 'heading' } }),
    createUiElement('Progress', { props: { value: 0, max: Math.max(1, Number(node.config?.durationMs || 1000)), label: 'Please wait…' }, bindings: { value: 'timer.elapsedMs' } }),
  ];
  return schema;
}

export default function GraphRuntimeRunnerPage({ data, onDone }) {
  const protocol = data.protocol;
  const services = useRef(runtimeServices());
  const initialState = useMemo(() => data.restore?.runtime?.protocolSchemaVersion
    ? restoreRuntime(data.restore.runtime, protocol)
    : createRuntimeState(protocol, { sessionId: data.session.session_id, startedAtEpochMs: Date.now(), startedAtMonotonicMs: performance.now() }), [data.restore, data.session.session_id, protocol]);
  const [runtime, setRuntime] = useState(initialState);
  const [events, setEvents] = useState(data.restore?.events || []);
  const [responses, setResponses] = useState(data.restore?.responses || []);
  const [started, setStarted] = useState(Boolean(data.restore?.runtime?.status && data.restore.runtime.status !== 'ready'));
  const [saved, setSaved] = useState(false);
  const finishing = useRef(false);
  const nodes = useMemo(() => new Map(protocol.graph.nodes.map(node => [node.id, node])), [protocol]);
  const currentNode = runtime.currentNodeId ? nodes.get(runtime.currentNodeId) : null;
  const executableCount = protocol.graph.nodes.filter(node => !node.component.type.startsWith('core.') && !node.component.type.startsWith('logic.')).length;
  const progress = { current: runtime.completedNodeIds.length, total: executableCount, percent: executableCount ? Math.round((runtime.completedNodeIds.length / executableCount) * 100) : 100 };
  const exportFiles = runtime.status === 'completed' ? buildGraphSessionFiles({ ...data.session, status: 'completed', runtime_snapshot: runtime, events, responses }, protocol, events, responses) : null;

  const apply = result => {
    setRuntime(result.state);
    if (result.events?.length) setEvents(current => [...current, ...result.events]);
  };

  const begin = () => {
    setStarted(true);
    apply(startRuntime(runtime, protocol, registry, services.current));
  };

  const complete = result => {
    const values = result?.values || {};
    const rows = Object.entries(values).map(([name, value]) => ({
      responseId: `response_${crypto.randomUUID()}`,
      sessionId: data.session.session_id,
      participantId: data.session.participant_id,
      protocolId: protocol.protocolId,
      nodeId: currentNode.id,
      componentType: currentNode.component.type,
      name,
      value,
      timestampIso: new Date().toISOString(),
    }));
    if (rows.length) setResponses(current => [...current, ...rows]);
    apply(completeCurrentNode(runtime, protocol, registry, services.current, { outputs: result?.outputs || values, variables: result?.variables || values }));
  };

  useEffect(() => {
    if (!started || !currentNode || currentNode.component.type !== 'timing.wait' || runtime.status !== 'waiting') return undefined;
    const timer = setTimeout(() => complete({}), Math.max(0, Number(currentNode.config?.durationMs ?? 1000)));
    return () => clearTimeout(timer);
  }, [currentNode?.id, runtime.status, started]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!started || ['completed', 'failed'].includes(runtime.status)) return;
    saveCurrentRun({ session: data.session, protocol, runtime: snapshotRuntime(runtime), events, responses, saved_at: new Date().toISOString(), runtime_version: 2 });
  }, [data.session, events, protocol, responses, runtime, started]);

  useEffect(() => {
    if (runtime.status !== 'completed' || finishing.current) return;
    finishing.current = true;
    const finished = {
      ...data.session,
      protocol_id: protocol.protocolId,
      protocol_version: protocolVersionOf(protocol),
      protocol_name: protocolNameOf(protocol),
      run_mode: protocolStatusOf(protocol) === 'frozen' ? 'formal' : 'preview',
      status: 'completed',
      ended_at: new Date().toISOString(),
      event_count: events.length,
      protocol_snapshot: protocol,
      runtime_snapshot: runtime,
      events,
      responses,
      data_contract_version: '2.0.0-alpha.1',
    };
    saveSession(finished).then(() => clearCurrentRun()).then(() => setSaved(true)).catch(error => setSaved(error.message || 'Save failed'));
  }, [data.session, events, protocol, responses, runtime]);

  if (!started) return <main className="graph-runner"><div className="graph-runner-ready"><span className="eyebrow">RUNTIME V2 READY</span><h1>{protocolNameOf(protocol)}</h1><p>{data.session.participant_id} · {executableCount} participant components</p><button className="primary" onClick={begin}>Begin experiment</button></div></main>;
  if (runtime.status === 'completed') return <main className="graph-runner"><div className="graph-runner-ready"><span className="eyebrow">SESSION COMPLETE</span><h1>Thank you</h1><p>{events.length} events · {responses.length} responses · {Object.keys(exportFiles).length} export files</p><p>{saved === true ? 'Saved locally.' : typeof saved === 'string' ? saved : 'Saving…'}</p><button className="primary" onClick={() => downloadBundle(exportFiles, data.session.participant_id)}>Export complete data package</button><button disabled={saved !== true} onClick={onDone}>Return to projects</button></div></main>;
  if (runtime.status === 'failed') return <main className="graph-runner"><div className="graph-runner-ready"><span className="eyebrow">RUNTIME FAILED</span><h1>Experiment stopped</h1><p>{runtime.error}</p><button onClick={onDone}>Return to projects</button></div></main>;
  if (!currentNode) return null;

  return <main className="graph-runner">
    <div className="graph-operator" role="toolbar"><div><b>{protocolNameOf(protocol)}</b><span>{currentNode.label} · {currentNode.component.type}</span></div><div>{progress.current}/{progress.total} completed</div><div>
      <button onClick={() => apply(runtime.status === 'paused' ? resumeRuntime(runtime, protocol, services.current) : pauseRuntime(runtime, protocol, services.current))}>{runtime.status === 'paused' ? 'Resume' : 'Pause'}</button>
      <button disabled={runtime.status !== 'waiting'} onClick={() => apply(retryCurrentNode(runtime, protocol, services.current, 'operator retry'))}>Retry</button>
      <button disabled={runtime.status !== 'waiting'} onClick={() => apply(skipCurrentNode(runtime, protocol, registry, services.current, 'operator skip'))}>Skip</button>
    </div></div>
    <section className="graph-participant" aria-label="Participant view">
      {runtime.status === 'paused' && <div className="pause-overlay">Paused</div>}
      <ParticipantRenderer schema={schemaForNode(currentNode)} disabled={runtime.status === 'paused'} context={{ participant: data.session, variables: runtime.variables, outputs: runtime.outputs, progress, timer: { elapsedMs: 0 } }} onSubmit={complete} />
    </section>
  </main>;
}
