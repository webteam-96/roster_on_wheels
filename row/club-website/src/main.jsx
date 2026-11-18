import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClubProvider } from './context/ClubProvider.jsx'
import { ThemeProvider } from './theme/ThemeProvider.jsx'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ClubProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </ClubProvider>
    </BrowserRouter>
  </StrictMode>
)
