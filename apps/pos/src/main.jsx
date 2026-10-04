import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import CustomerDisplay from './CustomerDisplay.jsx'
import { ToastProvider } from './Toast.jsx'

const isCustomerWindow = new URLSearchParams(window.location.search).get('window') === 'customer';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isCustomerWindow ? <CustomerDisplay /> : <ToastProvider><App /></ToastProvider>}
  </StrictMode>,
)
