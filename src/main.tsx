import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// No StrictMode: the app performs one-time side effects on start (open last map, routing)
createRoot(document.getElementById('root')!).render(<App />)
