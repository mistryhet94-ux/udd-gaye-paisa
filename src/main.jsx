import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Clear stale service worker caches on every load
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    // Only unregister if we detect a version mismatch via a flag
    // We use a version key to force refresh when app updates
    const currentVersion = '1.2.0';
    const cachedVersion = localStorage.getItem('ugp_sw_version');
    if (cachedVersion !== currentVersion) {
      regs.forEach(reg => reg.unregister());
      caches.keys().then(keys => keys.forEach(key => caches.delete(key)));
      localStorage.setItem('ugp_sw_version', currentVersion);
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
