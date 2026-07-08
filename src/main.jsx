import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Register minimal service worker for notifications only (no caching)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then(reg => console.log('SW registered:', reg.scope))
    .catch(err => console.warn('SW failed:', err));
}

const root = document.getElementById('root');

try {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (e) {
  root.innerHTML = `<div style="background:#07080f;min-height:100vh;padding:24px;font-family:monospace">
    <h2 style="color:#ff5e7d">App crashed on startup</h2>
    <pre style="color:#fca5a5;font-size:12px;white-space:pre-wrap">${e.message}\n${e.stack}</pre>
  </div>`;
}
