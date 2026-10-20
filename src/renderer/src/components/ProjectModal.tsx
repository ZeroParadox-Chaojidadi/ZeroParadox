import { useEffect, useState } from 'react'
import { Download, ExternalLink, Heart, Loader2, PackageOpen } from 'lucide-react'
import type { Instance, ModrinthProject, ModrinthVersion } from '../../../shared/types'
import type { ContentKind } from '../../../shared/types'
import { api, errorMessage, formatDate, formatNumber, loaderLabel } from '../lib/utils'
import Modal from './Modal'

interface ProjectModalProps {
  projectId: string
  instance: Instance
  kind: ContentKind
  onClose: () => void
  onInstalled: (message: string) => void
}

export default function ProjectModal({
  projectId,
  instance,
  kind,
  onClose,
  onInstalled
}: ProjectModalProps): React.JSX.Element {
  const [project, setProject] = useState<ModrinthProject | null>(null)
  const [versions, setVersions] = useState<ModrinthVersion[]>([])
  const [selectedVersion, setSelectedVersion] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      setLoading(true)
      setError('')
      try {
        const [projectData, versionData] = await Promise.all([
          api.modrinth.project(projectId),
          api.modrinth.versions(projectId, instance.gameVersion, instance.loader.type, kind)
        ])
        if (cancelled) return
        setProject(projectData)
        setVersions(versionData)
        setSelectedVersion(versionData[0]?.id || '')
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [projectId, instance.gameVersion, instance.loader.type, kind])

  const install = async (): Promise<void> => {
    if (!project) return
    setInstalling(true)
    setError('')
    try {
      const result = await api.modrinth.install(instance.id, project.id, kind, selectedVersion || undefined)
      onInstalled(
        result.warnings.length > 0
          ? `已安装 ${result.installed.length} 个文件，${result.warnings.length} 个依赖需要注意`
          : `已安装 ${project.title}`
      )
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setInstalling(false)
    }
  }

  const version = versions.find((item) => item.id === selectedVersion)
  const body = project ? cleanMarkdown(project.body) : ''

  return (
    <Modal
      title={project?.title || '项目详情'}
      subtitle={project ? `${project.categories.slice(0, 4).join(' · ')}` : '正在加载 Modrinth 项目…'}
      width="lg"
      onClose={onClose}
      className="project-modal"
      footer={
        <>
          <div className="project-footer-meta">
            {version ? (
              <>
                <PackageOpen size={14} /> {version.files[0]?.filename}
              </>
            ) : (
              '没有可用版本'
            )}
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={!project || !selectedVersion || installing}
              onClick={() => void install()}
            >
              {installing ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
              {installing ? '正在安装…' : '安装到实例'}
            </button>
          </div>
        </>
      }
    >
      {loading ? (
        <div className="project-loading">
          <Loader2 size={24} className="spin" />
          <span>正在从 Modrinth 获取项目…</span>
        </div>
      ) : project ? (
        <div className="project-detail">
          <div className="project-head">
            <span className="project-icon">
              {project.iconUrl ? <img src={project.iconUrl} alt="" /> : project.title.slice(0, 1)}
            </span>
            <div className="project-head-copy">
              <h3>{project.title}</h3>
              <p>{project.description}</p>
              <div className="project-stats">
                <span>
                  <Download size={13} /> {formatNumber(project.downloads)}
                </span>
                <span>
                  <Heart size={13} /> {formatNumber(project.followers)}
                </span>
                <span>客户端 {project.clientSide === 'required' ? '必需' : project.clientSide}</span>
                <span>服务端 {project.serverSide === 'required' ? '必需' : project.serverSide}</span>
              </div>
            </div>
            {project.sourceUrl && (
              <button className="icon-button" onClick={() => void api.shell.openExternal(project.sourceUrl!)} title="打开源地址">
                <ExternalLink size={16} />
              </button>
            )}
          </div>

          <div className="project-detail-grid">
            <div className="project-description">
              <h4>关于这个项目</h4>
              <p className={expanded ? 'expanded' : ''}>{body || project.description}</p>
              {body.length > 460 && (
                <button className="text-button" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? '收起' : '展开全部'}
                </button>
              )}
            </div>
            <div className="version-picker">
              <h4>选择版本</h4>
              {versions.length === 0 ? (
                <div className="list-empty">
                  没有适配 {instance.gameVersion} / {loaderLabel(instance.loader)} 的版本。
                </div>
              ) : (
                <div className="version-options">
                  {versions.slice(0, 20).map((item) => (
                    <button
                      key={item.id}
                      className={`project-version ${item.id === selectedVersion ? 'selected' : ''}`}
                      onClick={() => setSelectedVersion(item.id)}
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.versionNumber} · {formatDate(item.datePublished)}
                        </small>
                      </span>
                      <em className={item.versionType}>{item.versionType}</em>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}
        </div>
      ) : (
        <div className="form-error">{error || '加载失败'}</div>
      )}
    </Modal>
  )
}

function cleanMarkdown(body: string): string {
  return body
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>|]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3000)
}
