import { createLinearFlow, normalizeFlow, validateFlow } from './flowEngine.js';
import { APP_VERSION, STEP_TYPES, ROLES, MEDIA_TYPES, STEP_DEFAULTS } from './constants.js';

export { STEP_TYPES, ROLES };
export const uid=p=>{const uuid=(()=>{try{if(crypto?.randomUUID)return crypto.randomUUID()}catch{}const a='xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';return a.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:r&0x3|0x8).toString(16)})})();return`${p}_${uuid}`};
const defaultExtras=d=>Object.fromEntries(Object.entries(d).filter(([key])=>!['name','duration_mode','planned_duration_ms','recovery_behavior'].includes(key)));
export const step=(type='instruction',x={})=>{const d=STEP_DEFAULTS[type]||STEP_DEFAULTS.instruction;return{step_id:uid('step'),type,name:d.name,name_i18n:{zh:'',ja:'',en:''},role:'custom',appearance:{font_size:null,alignment:null,color:null,background:null},duration_mode:d.duration_mode,planned_duration_ms:d.planned_duration_ms,content:'',content_i18n:{zh:'',ja:'',en:''},stimulus_id:'',questionnaire_id:'',analysis_label:'',is_analysis_window:false,allow_skip:true,allow_retry:false,required:true,recovery_behavior:d.recovery_behavior||'resume_remaining',source_mode:MEDIA_TYPES.includes(type)?'url':'none',source_url:'',asset_id:'',file_name:'',start_mode:'auto',auto_advance:true,show_controls:true,muted:false,loop:false,volume:1,...defaultExtras(d),...x}};
export const trial=(x={})=>({trial_id:uid('trial'),name:'New trial',condition:'',repeat_count:1,iti_jitter_ms:0,iti_jitter_distribution:'uniform',layout:{background:'#fffef9',foreground:'#17221d',content_width:900,alignment:'center',padding:48,gap:24,show_progress:true,show_step_type:true,border_radius:12},steps:[step()],...x});
export const block=(x={})=>({block_id:uid('block'),name:'New block',description:'',order_rule:'fixed',repeat_count:1,is_practice:false,max_consecutive_same:0,no_immediate_repeat:false,trials:[trial()],...x});
export const protocol=(x={})=>({schema_version:'1.0.0',protocol_id:uid('protocol'),project_id:uid('project'),name:'Untitled experiment',version:1,version_name:'Draft 1',status:'draft',archived_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),frozen_at:null,config_hash:null,app_version:APP_VERSION,blocks:[block()],stimuli:[],questionnaires:[],...x});
const canonical=(v,seen=new WeakSet())=>{if(v&&typeof v==='object'){if(seen.has(v))return'[Circular]';seen.add(v)}return Array.isArray(v)?v.map(item=>canonical(item,seen)):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k],seen)])):v};
export async function hashProtocol(p){const clean={...p,config_hash:null,frozen_at:null,updated_at:null,archived_at:null,created_at:null};const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(clean))));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function freezeProtocol(p){const check=validateProtocol(p);if(!check.valid)throw new Error(`Protocol cannot be frozen:\n${check.errors.join('\n')}`);const frozen=structuredClone(p);frozen.blocks.forEach(block=>block.trials.forEach(trial=>{if(!trial.flow)trial.flow=createLinearFlow(trial.steps)}));frozen.status='frozen';frozen.frozen_at=new Date().toISOString();frozen.updated_at=frozen.frozen_at;frozen.config_hash=await hashProtocol(frozen);return frozen}
export function unfreezeProtocol(p){if(p.status!=='frozen')return p;const draft=structuredClone(p);draft.status='draft';draft.frozen_at=null;draft.config_hash=null;draft.updated_at=new Date().toISOString();return draft}
export function validateProtocol(p){
  const errors=[],warnings=[],ids=new Set();
  const stimuli=new Map((p?.stimuli||[]).map(item=>[item.stimulus_id,item]));
  const questionnaires=new Map((p?.questionnaires||[]).map(item=>[item.questionnaire_id,item]));
  const add=(id,path)=>{if(!id)errors.push(`${path}: missing ID`);else if(ids.has(id))errors.push(`${path}: duplicate ${id}`);else ids.add(id)};
  if(p?.schema_version!=='1.0.0')errors.push('Unsupported schema version');
  if(!p?.name?.trim())errors.push('Protocol name is required — enter a name at the top of the editor');
  if(!p?.blocks?.length)errors.push('At least one block is required — click "+ Add block"');
  p?.blocks?.forEach((b,bi)=>{
    const blockPath=`Block ${bi+1}`;add(b.block_id,blockPath);
    if(!b.name?.trim())errors.push(`${blockPath}: «Block name» is required — enter a name for this block`);
    if(!['fixed','random','latin_square','manual'].includes(b.order_rule))errors.push(`${blockPath}: invalid order rule`);
    if(!Number.isFinite(Number(b.repeat_count))||Number(b.repeat_count)<1)errors.push(`${blockPath}: «Repeat» must be at least 1`);
    if(b.no_immediate_repeat&&b.order_rule==='random'&&b.trials?.length<3)warnings.push(`${blockPath}: «No immediate repeat» is on but only ${b.trials?.length||0} trial(s) exist — need at least 3 for effective shuffling`);
    if(Number(b.max_consecutive_same)>0&&b.order_rule==='random'&&b.trials?.length<4)warnings.push(`${blockPath}: «Max consecutive same» constraint needs at least 4 trials with multiple conditions`);
    if(!b.trials?.length)errors.push(`${blockPath} has no Trials — click "+ Add trial"`);
    b.trials?.forEach((t,ti)=>{
      const trialPath=`${blockPath} / Trial ${ti+1}`;add(t.trial_id,trialPath);
      if(!t.name?.trim())errors.push(`${trialPath}: «Trial name» is required`);
      if(!Number.isFinite(Number(t.repeat_count))||Number(t.repeat_count)<1)errors.push(`${trialPath}: «Repeat» must be at least 1`);
      if(!Number.isFinite(Number(t.iti_jitter_ms))||Number(t.iti_jitter_ms)<0)errors.push(`${trialPath}: «ITI jitter» must be a non-negative number`);
      if(!['uniform','normal','exponential','fixed'].includes(t.iti_jitter_distribution||'fixed'))errors.push(`${trialPath}: «Jitter distribution» must be uniform, normal, exponential, or fixed`);
      if(!t.steps?.length)errors.push(`${trialPath} has no Steps — click a step type button (e.g. "+ instruction")`);
      t.steps?.forEach((s,si)=>{
        const stepPath=`${trialPath} / Step ${si+1}`;add(s.step_id,stepPath);
        if(!STEP_TYPES.includes(s.type))errors.push(`${stepPath}: «Event type» is invalid`);
        if(!s.name?.trim())errors.push(`${stepPath}: «Step name» is required`);
        if(s.duration_mode==='fixed'&&(!Number.isFinite(Number(s.planned_duration_ms))||Number(s.planned_duration_ms)<0))errors.push(`${stepPath}: «Duration» field is required when end mode is set to "Fixed time"`);
        if(!['resume_remaining','restart','wait_operator'].includes(s.recovery_behavior||(['video','audio'].includes(s.type)?'restart':'resume_remaining')))errors.push(`${stepPath}: invalid recovery behavior`);
        if(s.is_analysis_window&&!ROLES.includes(s.role))errors.push(`${stepPath}: «Analysis role» must be set when «Generate analysis window» is enabled`);
        const resource=stimuli.get(s.stimulus_id),effectiveSourceMode=s.source_url||s.asset_id?s.source_mode:resource?.source_mode||s.source_mode;
        if(['video','audio','image'].includes(s.type)){
          if(!s.source_url&&!s.asset_id&&!resource?.source_url&&!resource?.asset_id)errors.push(`${stepPath}: «Source URL» or uploaded file is required — this ${s.type} step has nothing to play`);
        }
        if(effectiveSourceMode==='youtube'&&s.duration_mode==='media')warnings.push(`${stepPath}: YouTube end detection uses the YouTube IFrame API (postMessage). This works in most browsers but the timing may differ from local media files by a few hundred milliseconds`);
        if(effectiveSourceMode==='youtube'&&s.is_analysis_window)warnings.push(`${stepPath}: YouTube source does not report exact playback events; the analysis window will use page display time instead of actual play time`);
        if(['video','audio'].includes(s.type)&&s.loop&&s.duration_mode==='media')errors.push(`${stepPath}: looping is ON but end mode is "When media ends". A looping media file never ends — switch end mode to «Fixed time» or «Manual continue», or turn off looping`);
        if(!['auto','manual'].includes(s.start_mode||'auto'))errors.push(`${stepPath}: «Start mode» must be "Automatic" or "Participant click"`);
        if(!['fixed','media','manual'].includes(s.duration_mode||''))errors.push(`${stepPath}: «End mode» is invalid`);
        if(s.source_mode&&!['url','youtube','upload','none'].includes(s.source_mode))errors.push(`${stepPath}: «Source» mode "${s.source_mode}" is invalid`);
        if(Number.isFinite(Number(t.repeat_count))&&Number(t.repeat_count)>100)warnings.push(`${trialPath}: large «Repeat» value (${t.repeat_count}) may cause long runtimes`);
        if(['video','audio'].includes(s.type)&&s.start_mode==='manual'&&s.show_controls===false)errors.push(`${stepPath}: start mode is "Participant click" but player controls are hidden. The participant needs visible controls to start playback — enable «Show player controls»`);
        if(s.type==='questionnaire'){
          if((s.questionnaire_mode||'internal')==='external'){
            const url=(s.external_form_url||'').trim();
            if(!url)errors.push(`${stepPath}: external questionnaire URL is required`);
            else if(!/^https?:\/\//i.test(url))errors.push(`${stepPath}: external questionnaire URL must start with http:// or https://`);
            if(s.duration_mode!=='manual')errors.push(`${stepPath}: external questionnaire steps must use «Manual continue» so the participant/operator can confirm completion`);
            if(s.external_append_context!==false&&!String(s.external_participant_param||s.external_session_param||'').trim())errors.push(`${stepPath}: external questionnaire context sync is enabled but no URL parameter names are set`);
          }else{
            const questionnaire=s.questionnaire||questionnaires.get(s.questionnaire_id);
            if(!questionnaire?.questions?.length)errors.push(`${stepPath}: this questionnaire step has no questions — add at least one question`);
            if(s.duration_mode==='fixed'&&questionnaire?.questions?.some(question=>question.required))errors.push(`${stepPath}: end mode is "Fixed time" but some questions are required. A timer will skip unanswered required questions — switch end mode to «Manual continue» so participants can submit`);
            const questionIds=new Set();
            questionnaire?.questions?.forEach((q,qi)=>{
              if(!q.question_id)errors.push(`${stepPath} / Question ${qi+1}: ID is required`);else if(questionIds.has(q.question_id))errors.push(`${stepPath}: duplicate question ID ${q.question_id}`);else questionIds.add(q.question_id);
              if(!q.type)errors.push(`${stepPath} / Question ${qi+1}: «Type» is required`);
              if(!Object.values(q.prompt_i18n||{}).some(text=>text?.trim()))errors.push(`${stepPath} / Question ${qi+1}: «Prompt» is empty in all languages — the participant won't know what to answer`);
              if(['single_choice','multiple_choice'].includes(q.type)&&!Object.values(q.options_i18n||{}).some(options=>options?.some(option=>option.trim())))errors.push(`${stepPath} / Question ${qi+1}: «Options» are required for ${q.type==='single_choice'?'single':'multiple'} choice — add at least one option`);
            });
          }
        }
        if(s.type==='response'){
          const options=s.response_options||[];
          if(!String(s.response_variable||'').trim())errors.push(`${stepPath}: «Response variable» is required — set the variable name used in exports and Condition nodes`);
          if(!options.length)errors.push(`${stepPath}: response options are required — add at least one value/label/key row`);
          const values=new Set(),keys=new Set();
          options.forEach((option,oi)=>{
            const value=String(option.value||'').trim();
            const label=Object.values(option.label_i18n||{}).find(text=>String(text||'').trim());
            const key=String(option.key||'').trim().toLowerCase();
            if(!value)errors.push(`${stepPath} / Response option ${oi+1}: «Value» is required`);
            else if(values.has(value))errors.push(`${stepPath}: duplicate response value "${value}"`);
            else values.add(value);
            if(!label)errors.push(`${stepPath} / Response option ${oi+1}: «Label» is required in at least one language`);
            if(key){
              if(keys.has(key))errors.push(`${stepPath}: duplicate response key "${option.key}"`);
              else keys.add(key);
            }
          });
        }
      });
      const flowSteps=(t.steps||[]).map(item=>item.type==='questionnaire'&&!item.questionnaire?{...item,questionnaire:questionnaires.get(item.questionnaire_id)}:item),flowCheck=validateFlow(normalizeFlow(t),flowSteps);
      flowCheck.errors.forEach(message=>errors.push(`${trialPath}: ${message}`));
      flowCheck.warnings.forEach(message=>warnings.push(`${trialPath}: ${message}`));
    });
  });
  if(!p?.blocks?.some(b=>b.trials?.some(t=>t.steps?.some(s=>s.is_analysis_window))))warnings.push('No analysis window defined — enable «Generate analysis window» on at least one step to produce a per-trial time window in the exported CSV');
  return{valid:!errors.length,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
}

export function createNextProtocolVersion(source){
  const next=structuredClone(source),now=new Date().toISOString();
  next.protocol_id=uid('protocol');next.version=Number(source.version||1)+1;next.version_name=`Version ${next.version}`;next.status='draft';next.archived_at=null;next.created_at=now;next.updated_at=now;next.frozen_at=null;next.config_hash=null;
  return next;
}

export function duplicateProtocolAsProject(source){
  const copy=createNextProtocolVersion(source),stimulusIds=new Map((source.stimuli||[]).map(item=>[item.stimulus_id,uid('stimulus')])),questionnaireIds=new Map();
  copy.project_id=uid('project');copy.version=1;copy.version_name='Draft 1';copy.name=`${source.name} Copy`;
  copy.stimuli=(source.stimuli||[]).map(item=>({...structuredClone(item),stimulus_id:stimulusIds.get(item.stimulus_id)}));
  copy.questionnaires=(source.questionnaires||[]).map(item=>{const cloned=cloneQuestionnaire(item);questionnaireIds.set(item.questionnaire_id,cloned.questionnaire_id);return cloned});
  copy.blocks=(source.blocks||[]).map((sourceBlock,blockIndex)=>{const cloned=duplicateBlock(sourceBlock);cloned.trials.forEach((trialCopy,trialIndex)=>trialCopy.steps.forEach((stepCopy,stepIndex)=>{const original=source.blocks[blockIndex]?.trials[trialIndex]?.steps[stepIndex];if(!original)return;if(original.stimulus_id){if(stimulusIds.has(original.stimulus_id))stepCopy.stimulus_id=stimulusIds.get(original.stimulus_id);else{stepCopy.stimulus_id='';stepCopy.source_url='';stepCopy.asset_id='';}}if(!original.questionnaire&&original.questionnaire_id&&questionnaireIds.has(original.questionnaire_id))stepCopy.questionnaire_id=questionnaireIds.get(original.questionnaire_id)}));return cloned});
  return copy;
}

function cloneQuestionnaire(source){
  if(!source)return source;
  return {...structuredClone(source),questionnaire_id:uid('questionnaire'),questions:(source.questions||[]).map(question=>({...structuredClone(question),question_id:uid('question')}))};
}

export function duplicateTrial(source){
  const copy=structuredClone(source),stepIds=new Map();
  copy.trial_id=uid('trial');copy.name=`${source.name} Copy`;
  copy.steps=(copy.steps||[]).map(item=>{const stepId=uid('step');stepIds.set(item.step_id,stepId);const questionnaire=cloneQuestionnaire(item.questionnaire);return{...item,step_id:stepId,questionnaire,questionnaire_id:questionnaire?.questionnaire_id||item.questionnaire_id}});
  copy.flow=copy.flow||createLinearFlow(source.steps||[]);
  if(copy.flow){
    const nodeIds=new Map(copy.flow.nodes.map(node=>[node.id,uid(`node_${node.type}`)]));
    copy.flow={nodes:copy.flow.nodes.map(node=>({...node,id:nodeIds.get(node.id),step_id:stepIds.get(node.step_id)||node.step_id})),edges:copy.flow.edges.map(edge=>({...edge,id:uid('edge'),source:nodeIds.get(edge.source),target:nodeIds.get(edge.target)}))};
  }
  return copy;
}

export function duplicateBlock(source){
  const copy=structuredClone(source);copy.block_id=uid('block');copy.name=`${source.name} Copy`;copy.trials=(source.trials||[]).map(duplicateTrial);return copy;
}

export function moveItem(items,index,direction){
  const target=index+direction;if(index<0||index>=items.length||target<0||target>=items.length)return[...items];const next=[...items];[next[index],next[target]]=[next[target],next[index]];return next;
}

export function protocolDiff(previous,next){
  const count=protocolValue=>({blocks:protocolValue.blocks?.length||0,trials:protocolValue.blocks?.reduce((total,item)=>total+(item.trials?.length||0),0)||0,steps:protocolValue.blocks?.reduce((total,item)=>total+(item.trials||[]).reduce((sum,trialValue)=>sum+(trialValue.steps?.length||0),0),0)||0,stimuli:protocolValue.stimuli?.length||0,questionnaires:protocolValue.questionnaires?.length||0});
  const before=count(previous),after=count(next),changes=[];
  Object.keys(before).forEach(key=>{if(before[key]!==after[key])changes.push(`${key}: ${before[key]} → ${after[key]}`)});
  if(previous.name!==next.name)changes.push(`name: ${previous.name} → ${next.name}`);
  return{before,after,changes,identical:changes.length===0&&JSON.stringify(canonical({...previous,protocol_id:null,project_id:null,version:null,version_name:null,status:null,created_at:null,updated_at:null,frozen_at:null,config_hash:null}))===JSON.stringify(canonical({...next,protocol_id:null,project_id:null,version:null,version_name:null,status:null,created_at:null,updated_at:null,frozen_at:null,config_hash:null}))};
}
const samQuestionnaire=()=>({questionnaire_id:uid('questionnaire'),name:'SAM and emotion label',questions:[{question_id:uid('question'),type:'sam_valence',required:true,prompt_i18n:{zh:'此刻您的愉悦程度如何？',ja:'現在の快・不快の程度を教えてください。',en:'How pleasant do you feel right now?'},scale_min:1,scale_max:9},{question_id:uid('question'),type:'sam_arousal',required:true,prompt_i18n:{zh:'此刻您的唤醒程度如何？',ja:'現在の覚醒度を教えてください。',en:'How aroused do you feel right now?'},scale_min:1,scale_max:9},{question_id:uid('question'),type:'single_choice',required:true,prompt_i18n:{zh:'请选择最符合的情绪标签',ja:'最も近い感情ラベルを選んでください',en:'Choose the closest emotion label'},options_i18n:{zh:['A','B','C','D','E','F'],ja:['A','B','C','D','E','F'],en:['A','B','C','D','E','F']}}]});
export function emotionTemplate(){const conditions=['HVHA','LVHA','LVLA','HVLA','NVLA'],sharedQ=samQuestionnaire();return protocol({name:'Five-condition emotion physiology experiment',version_name:'Emotion template v1',blocks:[block({name:'Main emotion block',order_rule:'latin_square',trials:conditions.map((c,i)=>trial({name:`Emotion trial ${i+1}`,condition:c,steps:[step('fixation',{name:'Baseline',role:'baseline',analysis_label:'baseline',is_analysis_window:true,planned_duration_ms:30000}),step('video',{name:`${c} video`,role:'stimulus',analysis_label:'stimulus',is_analysis_window:true,stimulus_id:c}),step('questionnaire',{name:'SAM and emotion label',duration_mode:'manual',questionnaire_id:sharedQ.questionnaire_id,questionnaire:samQuestionnaire()}),step('rest',{name:'Recovery',role:'recovery',analysis_label:'recovery',is_analysis_window:true,planned_duration_ms:30000})]}))})],stimuli:conditions.map(c=>({stimulus_id:c,name:c,type:'video',file_name:`${c}.mp4`,checksum:'',metadata:{target_condition:c}})),questionnaires:[sharedQ]})}

// ── Stroop Task Template ──
// Classic color-word Stroop: participants see color names displayed in colored ink
// and must respond with the ink color (not the word). Congruent = word matches ink,
// Incongruent = word conflicts with ink.
function stroopStimuli() {
  const colors = [
    { name: 'Red',    hex: '#E53935', key: 'r' },
    { name: 'Green',  hex: '#43A047', key: 'g' },
    { name: 'Blue',   hex: '#1E88E5', key: 'b' },
    { name: 'Yellow', hex: '#FDD835', key: 'y' },
  ];
  const trials = [];
  // Generate congruent (word=color) and incongruent (word≠color) trials
  colors.forEach(ink => {
    colors.forEach(word => {
      const congruency = ink.name === word.name ? 'congruent' : 'incongruent';
      trials.push({
        condition: congruency,
        word: word.name,
        ink_color: ink.name,
        ink_hex: ink.hex,
        correct_key: ink.key,
      });
    });
  });
  return { colors, trials };
}

export function stroopTemplate() {
  const { trials: stroopTrials } = stroopStimuli();
  const practiceBlock = block({
    name: 'Stroop practice',
    is_practice: true,
    order_rule: 'random',
    repeat_count: 1,
    max_consecutive_same: 2,
    trials: stroopTrials.slice(0, 8).map((t, i) => trial({
      name: `Practice ${i + 1}`,
      condition: t.condition,
      steps: [
        step('fixation', { name: 'Fixation', planned_duration_ms: 500, show_countdown_ring: false }),
        step('response', {
          name: `Stroop: ${t.word} in ${t.ink_color}`,
          duration_mode: 'fixed',
          planned_duration_ms: 2000,
          response_variable: 'stroop_response',
          response_required: true,
          response_auto_advance: true,
          response_options: [
            { value: t.correct_key, key: t.correct_key, label_i18n: { en: t.ink_color, zh: t.ink_color, ja: t.ink_color } },
          ],
          content_i18n: { en: t.word, zh: t.word, ja: t.word },
          appearance: { color: t.ink_hex, font_size: '2.5rem', alignment: 'center' },
        }),
        step('rest', { name: 'ITI', planned_duration_ms: 500, show_countdown_ring: false }),
      ],
      iti_jitter_ms: 300,
      iti_jitter_distribution: 'uniform',
    })),
  });
  const mainBlock = block({
    name: 'Stroop main task',
    order_rule: 'random',
    repeat_count: 2,
    max_consecutive_same: 3,
    no_immediate_repeat: false,
    trials: stroopTrials.map((t, i) => trial({
      name: `Stroop ${i + 1}`,
      condition: t.condition,
      steps: [
        step('fixation', { name: 'Fixation', planned_duration_ms: 500, show_countdown_ring: false }),
        step('response', {
          name: `Stroop: ${t.word} in ${t.ink_color}`,
          duration_mode: 'fixed',
          planned_duration_ms: 2000,
          response_variable: 'stroop_response',
          response_required: true,
          response_auto_advance: true,
          response_options: [
            { value: t.correct_key, key: t.correct_key, label_i18n: { en: t.ink_color, zh: t.ink_color, ja: t.ink_color } },
          ],
          content_i18n: { en: t.word, zh: t.word, ja: t.word },
          appearance: { color: t.ink_hex, font_size: '2.5rem', alignment: 'center' },
        }),
        step('rest', { name: 'ITI', planned_duration_ms: 500, show_countdown_ring: false }),
      ],
      iti_jitter_ms: 300,
      iti_jitter_distribution: 'uniform',
    })),
  });
  return protocol({
    name: 'Stroop color-word task',
    version_name: 'Stroop template v1',
    blocks: [practiceBlock, mainBlock],
    stimuli: [],
    questionnaires: [],
  });
}

// ── Go/No-Go Task Template ──
// Participants respond to "Go" stimuli and withhold response to "No-Go" stimuli.
// Typically 70% Go, 30% No-Go to build prepotent response tendency.
export function gonogoTemplate() {
  const goStimulus = { type: 'go', label: 'Go (press space)', key: ' ', color: '#43A047', shape: '●' };
  const nogoStimulus = { type: 'nogo', label: 'No-Go (withhold)', key: null, color: '#E53935', shape: '■' };
  // 70% Go, 30% No-Go
  const trialDefs = [];
  for (let i = 0; i < 40; i++) trialDefs.push(i < 28 ? goStimulus : nogoStimulus);

  const practiceBlock = block({
    name: 'Go/No-Go practice',
    is_practice: true,
    order_rule: 'random',
    repeat_count: 1,
    trials: trialDefs.slice(0, 10).map((t, i) => trial({
      name: `Practice ${i + 1}`,
      condition: t.type,
      steps: [
        step('fixation', { name: 'Fixation', planned_duration_ms: 500, show_countdown_ring: false }),
        step('response', {
          name: t.label,
          duration_mode: 'fixed',
          planned_duration_ms: 1000,
          response_variable: 'gonogo_response',
          response_required: false,
          response_auto_advance: true,
          response_options: [
            { value: 'press', key: ' ', label_i18n: { en: 'Press', zh: '按键', ja: '押す' } },
          ],
          content_i18n: { en: t.shape, zh: t.shape, ja: t.shape },
          appearance: { color: t.color, font_size: '3rem', alignment: 'center' },
        }),
        step('rest', { name: 'ITI', planned_duration_ms: 500, show_countdown_ring: false }),
      ],
      iti_jitter_ms: 250,
      iti_jitter_distribution: 'uniform',
    })),
  });

  const mainBlock = block({
    name: 'Go/No-Go main task',
    order_rule: 'random',
    repeat_count: 2,
    max_consecutive_same: 4,
    no_immediate_repeat: false,
    trials: trialDefs.map((t, i) => trial({
      name: `Trial ${i + 1}`,
      condition: t.type,
      steps: [
        step('fixation', { name: 'Fixation', planned_duration_ms: 500, show_countdown_ring: false }),
        step('response', {
          name: t.label,
          duration_mode: 'fixed',
          planned_duration_ms: 1000,
          response_variable: 'gonogo_response',
          response_required: false,
          response_auto_advance: true,
          response_options: [
            { value: 'press', key: ' ', label_i18n: { en: 'Press', zh: '按键', ja: '押す' } },
          ],
          content_i18n: { en: t.shape, zh: t.shape, ja: t.shape },
          appearance: { color: t.color, font_size: '3rem', alignment: 'center' },
        }),
        step('rest', { name: 'ITI', planned_duration_ms: 500, show_countdown_ring: false }),
      ],
      iti_jitter_ms: 250,
      iti_jitter_distribution: 'uniform',
    })),
  });

  return protocol({
    name: 'Go/No-Go inhibition task',
    version_name: 'Go/No-Go template v1',
    blocks: [practiceBlock, mainBlock],
    stimuli: [],
    questionnaires: [],
  });
}


// Per-step content-level checks — softer than protocol validation; used for inline hints.
export function stepContentIssues(step, stimuli, questionnaires) {
  const issues = [];
  const resource = stimuli?.find(s => s.stimulus_id === step.stimulus_id);
  const questionnaire = step.questionnaire || questionnaires?.find(q => q.questionnaire_id === step.questionnaire_id);

  if (['video','audio','image'].includes(step.type)) {
    const hasSource = step.source_url || step.asset_id || resource?.source_url || resource?.asset_id;
    if (!hasSource) issues.push({ kind: 'error', key: 'missing_media', message: 'No media source — enter a «Source URL» or upload a file' });
  }
  if (['instruction','response','manual_event','device_check'].includes(step.type)) {
    const empty = !Object.values(step.content_i18n || {}).some(t => t?.trim());
    // Response nodes use buttons/options, not content text — empty content is only advisory
    // Instruction and device_check benefit from content text but it's not blocking
    if (empty) issues.push({ kind: step.type === 'response' ? 'warn' : 'warn', key: 'empty_content', message: step.type === 'response' ? 'No instruction text — the response buttons are the primary interface' : 'Content is empty — fill in «Participant content» in at least one language for clearer participant guidance' });
  }
  if (step.type === 'response') {
    if (!String(step.response_variable || '').trim()) issues.push({ kind: 'error', key: 'missing_response_variable', message: 'Response variable is empty — set a name such as response or rating' });
    if (!(step.response_options || []).length) issues.push({ kind: 'error', key: 'missing_response_options', message: 'No response options — add at least one value/label/key row' });
    (step.response_options || []).forEach((option, index) => {
      if (!String(option.value || '').trim()) issues.push({ kind: 'error', key: 'missing_response_value', message: `Option ${index + 1}: value is empty` });
      if (!Object.values(option.label_i18n || {}).some(text => text?.trim())) issues.push({ kind: 'error', key: 'missing_response_label', message: `Option ${index + 1}: label is empty` });
    });
  }
  if (step.type === 'questionnaire') {
    if ((step.questionnaire_mode || 'internal') === 'external') {
      if (!step.external_form_url?.trim()) issues.push({ kind: 'error', key: 'missing_external_form', message: 'External form URL is empty — paste a Google Forms, Qualtrics, or survey link' });
    } else if (!questionnaire?.questions?.length) issues.push({ kind: 'error', key: 'empty_questionnaire', message: 'No questions — click «Add question» in the questionnaire designer' });
    else questionnaire.questions.forEach((q, qi) => {
      if (!Object.values(q.prompt_i18n || {}).some(t => t?.trim())) issues.push({ kind: 'warn', key: 'empty_prompt', message: `Q${qi + 1}: «Prompt» is empty — add a question title in at least one language` });
      if (['single_choice','multiple_choice'].includes(q.type) && q.required && !Object.values(q.options_i18n || {}).some(o => o?.some(x => x?.trim()))) issues.push({ kind: 'error', key: 'missing_options', message: `Q${qi + 1}: «Options» are empty — add at least one choice option` });
    });
  }
  if (step.type === 'attention_check') {
    if (!step.attention_expected_key?.trim()) issues.push({ kind: 'warn', key: 'missing_expected_key', message: '«Expected key» is empty — set the key the participant must press (e.g. space)' });
    const promptEmpty = !Object.values(step.attention_prompt_i18n || {}).some(t => t?.trim());
    if (promptEmpty) issues.push({ kind: 'warn', key: 'empty_prompt', message: '«Prompt» is empty — the participant will not know what to do' });
  }
  if ((step.type === 'fixation' || step.type === 'timer' || step.type === 'rest') && step.duration_mode === 'fixed' && (!step.planned_duration_ms || step.planned_duration_ms <= 0)) {
    issues.push({ kind: 'warn', key: 'zero_dur', message: '«Duration» is 0ms — this step will end immediately unless you set a duration' });
  }
  return issues;
}
