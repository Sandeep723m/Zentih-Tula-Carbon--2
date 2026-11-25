import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/ibm-plex-sans'
import 'lenis/dist/lenis.css'
import './styles/index.css'
import { startSmoothScroll } from './components/smoothScroll'
import App from './App.tsx'

startSmoothScroll()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
