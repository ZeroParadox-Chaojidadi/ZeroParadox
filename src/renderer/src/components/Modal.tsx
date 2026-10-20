import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'

interface ModalProps {
  title: string
  subtitle?: string
  children: React.ReactNode
  onClose: () => void
  width?: 'sm' | 'md' | 'lg' | 'xl'
  footer?: React.ReactNode
  className?: string
  closeOnBackdrop?: boolean
}

export default function Modal({
  title,
  subtitle,
  children,
  onClose,
  width = 'md',
  footer,
  className,
  closeOnBackdrop = true
}: ModalProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={panelRef} className={cn('modal-panel', `modal-${width}`, className)}>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
