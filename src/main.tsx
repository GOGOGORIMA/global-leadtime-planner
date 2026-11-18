import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { migrateLegacyStorage } from './utils/storage'

// Before the first render: the planner restores its last session from LocalStorage on start-up.
migrateLegacyStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
