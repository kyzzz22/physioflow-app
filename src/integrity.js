const SERIOUS_MARKERS = new Set(['device_disconnected']);
const TERMINAL_EVENTS = new Set(['step_completed','step_skipped','step_retried']);

function stepAttempts(events){
  const queues=new Map(),attempts=[];
  [...events].sort((left,right)=>(left.elapsed_monotonic_ms||0)-(right.elapsed_monotonic_ms||0)).forEach(event=>{
    if(event.event_type==='step_entered'){const attempt={start:event,end:null};attempts.push(attempt);const queue=queues.get(event.step_id)||[];queue.push(attempt);queues.set(event.step_id,queue)}
    if(TERMINAL_EVENTS.has(event.event_type)){const queue=queues.get(event.step_id)||[],attempt=queue.shift();if(attempt)attempt.end=event}
  });
  return attempts;
}

export function assessSession({ session, protocol, events = [], responses = [], runtime }) {
  const errors = [], warnings = [], facts = {},attempts=stepAttempts(events);
  const entered=attempts.map(attempt=>attempt.start),completed=events.filter(event=>event.event_type==='step_completed');
  const incomplete=attempts.filter(attempt=>!attempt.end);
  if(incomplete.length)errors.push(`${incomplete.length} entered Step(s) have no terminal event`);
  const mediaErrors=events.filter(event=>event.event_type==='media_error');if(mediaErrors.length)errors.push(`${mediaErrors.length} media playback error(s)`);
  const steps=new Map((protocol?.blocks||[]).flatMap(block=>(block?.trials||[]).flatMap(trial=>(trial?.steps||[]))).map(item=>[item.step_id,item]));
  const requiredSkips=events.filter(event=>event.event_type==='step_skipped'&&steps.get(event.step_id)?.required!==false);if(requiredSkips.length)errors.push(`${requiredSkips.length} required Step(s) were skipped`);
  const completedQuestionnaires=attempts.filter(attempt=>attempt.end?.event_type==='step_completed'&&steps.get(attempt.start.step_id)?.type==='questionnaire').length;
  const questionnaireSubmissions=events.filter(event=>event.event_type==='questionnaire_submitted').length;
  if(completedQuestionnaires>questionnaireSubmissions)errors.push(`${completedQuestionnaires-questionnaireSubmissions} completed questionnaire presentation(s) lack a submission`);
  const pauses=events.filter(event=>event.event_type==='session_paused').length,skips=events.filter(event=>event.event_type==='step_skipped').length,retries=events.filter(event=>event.event_type==='step_retried').length;
  if(pauses)warnings.push(`Session was paused ${pauses} time(s)`);if(skips)warnings.push(`${skips} Step(s) were skipped`);if(retries)warnings.push(`${retries} Step retry/retries occurred`);
  const seriousMarkers=events.filter(event=>['manual_marker','marker_interval_started'].includes(event.event_type)&&SERIOUS_MARKERS.has(event.metadata?.marker_type));if(seriousMarkers.length)warnings.push(`${seriousMarkers.length} serious device marker(s)`);
  if(session?.protocol_hash&&session.protocol_hash!==protocol?.config_hash)errors.push('Session protocol hash does not match the protocol snapshot');
  if(session?.status==='completed'&&!events.some(event=>event.event_type==='session_completed'))errors.push('Completed Session lacks session_completed event');
  if(runtime?.status==='invalid')errors.push(`Runtime invalid: ${runtime.error||'unknown error'}`);
  // Use Set for O(1) lookup instead of O(N²) nested some()
  const endedMarkerIds = new Set(events.filter(e => e.event_type === 'marker_interval_ended').map(e => e.metadata?.marker_id).filter(Boolean));
  const openIntervals = events.filter(event => event.event_type === 'marker_interval_started' && !endedMarkerIds.has(event.metadata?.marker_id));
  if (openIntervals.length) warnings.push(`${openIntervals.length} marker interval(s) lack an end event`);
  Object.assign(facts,{entered_steps:entered.length,completed_steps:completed.length,responses:responses.length,pauses,skips,retries,manual_markers:events.filter(event=>event.event_type==='manual_marker').length,marker_intervals:events.filter(event=>event.event_type==='marker_interval_started').length,open_marker_intervals:openIntervals.length,media_errors:mediaErrors.length});
  const validity_status=errors.length?'invalid':warnings.length?'attention':'valid';return{validity_status,checked_at:new Date().toISOString(),errors,warnings,facts};
}
