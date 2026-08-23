export const HOSTED_RUNTIME_SYNC_VERSION = '1.0.0';

export class HostedRuntimeSync {
  constructor({ client, session }) {
    if (!client || !session?.sessionId || !Number.isInteger(session.revision) || !Number.isInteger(session.nextEventSequence)) throw new Error('Hosted runtime sync requires a client and hosted session metadata');
    this.client = client;
    this.sessionId = session.sessionId;
    this.revision = session.revision;
    this.nextEventSequence = session.nextEventSequence;
    this.completed = session.status === 'completed';
    this.lastError = null;
    this.tail = Promise.resolve();
  }

  enqueue({ events = [], runtime, complete = ['completed', 'failed'].includes(runtime?.status) }) {
    const payload = { events: structuredClone(events), runtime: structuredClone(runtime), complete };
    const task = this.tail.catch(() => undefined).then(() => this.sync(payload));
    this.tail = task;
    return task;
  }

  async sync({ events, runtime, complete }) {
    if (this.completed) return this.status();
    try {
      const pending = events.filter(event => event.sequence >= this.nextEventSequence).sort((a, b) => a.sequence - b.sequence);
      if (pending.length) {
        if (pending[0].sequence !== this.nextEventSequence) throw new Error(`Hosted runtime event gap: expected ${this.nextEventSequence}, found ${pending[0].sequence}`);
        const first = pending[0].sequence;
        const last = pending.at(-1).sequence;
        const receipt = await this.client.appendEvents(this.sessionId, pending, {
          batchId: `runtime:${first}-${last}`,
          expectedRevision: this.revision,
        });
        this.revision = receipt.revision;
        this.nextEventSequence = last + 1;
      }
      if (runtime) {
        if (runtime.sessionId !== this.sessionId) throw new Error('Runtime state belongs to a different hosted session');
        if (runtime.eventSequence !== this.nextEventSequence - 1) throw new Error(`Runtime state sequence ${runtime.eventSequence} is ahead of hosted events ${this.nextEventSequence - 1}`);
        const synced = await this.client.syncState(this.sessionId, runtime, {
          syncId: `runtime:${runtime.eventSequence}:${runtime.status}`,
          expectedRevision: this.revision,
        });
        this.revision = synced.revision;
      }
      if (complete) {
        const completed = await this.client.completeSession(this.sessionId, {
          completionId: `runtime:${runtime?.eventSequence ?? this.nextEventSequence - 1}`,
          expectedRevision: this.revision,
          outcome: runtime?.status === 'failed' ? 'failed' : 'completed',
        });
        this.revision = completed.revision;
        this.completed = true;
        this.outcome = completed.status;
      }
      this.lastError = null;
      return this.status();
    } catch (error) {
      this.lastError = error;
      throw error;
    }
  }

  async flush() { return this.tail; }

  status() {
    return {
      version: HOSTED_RUNTIME_SYNC_VERSION,
      sessionId: this.sessionId,
      revision: this.revision,
      nextEventSequence: this.nextEventSequence,
      completed: this.completed,
      outcome: this.outcome || null,
      error: this.lastError?.message || null,
    };
  }
}
