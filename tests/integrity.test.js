import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSession } from '../src/integrity.js';
import { bundle, stimulusManifest, windows, zipBundle } from '../src/exporter.js';
import { block, protocol, step, trial } from '../src/domain.js';
import { withSessionIntegrity } from '../src/sessionReview.js';

const fixture = () => {
  const s=step('questionnaire',{name:'Survey',questionnaire:{questionnaire_id:'q',questions:[{question_id:'a',type:'short_text',required:true,prompt_i18n:{en:'Answer'}}]}});
  const p=protocol({config_hash:'hash',blocks:[block({trials:[trial({steps:[s]})]})]});
  const base={session_id:'S',participant_id:'P',protocol_id:p.protocol_id,protocol_version:1,block_id:p.blocks[0].block_id,trial_id:p.blocks[0].trials[0].trial_id,step_id:s.step_id,condition:'',elapsed_monotonic_ms:0,timestamp_epoch_ms:1,metadata:{node_id:'n'}};
  return {p,s,base};
};

test('integrity rejects an entered questionnaire without a terminal event',()=>{
  const {p,base}=fixture();const report=assessSession({session:{status:'completed',protocol_hash:'hash'},protocol:p,events:[{...base,event_type:'step_entered'}],responses:[]});assert.equal(report.validity_status,'invalid');assert.ok(report.errors.some(error=>error.includes('no terminal')));
});

test('skipped and retried attempts are terminal but remain integrity warnings',()=>{const {p,base}=fixture(),events=[{...base,event_type:'step_entered',elapsed_monotonic_ms:1},{...base,event_type:'step_skipped',elapsed_monotonic_ms:2},{...base,event_type:'step_entered',elapsed_monotonic_ms:3},{...base,event_type:'step_retried',elapsed_monotonic_ms:4}];const report=assessSession({session:{},protocol:p,events});assert.equal(report.errors.some(message=>message.includes('terminal')),false);assert.equal(report.facts.skips,1);assert.equal(report.facts.retries,1)});

test('bundle contains required raw files and integrity report',()=>{
  const {p,base}=fixture();const events=[{...base,event_id:'e1',event_type:'step_entered',timestamp_iso:'x',event_status:'ok'},{...base,event_id:'e2',event_type:'step_completed',elapsed_monotonic_ms:10,timestamp_iso:'x',event_status:'ok'},{...base,event_id:'e3',event_type:'questionnaire_submitted',elapsed_monotonic_ms:9,timestamp_iso:'x',event_status:'ok'},{...base,event_id:'e4',event_type:'session_completed',elapsed_monotonic_ms:11,timestamp_iso:'x',event_status:'ok'}];const responses=[{response_id:'r',session_id:'S',participant_id:'P',question_id:'choice',question_type:'response_choice',value:'left',option_label:'Left',response_key:'1',reaction_time_ms:432,submitted_epoch_ms:2}];const files=bundle({session_id:'S',status:'completed',protocol_hash:'hash'},p,events,responses);['README.txt','export_manifest.json','session.json','protocol.json','events.csv','responses.csv','analysis_windows.csv','stimulus_manifest.csv','data_dictionary.csv','integrity_report.json'].forEach(name=>assert.ok(files[name]));assert.equal(JSON.parse(files['export_manifest.json']).counts.events,4);assert.ok(files['data_dictionary.csv'].includes('elapsed_monotonic_ms'));assert.ok(files['data_dictionary.csv'].includes('manual_event_confirmed metadata'));assert.ok(files['data_dictionary.csv'].includes('external_questionnaire_confirmed metadata'));assert.ok(files['data_dictionary.csv'].includes('reaction_time_ms'));assert.ok(files['responses.csv'].includes('response_key'));assert.ok(files['responses.csv'].includes('432'));assert.ok(files['README.txt'].includes('external_questionnaire_* events'));
});

test('session integrity is normalized before storage or review save',()=>{
  const {p,base}=fixture();
  const events=[
    {...base,event_id:'e1',event_type:'step_entered',elapsed_monotonic_ms:1},
    {...base,event_id:'e2',event_type:'questionnaire_submitted',elapsed_monotonic_ms:4},
    {...base,event_id:'e3',event_type:'step_completed',elapsed_monotonic_ms:5},
    {...base,event_id:'e4',event_type:'session_completed',elapsed_monotonic_ms:6},
  ];
  const responses=[{response_id:'r1',session_id:'S',participant_id:'P',question_id:'a',value:'ok'}];
  const reviewed=withSessionIntegrity({session_id:'S',participant_id:'P',status:'completed',researcher_validity:'valid',protocol_snapshot:p,events,responses});
  assert.equal(reviewed.event_count,4);
  assert.equal(reviewed.researcher_validity,'valid');
  assert.equal(reviewed.integrity.validity_status,'valid');
  assert.equal(reviewed.integrity.facts.responses,1);
});

test('analysis windows pair repeated node occurrences in sequence',()=>{
  const {p,s,base}=fixture();s.is_analysis_window=true;
  const events=[
    {...base,event_id:'start-1',event_type:'step_entered',elapsed_monotonic_ms:10},
    {...base,event_id:'end-1',event_type:'step_completed',elapsed_monotonic_ms:20},
    {...base,event_id:'start-2',event_type:'step_entered',elapsed_monotonic_ms:30},
    {...base,event_id:'pause',event_type:'session_paused',elapsed_monotonic_ms:35},
    {...base,event_id:'end-2',event_type:'step_completed',elapsed_monotonic_ms:50},
  ];
  const result=windows(events,p);
  assert.deepEqual(result.map(item=>item.end_event_id),['end-1','end-2']);
  assert.deepEqual(result.map(item=>item.duration_ms),[10,20]);
  assert.equal(result[1].validity_status,'attention');
});

test('analysis pairing does not require terminal events to repeat node metadata',()=>{const {p,s,base}=fixture();s.is_analysis_window=true;const result=windows([{...base,event_id:'start',event_type:'step_entered',elapsed_monotonic_ms:1,metadata:{node_id:'node-1'}},{...base,event_id:'end',event_type:'step_completed',elapsed_monotonic_ms:9,metadata:{}}],p);assert.equal(result[0].end_event_id,'end');assert.equal(result[0].duration_ms,8)});

test('stimulus manifest includes media configured directly on a step',()=>{
  const media=step('audio',{name:'Prompt',source_mode:'upload',asset_id:'asset-1',file_name:'prompt.wav',checksum:'abc'});
  const p=protocol({blocks:[block({trials:[trial({steps:[media]})]})]});
  const [item]=stimulusManifest(p);
  assert.equal(item.asset_id,'asset-1');
  assert.equal(item.file_name,'prompt.wav');
  assert.equal(item.checksum,'abc');
});

test('media analysis windows use actual playback events',()=>{
  const media=step('video',{name:'Clip',source_url:'https://example.test/clip.mp4',is_analysis_window:true,planned_duration_ms:999});
  const p=protocol({blocks:[block({trials:[trial({steps:[media]})]})]});
  const base={session_id:'S',participant_id:'P',block_id:p.blocks[0].block_id,trial_id:p.blocks[0].trials[0].trial_id,step_id:media.step_id,condition:'A',timestamp_epoch_ms:100,metadata:{}};
  const result=windows([
    {...base,event_id:'entered',event_type:'step_entered',elapsed_monotonic_ms:0},
    {...base,event_id:'played',event_type:'media_play_started',elapsed_monotonic_ms:20},
    {...base,event_id:'ended',event_type:'media_ended',elapsed_monotonic_ms:70},
    {...base,event_id:'completed',event_type:'step_completed',elapsed_monotonic_ms:90},
  ],p);
  assert.equal(result[0].start_event_id,'played');
  assert.equal(result[0].end_event_id,'ended');
  assert.equal(result[0].duration_ms,50);
});

test('YouTube analysis windows are exported as unverified presentation time',()=>{const media=step('video',{source_mode:'youtube',source_url:'https://youtu.be/example',duration_mode:'fixed',is_analysis_window:true}),p=protocol({blocks:[block({trials:[trial({steps:[media]})]})]}),base={session_id:'S',participant_id:'P',step_id:media.step_id,elapsed_monotonic_ms:0,timestamp_epoch_ms:1,metadata:{}};const result=windows([{...base,event_id:'start',event_type:'step_entered'},{...base,event_id:'end',event_type:'step_completed',elapsed_monotonic_ms:5000}],p);assert.equal(result[0].validity_status,'attention');assert.equal(result[0].invalid_reason,'youtube_playback_unverified')});

test('complete export is packaged as one valid zip archive',async()=>{
  const blob=zipBundle({'a.txt':'alpha','b.csv':'beta'}),bytes=new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0,4)],[0x50,0x4b,0x03,0x04]);
  assert.ok(bytes.some((_,index)=>bytes[index]===0x50&&bytes[index+1]===0x4b&&bytes[index+2]===0x05&&bytes[index+3]===0x06));
});
test('zip archive sanitizes traversal and reserved filename characters',async()=>{const blob=zipBundle({'../bad:name.txt':'x'}),text=new TextDecoder().decode(await blob.arrayBuffer());assert.ok(text.includes('bad_name.txt'));assert.equal(text.includes('..'),false)});

test('analysis windows include overlapping marker intervals',()=>{
  const item=step('rest',{is_analysis_window:true}),p=protocol({blocks:[block({trials:[trial({steps:[item]})]})]}),base={session_id:'S',participant_id:'P',block_id:'B',trial_id:'T',step_id:item.step_id,condition:'',timestamp_epoch_ms:1,metadata:{}};
  const result=windows([{...base,event_id:'start',event_type:'step_entered',elapsed_monotonic_ms:10},{...base,event_id:'marker-start',event_type:'marker_interval_started',elapsed_monotonic_ms:20,metadata:{marker_id:'m1',marker_type:'movement'}},{...base,event_id:'marker-end',event_type:'marker_interval_ended',elapsed_monotonic_ms:30,metadata:{marker_id:'m1',marker_type:'movement'}},{...base,event_id:'end',event_type:'step_completed',elapsed_monotonic_ms:40}],p);
  assert.equal(result[0].overlapping_markers,'movement:interval');
});

test('integrity warns about an unclosed marker interval',()=>{
  const {p}=fixture(),report=assessSession({session:{},protocol:p,events:[{event_type:'marker_interval_started',metadata:{marker_id:'m1',marker_type:'movement'}}]});
  assert.equal(report.facts.open_marker_intervals,1);assert.ok(report.warnings.some(message=>message.includes('lack an end')));
});
