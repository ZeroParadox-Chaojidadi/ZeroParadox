import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Clock3,
  Copy,
  Download,
  FileArchive,
  FolderOpen,
  Globe2,
  HardDrive,
  Image,
  Loader2,
  Map,
  Package,
  Palette,
  Play,
  RefreshCw,
  Save,
  ScrollText,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  UserRound
} from 'lucide-react'
import type { ContentEntry, ContentKind, Instance, WorldEntry } from '../../../shared/types'
import { api, cn, errorMessage, formatBytes, formatDate, formatPlaytime, loaderLabel } from '../lib/utils'
import type { InstanceTab } from '../types'
import EmptyState from '../components/EmptyState'

interface InstanceDetailProps {
  instance: Instance
  running: boolean
  launching: boolean
  accountName: string | null
  logs: string[]
  onBack: () => void
  onLaunch: () => void
  onStop: () => void
  onBrowse: (instanceId: string, kind: ContentKind) => void
  onVerify: () => void
  onUpdate: (patch: Partial<Instance>) => Promise<void>
  onDelete: () => void
  onDuplicate: () => void
  onToast: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void
}

const TABS: { id: InstanceTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'overview', label: '概览', icon: Sparkles },
  { id: 'mods', label: '模组', icon: Package },
  { id: 'resourcepacks', label: '资源包', icon: Image },
  { id: 'shaders', label: '光影', icon: Palette },
  { id: 'worlds', label: '世界', icon: Map },
  { id: 'logs', label: '日志', icon: Terminal },
  { id: 'settings', label: '设置', icon: Settings2 }
]

export default function InstanceDetail({
  instance,
  running,
  launching,
  accountName,
  logs,
  onBack,
  onLaunch,
  onStop,
  onBrowse,
  onVerify,
  onUpdate,
  onDelete,
  onDuplicate,
  onToast
}: InstanceDetailProps): React.JSX.Element {
  const [tab, setTab] = useState<InstanceTab>('overview')

  return (
    <div className="view detail-view">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={16} /> 返回实例列表
      </button>

      <header className="detail-hero" style={{ '--instance-color': instance.color } as React.CSSProperties}>
        <div className="detail-bg-grid" />
        <div className="detail-icon">{instance.icon}</div>
        <div className="detail-copy">
          <div className="detail-kicker">
            <span className={cn('status-light', running && 'live')} />
            {running ? '游戏正在运行' : instance.installedAt ? '实例已就绪' : '等待安装'}
          </div>
          <h1>{instance.name}</h1>
          <div className="detail-tags">
            <span>Minecraft {instance.gameVersion}</span>
            <span>{loaderLabel(instance.loader)}</span>
            <span>{instance.playtimeMs ? formatPlaytime(instance.playtimeMs) : '新的旅程'}</span>
          </div>
        </div>
        <div className="detail-actions">
          {running ? (
            <button className="btn btn-danger-soft" onClick={onStop}>
              <Square size={15} fill="currentColor" /> 结束游戏
            </button>
          ) : (
            <button className="btn btn-primary" onClick={onLaunch} disabled={launching}>
              {launching ? <Loader2 size={17} className="spin" /> : <Play size={17} fill="currentColor" />}
              {launching ? '启动中…' : '开始游戏'}
            </button>
          )}
          <button className="icon-button glass" onClick={() => void api.instances.openFolder(instance.id)} title="打开实例文件夹">
            <FolderOpen size={17} />
          </button>
        </div>
      </header>

      <div className="detail-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={cn('detail-tab', tab === item.id && 'active')}
            onClick={() => setTab(item.id)}
          >
            <item.icon size={15} />
            {item.label}
          </button>
        ))}
      </div>

      <div className="detail-content">
        {tab === 'overview' && (
          <OverviewTab
            instance={instance}
            accountName={accountName}
            onBrowse={() => onBrowse(instance.id, 'mod')}
            onVerify={onVerify}
            onOpenLogs={() => void api.instances.openLogs(instance.id)}
            onOpenFolder={() => void api.instances.openFolder(instance.id)}
          />
        )}
        {tab === 'mods' && <ContentTab instance={instance} kind="mod" onBrowse={onBrowse} onToast={onToast} />}
        {tab === 'resourcepacks' && (
          <ContentTab instance={instance} kind="resourcepack" onBrowse={onBrowse} onToast={onToast} />
        )}
        {tab === 'shaders' && <ContentTab instance={instance} kind="shader" onBrowse={onBrowse} onToast={onToast} />}
        {tab === 'worlds' && <WorldsTab instance={instance} onToast={onToast} />}
        {tab === 'logs' && <LogsTab instance={instance} logs={logs} onToast={onToast} />}
        {tab === 'settings' && (
          <SettingsTab
            instance={instance}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onToast={onToast}
          />
        )}
      </div>
    </div>
  )
}

function OverviewTab({
  instance,
  accountName,
  onBrowse,
  onVerify,
  onOpenLogs,
  onOpenFolder
}: {
  instance: Instance
  accountName: string | null
  onBrowse: () => void
  onVerify: () => void
  onOpenLogs: () => void
  onOpenFolder: () => void
}): React.JSX.Element {
  return (
    <div className="panel overview-main">
      <div className="panel-head">
        <div>
          <h2>实例信息</h2>
        </div>
        <button className="btn btn-outline small" onClick={onVerify}>
          <RefreshCw size={14} /> 校验文件
        </button>
      </div>
      <div className="info-grid">
        <InfoItem icon={Boxes} label="游戏版本" value={instance.gameVersion} />
        <InfoItem icon={Package} label="模组加载器" value={loaderLabel(instance.loader)} />
        <InfoItem
          icon={HardDrive}
          label="分配内存"
          value={instance.memoryMb ? `${instance.memoryMb} MB` : '跟随全局设置'}
        />
        <InfoItem icon={Clock3} label="上次游玩" value={formatDate(instance.lastPlayedAt)} />
        <InfoItem icon={Clock3} label="累计游玩" value={formatPlaytime(instance.playtimeMs)} />
        <InfoItem icon={UserRound} label="使用账户" value={accountName || '未选择'} />
      </div>
      <div className="overview-notes">
        <h3>备注</h3>
        <p>{instance.notes || '没有备注。'}</p>
      </div>
      <div className="quick-actions">
        <button onClick={onOpenFolder}>
          <FolderOpen size={14} /> 打开游戏文件夹
        </button>
        <button onClick={onOpenLogs}>
          <ScrollText size={14} /> 日志
        </button>
        <button onClick={onBrowse}>
          <Globe2 size={14} /> 浏览模组
        </button>
      </div>
    </div>
  )
}

function InfoItem({
  icon: Icon,
  label,
  value
}: {
  icon: React.ComponentType<{ size?: number }>
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="info-item">
      <span className="info-icon"><Icon size={16} /></span>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </div>
  )
}

function ContentTab({
  instance,
  kind,
  onBrowse,
  onToast
}: {
  instance: Instance
  kind: ContentKind
  onBrowse: (instanceId: string, kind: ContentKind) => void
  onToast: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void
}): React.JSX.Element {
  const [entries, setEntries] = useState<ContentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const labels: Record<ContentKind, { title: string; description: string; folder: string }> = {
    mod: { title: '模组', description: '扩展游戏内容，需要 Fabric 加载器支持。', folder: 'mods' },
    resourcepack: { title: '资源包', description: '替换材质、音效与界面风格。', folder: 'resourcepacks' },
    shader: { title: '光影', description: '需要 Iris 或 OptiFine 等光影支持。', folder: 'shaderpacks' },
    datapack: { title: '数据包', description: '为世界添加进度、配方或结构。', folder: 'datapacks' }
  }
  const meta = labels[kind]

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setEntries(await api.content.list(instance.id, kind))
    } catch (error) {
      onToast('error', '读取内容失败', errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [instance.id, kind])

  const toggle = async (entry: ContentEntry): Promise<void> => {
    setBusy(entry.fileName)
    try {
      await api.content.toggle(instance.id, kind, entry.fileName)
      await load()
    } catch (error) {
      onToast('error', '操作失败', errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (entry: ContentEntry): Promise<void> => {
    setBusy(entry.fileName)
    try {
      await api.content.delete(instance.id, kind, entry.fileName)
      setConfirmDelete(null)
      await load()
      onToast('success', '已删除文件', entry.name)
    } catch (error) {
      onToast('error', '删除失败', errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="panel content-panel">
      <div className="panel-head">
        <div>
          <span className="section-kicker">{kind.toUpperCase()}S</span>
          <h2>{meta.title}</h2>
          <p>{meta.description}</p>
        </div>
        <div className="panel-head-actions">
          <button className="btn btn-outline small" onClick={() => void api.instances.openFolder(instance.id)}>
            <FolderOpen size={14} /> 打开 {meta.folder}
          </button>
          <button className="btn btn-primary small" onClick={() => onBrowse(instance.id, kind)}>
            <Download size={14} /> 浏览 Modrinth
          </button>
        </div>
      </div>

      {kind === 'mod' && instance.loader.type === 'vanilla' && (
        <div className="inline-banner warning">
          <AlertTriangle size={16} />
          <span>这个实例是原版，安装的模组不会生效。建议创建一个 Fabric 实例。</span>
        </div>
      )}

      {loading ? (
        <div className="panel-loading">
          <Loader2 size={20} className="spin" /> 正在读取 {meta.title}…
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          compact
          icon={FileArchive}
          title={`还没有${meta.title}`}
          description={`把 .${kind === 'mod' ? 'jar' : 'zip'} 文件放入 ${meta.folder} 文件夹，或从资源中心安装。`}
          action={
            <button className="btn btn-primary" onClick={() => onBrowse(instance.id, kind)}>
              <Download size={15} /> 浏览资源
            </button>
          }
        />
      ) : (
        <div className="content-list">
          {entries.map((entry) => (
            <div key={entry.fileName} className={cn('content-row', !entry.enabled && 'disabled')}>
              <span className="content-icon">
                {entry.iconUrl ? <img src={entry.iconUrl} alt="" /> : <Package size={19} />}
              </span>
              <div className="content-info">
                <strong>{entry.name}</strong>
                <p>{entry.description || entry.fileName}</p>
                <span>
                  {formatBytes(entry.size)} · {entry.source === 'modrinth' ? '来自 Modrinth' : '本地文件'}
                  {!entry.enabled ? ' · 已禁用' : ''}
                </span>
              </div>
              <div className="content-actions">
                <button
                  className={cn('switch', entry.enabled && 'on')}
                  onClick={() => void toggle(entry)}
                  disabled={busy === entry.fileName}
                  title={entry.enabled ? '禁用' : '启用'}
                >
                  <span />
                </button>
                {confirmDelete === entry.fileName ? (
                  <div className="inline-confirm">
                    <button className="text-danger" onClick={() => void remove(entry)}>删除</button>
                    <button onClick={() => setConfirmDelete(null)}>取消</button>
                  </div>
                ) : (
                  <button className="icon-button danger-hover" onClick={() => setConfirmDelete(entry.fileName)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WorldsTab({
  instance,
  onToast
}: {
  instance: Instance
  onToast: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void
}): React.JSX.Element {
  const [worlds, setWorlds] = useState<WorldEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void api.worlds
      .list(instance.id)
      .then((data) => {
        if (active) setWorlds(data)
      })
      .catch((error) => onToast('error', '读取存档失败', errorMessage(error)))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [instance.id])

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <span className="section-kicker">SAVES</span>
          <h2>世界存档</h2>
          <p>这里的存档只属于当前实例。</p>
        </div>
        <button className="btn btn-outline small" onClick={() => void api.instances.openFolder(instance.id)}>
          <FolderOpen size={14} /> 打开实例目录
        </button>
      </div>
      {loading ? (
        <div className="panel-loading"><Loader2 size={20} className="spin" /> 正在读取存档…</div>
      ) : worlds.length === 0 ? (
        <EmptyState
          compact
          icon={Map}
          title="还没有世界"
          description="进入游戏创建一个新世界，它就会出现在这里。"
        />
      ) : (
        <div className="world-grid">
          {worlds.map((world) => (
            <div className="world-tile" key={world.folder}>
              <div className="world-image">
                {world.icon ? <img src={world.icon} alt="" /> : <span className="world-placeholder">🏔️</span>}
              </div>
              <div>
                <strong>{world.name}</strong>
                <span>{formatDate(world.lastModified)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LogsTab({
  instance,
  logs,
  onToast
}: {
  instance: Instance
  logs: string[]
  onToast: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void
}): React.JSX.Element {
  const [tail, setTail] = useState<string[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)
  const combined = useMemo(() => {
    const fromFile = tail.slice(-250)
    const live = logs.filter((line) => !fromFile.includes(line)).slice(-250)
    return [...fromFile, ...live]
  }, [tail, logs])

  const refresh = async (): Promise<void> => {
    try {
      const content = await api.instances.logTail(instance.id, 400)
      setTail(content.split(/\r?\n/).filter(Boolean))
    } catch (error) {
      onToast('error', '读取日志失败', errorMessage(error))
    }
  }

  useEffect(() => {
    void refresh()
  }, [instance.id])

  useEffect(() => {
    if (autoScroll) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [combined, autoScroll])

  return (
    <div className="panel logs-panel">
      <div className="panel-head">
        <div>
          <span className="section-kicker">OUTPUT</span>
          <h2>运行日志</h2>
          <p>游戏与启动器的实时输出，用于排查崩溃与模组冲突。</p>
        </div>
        <div className="panel-head-actions">
          <label className="check-row compact">
            <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
            <span>自动滚动</span>
          </label>
          <button className="btn btn-outline small" onClick={() => void refresh()}>
            <RefreshCw size={14} /> 刷新
          </button>
          <button className="btn btn-outline small" onClick={() => void api.instances.openLogs(instance.id)}>
            <FolderOpen size={14} /> 日志目录
          </button>
        </div>
      </div>
      <div className="log-console">
        {combined.length === 0 ? (
          <div className="log-empty">
            <Terminal size={28} />
            <span>还没有日志。启动一次游戏后，输出会实时显示在这里。</span>
          </div>
        ) : (
          combined.map((line, index) => (
            <div key={`${index}-${line.slice(0, 24)}`} className={cn('log-line', /error|exception|crash/i.test(line) && 'error')}>
              <span className="log-index">{String(index + 1).padStart(3, '0')}</span>
              <span>{line}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}

function SettingsTab({
  instance,
  onUpdate,
  onDelete,
  onDuplicate,
  onToast
}: {
  instance: Instance
  onUpdate: (patch: Partial<Instance>) => Promise<void>
  onDelete: () => void
  onDuplicate: () => void
  onToast: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void
}): React.JSX.Element {
  const [name, setName] = useState(instance.name)
  const [notes, setNotes] = useState(instance.notes)
  const [memory, setMemory] = useState(instance.memoryMb ? String(instance.memoryMb) : '')
  const [javaPath, setJavaPath] = useState(instance.javaPath || '')
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs)
  const [gameArgs, setGameArgs] = useState(instance.gameArgs)
  const [width, setWidth] = useState(String(instance.resolution.width))
  const [height, setHeight] = useState(String(instance.resolution.height))
  const [customResolution, setCustomResolution] = useState(instance.resolution.custom)
  const [fullscreen, setFullscreen] = useState(instance.resolution.fullscreen)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(instance.name)
    setNotes(instance.notes)
    setMemory(instance.memoryMb ? String(instance.memoryMb) : '')
    setJavaPath(instance.javaPath || '')
    setJvmArgs(instance.jvmArgs)
    setGameArgs(instance.gameArgs)
    setWidth(String(instance.resolution.width))
    setHeight(String(instance.resolution.height))
    setCustomResolution(instance.resolution.custom)
    setFullscreen(instance.resolution.fullscreen)
  }, [instance])

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await onUpdate({
        name: name.trim() || instance.name,
        notes,
        memoryMb: memory ? Number(memory) : null,
        javaPath: javaPath || null,
        jvmArgs,
        gameArgs,
        resolution: {
          width: Math.max(320, Number(width) || 1280),
          height: Math.max(240, Number(height) || 720),
          custom: customResolution,
          fullscreen
        }
      })
      onToast('success', '设置已保存')
    } catch (error) {
      onToast('error', '保存失败', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const pickJava = async (): Promise<void> => {
    try {
      const selected = await api.dialog.pickJava()
      if (selected) setJavaPath(selected)
    } catch (error) {
      onToast('error', '无法使用该 Java', errorMessage(error))
    }
  }

  return (
    <div className="settings-tab">
      <div className="panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">GENERAL</span>
            <h2>基础设置</h2>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>实例名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
          </label>
          <label className="field">
            <span>内存上限（MB，留空跟随全局）</span>
            <input value={memory} inputMode="numeric" onChange={(event) => setMemory(event.target.value.replace(/\D/g, ''))} placeholder="例如 4096" />
          </label>
          <label className="field field-span">
            <span>备注</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="服务器地址、整合包说明、注意事项…" />
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">RUNTIME</span>
            <h2>Java 与启动参数</h2>
          </div>
        </div>
        <div className="form-grid">
          <label className="field field-span">
            <span>自定义 Java 路径</span>
            <div className="input-with-button">
              <input value={javaPath} onChange={(event) => setJavaPath(event.target.value)} placeholder="留空自动检测，或选择 javaw.exe" />
              <button className="btn btn-outline" onClick={() => void pickJava()}>
                浏览…
              </button>
            </div>
          </label>
          <label className="field field-span">
            <span>额外 JVM 参数</span>
            <input value={jvmArgs} onChange={(event) => setJvmArgs(event.target.value)} placeholder="-XX:+UseG1GC -Dfile.encoding=UTF-8" />
          </label>
          <label className="field field-span">
            <span>额外游戏参数</span>
            <input value={gameArgs} onChange={(event) => setGameArgs(event.target.value)} placeholder="--demo 或其他参数" />
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">DISPLAY</span>
            <h2>窗口</h2>
          </div>
        </div>
        <div className="form-grid">
          <label className="check-row">
            <input type="checkbox" checked={customResolution} onChange={(event) => setCustomResolution(event.target.checked)} />
            <span>使用自定义窗口分辨率</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={fullscreen} onChange={(event) => setFullscreen(event.target.checked)} />
            <span>以全屏启动</span>
          </label>
          <div className="field-row">
            <label className="field">
              <span>宽度</span>
              <input value={width} onChange={(event) => setWidth(event.target.value.replace(/\D/g, ''))} disabled={!customResolution} />
            </label>
            <label className="field">
              <span>高度</span>
              <input value={height} onChange={(event) => setHeight(event.target.value.replace(/\D/g, ''))} disabled={!customResolution} />
            </label>
          </div>
        </div>
      </div>

      <div className="settings-save">
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
          保存设置
        </button>
      </div>

      <div className="panel danger-panel">
        <div className="panel-head">
          <div>
            <span className="section-kicker">DANGER ZONE</span>
            <h2>实例操作</h2>
          </div>
        </div>
        <div className="danger-actions">
          <div>
            <strong>复制实例</strong>
            <p>复制存档、模组和设置，创建一个完全独立的副本。</p>
          </div>
          <button className="btn btn-outline" onClick={onDuplicate}><Copy size={15} /> 创建副本</button>
          <div>
            <strong>删除实例</strong>
            <p>永久删除实例目录中的游戏文件、存档和模组，此操作不可恢复。</p>
          </div>
          <button className="btn btn-danger" onClick={onDelete}><Trash2 size={15} /> 删除实例</button>
        </div>
      </div>
    </div>
  )
}
