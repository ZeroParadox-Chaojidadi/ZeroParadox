import { useEffect, useRef, useState } from 'react'
import { Check, Clipboard, ExternalLink, Loader2, LogIn, RotateCcw } from 'lucide-react'
import type { Account, MicrosoftDeviceCodeInfo } from '../../../shared/types'
import { api, errorMessage } from '../lib/utils'
import Modal from './Modal'

interface MicrosoftLoginModalProps {
  clientId: string
  onClose: () => void
  onSaveClientId: (clientId: string) => Promise<void>
  onSuccess: (account: Account) => Promise<void> | void
  onToast: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void
}

type Stage = 'setup' | 'starting' | 'waiting' | 'success' | 'error'

export default function MicrosoftLoginModal({
  clientId,
  onClose,
  onSaveClientId,
  onSuccess,
  onToast
}: MicrosoftLoginModalProps): React.JSX.Element {
  const [draftClientId, setDraftClientId] = useState(clientId)
  const [info, setInfo] = useState<MicrosoftDeviceCodeInfo | null>(null)
  const [stage, setStage] = useState<Stage>('setup')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const flowRef = useRef<string | null>(null)
  const activeRef = useRef(true)

  useEffect(() => {
    return () => {
      activeRef.current = false
      if (flowRef.current) void api.accounts.microsoftCancel(flowRef.current)
    }
  }, [])

  const cancelFlow = async (): Promise<void> => {
    if (flowRef.current) {
      await api.accounts.microsoftCancel(flowRef.current).catch(() => undefined)
      flowRef.current = null
    }
  }

  const close = async (): Promise<void> => {
    await cancelFlow()
    onClose()
  }

  const saveClientId = async (): Promise<string> => {
    const id = draftClientId.trim()
    if (!id) throw new Error('请填写 Microsoft Azure 应用 Client ID')
    if (id !== clientId.trim()) await onSaveClientId(id)
    return id
  }

  const start = async (): Promise<void> => {
    setError('')
    setCopied(false)
    await cancelFlow()
    try {
      await saveClientId()
    } catch (err) {
      setError(errorMessage(err))
      return
    }
    setStage('starting')
    try {
      const next = await api.accounts.microsoftStart()
      if (!activeRef.current) {
        await api.accounts.microsoftCancel(next.flowId)
        return
      }
      flowRef.current = next.flowId
      setInfo(next)
      setStage('waiting')
      void api.shell.openExternal(next.verificationUri).catch(() => undefined)
      const account = await api.accounts.microsoftWait(next.flowId)
      flowRef.current = null
      if (!activeRef.current) return
      setStage('success')
      await onSuccess(account)
      onToast('success', 'Microsoft 登录成功', account.username)
      window.setTimeout(() => {
        if (activeRef.current) onClose()
      }, 900)
    } catch (err) {
      if (!activeRef.current) return
      const message = errorMessage(err)
      if (message.includes('取消')) {
        setStage('setup')
        return
      }
      setError(message)
      setStage('error')
    }
  }

  const copyCode = async (): Promise<void> => {
    if (!info) return
    try {
      await navigator.clipboard.writeText(info.userCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      onToast('info', '请手动复制设备码', info.userCode)
    }
  }

  const retry = async (): Promise<void> => {
    await cancelFlow()
    setInfo(null)
    setError('')
    setStage('setup')
  }

  return (
    <Modal
      title="Microsoft 正版登录"
      subtitle="使用 Microsoft 账户登录 Minecraft"
      width="md"
      onClose={() => void close()}
      footer={
        <div className="modal-actions spread">
          <span className="modal-footnote">
            {stage === 'waiting' ? '等待浏览器确认，请勿关闭此窗口' : '登录信息只保存在本机'}
          </span>
          <div className="modal-actions">
            {stage === 'waiting' ? (
              <button className="btn btn-ghost" onClick={() => void cancelFlow().then(() => setStage('setup'))}>
                取消登录
              </button>
            ) : stage === 'success' ? (
              <button className="btn btn-primary" onClick={onClose}>
                完成
              </button>
            ) : (
              <>
                <button className="btn btn-ghost" onClick={() => void close()}>
                  关闭
                </button>
                <button
                className="btn btn-primary"
                disabled={stage === 'starting' || !draftClientId.trim()}
                onClick={() => void start()}
              >
                  {stage === 'starting' ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />}
                  开始登录
                </button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="ms-login">
        {stage === 'setup' && (
          <>
            <div className="ms-intro">
              <span className="ms-mark">M</span>
              <div>
                <strong>使用微软账户登录</strong>
                <p>登录后可以进入开启正版验证的服务器。启动器不会接触你的密码。</p>
              </div>
            </div>

            <label className="field">
              <span>Azure 应用 Client ID</span>
              <input
                value={draftClientId}
                onChange={(event) => setDraftClientId(event.target.value)}
                placeholder="例如 00000000-0000-0000-0000-000000000000"
                spellCheck={false}
              />
            </label>

            <div className="ms-hint">
              <p>微软要求每个启动器使用自己的 Azure 应用。注册是免费的，只需要做一次。</p>
              <button
                className="text-button"
                onClick={() =>
                  void api.shell.openExternal(
                    'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade/quickStartType~/null/isMSAApp~/true'
                  )
                }
              >
                打开 Azure 应用注册 <ExternalLink size={12} />
              </button>
              <ol>
                <li>创建应用，账户类型选择“个人 Microsoft 账户”</li>
                <li>在“身份验证”中添加平台“移动和桌面应用程序”</li>
                <li>勾选 <code>https://login.microsoftonline.com/common/oauth2/nativeclient</code></li>
                <li>开启“允许公共客户端流”，保存</li>
                <li>复制“应用程序(客户端) ID”粘贴到上方</li>
                <li>如果提示 Invalid app registration，需通过 aka.ms/AppRegInfo 提交启动器应用审批</li>
              </ol>
            </div>
          </>
        )}

        {stage === 'starting' && (
          <div className="ms-loading">
            <Loader2 size={22} className="spin" />
            <span>正在向微软请求登录码…</span>
          </div>
        )}

        {stage === 'waiting' && info && (
          <>
            <div className="ms-intro">
              <span className="ms-mark">M</span>
              <div>
                <strong>在浏览器中输入设备码</strong>
                <p>浏览器已打开微软登录页。完成登录后，此窗口会自动继续。</p>
              </div>
            </div>
            <button className="device-code" onClick={() => void copyCode()} title="点击复制">
              <span>{info.userCode}</span>
              {copied ? <Check size={18} /> : <Clipboard size={18} />}
            </button>
            <div className="ms-waiting-row">
              <Loader2 size={15} className="spin" />
              <span>等待 Microsoft 确认…</span>
              <button
                className="text-button"
                onClick={() => void api.shell.openExternal(info.verificationUri)}
              >
                重新打开登录页
              </button>
            </div>
          </>
        )}

        {stage === 'success' && (
          <div className="ms-success">
            <Check size={26} />
            <strong>登录成功</strong>
            <p>账户已添加并设为当前账户。</p>
          </div>
        )}

        {stage === 'error' && (
          <div className="ms-error">
            <strong>登录没有完成</strong>
            <p>{error}</p>
            <button className="btn btn-outline" onClick={() => void retry()}>
              <RotateCcw size={14} /> 重新开始
            </button>
            {error.includes('Invalid app registration') || error.includes('尚未授权') ? (
              <button
                className="text-button"
                onClick={() => void api.shell.openExternal('https://aka.ms/AppRegInfo')}
              >
                打开 Mojang 应用审批页面 <ExternalLink size={12} />
              </button>
            ) : null}
          </div>
        )}

        {error && stage === 'setup' && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  )
}
