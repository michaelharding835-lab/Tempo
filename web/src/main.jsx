import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/outfit'
import './styles.css'
import App from './App'
import { SettingsProvider } from './lib/settings'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
)

// Offline shell + "Add to Home Screen" support (skipped in previews and dev).
if ('serviceWorker' in navigator && import.meta.env.PROD && import.meta.env.MODE !== 'preview' && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
