import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Boxes,
  Copy,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Square,
  Trash2
} from 'lucide-react'
import type { Instance } from '../../../shared/types'
import { cn, api, formatDate, formatPlaytime, loaderLabel } from '../lib/utils'
import EmptyState from '../components/EmptyState'

interface LibraryViewProps {
  instances: Instance[]
  runningIds: string[]
  launchingId: string | null
  onNew: () => void
  onOpen: (id: string) => void
  onLaunch: (id: string) => void
  onStop: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}

export default function LibraryView({
  instances,
  runningIds,
  launchingId,
  onNew,
  onOpen,
  onLaunch,
  onStop,
  onDuplicate,
  onDelete
}: LibraryViewProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'name'>('recent')

  const sorted = useMemo(() => {
    return instances
      .filter((instance) => {
        const text = `${instance.name} ${instance.gameVersion} ${instance.loader.type}`.toLowerCase()
        return !query || text.includes(query.toLowerCase())
      })
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN')
        return (
          new Date(b.lastPlayedAt || b.createdAt).getTime() - new Date(a.lastPlayedAt || a.createdAt).getTime()
        )
      })
  }, [instances, query, sort])

  return (
    <div className="view library-view">
      <div className="library-heading">
        <div>
          <h1>游戏实例</h1>
          <p>{instances.length > 0 ? `${instances.length} 个实例` : '还没有创建实例'}</p>
        </div>
        <button className="btn btn-primary" onClick={onNew}>
          <Plus size={16} /> 新建实例
        </button>
      </div>

      {instances.length > 0 && (
        <div className="library-toolbar">
          <div className="search-box">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索实例" />
          </div>
          <select
            className="plain-select"
            value={sort}
            onChange={(event) => setSort(event.target.value as 'recent' | 'name')}
          >
            <option value="recent">最近游玩</option>
            <option value="name">按名称</option>
          </select>
        </div>
      )}

      {sorted.length === 0 ? (
        instances.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="没有游戏实例"
            description="创建一个实例，启动器会自动下载并校验游戏文件。"
            action={
              <button className="btn btn-primary" onClick={onNew}>
                <Plus size={16} /> 新建实例
              </button>
            }
          />
        ) : (
          <EmptyState icon={Search} title="没有匹配的实例" description="换一个关键词试试。" compact />
        )
      ) : (
        <div className="instance-table">
          <div className="instance-table-head">
            <span>实例</span>
            <span>版本</span>
            <span>上次游玩</span>
            <span />
          </div>
          {sorted.map((instance) => (
            <InstanceRow
              key={instance.id}
              instance={instance}
              running={runningIds.includes(instance.id)}
              launching={launchingId === instance.id}
              onOpen={() => onOpen(instance.id)}
              onLaunch={() => onLaunch(instance.id)}
              onStop={() => onStop(instance.id)}
              onDuplicate={() => onDuplicate(instance.id)}
              onDelete={() => onDelete(instance.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function InstanceRow({
  instance,
  running,
  launching,
  onOpen,
  onLaunch,
  onStop,
  onDuplicate,
  onDelete
}: {
  instance: Instance
  running: boolean
  launching: boolean
  onOpen: () => void
  onLaunch: () => void
  onStop: () => void
  onDuplicate: () => void
  onDelete: () => void
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  return (
    <div
      className={cn('instance-row', running && 'running')}
      onClick={onOpen}
      style={{ '--instance-color': instance.color } as React.CSSProperties}
    >
      <div className="row-main">
        <span className="row-icon">{instance.icon}</span>
        <div className="row-title">
          <strong>{instance.name}</strong>
          <span>
            已游玩 {formatPlaytime(instance.playtimeMs)}
            {!instance.installedAt && <em className="row-pending">未安装</em>}
            {running && <em className="row-live">运行中</em>}
          </span>
        </div>
      </div>
      <div className="row-version">
        <span>Minecraft {instance.gameVersion}</span>
        <em className={cn(instance.loader.type)}>{loaderLabel(instance.loader)}</em>
      </div>
      <div className="row-played">{formatDate(instance.lastPlayedAt)}</div>
      <div className="row-actions" onClick={(event) => event.stopPropagation()}>
        {running ? (
          <button className="row-play stop" onClick={onStop} title="结束游戏">
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button className="row-play" onClick={onLaunch} disabled={launching} title="开始游戏">
            {launching ? <Loader2 size={15} className="spin" /> : <Play size={15} fill="currentColor" />}
          </button>
        )}
        <div className="row-menu" ref={menuRef}>
          <button
            className="icon-button subtle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="实例菜单"
          >
            <MoreHorizontal size={17} />
          </button>
          {menuOpen && (
            <div className="dropdown-menu">
              <button
                onClick={() => {
                  setMenuOpen(false)
                  void api.instances.openFolder(instance.id)
                }}
              >
                <FolderOpen size={13} /> 打开目录
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  onDuplicate()
                }}
              >
                <Copy size={13} /> 创建副本
              </button>
              <button
                className="danger"
                onClick={() => {
                  setMenuOpen(false)
                  onDelete()
                }}
              >
                <Trash2 size={13} /> 删除
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
