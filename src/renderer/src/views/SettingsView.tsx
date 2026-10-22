import { useEffect, useState } from 'react'
import {
  Check,
  ChevronRight,
  Cpu,
  ExternalLink,
  FolderOpen,
  Gauge,
  Globe2,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  UserRound,
  Zap
} from 'lucide-react'
import type { AppInfo, JavaDetection, Settings } from '../../../shared/types'
import { api, cn, errorMessage } from '../lib/utils'

interface SettingsViewProps {
  settings: Settings
  appInfo: AppInfo | null
  dataDir: string
  totalMemoryMb: number
  activeAccountName: string | null
  activeAccountType: 'offline' | 'microsoft' | 'yggdrasil' | null
  onUpdate: (patch: Partial<Settings>) => Promise<void>
  onAccount: () => void
  onToast: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void
}

export default function SettingsView({
  settings,
  appInfo,
  dataDir,
  totalMemoryMb,
  activeAccountName,
  activeAccountType,
  onUpdate,
  onAccount,
  onToast
}: SettingsViewProps): React.JSX.Element {
  const [javaList, setJavaList] = useState<JavaDetection[]>([])
  const [detecting, setDetecting] = useState(false)
  const [moving, setMoving] = useState(false)
  const [resourceDir, setResourceDir] = useState<string | null>(null)
  const [memoryDraft, setMemoryDraft] = useState(String(settings.memoryMb))
  const [concurrencyDraft, setConcurrencyDraft] = useState(String(settings.downloadConcurrency))

  useEffect(() => {
    void api.settings
      .getResourceDir()
      .then(setResourceDir)
      .catch(() => undefined)
  }, [])

  const pickResourceDir = async (): Promise<void> => {
    const picked = await api.dialog.pickDirectory().catch(() => null)
    if (!picked) return
    const confirmed = window.confirm(
      `将复用该目录下的 assets 与 libraries：\n${picked}\n\n不会复制文件，但启动器可能向该目录补写缺失的资源。设置后需要重启启动器。继续吗？`
    )
    if (!confirmed) return
    try {
      await api.settings.setResourceDir(picked)
      onToast('info', '资源目录已设置', '启动器即将重启…')
      await api.relaunch()
    } catch (error) {
      onToast('error', '设置资源目录失败', errorMessage(error))
    }
  }

  const resetResourceDir = async (): Promise<void> => {
    try {
      await api.settings.setResourceDir(null)
      onToast('info', '已恢复默认资源目录', '启动器即将重启…')
      await api.relaunch()
    } catch (error) {
      onToast('error', '恢复资源目录失败', errorMessage(error))
    }
  }

  const changeDataDir = async (): Promise<void> => {
    const picked = await api.dialog.pickDirectory().catch(() => null)
    if (!picked) return
    const confirmed = window.confirm(
      `将把启动器数据目录移动到：\n${picked}\n\n实例、资源与库文件会一起迁移，完成后启动器会自动重启。继续吗？`
    )
    if (!confirmed) return
    setMoving(true)
    try {
      await api.settings.setDataDir(picked, 'move')
      onToast('info', '数据目录已更改', '启动器即将重启…')
      await api.relaunch()
    } catch (error) {
      onToast('error', '更改数据目录失败', errorMessage(error))
      setMoving(false)
    }
  }

  useEffect(() => {
    setMemoryDraft(String(settings.memoryMb))
    setConcurrencyDraft(String(settings.downloadConcurrency))
  }, [settings.memoryMb, settings.downloadConcurrency])

  const detectJava = async (): Promise<void> => {
    setDetecting(true)
    try {
      const found = await api.java.detect()
      setJavaList(found)
      if (found.length === 0) onToast('info', '没有找到 Java', '启动器会在需要时自动下载匹配的运行时。')
    } catch (error) {
      onToast('error', '检测 Java 失败', errorMessage(error))
    } finally {
      setDetecting(false)
    }
  }

  useEffect(() => {
    void detectJava()
  }, [])

  const addJava = async (): Promise<void> => {
    try {
      const picked = await api.dialog.pickJava()
      if (!picked) return
      const next = Array.from(new Set([...(settings.extraJavaPaths || []), picked]))
      await update({ extraJavaPaths: next })
      await detectJava()
      onToast('success', '已添加 Java', picked)
    } catch (error) {
      onToast('error', '添加 Java 失败', errorMessage(error))
    }
  }

  const removeJava = async (javaPath: string): Promise<void> => {
    try {
      const next = (settings.extraJavaPaths || []).filter((item) => item !== javaPath)
      await update({ extraJavaPaths: next })
      if (settings.javaPath === javaPath) await update({ javaPath: '' })
      await detectJava()
    } catch (error) {
      onToast('error', '移除 Java 失败', errorMessage(error))
    }
  }

  const update = async (patch: Partial<Settings>): Promise<void> => {
    try {
      await onUpdate(patch)
    } catch (error) {
      onToast('error', '保存设置失败', errorMessage(error))
    }
  }

  const maxMemory = Math.max(4096, Math.floor(totalMemoryMb || 8192))
  const recommended = Math.max(1024, Math.min(8192, Math.round((totalMemoryMb || 8192) * 0.3)))

  return (
    <div className="view settings-view">
      <div className="page-heading">
        <div>
          <h1>设置</h1>
          <p>游戏运行与下载选项</p>
        </div>
        <span className="settings-version">版本 {appInfo?.version || '1.0.0'}</span>
      </div>

      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel settings-panel">
            <div className="settings-section-head">
              <span className="settings-icon"><Cpu size={18} /></span>
              <div>
                <h2>性能</h2>
                <p>内存与 Java 运行时</p>
              </div>
            </div>
            <div className="setting-row column">
              <div className="setting-copy inline">
                <div>
                  <strong>默认内存上限</strong>
                  <span>新建实例未单独设置时使用，推荐 {recommended} MB</span>
                </div>
                <span className="memory-value">{memoryDraft} MB</span>
              </div>
              <input
                type="range"
                className="range"
                min={1024}
                max={maxMemory}
                step={512}
                value={Number(memoryDraft)}
                onChange={(event) => setMemoryDraft(event.target.value)}
                onPointerUp={(event) => void update({ memoryMb: Number((event.target as HTMLInputElement).value) })}
                onKeyUp={(event) => void update({ memoryMb: Number((event.target as HTMLInputElement).value) })}
              />
              <div className="range-labels">
                <span>1 GB</span>
                <span>系统内存 {Math.round(totalMemoryMb / 1024)} GB</span>
                <span>{Math.round(maxMemory / 1024)} GB</span>
              </div>
              <div className="preset-row">
                {[2048, 4096, 6144, 8192].map((value) => (
                  <button
                    key={value}
                    className={cn('chip-button', Number(memoryDraft) === value && 'active')}
                    onClick={() => {
                      setMemoryDraft(String(value))
                      void update({ memoryMb: value })
                    }}
                  >
                    {value / 1024} GB
                  </button>
                ))}
                <button className="chip-button" onClick={() => setMemoryDraft(String(recommended))}>
                  推荐
                </button>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-copy">
                <strong>Java 运行时</strong>
                <span>{settings.javaPath ? settings.javaPath : '自动检测本机 Java，缺失时下载 Mojang 运行时'}</span>
              </div>
              <div className="setting-actions">
                <button className="btn btn-outline small" onClick={() => void addJava()}>
                  <Plus size={14} /> 添加 Java…
                </button>
                <button
                  className="btn btn-outline small"
                  onClick={() => {
                    void detectJava()
                  }}
                  disabled={detecting}
                >
                  {detecting ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                  重新检测
                </button>
              </div>
            </div>
            <div className="java-list">
              <button
                className={cn('java-option', !settings.javaPath && 'active')}
                onClick={() => void update({ javaPath: '' })}
              >
                <span className="java-radio">{!settings.javaPath && <span />}</span>
                <span>
                  <strong>自动选择</strong>
                  <small>优先使用已安装且版本匹配的 Java</small>
                </span>
                <em>推荐</em>
              </button>
              {javaList.map((java) => (
                <div key={java.path} className="java-option-wrap">
                  <button
                    className={cn('java-option', settings.javaPath === java.path && 'active')}
                    onClick={() => void update({ javaPath: java.path })}
                  >
                    <span className="java-radio">{settings.javaPath === java.path && <span />}</span>
                    <span>
                      <strong>{java.label}</strong>
                      <small>{java.path}</small>
                    </span>
                    {java.source === 'custom' && <em className="java-tag">自定义</em>}
                    {settings.javaPath === java.path && <Check size={14} />}
                  </button>
                  {java.source === 'custom' && (
                    <button
                      className="java-option-remove"
                      title="移除这个 Java"
                      onClick={() => void removeJava(java.path)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {javaList.length === 0 && !detecting && (
                <div className="java-empty">未检测到本机 Java。首次启动时会自动下载。</div>
              )}
            </div>
          </section>

          <section className="panel settings-panel">
            <div className="settings-section-head">
              <span className="settings-icon"><Globe2 size={18} /></span>
              <div>
                <h2>下载</h2>
                <p>选择游戏文件与资源的下载方式</p>
              </div>
            </div>
            <div className="setting-row column">
              <div className="setting-copy">
                <strong>下载源</strong>
                <span>官方源更及时；镜像源在中国大陆通常更快</span>
              </div>
              <div className="source-options">
                <button
                  className={cn('source-card', settings.downloadSource === 'official' && 'active')}
                  onClick={() => void update({ downloadSource: 'official' })}
                >
                  <span className="source-icon official"><Globe2 size={18} /></span>
                  <span>
                    <strong>Mojang 官方源</strong>
                    <small>piston-meta.mojang.com</small>
                  </span>
                  <span className="radio-dot" />
                </button>
                <button
                  className={cn('source-card', settings.downloadSource === 'bmclapi' && 'active')}
                  onClick={() => void update({ downloadSource: 'bmclapi' })}
                >
                  <span className="source-icon mirror"><Zap size={18} /></span>
                  <span>
                    <strong>BMCLAPI 镜像</strong>
                    <small>适合中国大陆网络环境</small>
                  </span>
                  <span className="radio-dot" />
                </button>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-copy">
                <strong>并发下载数</strong>
                <span>同时下载的文件数量，过高可能被服务器限速</span>
              </div>
              <div className="number-stepper">
                <button onClick={() => void update({ downloadConcurrency: Math.max(1, settings.downloadConcurrency - 1) })}>−</button>
                <input
                  value={concurrencyDraft}
                  onChange={(event) => setConcurrencyDraft(event.target.value.replace(/\D/g, ''))}
                  onBlur={() => void update({ downloadConcurrency: Number(concurrencyDraft) || 8 })}
                />
                <button onClick={() => void update({ downloadConcurrency: Math.min(32, settings.downloadConcurrency + 1) })}>+</button>
              </div>
            </div>
          </section>

          <section className="panel settings-panel">
            <div className="settings-section-head">
              <span className="settings-icon"><Gauge size={18} /></span>
              <div>
                <h2>行为</h2>
                <p>启动器在游戏启动时的表现</p>
              </div>
            </div>
            <ToggleRow
              title="显示快照版本"
              description="在创建实例时允许选择每周快照"
              checked={settings.showSnapshots}
              onChange={(value) => void update({ showSnapshots: value })}
            />
            <ToggleRow
              title="启动游戏后最小化"
              description="游戏启动后自动收起启动器窗口"
              checked={settings.minimizeOnLaunch}
              onChange={(value) => void update({ minimizeOnLaunch: value })}
            />
          </section>
        </div>

        <aside className="settings-side">
          <div className="panel settings-panel">
            <div className="settings-section-head">
              <span className="settings-icon"><UserRound size={18} /></span>
              <div>
                <h2>账户</h2>
                <p>正在使用的游戏身份</p>
              </div>
            </div>
            <div className="settings-account">
              <span className="settings-avatar">{activeAccountName?.slice(0, 1).toUpperCase() || '?'}</span>
              <div>
                <strong>{activeAccountName || '未添加账户'}</strong>
                <span>
                  {activeAccountName
                    ? activeAccountType === 'microsoft'
                      ? 'Microsoft 账户'
                      : activeAccountType === 'yggdrasil'
                        ? '第三方账户'
                        : '离线账户'
                    : '添加账户后才能启动游戏'}
                </span>
              </div>
            </div>
            <button className="btn btn-outline full" onClick={onAccount}>
              管理账户 <ChevronRight size={15} />
            </button>
          </div>

          <div className="panel settings-panel">
            <div className="settings-section-head">
              <span className="settings-icon"><HardDrive size={18} /></span>
              <div>
                <h2>存储</h2>
                <p>启动器数据目录</p>
              </div>
            </div>
            <code className="path-box">{dataDir}</code>
            <button className="btn btn-outline full" onClick={() => void api.shell.openPath(dataDir)}>
              <FolderOpen size={15} /> 打开数据目录
            </button>
            <button
              className="btn btn-outline full"
              onClick={() => void changeDataDir()}
              disabled={moving}
            >
              {moving ? <Loader2 size={15} className="spin" /> : <HardDrive size={15} />}
              {moving ? '正在迁移…' : '更改目录…'}
            </button>
            <code className="path-box">{resourceDir || '资源目录：默认（数据目录内）'}</code>
            <button className="btn btn-outline full" onClick={() => void pickResourceDir()}>
              <FolderOpen size={15} /> 复用已有资源目录…
            </button>
            {resourceDir && (
              <button className="btn btn-ghost full" onClick={() => void resetResourceDir()}>
                恢复默认资源目录
              </button>
            )}
            <button className="text-button settings-log-link" onClick={() => void api.instances.openLogs()}>
              <ExternalLink size={13} /> 查看所有日志
            </button>
          </div>

          <div className="panel about-card">
            <span className="about-logo">◇</span>
            <h3>零式悖论</h3>
            <div className="about-meta">
              <span>版本 {appInfo?.version}</span>
              <span>Electron {appInfo?.electron}</span>
            </div>
            <button
              className="text-button"
              onClick={() => void api.shell.openExternal('https://github.com/PrismLauncher/PrismLauncher')}
            >
              灵感来自 PrismLauncher <ExternalLink size={12} />
            </button>
            <p className="disclaimer">
              与 Mojang Studios、Microsoft 无关联。Minecraft 是 Mojang Studios 的商标。
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function ToggleRow({
  title,
  description,
  checked,
  onChange
}: {
  title: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <button className={cn('switch', checked && 'on')} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </div>
  )
}
