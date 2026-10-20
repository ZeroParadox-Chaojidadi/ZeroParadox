import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, Search } from 'lucide-react'
import type { VersionSummary } from '../../../shared/types'
import { cn } from '../lib/utils'
import Modal from './Modal'

interface CreateInstanceModalProps {
  versions: VersionSummary[]
  latestRelease: string
  showSnapshotsDefault: boolean
  onClose: () => void
  onCreate: (input: {
    name: string
    gameVersion: string
    loaderType: 'vanilla' | 'fabric'
  }) => Promise<void>
}

export default function CreateInstanceModal({
  versions,
  latestRelease,
  showSnapshotsDefault,
  onClose,
  onCreate
}: CreateInstanceModalProps): React.JSX.Element {
  const [name, setName] = useState(`Minecraft ${latestRelease}`)
  const [gameVersion, setGameVersion] = useState(latestRelease)
  const [loaderType, setLoaderType] = useState<'vanilla' | 'fabric'>('fabric')
  const [search, setSearch] = useState('')
  const [showSnapshots, setShowSnapshots] = useState(showSnapshotsDefault)
  const [versionOpen, setVersionOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return versions
      .filter((version) => showSnapshots || version.type === 'release')
      .filter((version) => !query || version.id.toLowerCase().includes(query))
      .slice(0, 100)
  }, [versions, showSnapshots, search])

  useEffect(() => {
    setName((current) => (current.startsWith('Minecraft ') ? `Minecraft ${gameVersion}` : current))
  }, [gameVersion])

  const create = async (): Promise<void> => {
    if (creating) return
    setError('')
    if (!name.trim()) {
      setError('请输入实例名称')
      return
    }
    setCreating(true)
    try {
      await onCreate({ name: name.trim(), gameVersion, loaderType })
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(err))
      setCreating(false)
    }
  }

  return (
    <Modal
      title="新建实例"
      width="md"
      onClose={() => {
        if (!creating) onClose()
      }}
      closeOnBackdrop={!creating}
      footer={
        <>
          <span className="modal-footnote">
            {loaderType === 'fabric' ? '将自动安装最新稳定版 Fabric' : '原版游戏，可稍后加装 Fabric'}
          </span>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={creating}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void create()} disabled={creating}>
              {creating ? <Loader2 size={15} className="spin" /> : null}
              {creating ? '创建中…' : '创建'}
            </button>
          </div>
        </>
      }
    >
      <div className="simple-form">
        <label className="field">
          <span>名称</span>
          <input
            value={name}
            maxLength={40}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            placeholder="实例名称"
          />
        </label>

        <div className="field">
          <span>游戏版本</span>
          <div className={cn('version-select', versionOpen && 'open')}>
            <button type="button" className="version-trigger" onClick={() => setVersionOpen((open) => !open)}>
              <span className="version-main">
                <strong>{gameVersion}</strong>
                <em>{versions.find((version) => version.id === gameVersion)?.type === 'release' ? '正式版' : '快照'}</em>
              </span>
              <ChevronDown size={15} />
            </button>
            {versionOpen && (
              <div className="version-popover">
                <div className="version-search">
                  <Search size={14} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索版本"
                    autoFocus
                  />
                </div>
                <label className="check-row compact">
                  <input
                    type="checkbox"
                    checked={showSnapshots}
                    onChange={(event) => setShowSnapshots(event.target.checked)}
                  />
                  <span>显示快照</span>
                </label>
                <div className="version-list">
                  {filtered.map((version) => (
                    <button
                      key={version.id}
                      type="button"
                      className={cn('version-option', version.id === gameVersion && 'selected')}
                      onClick={() => {
                        setGameVersion(version.id)
                        setVersionOpen(false)
                      }}
                    >
                      <span>
                        <strong>{version.id}</strong>
                        <small>{new Date(version.releaseTime).toLocaleDateString('zh-CN')}</small>
                      </span>
                      {version.id === gameVersion && <Check size={14} />}
                    </button>
                  ))}
                  {filtered.length === 0 && <div className="list-empty">没有匹配的版本</div>}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="field">
          <span>加载器</span>
          <div className="loader-options">
            <button
              type="button"
              className={cn('loader-option', loaderType === 'vanilla' && 'selected')}
              onClick={() => setLoaderType('vanilla')}
            >
              <span className="loader-icon vanilla">V</span>
              <span>
                <strong>原版</strong>
                <small>Vanilla</small>
              </span>
              {loaderType === 'vanilla' && <Check size={15} />}
            </button>
            <button
              type="button"
              className={cn('loader-option', loaderType === 'fabric' && 'selected')}
              onClick={() => setLoaderType('fabric')}
            >
              <span className="loader-icon fabric">F</span>
              <span>
                <strong>Fabric</strong>
                <small>模组加载器</small>
              </span>
              {loaderType === 'fabric' && <Check size={15} />}
            </button>
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  )
}
