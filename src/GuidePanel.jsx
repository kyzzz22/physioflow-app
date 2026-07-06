import { useEffect, useState } from 'react';
import { APP_VERSION, CONTROL_NODE_GUIDE, DATA_FORMAT_GUIDE, OUTPUT_FILES, PALETTE, QUICK_START_STEPS, STEP_GUIDE, STORAGE_GUIDE, SYSTEM_GUIDE_SECTIONS } from './constants.js';

export default function GuidePanel({ onClose, initialTab = 'workflow' }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const stepItems = PALETTE.flatMap(group => group.items.map(([type, icon, label]) => ({ type, icon, label, group: group.title })));

  return (
    <div className="guide-backdrop" role="dialog" aria-modal="true" aria-label="PhysioFlow built-in help center">
      <section className="guide-panel">
        <header className="guide-head">
          <div>
            <span>PHYSIOFLOW HELP CENTER</span>
            <h2>System guide and data reference</h2>
            <p>Built-in operator handbook for setup, node behavior, local storage, distribution, and exported data formats.</p>
          </div>
          <button onClick={onClose} aria-label="Close guide">×</button>
        </header>

        <nav className="guide-tabs" aria-label="Guide sections">
          <button className={tab === 'workflow' ? 'active' : ''} onClick={() => setTab('workflow')}>Quick start</button>
          <button className={tab === 'nodes' ? 'active' : ''} onClick={() => setTab('nodes')}>Node manual</button>
          <button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}>Data format</button>
          <button className={tab === 'storage' ? 'active' : ''} onClick={() => setTab('storage')}>Storage &amp; sharing</button>
        </nav>

        {tab === 'workflow' && (
          <div className="guide-content">
            <section className="guide-overview">
              {SYSTEM_GUIDE_SECTIONS.map(([title, text]) => (
                <article key={title}>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </section>
            <div className="guide-steps">
              {QUICK_START_STEPS.map(([number, title, text]) => (
                <article key={number}>
                  <b>{number}</b>
                  <div><h3>{title}</h3><p>{text}</p></div>
                </article>
              ))}
            </div>
            <div className="guide-note">
              <h3>Recommended formal workflow</h3>
              <p>Create the protocol, attach all media, validate, run one preview session, select a local data folder, freeze a reproducible version, then collect formal sessions and export a complete ZIP per participant.</p>
            </div>
          </div>
        )}

        {tab === 'nodes' && (
          <div className="guide-content">
            <section className="guide-node-grid">
              {stepItems.map(item => {
                const guide = STEP_GUIDE[item.type];
                return (
                  <article key={item.type}>
                    <i>{item.icon}</i>
                    <div>
                      <small>{item.group}</small>
                      <h3>{item.label}</h3>
                      <p>{guide.summary}</p>
                      <p><b>Setup:</b> {guide.setup}</p>
                      <p><b>Export:</b> {guide.output}</p>
                    </div>
                  </article>
                );
              })}
            </section>
            <section className="guide-control-list">
              {Object.entries(CONTROL_NODE_GUIDE).map(([type, guide]) => (
                <article key={type}>
                  <b>{type}</b>
                  <p>{guide.summary}</p>
                  <small>{guide.setup}</small>
                </article>
              ))}
            </section>
          </div>
        )}

        {tab === 'data' && (
          <div className="guide-content">
            <div className="guide-note">
              <h3>Session ZIP contents</h3>
              <p>Exports are local files. CSV files include a UTF-8 BOM for spreadsheet compatibility, and every ZIP includes both a human README and a machine-readable data dictionary.</p>
            </div>
            <section className="guide-control-list guide-data-list">
              {DATA_FORMAT_GUIDE.map(([file, description]) => (
                <article key={file}>
                  <b>{file}</b>
                  <p>{description}</p>
                </article>
              ))}
            </section>
            <div className="guide-table">
              {OUTPUT_FILES.map(([file, description]) => (
                <div key={file}>
                  <code>{file}</code>
                  <span>{description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'storage' && (
          <div className="guide-content">
            <div className="guide-note">
              <h3>Click-to-use distribution</h3>
              <p>Use the desktop build for the easiest handoff. It writes data to a normal local folder, so lab operators can back it up, inspect it, and move it without relying on browser cache.</p>
            </div>
            <section className="guide-control-list guide-storage-list">
              {STORAGE_GUIDE.map(([title, description]) => (
                <article key={title}>
                  <b>{title}</b>
                  <p>{description}</p>
                </article>
              ))}
            </section>
            <div className="guide-callout">
              <b>Default desktop data folder</b>
              <code>~/Documents/PhysioFlow Data</code>
              <span>Share release-desktop/PhysioFlow_{APP_VERSION}_aarch64.dmg for macOS Apple Silicon, or build native installers on Windows/Linux before distributing to those systems.</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
