import { Boxes, Compass, Settings, UserRound } from 'lucide-react'
import type { Account } from '../../../shared/types'
import { cn } from '../lib/utils'
import type { View } from '../types'

interface SidebarProps {
  view: View
  instanceCount: number
  runningIds: string[]
  accounts: Account[]
  activeAccountId: string | null
  onNavigate: (view: View) => void
  onAccountClick: () => void
}

const navItems = [
  { id: 'library' as const, label: '游戏库', icon: Boxes },
  { id: 'browse' as const, label: '资源中心', icon: Compass },
  { id: 'settings' as const, label: '设置', icon: Settings }
]

export default function Sidebar({
  view,
  instanceCount,
  runningIds,
  accounts,
  activeAccountId,
  onNavigate,
  onAccountClick
}: SidebarProps): React.JSX.Element {
  const activeAccount = accounts.find((account) => account.id === activeAccountId)
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={cn('nav-item', view === item.id && 'active')}
            onClick={() => onNavigate(item.id)}
          >
            <item.icon size={17} strokeWidth={1.9} />
            <span>{item.label}</span>
            {item.id === 'library' && instanceCount > 0 && <em>{instanceCount}</em>}
            {item.id === 'library' && runningIds.length > 0 && <i className="running-dot" title="有游戏正在运行" />}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button className="account-card" onClick={onAccountClick}>
          <span className="account-avatar">
            {activeAccount?.avatarUrl ? (
              <img src={activeAccount.avatarUrl} alt="" />
            ) : activeAccount ? (
              activeAccount.username.slice(0, 1).toUpperCase()
            ) : (
              <UserRound size={17} />
            )}
          </span>
          <span className="account-copy">
            <strong>{activeAccount ? activeAccount.username : '添加账户'}</strong>
            <small>
              {activeAccount
                ? activeAccount.type === 'microsoft'
                  ? 'Microsoft 账户'
                  : '离线账户'
                : '未登录'}
            </small>
          </span>
          <span className={cn('status-dot', activeAccount && 'online')} />
        </button>
      </div>
    </aside>
  )
}
