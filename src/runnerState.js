export function remainingMilliseconds(timing,now){
  if(!timing?.active)return Math.max(0,Number(timing?.remaining||0));
  return Math.max(0,Number(timing.remaining||0)-(now-Number(timing.started_at||now)));
}

export function captureRunnerState(timing,state,now){
  return{paused:Boolean(state.paused),awaiting_start:Boolean(state.awaiting_start),timed_out:Boolean(state.timed_out),media_ended:Boolean(state.media_ended),active_marker:state.active_marker||null,current_step_entered:state.current_step_entered!==false,remaining_ms:remainingMilliseconds(timing,now)};
}

export function recoverySchedule(step,runnerState){
  if(!step||runnerState?.paused||runnerState?.awaiting_start||runnerState?.timed_out||step.duration_mode!=='fixed')return null;
  if(step.recovery_behavior==='wait_operator')return null;
  if(step.recovery_behavior==='restart'||['video','audio'].includes(step.type))return Math.max(0,Number(step.planned_duration_ms||0));
  return Math.max(0,Number(runnerState?.remaining_ms??step.planned_duration_ms??0));
}
