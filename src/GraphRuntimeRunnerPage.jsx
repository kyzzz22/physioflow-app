import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ParticipantRenderer from './ParticipantRenderer.jsx';
import QuestionnaireForm from './QuestionnaireFormV2.jsx';
import CognitiveTaskRunner from './CognitiveTaskRunner.jsx';
import AttentionCheckRunner from './AttentionCheckRunner.jsx';
import ResponseRunner from './ResponseRunner.jsx';
import CalibrationRunner from './CalibrationRunner.jsx';
import { protocolNameOf, protocolStatusOf, protocolVersionOf } from './core/index.js';
import {
  completeCurrentNode,
  createCoreControlHandlerRegistry,
  createDeviceSampler,
  createRuntimeState,
  maxInputSampleRateHz,
  pauseRuntime,
  recordRuntimeEvent,
  resolveDeviceConnector,
  restoreRuntime,
  resumeRuntime,
  retryCurrentNode,
  skipCurrentNode,
  snapshotRuntime,
  startRuntime,
} from './runtime/index.js';
import { localResourceManifest, schemaForNode } from './runtime/nodeSchema.js';
import { DeviceConnectorSession, createMuseDeviceAdapter, createSimulatedDeviceAdapter } from './devices/index.js';
import { clearCurrentRun, saveCurrentRun, saveSession } from './storage.js';
import { buildGraphBidsBundle, buildGraphSessionFiles } from './data/index.js';
import { downloadBundle } from './exporter.js';
import { createProjectComponentRegistry } from './sdk/index.js';
import { HostedRuntimeSync } from './hosted/index.js';

function runtimeServices() {
  return {
    idFactory: prefix => `${prefix}_${crypto.randomUUID()}`,
    clock: { now: () => { const epochMs = Date.now(); return { epochMs, monotonicMs: performance.timeOrigin + performance.now(), iso: new Date(epochMs).toISOString() }; } },
    controlHandlers: createCoreControlHandlerRegistry(),
  };
}

// Pick the adapter that can drive an installed connector. Unknown transports yield
// null so the experiment still runs, just without device sampling.
function createDeviceAdapter(connector) {
  if (connector.transport === 'simulated') return createSimulatedDeviceAdapter();
  if (connector.transport === 'bluetooth' && connector.connectorId.startsWith('org.physioflow.muse')) return createMuseDeviceAdapter();
  return null;
}

function packagePermissions(protocol, node) {
  const componentPackage = (protocol.componentPackages || []).find(item => item.components?.some(component => component.type === node.component.type && component.version === node.component.version));
  return componentPackage ? new Set(componentPackage.approvedPermissions || []) : null;
}



export default function GraphRuntimeRunnerPage({ data, onDone }) {
  const protocol = data.protocol;
  const registry = useMemo(() => createProjectComponentRegistry(protocol), [protocol]);
  const services = useRef(runtimeServices());
  const initialState = useMemo(() => data.restore?.runtime?.protocolSchemaVersion
    ? restoreRuntime(data.restore.runtime, protocol)
    : createRuntimeState(protocol, { sessionId: data.session.session_id, startedAtEpochMs: Date.now(), startedAtMonotonicMs: performance.timeOrigin + performance.now() }), [data.restore, data.session.session_id, protocol]);
  const [runtime, setRuntime] = useState(initialState);
  const [events, setEvents] = useState(data.restore?.events || []);
  const [responses, setResponses] = useState(data.restore?.responses || []);
  const deviceEventsRef = useRef(data.restore?.device_events || []);
  const [deviceStatus, setDeviceStatus] = useState(null);
  const deviceSessionRef = useRef(null);
  const samplerRef = useRef(null);
  const [started, setStarted] = useState(Boolean(data.restore?.runtime?.status && data.restore.runtime.status !== 'ready'));
  const [saved, setSaved] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
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
  const exportFiles = runtime.status === 'completed' ? { ...buildGraphSessionFiles({ ...data.session, status: 'completed', runtime_snapshot: runtime, events, responses, device_events: deviceEventsRef.current }, protocol, events, responses), ...buildGraphBidsBundle({ ...data.session, status: 'completed' }, protocol, events, responses) } : null;

  const apply = result => {
    runtimeRef.current = result.state;
    setRuntime(result.state);
    if (result.events?.length) setEvents(current => [...current, ...result.events]);
  };

  const begin = async () => {
    setStarted(true);
    try {
      const deviceNode = protocol.graph?.nodes?.find(node => node.config?.deviceConnectorId);
      if (deviceNode) {
        const resolved = resolveDeviceConnector(protocol, deviceNode);
        const adapter = resolved ? createDeviceAdapter(resolved.connector) : null;
        if (resolved?.connector && adapter) {
          deviceSessionRef.current = new DeviceConnectorSession({
            connector: { ...resolved.connector, approvedPermissions: resolved.connector.approvedPermissions },
            adapter,
            sessionId: data.session.session_id,
            services: services.current,
            onEvent: event => { deviceEventsRef.current.push(event); },
          });
          try {
            await deviceSessionRef.current.connect({ source: resolved.connector.transport });
            samplerRef.current = createDeviceSampler({
              session: deviceSessionRef.current,
              channels: resolved.connector.channels.filter(channel => channel.direction === 'input'),
              sampleRateHz: maxInputSampleRateHz(resolved.connector),
            });
            samplerRef.current.start();
            setDeviceStatus({ connected: true });
          } catch (error) {
            setDeviceStatus({ connected: false, error: error.message || String(error) });
          }
        }
      }
    } catch { /* device setup must not block the experiment */ }
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
    // Performance-variable backfill: if the designer declared these names as protocol
    // variables, the runtime feeds live response metrics into them so Condition nodes
    // can branch adaptively (legacy last_rt_ms / last_response semantics, new-arch style).
    const declared = new Set((protocol.variables || []).map(variable => variable.name));
    const performanceValues = {};
    if (rows.length) {
      if (declared.has('last_rt_ms')) performanceValues.last_rt_ms = rows[0].reactionTimeMs;
      if (declared.has('last_response')) performanceValues.last_response = rows[0].value;
    }
    const requestedVariables = { ...(result?.variables || values), ...performanceValues };
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
    if (!started || !['completed', 'failed'].includes(runtime.status)) return undefined;
    samplerRef.current?.stop();
    deviceSessionRef.current?.disconnect('session end').catch(() => {});
    return undefined;
  }, [runtime.status, started]);

  useEffect(() => {
    if (!started || runtime.status !== 'waiting') return undefined;
    const timer = setInterval(() => {
      setDeviceStatus(current => (current?.connected ? { ...current, sampleCount: deviceEventsRef.current.length } : current));
    }, 500);
    return () => clearInterval(timer);
  }, [runtime.status, started]);

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
    saveCurrentRun({ session: data.session, protocol, runtime: snapshotRuntime(runtime), events, responses, device_events: deviceEventsRef.current, saved_at: new Date().toISOString(), runtime_version: 2 });
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
      device_events: deviceEventsRef.current,
      data_contract_version: '2.0.0-alpha.1',
    };
    saveSession(finished).then(() => clearCurrentRun()).then(() => setSaved(true)).catch(error => setSaved(error.message || 'Save failed'));
  }, [data.session, events, protocol, responses, runtime]);

  if (!started) return <main className="graph-runner"><div className="graph-runner-ready"><span className="eyebrow">RUNTIME V2 READY</span><h1>{protocolNameOf(protocol)}</h1><p>{data.session.participant_id} · {executableCount} participant components</p><button className="primary" onClick={begin}>Begin experiment</button></div></main>;
  if (runtime.status === 'completed') {
    const hostedReady = !hostedSyncRef.current || hostedStatus?.completed;
    const deviceSampleCount = deviceEventsRef.current.length;
    return <main className="graph-runner"><div className="graph-runner-ready"><span className="eyebrow">SESSION COMPLETE</span><h1>Thank you</h1><p>{events.length} events · {responses.length} responses · {deviceSampleCount} device samples · {Object.keys(exportFiles).length} export files</p><p>{saved === true ? 'Saved locally.' : typeof saved === 'string' ? saved : 'Saving…'}</p>{deviceStatus?.connected && <p>Device connected · {deviceSampleCount} samples collected</p>}{hostedSyncRef.current && <p>{hostedStatus?.completed ? `Hosted sync complete · revision ${hostedStatus.revision}` : hostedStatus?.error ? `Hosted sync failed: ${hostedStatus.error}` : 'Syncing hosted session…'}</p>}{hostedStatus?.error && <button onClick={() => syncHosted().catch(() => {})}>Retry hosted sync</button>}
      <button className="primary" onClick={() => downloadBundle(exportFiles, data.session.participant_id)}>Export complete data package</button><button disabled={saved !== true || !hostedReady} onClick={onDone}>Return to projects</button></div></main>;
  }
  if (runtime.status === 'failed') return <main className="graph-runner"><div className="graph-runner-ready"><span className="eyebrow">RUNTIME FAILED</span><h1>Experiment stopped</h1><p>{runtime.error}</p>{hostedSyncRef.current && <p>{hostedStatus?.completed ? `Hosted failure recorded · revision ${hostedStatus.revision}` : hostedStatus?.error ? `Hosted sync failed: ${hostedStatus.error}` : 'Recording hosted failure…'}</p>}{hostedStatus?.error && <button onClick={() => syncHosted().catch(() => {})}>Retry hosted sync</button>}<button disabled={Boolean(hostedSyncRef.current && !hostedStatus?.completed)} onClick={onDone}>Return to projects</button></div></main>;
  if (!currentNode) return null;

  return <main className="graph-runner">
    <div className="graph-operator" role="toolbar"><div><b>{protocolNameOf(protocol)}</b><span>{currentNode.label} · {currentNode.component.type}</span></div><div>{progress.current}/{progress.total} completed</div><div>
      <button className={inspectorOpen ? 'active' : ''} onClick={() => setInspectorOpen(open => !open)} title="Live variables, outputs and flow state">⌄ Inspect</button>
      <button onClick={() => apply(runtime.status === 'paused' ? resumeRuntime(runtimeRef.current, protocol, services.current) : pauseRuntime(runtimeRef.current, protocol, services.current))}>{runtime.status === 'paused' ? 'Resume' : 'Pause'}</button>
      <button disabled={runtime.status !== 'waiting'} onClick={() => apply(retryCurrentNode(runtimeRef.current, protocol, services.current, 'operator retry'))}>Retry</button>
      <button disabled={runtime.status !== 'waiting'} onClick={() => apply(skipCurrentNode(runtimeRef.current, protocol, registry, services.current, 'operator skip'))}>Skip</button>
    </div></div>
    {inspectorOpen && <RuntimeInspector runtime={runtime} protocol={protocol} nodes={nodes} />}
    <section className="graph-participant" aria-label="Participant view">
      {runtime.status === 'paused' && <div className="pause-overlay">Paused</div>}
      {currentNode.component.type === 'stimulus.attention-check'
        ? <AttentionCheckRunner config={currentNode.config} language={data.session.participant_language || 'en'} disabled={runtime.status === 'paused'} onSubmit={complete} />
        : currentNode.component.type === 'input.response'
        ? <ResponseRunner config={currentNode.config} language={data.session.participant_language || 'en'} disabled={runtime.status === 'paused'} onSubmit={complete} />
        : currentNode.component.type === 'stimulus.screen-calibration'
        ? <CalibrationRunner config={currentNode.config} language={data.session.participant_language || 'en'} disabled={runtime.status === 'paused'} onSubmit={complete} />
        : currentNode.component.type === 'experiment.cognitive-task'
        ? <CognitiveTaskRunner config={currentNode.config} disabled={runtime.status === 'paused'} onSubmit={complete} onTrialEvent={(eventType, payload) => record(eventType, payload)} />
        : currentNode.component.type === 'input.questionnaire' && currentNode.config?.questionnaire?.questions?.length
        ? <QuestionnaireForm questionnaire={currentNode.config.questionnaire} language={data.session.participant_language || 'en'} randomSeed={runtime.randomSeed} onSubmit={(answers, metadata) => {
            const scoreValues = metadata?.score?.total > 0 ? {
              questionnaire_score_correct: metadata.score.correct,
              questionnaire_score_total: metadata.score.total,
              questionnaire_score_pct: metadata.score.pct,
            } : {};
            const values = { ...answers, ...scoreValues, questionnaire_timed_out_question_ids: metadata?.timedOutQuestionIds || [] };
            complete({ values, outputs: values, variables: scoreValues, metadata: { questionnaire: metadata } });
          }} />
        : <ParticipantRenderer key={currentNode.id} schema={schemaForNode(currentNode, currentDefinition, data.hosted?.resources || localResourceManifest(protocol.assets || []))} disabled={runtime.status === 'paused'} context={{ participant: data.session, variables: currentPermissions && !currentPermissions.has('session.variables.read') ? {} : runtime.variables, outputs: runtime.outputs, progress, timer: { elapsedMs: 0 } }} onSubmit={complete} onValueChange={payload => record('value_changed', payload)} onAction={action => record('ui_action', action)} onMediaEvent={(eventType, payload) => {
          record(eventType, payload);
          if (eventType === 'media_ended' && currentNode.config?.completion?.mode === 'media-ended') complete({});
        }} />}
    </section>
  </main>;
}

// Live operator-facing inspector: reconstructed variables, data outputs and
// flow state straight from the Runtime V2 state machine (W5).
function RuntimeInspector({ runtime, protocol, nodes }) {
  const format = value => value === null || value === undefined ? '—'
    : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const variableRows = (protocol.variables || []).map(variable => ({ name: variable.name, type: variable.type, value: runtime.variables?.[variable.name] }));
  const outputRows = Object.entries(runtime.outputs || {}).map(([key, value]) => ({ name: key, value }));
  const loopRows = Object.entries(runtime.loopCounts || {}).map(([key, value]) => ({ name: key, value }));
  return <section className="runtime-inspector" aria-label="Runtime variables, outputs and flow state">
    <div className="ri-section">
      <h4>Variables <small>{variableRows.length}</small></h4>
      {variableRows.length ? <table><thead><tr><th>Name</th><th>Type</th><th>Value</th></tr></thead>
        <tbody>{variableRows.map(row => <tr key={row.name}><td><code>{row.name}</code></td><td>{row.type}</td><td><code>{format(row.value)}</code></td></tr>)}</tbody></table>
        : <p className="muted">No protocol variables declared.</p>}
    </div>
    <div className="ri-section">
      <h4>Outputs <small>{outputRows.length}</small></h4>
      {outputRows.length ? <table><thead><tr><th>Port</th><th>Value</th></tr></thead>
        <tbody>{outputRows.map(row => <tr key={row.name}><td><code>{row.name}</code></td><td><code>{format(row.value)}</code></td></tr>)}</tbody></table>
        : <p className="muted">No node outputs yet.</p>}
    </div>
    <div className="ri-section ri-flow">
      <h4>Flow state</h4>
      <p><span>Status</span><b>{runtime.status}</b></p>
      <p><span>Current node</span><b>{runtime.currentNodeId ? nodes.get(runtime.currentNodeId)?.label || runtime.currentNodeId : '—'}</b></p>
      <p><span>Completed</span><b>{runtime.completedNodeIds.length}</b></p>
      <p><span>Skipped</span><b>{runtime.skippedNodeIds.length}</b></p>
      <p><span>Attempts</span><b>{Object.keys(runtime.attempts || {}).length}</b></p>
      {loopRows.length > 0 && <p><span>Loop counts</span><b>{loopRows.map(row => `${row.name}×${format(row.value)}`).join(', ')}</b></p>}
    </div>
  </section>;
}
