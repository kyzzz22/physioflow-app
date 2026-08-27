import { useState } from 'react';
import { useT } from './i18n';
import { bioDBDefaultSettings, testBioDBConnection } from './bioDBClient.js';

// BioDB global connection settings (D2): baseUrl + user_id + long-term token.
export default function BioDBSettings({ settings, onSave, onClose }) {
  const t = useT();
  const current = (settings && settings.biodb) || {};
  const [baseUrl, setBaseUrl] = useState(current.baseUrl || bioDBDefaultSettings().baseUrl);
  const [userId, setUserId] = useState(current.userId || '');
  const [token, setToken] = useState(current.token || '');
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(null); // {ok, message}

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      await testBioDBConnection({ baseUrl, userId, token });
      setStatus({ ok: true, message: t('Connection OK') });
    } catch (err) {
      setStatus({ ok: false, message: err.message || String(err) });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    onSave({ ...settings, biodb: { baseUrl: baseUrl.trim(), userId: userId.trim(), token: token.trim() } });
    onClose();
  };

  return (
    <div className="qw-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div className="theme-settings-panel">
        <div className="qw-header">
          <div className="qw-header-left">
            <span className="qw-badge">BIODB</span>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{t('BioDB connection settings')}</h3>
          </div>
          <button className="qw-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="theme-body">
          <section className="theme-section">
            <h4>{t('Connection')}</h4>
            <label className="field-label">
              {t('Base URL')}
              <input className="field-input" type="text" value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)} placeholder="http://localhost:5002" />
            </label>
            <label className="field-label">
              {t('User ID')}
              <input className="field-input" type="text" value={userId}
                onChange={e => setUserId(e.target.value)} placeholder={t('user_id from BioDB admin')} />
            </label>
            <label className="field-label">
              {t('Long-term token')}
              <input className="field-input" type="password" value={token}
                onChange={e => setToken(e.target.value)} placeholder="••••••••••••••••" />
            </label>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginTop: '.6rem' }}>
              <button className="qbtn" onClick={test} disabled={testing || !userId || !token}>
                {testing ? '…' : t('Test connection')}
              </button>
              {status && (
                <span className={status.ok ? 'bio-status-ok' : 'bio-status-err'}>
                  {status.ok ? '✓ ' : '✗ '}{status.message}
                </span>
              )}
            </div>
          </section>

          <section className="theme-section">
            <h4>{t('Experiment / participant mapping')}</h4>
            <p className="field-hint">
              {t('experiment mapping hint')}
            </p>
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
