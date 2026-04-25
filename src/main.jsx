import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/globals.css';

// On Android (Capacitor) builds, install the window.electron shim before
// anything else renders so every component sees a consistent API.
if (import.meta.env.VITE_PLATFORM === 'android') {
  await import('./capacitor-shim.js');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
