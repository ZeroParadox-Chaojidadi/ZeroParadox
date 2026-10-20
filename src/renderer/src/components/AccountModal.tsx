import { useState } from 'react'
import { Check, Loader2, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import type { Account } from '../../../shared/types'
import { cn } from '../lib/utils'
import Modal from './Modal'

interface AccountModalProps {
  accounts: Account[]
  activeAccountId: string | null
  onClose: () => void
  onAddOffline: (username: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onSetActive: (id: string) => Promise<void>
}

export default function AccountModal({
  accounts,
  activeAccountId,
  onClose,
  onAddOffline,
  onRemove,
  onSetActive
}: AccountModalProps): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(accounts.length === 0)
  const [removing, setRemoving] = useState<string | null>(null)

  const add = async (): Promise<void> => {
    setError('')
    setLoading(true)
    try {
      await onAddOffline(username.trim())
      setUsername('')
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="游戏账户"
      subtitle="选择一个账户用于启动游戏"
      width="md"
      onClose={onClose}
      footer={
        <div className="modal-actions spread">
          <span className="modal-footnote">
            <ShieldCheck size={14} /> 离线账户仅用于本地游戏，不验证正版身份
          </span>
          <button className="btn btn-ghost" onClick={onClose}>
            完成
          </button>
        </div>
      }
    >
      <div className="account-list">
        {accounts.map((account) => (
          <div key={account.id} className={cn('account-row', account.id === activeAccountId && 'active')}>
            <button className="account-select" onClick={() => void onSetActive(account.id)}>
              <span className="account-avatar large">
                {account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : account.username.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{account.username}</strong>
                <small>{account.type === 'offline' ? '离线账户' : 'Microsoft 账户'}</small>
              </span>
              {account.id === activeAccountId && <em className="active-badge"><Check size={12} /> 当前</em>}
            </button>
            {removing === account.id ? (
              <div className="inline-confirm">
                <span>删除？</span>
                <button
                  className="text-danger"
                  onClick={() => {
                    void onRemove(account.id)
                    setRemoving(null)
                  }}
                >
                  确定
                </button>
                <button onClick={() => setRemoving(null)}>取消</button>
              </div>
            ) : (
              <button className="icon-button danger-hover" onClick={() => setRemoving(account.id)} aria-label="删除账户">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
        {accounts.length === 0 && !showForm && (
          <div className="list-empty">还没有账户，添加一个离线账户即可开始游戏。</div>
        )}
      </div>

      {showForm ? (
        <div className="account-form">
          <div className="account-form-title">
            <UserRound size={16} />
            <strong>添加离线账户</strong>
          </div>
          <div className="input-with-button">
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void add()
              }}
              placeholder="3–16 位字母、数字或下划线"
              maxLength={16}
              autoFocus
            />
            <button className="btn btn-primary" onClick={() => void add()} disabled={loading || !username.trim()}>
              {loading ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
              添加
            </button>
          </div>
          {error && <div className="form-error">{error}</div>}
          <p className="form-help">
            离线用户名会显示在游戏中。离线账户无法加入开启正版验证的服务器。
          </p>
        </div>
      ) : (
        <button className="add-account-button" onClick={() => setShowForm(true)}>
          <Plus size={17} /> 添加离线账户
        </button>
      )}
    </Modal>
  )
}
