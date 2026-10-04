import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import CustomerDisplay from './CustomerDisplay.jsx'
import { QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from './Toast.jsx'
import { queryClient } from './queryClient.js'

const isCustomerWindow = new URLSearchParams(window.location.search).get('window') === 'customer';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isCustomerWindow ? (
      <CustomerDisplay />
    ) : (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </QueryClientProvider>
    )}
  </StrictMode>,
)
