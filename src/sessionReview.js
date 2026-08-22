import { assessSession } from './integrity.js';
import { isGraphProtocol } from './core/protocolSelectors.js';
import { assessGraphSession } from './data/graphIntegrity.js';

export function withSessionIntegrity(session) {
  if (!session || !session.protocol_snapshot) return session;
  const events = session.events || [];
  const responses = session.responses || [];
  const runtime = session.runtime_snapshot;
  const next = {
    ...session,
    event_count: events.length,
  };
  next.integrity = (isGraphProtocol(session.protocol_snapshot) ? assessGraphSession : assessSession)({
    session: next,
    protocol: session.protocol_snapshot,
    events,
    responses,
    runtime,
  });
  return next;
}
