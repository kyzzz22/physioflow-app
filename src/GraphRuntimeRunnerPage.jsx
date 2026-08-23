import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ParticipantRenderer from './ParticipantRenderer.jsx';
import { createUiElement, participantUiTemplate, protocolNameOf, protocolStatusOf, protocolVersionOf } from './core/index.js';
import {
  completeCurrentNode,
  createCoreControlHandlerRegistry,
  createRuntimeState,
  pauseRuntime,
  recordRuntimeEvent,
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
import { createProjectComponentRegistry } from './sdk/index.js';
import { HostedRuntimeSync } from './hosted/index.js';

function runtimeServices() {
  return {
    idFactory: prefix => `${prefix}_${crypto.randomUUID()}`,
    clock: { now: () => { const epochMs = Date.now(); return { epochMs, monotonicMs: performance.now(), iso: new Date(epochMs).toISOString() }; } },
    controlHandlers: createCoreControlHandlerRegistry(),
  };
}

function findUiElement(element, type) {
  if (element?.type === type) return element;
  for (const child of element?.children || []) {
    const found = findUiElement(child, type);
    if (found) return found;
  }
  return null;
}

function packagePermissions(protocol, node) {
  const componentPackage = (protocol.componentPackages || []).find(item => item.components?.some(component => component.type === node.component.type && component.version === node.component.version));
  return componentPackage ? new Set(componentPackage.approvedPermissions || []) : null;
}

function schemaForNode(node, definition) {
  const adapter = definition?.runtime?.uiAdapter || 'schema';
  if (adapter === 'screen' || adapter === 'schema') return structuredClone(node.config?.ui || participantUiTemplate('instruction'));
  if (adapter === 'media') {
    const schema = structuredClone(node.config?.ui || participantUiTemplate('media'));
    const media = findUiElement(schema.root, 'Media');
    if (media) media.props = { ...media.props, mediaType: node.config?.mediaType || 'image', sourceUrl: node.config?.sourceUrl || '', assetId: node.config?.assetId || null };
    return schema;
  }
  if (adapter === 'rating') {
    const schema = structuredClone(node.config?.ui || participantUiTemplate('form'));
    const input = findUiElement(schema.root, 'Input');
    if (input) input.props = { ...input.props, name: 'value', label: node.label, min: node.config?.min ?? 1, max: node.config?.max ?? 7, required: node.config?.required !== false };
    return schema;
  }
  if (adapter === 'text') {
    const schema = structuredClone(node.config?.ui || participantUiTemplate('form'));
    const input = findUiElement(schema.root, 'Input');
    if (input) input.props = { ...input.props, name: 'value', label: node.label, inputType: node.config?.multiline ? 'textarea' : 'text', placeholder: node.config?.placeholder || '', required: Boolean(node.config?.required) };
    return schema;
  }
  if (adapter !== 'wait') return structuredClone(node.config?.ui || participantUiTemplate('instruction'));
  const schema = structuredClone(node.config?.ui || participantUiTemplate('instruction'));
  schema.root.children = [
    createUiElement('Text', { props: { text: node.label, variant: 'heading' } }),
    createUiElement('Progress', { props: { value: 0, max: Math.max(1, Number(node.config?.durationMs || 1000)), label: 'Please wait…' }, bindings: { value: 'timer.elapsedMs' } }),
  ];
  return schema;
}

export default function GraphRuntimeRunnerPage({ data, onDone }) {
  const protocol = data.protocol;
  const registry = useMemo(() => createProjectComponentRegistry(protocol), [protocol]);
  const services = useRef(runtimeServices());
  const initialState = useMemo(() => data.restore?.runtime?.protocolSchemaVersion
    ? restoreRuntime(data.restore.runtime, protocol)
    : createRuntimeState(protocol, { sessionId: data.session.session_id, startedAtEpochMs: Date.now(), startedAtMonotonicMs: performance.now() }), [data.restore, data.session.session_id, protocol]);
  const [runtime, setRuntime] = useState(initialState);
  const [events, setEvents] = useState(data.restore?.events || []);
  const [responses, setResponses] = useState(data.restore?.responses || []);
  const [started, setStarted] = useState(Boolean(data.restore?.runtime?.status && data.restore.runtime.status !== 'ready'));
  const [saved, setSaved] = useState(false);
  const hostedSyncRef = useRef(null);
  if (data.hosted && !hostedSyncRef.current) hostedSyncRef.current = new HostedRuntimeSync(data.hosted);
  const [hostedStatus, setHostedStatus] = useState(() => hostedSyncRef.current?.status() || null);
  const finishing = useRef(false);
  const runtimeRef = useRef(initialState);
  const nodeEnteredAt = useRef(performance.now());
  const nodes = useMemo(() => new Map(protocol.graph.nodes.map(node => [node.id, node])), [protocol]);
  const currentNode = runtime.currentNodeId ? nodes.get(runtime.currentNodeId) : null;
  const currentDefinition = currentNode ? registry.get(currentNode.component.type, currentNode.component.version) : null;
  const currentPermissions = currentNode ? packagePermissions(protocol, currentNode) : null;
  const executableCount = protocol.graph.nodes.filter(node => registry.get(node.component.type, node.component.version)?.runtime?.kind === 'participant').length;
  const progress = { current: runtime.completedNodeIds.length, total: executableCount, percent: executableCount ? Math.round((runtime.completedNodeIds.length / executableCount) * 100) : 100 };
  const exportFiles = runtime.status === 'completed' ? buildGraphSessionFiles({ ...data.session, status: 'completed', runtime_snapshot: runtime, events, responses }, protocol, events, responses) : null;

  const apply = result => {
    runtimeRef.current = result.state;
    setRuntime(result.state);
    if (result.events?.length) setEvents(current => [...current, ...result.events]);
  };

  const begin = () => {
    setStarted(true);
    apply(startRuntime(runtimeRef.current, protocol, registry, services.current));
  };

  const complete = result => {
    const activeRuntime = runtimeRef.current;
    const activeNode = activeRuntime.currentNodeId ? nodes.get(activeRuntime.currentNodeId) : null;
    if (!activeNode || activeRuntime.status !== 'waiting') return;
    const values = result?.values || {};
    const rows = Object.entries(values).map(([name, value]) => ({
      responseId: `response_${crypto.randomUUID()}`,
      sessionId: data.session.session_id,
      participantId: data.session.participant_id,
      protocolId: protocol.protocolId,
      nodeId: activeNode.id,
      componentType: activeNode.component.type,
      name,
      value,
      reactionTimeMs: Math.max(0, Math.round(performance.now() - nodeEnteredAt.current)),
      timestampIso: new Date().toISOString(),
    }));
    if (rows.length) setResponses(current => [...current, ...rows]);
    const submitted = rows.length
      ? recordRuntimeEvent(activeRuntime, protocol, services.current, 'response_submitted', { payload: { fields: rows.map(row => row.name), values, reactionTimeMs: rows[0].reactionTimeMs } })
      : { state: activeRuntime, events: [] };
    const requestedVariables = result?.variables || values;
    const completed = completeCurrentNode(submitted.state, protocol, registry, services.current, { outputs: result?.outputs || values, variables: currentPermissions && !currentPermissions.has('session.variables.write') ? {} : requestedVariables });
    apply({ state: completed.state, events: [...submitted.events, ...completed.events] });
  };

  const record = (eventType, payload) => {
    if (currentPermissions && eventType === 'ui_action' && !currentPermissions.has('events.emit')) return;
    apply(recordRuntimeEvent(runtimeRef.current, protocol, services.current, eventType, { payload }));
  };

  const syncHosted = useCallback(() => {
    if (!hostedSyncRef.current) return Promise.resolve(null);
    return hostedSyncRef.current.enqueue({ events, runtime, complete: ['completed', 'failed'].includes(runtime.status) })
      .then(status => { setHostedStatus(status); return status; })
      .catch(error => { setHostedStatus({ ...hostedSyncRef.current.status(), error: error.message || String(error) }); throw error; });
  }, [events, runtime]);

  useEffect(() => {
    if (currentNode?.id) nodeEnteredAt.current = performance.now();
  }, [currentNode?.id]);

  useEffect(() => {
    if (!started || !currentNode || runtime.status !== 'waiting') return undefined;
    const duration = currentDefinition?.runtime?.completion === 'durationMs'
      ? currentNode.config?.durationMs
      : currentNode.config?.completion?.mode === 'fixed' ? currentNode.config.completion.durationMs : null;
    if (duration === null || duration === undefined) return undefined;
    const timer = setTimeout(() => complete({}), Math.max(0, Number(duration)));
    return () => clearTimeout(timer);
  }, [currentNode?.id, runtime.status, started]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!started || ['completed', 'failed'].includes(runtime.status)) return;
    saveCurrentRun({ session: data.session, protocol, runtime: snapshotRuntime(runtime), events, responses, saved_at: new Date().toISOString(), runtime_version: 2 });
  }, [data.session, events, protocol, responses, runtime, started]);

  useEffect(() => {
    if (!started || !hostedSyncRef.current) return;
    syncHosted().catch(() => {});
  }, [started, syncHosted]);

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
  if (runtime.status === 'completed') {
    const hostedReady = !hostedSyncRef.current || hostedStatus?.completed;
    return <main className="graph-runner"><div className="graph-runner-ready"><span className="eyebrow">SESSION COMPLETE</span><h1>Thank you</h1><p>{events.length} events · {responses.length} responses · {Object.keys(exportFiles).length} export files</p><p>{saved === true ? 'Saved locally.' : typeof saved === 'string' ? saved : 'Saving…'}</p>{hostedSyncRef.current && <p>{hostedStatus?.completed ? `Hosted sync complete · revision ${hostedStatus.revision}` : hostedStatus?.error ? `Hosted sync failed: ${hostedStatus.error}` : 'Syncing hosted session…'}</p>}{hostedStatus?.error && <button onClick={() => syncHosted().catch(() => {})}>Retry hosted sync</button>}<button className="primary" onClick={() => downloadBundle(exportFiles, data.session.participant_id)}>Export complete data package</button><button disabled={saved !== true || !hostedReady} onClick={onDone}>Return to projects</button></div></main>;
  }
  if (runtime.status === 'failed') return <main className="graph-runner"><div className="graph-runner-ready"><span className="eyebrow">RUNTIME FAILED</span><h1>Experiment stopped</h1><p>{runtime.error}</p>{hostedSyncRef.current && <p>{hostedStatus?.completed ? `Hosted failure recorded · revision ${hostedStatus.revision}` : hostedStatus?.error ? `Hosted sync failed: ${hostedStatus.error}` : 'Recording hosted failure…'}</p>}{hostedStatus?.error && <button onClick={() => syncHosted().catch(() => {})}>Retry hosted sync</button>}<button disabled={Boolean(hostedSyncRef.current && !hostedStatus?.completed)} onClick={onDone}>Return to projects</button></div></main>;
  if (!currentNode) return null;

  return <main className="graph-runner">
    <div className="graph-operator" role="toolbar"><div><b>{protocolNameOf(protocol)}</b><span>{currentNode.label} · {currentNode.component.type}</span></div><div>{progress.current}/{progress.total} completed</div><div>
      <button onClick={() => apply(runtime.status === 'paused' ? resumeRuntime(runtimeRef.current, protocol, services.current) : pauseRuntime(runtimeRef.current, protocol, services.current))}>{runtime.status === 'paused' ? 'Resume' : 'Pause'}</button>
      <button disabled={runtime.status !== 'waiting'} onClick={() => apply(retryCurrentNode(runtimeRef.current, protocol, services.current, 'operator retry'))}>Retry</button>
      <button disabled={runtime.status !== 'waiting'} onClick={() => apply(skipCurrentNode(runtimeRef.current, protocol, registry, services.current, 'operator skip'))}>Skip</button>
    </div></div>
    <section className="graph-participant" aria-label="Participant view">
      {runtime.status === 'paused' && <div className="pause-overlay">Paused</div>}
      <ParticipantRenderer key={currentNode.id} schema={schemaForNode(currentNode, currentDefinition)} disabled={runtime.status === 'paused'} context={{ participant: data.session, variables: currentPermissions && !currentPermissions.has('session.variables.read') ? {} : runtime.variables, outputs: runtime.outputs, progress, timer: { elapsedMs: 0 } }} onSubmit={complete} onValueChange={payload => record('value_changed', payload)} onAction={action => record('ui_action', action)} onMediaEvent={(eventType, payload) => {
        record(eventType, payload);
        if (eventType === 'media_ended' && currentNode.config?.completion?.mode === 'media-ended') complete({});
      }} />
    </section>
  </main>;
}
