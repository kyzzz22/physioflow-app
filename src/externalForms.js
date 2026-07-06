export function buildExternalFormUrl(step = {}, session = {}) {
  const baseUrl = (step.external_form_url || '').trim();
  if (!baseUrl || step.external_append_context === false) return baseUrl;
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return baseUrl;
  }
  const pairs = [
    [step.external_participant_param || 'participant_id', session.participant_id],
    [step.external_session_param || 'session_id', session.session_id],
  ];
  pairs.forEach(([key, value]) => {
    const cleanKey = String(key || '').trim();
    const cleanValue = value == null ? '' : String(value);
    if (cleanKey && cleanValue) url.searchParams.set(cleanKey, cleanValue);
  });
  return url.toString();
}
