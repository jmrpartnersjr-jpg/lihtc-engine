import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { LihtcProvider } from './context/LihtcContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LihtcProvider>
      <App />
    </LihtcProvider>
  </StrictMode>,
)
