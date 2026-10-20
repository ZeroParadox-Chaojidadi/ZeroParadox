import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Compass,
  Download,
  Loader2,
  Package,
  Palette,
  Search,
  SlidersHorizontal,
  Image as ImageIcon,
  AlertTriangle,
  ChevronDown
} from 'lucide-react'
import type { ContentKind, Instance, ModrinthSearchHit } from '../../../shared/types'
import { api, cn, errorMessage, formatNumber } from '../lib/utils'
import EmptyState from '../components/EmptyState'
import ProjectModal from '../components/ProjectModal'

interface BrowseViewProps {
  instances: Instance[]
  initialInstanceId: string | null
  initialKind: ContentKind
  onToast: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void
  onNewInstance: () => void
}

const KIND_TABS: { id: ContentKind; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'mod', label: '模组', icon: Package },
  { id: 'resourcepack', label: '资源包', icon: ImageIcon },
  { id: 'shader', label: '光影', icon: Palette }
]

export default function BrowseView({
  instances,
  initialInstanceId,
  initialKind,
  onToast,
  onNewInstance
}: BrowseViewProps): React.JSX.Element {
  const [instanceId, setInstanceId] = useState(initialInstanceId || instances[0]?.id || '')
  const [kind, setKind] = useState<ContentKind>(initialKind)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'relevance' | 'downloads' | 'newest' | 'updated'>('downloads')
  const [results, setResults] = useState<ModrinthSearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const requestRef = useRef(0)

  const instance = instances.find((item) => item.id === instanceId) || instances[0]
  const vanilla = instance?.loader.type === 'vanilla'

  useEffect(() => {
    if (initialInstanceId) setInstanceId(initialInstanceId)
  }, [initialInstanceId])

  useEffect(() => {
    setKind(initialKind)
  }, [initialKind])

  useEffect(() => {
    if (vanilla && kind === 'mod') {
      setKind('resourcepack')
      onToast('info', '原版实例不支持模组', '已切换到资源包。创建 Fabric 实例后即可浏览模组。')
    }
  }, [vanilla, kind])

  useEffect(() => {
    if (!instance) return
    const timer = window.setTimeout(() => {
      void load(true)
    }, query ? 320 : 0)
    return () => window.clearTimeout(timer)
  }, [instance?.id, kind, query, sort])

  const load = async (reset: boolean): Promise<void> => {
    if (!instance) return
    const requestId = ++requestRef.current
    if (reset) {
      setLoading(true)
      setResults([])
      setError('')
    } else {
      setLoadingMore(true)
    }
    try {
      const data = await api.modrinth.search({
        query,
        kind,
        gameVersion: instance.gameVersion,
        loader: instance.loader.type,
        offset: reset ? 0 : results.length,
        limit: 20,
        sort: query ? 'relevance' : sort
      })
      if (requestRef.current !== requestId) return
      setTotal(data.totalHits)
      setResults((current) => (reset ? data.hits : [...current, ...data.hits]))
    } catch (err) {
      if (requestRef.current !== requestId) return
      setError(errorMessage(err))
    } finally {
      if (requestRef.current === requestId) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }

  const availableTabs = useMemo(() => KIND_TABS.filter((tab) => tab.id !== 'mod' || !vanilla), [vanilla])

  if (!instance) {
    return (
      <div className="view browse-view">
        <div className="page-heading">
          <div>
            <span className="section-kicker">MODRINTH</span>
            <h1>资源中心</h1>
            <p>发现模组、资源包与光影。</p>
          </div>
        </div>
        <EmptyState
          icon={Compass}
          title="先创建一个实例"
          description="资源需要安装到具体的游戏实例中。创建实例后即可浏览适配版本的资源。"
          action={
            <button className="btn btn-primary" onClick={onNewInstance}>
              创建实例
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="view browse-view">
      <div className="page-heading browse-heading">
        <div>
          <h1>资源中心</h1>
          <p>安装模组、资源包和光影</p>
        </div>
        <button
          className="text-button"
          onClick={() => void api.shell.openExternal('https://modrinth.com')}
        >
          Modrinth <ArrowUpRight size={14} />
        </button>
      </div>

      <div className="browse-target panel">
        <div className="browse-target-main">
          <span className="target-icon" style={{ background: instance.color }}>{instance.icon}</span>
          <div>
            <span>安装到</span>
            <div className="target-select">
              <select value={instance.id} onChange={(event) => setInstanceId(event.target.value)}>
                {instances.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.gameVersion} · {item.loader.type === 'fabric' ? 'Fabric' : '原版'}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
          </div>
        </div>
        <div className="browse-target-meta">
          <span>Minecraft {instance.gameVersion}</span>
          <span className={cn('loader-tag', instance.loader.type)}>
            {instance.loader.type === 'fabric' ? 'Fabric' : '原版'}
          </span>
        </div>
      </div>

      <div className="browse-toolbar">
        <div className="browse-tabs">
          {availableTabs.map((tab) => (
            <button
              key={tab.id}
              className={cn('browse-tab', kind === tab.id && 'active')}
              onClick={() => setKind(tab.id)}
            >
              <tab.icon size={15} />
              {tab.label}
            </button>
          ))}
          {vanilla && (
            <button
              className="browse-tab locked"
              onClick={() => onToast('info', '需要 Fabric 实例', '原版无法加载模组。请新建一个 Fabric 实例。')}
            >
              <Package size={15} />
              模组
              <span className="lock-dot">需 Fabric</span>
            </button>
          )}
        </div>
        <div className="browse-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`搜索${kind === 'mod' ? '模组' : kind === 'resourcepack' ? '资源包' : '光影'}`}
          />
          {query && <button onClick={() => setQuery('')} className="search-clear">清除</button>}
        </div>
        <div className="select-wrap">
          <SlidersHorizontal size={14} />
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} disabled={Boolean(query)}>
            <option value="downloads">下载最多</option>
            <option value="relevance">相关度</option>
            <option value="newest">最新发布</option>
            <option value="updated">最近更新</option>
          </select>
        </div>
      </div>

      <div className="results-meta">
        <span>
          {loading ? '正在加载…' : error ? '加载失败' : `${formatNumber(total)} 个结果`}
        </span>
      </div>

      {loading ? (
        <div className="project-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <div className="project-card skeleton" key={index}>
              <span className="skeleton-icon" />
              <div className="skeleton-copy">
                <span />
                <span />
                <span />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={AlertTriangle}
          title="无法连接 Modrinth"
          description={error}
          action={
            <button className="btn btn-outline" onClick={() => void load(true)}>
              重试
            </button>
          }
        />
      ) : results.length === 0 ? (
        <EmptyState
          icon={Compass}
          title="没有找到结果"
          description={`试试其他关键词，或确认 Minecraft ${instance.gameVersion} 已有适配内容。`}
          action={
            <button className="btn btn-outline" onClick={() => setQuery('')}>
              清空搜索
            </button>
          }
        />
      ) : (
        <>
          <div className="project-grid">
            {results.map((project) => (
              <ProjectCard key={project.projectId} project={project} onOpen={() => setProjectId(project.projectId)} />
            ))}
          </div>
          {results.length < total && (
            <div className="load-more-wrap">
              <button className="btn btn-outline" disabled={loadingMore} onClick={() => void load(false)}>
                {loadingMore ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                {loadingMore ? '正在加载…' : '加载更多'}
              </button>
            </div>
          )}
        </>
      )}

      {projectId && (
        <ProjectModal
          projectId={projectId}
          instance={instance}
          kind={kind}
          onClose={() => setProjectId(null)}
          onInstalled={(message) => onToast('success', '安装成功', message)}
        />
      )}
    </div>
  )
}

function ProjectCard({ project, onOpen }: { project: ModrinthSearchHit; onOpen: () => void }): React.JSX.Element {
  return (
    <button className="project-card" onClick={onOpen}>
      <span className="project-card-icon">
        {project.iconUrl ? <img src={project.iconUrl} alt="" loading="lazy" /> : project.title.slice(0, 1)}
      </span>
      <div className="project-card-copy">
        <div className="project-card-title">
          <strong>{project.title}</strong>
          <span className="author">by {project.author}</span>
        </div>
        <p>{project.description}</p>
        <div className="project-card-meta">
          <span>
            <Download size={12} /> {formatNumber(project.downloads)}
          </span>
          {project.categories.slice(0, 2).map((category) => (
            <em key={category}>{category}</em>
          ))}
        </div>
      </div>
      <span className="project-open">
        <ArrowUpRight size={16} />
      </span>
    </button>
  )
}
