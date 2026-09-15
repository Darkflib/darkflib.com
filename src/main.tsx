// Global styles load before any component styles so component rules win ties.
import './styles/reset.css'
import './styles/fonts.css'
import './styles/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startServiceWorker } from './telemetry/serviceWorker'

// Before React renders: the worker's message listener must exist before the page's client message queue opens, or
// early messages (observed requests from this page load) are dropped. Registration itself still waits for load.
startServiceWorker()

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
