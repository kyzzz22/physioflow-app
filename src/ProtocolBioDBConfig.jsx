import { useState } from 'react';
import { useT } from './i18n';
import { experimentIdOf, experimentLabelOf, withBioDBConfig } from './core/protocolSelectors.js';
import { listBioDBExperiments } from './bioDBClient.js';

// Protocol-level BioDB experiment mapping (D2): choose an experiment from the
// BioDB registry (or type the id manually); stored in protocol.biodb.
export default function ProtocolBioDBConfig({ protocol, settings, onChange, onClose }) {
  const t = useT();
  const [experimentId, setExperimentId] = useState(experimentIdOf(protocol) || '');
  const [experimentLabel, setExperimentLabel] = useState(experimentLabelOf(protocol) || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [experiments, setExperiments] = useState([]);
  const [selected, setSelected] = useState('');

  const biodbCfg = (settings && settings.biodb) || {};

  const loadExperiments = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listBioDBExperiments(biodbCfg, 'pf_experiment_browser');
      setExperiments(list || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const pick = (id) => {
    const exp = experiments.find(e => (e.experiment_id || e.experimentId) === id);
    setExperimentId(id);
    setExperimentLabel(exp ? (exp.experiment_name || exp.name || exp.experimentLabel || '') : '');
  };

  const save = () => {
    onChange(withBioDBConfig(protocol, { experimentId: experimentId.trim(), experimentLabel: experimentLabel.trim() }));
    onClose();
  };

  const list = experiments || [];
  const hasCfg = Boolean(biodbCfg.userId && biodbCfg.token);

  return (
    <div className="qw-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div className="theme-settings-panel">
        <div className="qw-header">
          <div className="qw-header-left">
            <span className="qw-badge">BIODB</span>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{t('Protocol BioDB experiment mapping')}</h3>
          </div>
          <button className="qw-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="theme-body">
          <section className="theme-section">
            <h4>{t('Experiment')}</h4>
            {!hasCfg && (
              <p className="field-hint bio-warn">{t('connect BioDB first hint')}</p>
            )}
            <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.6rem' }}>
              <button className="qbtn" onClick={loadExperiments} disabled={loading || !hasCfg}>
                {loading ? '…' : t('Load BioDB experiments')}
              </button>
            </div>
            {list.length > 0 && (
              <select className="field-input" value={selected}
                onChange={e => { setSelected(e.target.value); pick(e.target.value); }}>
                <option value="">{t('Select an experiment')}</option>
                {list.map(exp => {
                  const id = exp.experiment_id || exp.experimentId;
                  const name = exp.experiment_name || exp.name || exp.experimentLabel || id;
                  return <option key={id} value={id}>{name} — {id}</option>;
                })}
              </select>
            )}
            {error && <p className="bio-status-err">✗ {error}</p>}
            <label className="field-label">
              {t('experiment_id')}
              <input className="field-input" type="text" value={experimentId}
                onChange={e => setExperimentId(e.target.value)} placeholder="e.g. exp_xxxxx" />
            </label>
            <label className="field-label">
              {t('Experiment label')}
              <input className="field-input" type="text" value={experimentLabel}
                onChange={e => setExperimentLabel(e.target.value)} placeholder={t('Experiment label')} />
            </label>
          </section>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginTop: '1rem' }}>
            <button className="qbtn" onClick={onClose}>{t('Cancel')}</button>
            <button className="qbtn" onClick={save}>{t('Save')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
