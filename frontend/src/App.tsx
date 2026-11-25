import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { DialogProvider } from './components/Dialog'
import { IdleSignOut } from './components/IdleSignOut'
import { ToastProvider } from './components/Toast'
import AppRoutes from './routes/AppRoutes'

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <DialogProvider>
            <IdleSignOut />
            <AppRoutes />
          </DialogProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
