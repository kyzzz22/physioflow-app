export const PARTICIPANT_LAUNCH_ROUTE = '/participant';

function safeApiBaseUrl(value, origin) {
  const url = new URL(value || origin, origin);
  if (url.protocol === 'https:') return url.toString().replace(/\/$/, '');
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.toString().replace(/\/$/, '');
  throw new Error('Participant API must use HTTPS, except on a loopback development host');
}

export function isParticipantEntryLocation(location = globalThis.location) {
  if (!location) return false;
  const path = location.pathname.replace(/\/$/, '') || '/';
  return path.endsWith(PARTICIPANT_LAUNCH_ROUTE) || new URLSearchParams(location.search).get('participant') === '1';
}

export function parseParticipantLaunchLocation(location = globalThis.location, defaultApiBaseUrl) {
  if (!location) throw new Error('Participant launch location is unavailable');
  const fragment = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const query = new URLSearchParams(location.search || '');
  const launchToken = fragment.get('launch') || query.get('launch') || '';
  const participantId = fragment.get('participantId') || query.get('participantId') || '';
  const apiValue = fragment.get('api') || query.get('api') || defaultApiBaseUrl || location.origin;
  return {
    apiBaseUrl: safeApiBaseUrl(apiValue, location.origin),
    launchToken,
    participantId,
  };
}

export function createParticipantLaunchUrl(launchToken, options = {}) {
  const origin = options.origin || globalThis.location?.origin;
  if (!origin) throw new Error('Participant launch URL requires an origin');
  const url = new URL(options.path || PARTICIPANT_LAUNCH_ROUTE, origin);
  const fragment = new URLSearchParams({ launch: launchToken });
  if (options.apiBaseUrl) fragment.set('api', options.apiBaseUrl);
  if (options.participantId) fragment.set('participantId', options.participantId);
  url.hash = fragment.toString();
  return url.toString();
}
