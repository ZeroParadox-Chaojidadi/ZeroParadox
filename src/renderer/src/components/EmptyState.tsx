import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: React.ReactNode
  compact?: boolean
}

export default function EmptyState({ icon: Icon, title, description, action, compact }: EmptyStateProps): React.JSX.Element {
  return (
    <div className={`empty-state ${compact ? 'empty-compact' : ''}`}>
      <span className="empty-icon">
        <Icon size={compact ? 22 : 30} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}
