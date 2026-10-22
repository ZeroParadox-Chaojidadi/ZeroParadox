import { useState } from 'react'
import { KeyRound, Loader2, LogIn } from 'lucide-react'
import type { Account } from '../../../shared/types'
import { api, errorMessage } from '../lib/utils'
import Modal from './Modal'

interface YggdrasilLoginModalProps {
  onClose: () => void
  onSuccess: (account: Account) => Promise<void> | void
  onToast: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void
}

const DEFAULT_SERVER = 'https://skin.zeroparadox.xyz/api/yggdrasil'

export default function YggdrasilLoginModal({
  onClose,
  onSuccess,
  onToast
}: YggdrasilLoginModalProps): React.JSX.Element {
  const [server, setServer] = useState(DEFAULT_SERVER)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    if (busy) return
    setError('')
    if (!server.trim()) {
      setError('请填写登录服务器地址')
      return
    }
    if (!username.trim() || !password) {
      setError('请填写用户名和密码')
      return
    }
    setBusy(true)
    try {
      const account = await api.accounts.yggdrasilLogin(server.trim(), username.trim(), password)
      await onSuccess(account)
      onToast('success', '登录成功', account.username)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="第三方登录"
      subtitle="使用皮肤站 / 外置登录账号"
      width="md"
      onClose={() => {
        if (!busy) onClose()
      }}
      closeOnBackdrop={!busy}
      footer={
        <>
          <span className="modal-footnote">密码只发送到登录服务器，不会保存在本机</span>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
              {busy ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />}
              登录
            </button>
          </div>
        </>
      }
    >
      <div className="ygg-login">
        <div className="ms-intro">
          <span className="ms-mark">Y</span>
          <div>
            <strong>Yggdrasil 外置登录</strong>
            <p>支持 Blessing Skin 等皮肤站账号，登录后可用对应皮肤进入服务器。</p>
          </div>
        </div>

        <label className="field">
          <span>服务器地址</span>
          <input
            value={server}
            onChange={(event) => setServer(event.target.value)}
            placeholder={DEFAULT_SERVER}
            spellCheck={false}
          />
        </label>

        <label className="field">
          <span>用户名 / 邮箱</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} spellCheck={false} />
        </label>

        <label className="field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
          />
        </label>

        {error ? <div className="form-error">{error}</div> : null}

        <p className="storage-note">
          <KeyRound size={12} /> 授权令牌保存在本机 launcher.json；启动时通过 authlib-injector 注入。
        </p>
      </div>
    </Modal>
  )
}
