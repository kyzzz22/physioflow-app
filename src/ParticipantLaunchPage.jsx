import { useEffect, useState } from 'react';
import GraphRuntimeRunnerPage from './GraphRuntimeRunnerPage.jsx';
import { protocolNameOf } from './core/index.js';
import { loadCurrentRunAsync } from './storage.js';
import { parseParticipantLaunchLocation, prepareParticipantLaunch } from './hosted/index.js';

function sessionData(session, protocol) {
  return {
    session_id: session.sessionId,
    participant_id: session.participantId,
    operator_id: 'hosted',
    participant_language: 'en',
    protocol_id: session.protocolId,
    protocol_version: session.protocolVersion,
    protocol_hash: session.configHash,
    protocol_name: protocolNameOf(protocol),
    run_mode: 'hosted',
    status: session.status,
    started_at: session.createdAt,
    ended_at: null,
  };
}

function responsesFromEvents(events, session, protocol) {
  return (events || []).flatMap(event => {
    if (event.eventType !== 'response_submitted') return [];
    return Object.entries(event.payload?.values || {}).map(([name, value]) => ({
      responseId: `recovered_${event.eventId}_${name}`,
      sessionId: session.sessionId,
      participantId: session.participantId,
      protocolId: protocol.protocolId,
      nodeId: event.nodeId,
      componentType: event.componentType,
      name,
      value,
      reactionTimeMs: Number(event.payload?.reactionTimeMs || 0),
      timestampIso: event.timestampIso,
    }));
  });
}

export default function ParticipantLaunchPage({ location = globalThis.location, fetch, apiBaseUrl }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ phase: 'loading', run: null, error: '' });

  useEffect(() => {
    let active = true;
    setState({ phase: 'loading', run: null, error: '' });
    (async () => {
      const request = parseParticipantLaunchLocation(location, apiBaseUrl);
      const prepared = await prepareParticipantLaunch({ ...request, fetch });
      const protocol = prepared.bootstrap.protocol;
      const stored = await loadCurrentRunAsync().catch(() => null);
      const localRestore = stored?.session?.session_id === prepared.session.sessionId && stored?.protocol?.freeze?.configHash === protocol.freeze?.configHash
        ? stored
        : undefined;
      const hostedRecovery = prepared.bootstrap.recovery
        ? { runtime: prepared.bootstrap.recovery.runtime, events: prepared.bootstrap.recovery.events, responses: responsesFromEvents(prepared.bootstrap.recovery.events, prepared.session, protocol) }
        : undefined;
      const restore = (localRestore?.runtime?.eventSequence ?? -1) >= (hostedRecovery?.runtime?.eventSequence ?? -1) ? localRestore : hostedRecovery;
      if (!active) return;
      setState({
        phase: 'ready',
        error: '',
        run: {
          protocol,
          session: sessionData(prepared.session, protocol),
          restore,
          hosted: { client: prepared.client, session: prepared.session, resources: prepared.bootstrap.resources },
        },
      });
    })().catch(error => {
      if (active) setState({ phase: 'error', run: null, error: error?.message || 'The participant link could not be opened' });
    });
    return () => { active = false; };
  }, [apiBaseUrl, attempt, fetch, location]);

  if (state.phase === 'ready') return <GraphRuntimeRunnerPage data={state.run} onDone={() => setState({ phase: 'complete', run: null, error: '' })} />;
  if (state.phase === 'complete') return <main className="participant-launch"><section><span className="eyebrow">SESSION CLOSED</span><h1>Thank you</h1><p>Your experiment record has been synchronized.</p></section></main>;
  if (state.phase === 'error') return <main className="participant-launch"><section role="alert"><span className="eyebrow">LINK UNAVAILABLE</span><h1>This experiment cannot be opened</h1><p>{state.error}</p><button onClick={() => setAttempt(value => value + 1)}>Try again</button></section></main>;
  return <main className="participant-launch"><section role="status" aria-live="polite"><span className="eyebrow">PHYSIOFLOW PARTICIPANT</span><h1>Preparing your experiment…</h1><p>Verifying the session and downloading its exact protocol.</p></section></main>;
}
