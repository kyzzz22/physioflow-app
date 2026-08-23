import { HostedHttpClient } from './hostedHttp.js';
import { validateParticipantBootstrap } from './participantBootstrap.js';
export { createParticipantLaunchUrl, isParticipantEntryLocation, parseParticipantLaunchLocation, PARTICIPANT_LAUNCH_ROUTE } from './participantRoute.js';

async function tokenIdempotencyKey(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const fingerprint = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  return `participant-launch:${fingerprint}`;
}

export async function prepareParticipantLaunch({ apiBaseUrl, launchToken, participantId, fetch, timeoutMs } = {}) {
  if (!launchToken) throw new Error('This participant link is missing its launch token');
  const anonymous = new HostedHttpClient({ baseUrl: apiBaseUrl, fetch, timeoutMs });
  const redemption = await anonymous.redeemLaunchLink(launchToken, {
    idempotencyKey: await tokenIdempotencyKey(launchToken),
    participantId: participantId || undefined,
  });
  const accessToken = redemption.session?.participantAccessToken;
  if (!accessToken || !redemption.session?.sessionId) throw new Error('Hosted launch did not return participant session credentials');
  const client = new HostedHttpClient({ baseUrl: apiBaseUrl, accessToken, fetch, timeoutMs });
  const session = await client.session(redemption.session.sessionId);
  const bootstrap = await client.bootstrap(session.sessionId);
  const check = await validateParticipantBootstrap(bootstrap);
  if (!check.valid) throw new Error(`Participant bootstrap failed validation: ${check.errors.join('; ')}`);
  return { client, session, bootstrap };
}
