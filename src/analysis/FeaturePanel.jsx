import { seriesColor } from './chartGeometry.js';

// Feature panel (D8): renders the output of the D7 analysis pipeline.
//
// Each feature family gets the view that suits it — HRV as labelled metrics,
// band power as a stacked bar, EDA as tonic level plus SCR count. The panel is
// deliberately dumb: it draws what the pipeline already computed, and says so
// when a feature is missing rather than inventing a number.

const BAND_ORDER = ['delta', 'theta', 'alpha', 'beta', 'gamma'];
const HRV_BAND_ORDER = ['vlf', 'lf', 'hf'];

export default function FeaturePanel({ analysis, title = 'Analysis' }) {
  if (!analysis || !analysis.channels) {
    return <div className="viz-empty">No analysis results yet.</div>;
  }
  const entries = Object.entries(analysis.channels);
  if (!entries.length) return <div className="viz-empty">No channels were analysed.</div>;

  return (
    <div className="viz-features">
      <div className="viz-features-head">
        <h4>{title}</h4>
        <span className="viz-muted">
          {analysis.sampleRateHz ? `${analysis.sampleRateHz} Hz` : 'sample rate unknown'}
          {' · '}{entries.length} channel{entries.length === 1 ? '' : 's'}
        </span>
      </div>

      {analysis.warnings?.length > 0 && (
        <ul className="viz-warnings">
          {analysis.warnings.map((warning, i) => <li key={i}>{warning}</li>)}
        </ul>
      )}

      {entries.map(([id, entry], index) => (
        <ChannelFeatures key={id} id={id} entry={entry} color={seriesColor(index)} />
      ))}
    </div>
  );
}

function ChannelFeatures({ id, entry, color }) {
  const { features = {}, missing = 0, rejectedSamples = 0 } = entry;
  const generic = features.generic || {};
  return (
    <section className="viz-feature-card">
      <header>
        <i className="viz-swatch" style={{ background: color }} />
        <b>{id}</b>
        <span className="viz-kind">{features.kind}</span>
      </header>

      <div className="viz-metric-row">
        <Metric label="mean" value={generic.mean} />
        <Metric label="sd" value={generic.sd} />
        <Metric label="min" value={generic.min} />
        <Metric label="max" value={generic.max} />
        <Metric label="rms" value={generic.rms} />
        <Metric label="peak Hz" value={generic.dominantFrequencyHz} />
      </div>

      {missing > 0 && <p className="viz-note">{missing} missing sample(s) were interpolated before analysis.</p>}
      {rejectedSamples > 0 && <p className="viz-note">{rejectedSamples} sample(s) were replaced as artefacts.</p>}

      {generic.bands && <BandBar bands={generic.bands} order={HRV_BAND_ORDER} title="Power bands (relative)" />}
      {features.kind === 'eeg' && generic.bands && <BandBar bands={generic.bands} order={BAND_ORDER} title="EEG bands (relative)" />}

      {features.hrv && <HrvBlock hrv={features.hrv} />}
      {features.eda && <EdaBlock eda={features.eda} />}
    </section>
  );
}

function HrvBlock({ hrv }) {
  const time = hrv.time || {};
  const freq = hrv.frequency || {};
  return (
    <div className="viz-block">
      <h5>HRV</h5>
      <div className="viz-metric-row">
        <Metric label="mean HR" value={time.meanHR} unit="bpm" />
        <Metric label="mean RR" value={time.meanRR} unit="ms" />
        <Metric label="SDNN" value={time.sdnn} unit="ms" />
        <Metric label="RMSSD" value={time.rmssd} unit="ms" />
        <Metric label="pNN50" value={time.pnn50} unit="%" />
        <Metric label="LF/HF" value={freq.lfHfRatio} />
      </div>
      <p className="viz-note">
        {hrv.peakCount} peaks; {hrv.rejectedIntervals} physiologically implausible interval(s) excluded.
        {time.n < 4 && ' Too few intervals for a reliable frequency-domain estimate.'}
      </p>
    </div>
  );
}

function EdaBlock({ eda }) {
  return (
    <div className="viz-block">
      <h5>EDA</h5>
      <div className="viz-metric-row">
        <Metric label="tonic mean" value={eda.tonic?.mean} unit="uS" />
        <Metric label="phasic sd" value={eda.phasic?.sd} unit="uS" />
        <Metric label="SCR count" value={eda.scrCount} />
        <Metric label="SCR rate" value={eda.scrRatePerMinute} unit="/min" />
        <Metric label="SCR amp" value={eda.scrMeanAmplitude} unit="uS" />
      </div>
    </div>
  );
}

function BandBar({ bands, order, title }) {
  const entries = order.filter(name => bands[name]).map(name => [name, bands[name].relative || 0]);
  const total = entries.reduce((sum, [, v]) => sum + v, 0) || 1;
  return (
    <div className="viz-block">
      <h5>{title}</h5>
      <div className="viz-bandbar">
        {entries.map(([name, value], i) => (
          <span
            key={name}
            className="viz-band"
            style={{ width: `${(value / total) * 100}%`, background: seriesColor(i) }}
            title={`${name}: ${(value * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="viz-band-legend">
        {entries.map(([name, value], i) => (
          <span key={name}>
            <i style={{ background: seriesColor(i) }} />
            {name} {(value * 100).toFixed(1)}%
          </span>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, unit = '' }) {
  return (
    <span className="viz-metric">
      <em>{label}</em>
      <b>{Number.isFinite(value) ? format(value) : '—'}</b>
      {unit && <small>{unit}</small>}
    </span>
  );
}

function format(value) {
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 0.01) return value.toFixed(3);
  return value.toExponential(2);
}
