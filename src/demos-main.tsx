// The /demos/ page (demos/index.html). Same global styles and service worker start as the home page (src/main.tsx).
import './styles/reset.css'
import './styles/fonts.css'
import './styles/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Demos } from './Demos'
import { startServiceWorker } from './telemetry/serviceWorker'

startServiceWorker()

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <Demos />
  </StrictMode>,
)
