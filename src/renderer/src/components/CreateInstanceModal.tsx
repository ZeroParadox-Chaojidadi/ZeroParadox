import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, Search } from 'lucide-react'
import type { ForgeLoader, VersionSummary } from '../../../shared/types'
import { api, cn, errorMessage } from '../lib/utils'
import Modal from './Modal'

interface CreateInstanceModalProps {
  versions: VersionSummary[]
  latestRelease: string
  showSnapshotsDefault: boolean
  onClose: () => void
  onCreate: (input: {
    name: string
    gameVersion: string
    loaderType: 'vanilla' | 'fabric' | 'forge' | 'neoforge'
    forgeVersion?: string
    neoforgeVersion?: string
  }) => Promise<void>
  seed?: {
    name?: string
    gameVersion?: string
    loaderType?: 'vanilla' | 'fabric' | 'forge' | 'neoforge'
  } | null
}

export default function CreateInstanceModal({
  versions,
  latestRelease,
  showSnapshotsDefault,
  onClose,
  onCreate,
  seed
}: CreateInstanceModalProps): React.JSX.Element {
  const [name, setName] = useState(seed?.name?.trim() || `Minecraft ${latestRelease}`)
  const [gameVersion, setGameVersion] = useState(seed?.gameVersion || latestRelease)
  const [loaderType, setLoaderType] = useState<'vanilla' | 'fabric' | 'forge' | 'neoforge'>(
    seed?.loaderType || 'fabric'
  )
  const [forgeVersions, setForgeVersions] = useState<ForgeLoader[]>([])
  const [forgeVersion, setForgeVersion] = useState('')
  const [forgeLoading, setForgeLoading] = useState(false)
  const [forgeError, setForgeError] = useState('')
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

  useEffect(() => {
    if (loaderType !== 'forge' && loaderType !== 'neoforge') {
      setForgeVersions([])
      setForgeVersion('')
      setForgeError('')
      setForgeLoading(false)
      return
    }
    let cancelled = false
    setForgeLoading(true)
    setForgeError('')
    void (loaderType === 'neoforge' ? api.neoforge : api.forge)
      .versions(gameVersion)
      .then((list) => {
        if (cancelled) return
        setForgeVersions(list)
        setForgeVersion((current) => {
          if (list.some((item) => item.version === current)) return current
          return (
            list.find((item) => item.recommended)?.version ||
            list.find((item) => item.latest)?.version ||
            list[0]?.version ||
            ''
          )
        })
      })
      .catch((err) => {
        if (cancelled) return
        setForgeVersions([])
        setForgeVersion('')
        setForgeError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setForgeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [gameVersion, loaderType])

  const create = async (): Promise<void> => {
    if (creating) return
    setError('')
    if (!name.trim()) {
      setError('请输入实例名称')
      return
    }
    if ((loaderType === 'forge' || loaderType === 'neoforge') && !forgeVersion) {
      setError(forgeLoading ? '正在获取加载器版本…' : '请选择加载器版本')
      return
    }
    setCreating(true)
    try {
      await onCreate({
        name: name.trim(),
        gameVersion,
        loaderType,
        forgeVersion: loaderType === 'forge' ? forgeVersion : undefined,
        neoforgeVersion: loaderType === 'neoforge' ? forgeVersion : undefined
      })
    } catch (err) {
      setError(errorMessage(err))
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
            {loaderType === 'fabric'
              ? '将自动安装最新稳定版 Fabric'
              : loaderType === 'forge'
                ? '首次启动会下载并安装 Forge，可能需要几分钟'
                : loaderType === 'neoforge'
                  ? '首次启动会下载并安装 NeoForge，可能需要几分钟'
                  : '原版游戏，可稍后加装 Fabric、Forge 或 NeoForge'}
          </span>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={creating}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void create()} disabled={
              creating ||
              ((loaderType === 'forge' || loaderType === 'neoforge') && (forgeLoading || !forgeVersion))
            }>
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
            <button
              type="button"
              className={cn('loader-option', loaderType === 'forge' && 'selected')}
              onClick={() => setLoaderType('forge')}
            >
              <span className="loader-icon forge">F</span>
              <span>
                <strong>Forge</strong>
                <small>模组加载器</small>
              </span>
              {loaderType === 'forge' && <Check size={15} />}
            </button>
            <button
              type="button"
              className={cn('loader-option', loaderType === 'neoforge' && 'selected')}
              onClick={() => setLoaderType('neoforge')}
            >
              <span className="loader-icon forge">N</span>
              <span>
                <strong>NeoForge</strong>
                <small>模组加载器</small>
              </span>
              {loaderType === 'neoforge' && <Check size={15} />}
            </button>
          </div>
        </div>

        {(loaderType === 'forge' || loaderType === 'neoforge') && (
          <div className="field">
            <span>{loaderType === 'neoforge' ? 'NeoForge 版本' : 'Forge 版本'}</span>
            {forgeLoading ? (
              <div className="forge-loading">
                <Loader2 size={14} className="spin" /> 正在获取加载器版本…
              </div>
            ) : forgeError ? (
              <div className="form-error">{forgeError}</div>
            ) : (
              <div className="select-wrap">
                <select
                  value={forgeVersion}
                  onChange={(event) => setForgeVersion(event.target.value)}
                  disabled={creating}
                >
                  {forgeVersions.map((item) => (
                    <option key={item.version} value={item.version}>
                      {item.version}
                      {item.recommended ? '（推荐）' : item.latest ? '（最新）' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
            )}
            <small className="field-note">创建后首次启动时自动安装，不再需要手动运行安装器。</small>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  )
}
