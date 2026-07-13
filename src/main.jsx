import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { LanguageProvider } from './i18n';
import './style.css';
import './i18n.css';
import './questionnaire.css';
import './flow.css';
import './flow-controls.css';
import './runner-extra.css';
import './dashboard.css';
import './analytics.css';
import './sessions.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('PhysioFlow crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      return React.createElement('div', {
        style: {
          padding: '2rem', margin: '2rem auto', maxWidth: 600,
          background: '#fff3f2', borderRadius: 8, border: '1px solid #ffcdcb',
          fontFamily: 'system-ui, sans-serif',
        }
      },
        React.createElement('h2', { style: { color: '#a32e25', marginTop: 0 } }, 'App Error'),
        React.createElement('pre', {
          style: { whiteSpace: 'pre-wrap', fontSize: '.8rem', color: '#5a2e25', lineHeight: 1.5 }
        }, this.state.error?.stack || this.state.error?.message || String(this.state.error)),
        React.createElement('button', {
          onClick: () => { this.setState({ error: null }); window.location.reload(); },
          style: { marginTop: '1rem', padding: '.6rem 1.2rem', border: '1px solid #a32e25', borderRadius: 6, background: 'white', cursor: 'pointer', color: '#a32e25' }
        }, 'Reload'),
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) {
  document.body.innerHTML = '<div style="padding:2rem;font-family:system-ui,sans-serif;color:#a32e25"><h2>Fatal Error</h2><p>Root element #root not found. Ensure index.html loads before this script.</p></div>';
  throw new Error('#root element not found');
}

// Toast container rendered outside React tree for global availability
const toastRoot = document.createElement('div');
toastRoot.className = 'toast-container';
toastRoot.id = 'toast-root';
document.body.appendChild(toastRoot);

// Dark mode init — apply before React renders to avoid flash
if (localStorage.getItem('physioflow.dark-mode') === '1') {
  document.documentElement.classList.add('dark-mode');
  document.documentElement.classList.remove('light-mode');
} else {
  document.documentElement.classList.add('light-mode');
  document.documentElement.classList.remove('dark-mode');
}

createRoot(root).render(
  React.createElement(React.StrictMode, null,
    React.createElement(ErrorBoundary, null,
      React.createElement(LanguageProvider, null,
        React.createElement(App, null)
      )
    )
  )
);

// Register service worker for PWA offline support (web only)
if ('serviceWorker' in navigator && !window.__TAURI_INTERNALS__) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
