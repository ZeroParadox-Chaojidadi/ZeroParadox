import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import type { ToastMessage } from '../types'

interface ToastViewportProps {
  toasts: ToastMessage[]
  onDismiss: (id: number) => void
}

export default function ToastViewport({ toasts, onDismiss }: ToastViewportProps): React.JSX.Element {
  return (
    <div className="toast-viewport">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <span className="toast-icon">
            {toast.type === 'success' ? (
              <CheckCircle2 size={18} />
            ) : toast.type === 'error' ? (
              <AlertCircle size={18} />
            ) : (
              <Info size={18} />
            )}
          </span>
          <div className="toast-copy">
            <strong>{toast.title}</strong>
            {toast.detail && <p>{toast.detail}</p>}
          </div>
          <button onClick={() => onDismiss(toast.id)} aria-label="关闭">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
