import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Unregister ALL service workers and clear ALL caches
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister());
  });
  caches.keys().then(keys => {
    keys.forEach(key => caches.delete(key));
  });
}

const root = document.getElementById('root');
if (!root) {
  document.body.innerHTML = '<h1 style="color:white">ROOT NOT FOUND</h1>';
} else {
  try {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch(e) {
    root.innerHTML = '<pre style="color:red;padding:20px">' + e.message + '\n' + e.stack + '</pre>';
  }
}
