import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import type {
  AppInfo,
  Bootstrap,
  ContentKind,
  Instance,
  LogEvent,
  ProgressEvent,
  Settings,
  VersionSummary
} from '../../shared/types'
import { api, errorMessage } from './lib/utils'
import type { TaskState, ToastMessage, View } from './types'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ToastViewport from './components/ToastViewport'
import CreateInstanceModal from './components/CreateInstanceModal'
import AccountModal from './components/AccountModal'
import TaskModal from './components/TaskModal'
import Modal from './components/Modal'
import LibraryView from './views/LibraryView'
import InstanceDetail from './views/InstanceDetail'
import BrowseView from './views/BrowseView'
import SettingsView from './views/SettingsView'
import logo from './assets/logo.png'

interface ConfirmState {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  action: () => Promise<void> | void
}

export default function App(): React.JSX.Element {
  const [data, setData] = useState<Bootstrap | null>(null)
  const [fatalError, setFatalError] = useState('')
  const [view, setView] = useState<View>('library')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [latestRelease, setLatestRelease] = useState('')
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [runningIds, setRunningIds] = useState<string[]>([])
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const [task, setTask] = useState<TaskState | null>(null)
  const [progress, setProgress] = useState<Record<string, ProgressEvent | undefined>>({})
  const [logs, setLogs] = useState<Record<string, string[]>>({})
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [browseSeed, setBrowseSeed] = useState<{ instanceId: string | null; kind: ContentKind }>({
    instanceId: null,
    kind: 'mod'
  })
  const toastId = useRef(0)

  const pushToast = useCallback((type: ToastMessage['type'], title: string, detail?: string) => {
    const id = ++toastId.current
    setToasts((current) => [...current.slice(-3), { id, type, title, detail }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 5200)
  }, [])

  const refresh = useCallback(async (): Promise<Bootstrap | null> => {
    try {
      const next = await api.getBootstrap()
      setData(next)
      return next
    } catch (error) {
      setFatalError(errorMessage(error))
      return null
    }
  }, [])

  const loadVersions = useCallback(async (): Promise<VersionSummary[]> => {
    try {
      const manifest = await api.versions.list()
      setVersions(manifest.versions)
      setLatestRelease(manifest.latest.release)
      return manifest.versions
    } catch (error) {
      pushToast('error', '无法获取游戏版本列表', errorMessage(error))
      return []
    }
  }, [pushToast])

  useEffect(() => {
    void (async () => {
      const boot = await refresh()
      if (!boot) return
      void api.getAppInfo().then(setAppInfo).catch(() => undefined)
      void loadVersions()
      try {
        setRunningIds(await api.instances.running())
      } catch {
        // Ignore.
      }
    })()
  }, [refresh, loadVersions])

  useEffect(() => {
    const offProgress = api.instances.onProgress((event) => {
      setProgress((current) => ({ ...current, [event.instanceId]: event }))
      if (event.done) {
        void refresh()
        if (event.error) setLaunchingId(null)
      }
    })
    const offLog = api.instances.onLog((event: LogEvent) => {
      setLogs((current) => {
        const lines = [...(current[event.instanceId] || []), event.line]
        return { ...current, [event.instanceId]: lines.slice(-800) }
      })
    })
    const offExit = api.instances.onGameExit((event) => {
      setRunningIds((current) => current.filter((id) => id !== event.instanceId))
      setLaunchingId(null)
      void refresh()
      if (event.code && event.code !== 0) {
        pushToast('error', '游戏异常退出', `退出代码 ${event.code}，可以到实例日志中查看原因。`)
      } else {
        pushToast('info', '游戏已退出', '存档与游玩时长已保存。')
      }
    })
    return () => {
      offProgress()
      offLog()
      offExit()
    }
  }, [refresh, pushToast])

  useEffect(() => {
    if (!task) return
    const current = progress[task.instanceId]
    if (!current?.done || current.error) return
    const instanceId = task.instanceId
    const timer = window.setTimeout(() => {
      setTask((active) => (active?.instanceId === instanceId ? null : active))
      if (task.mode === 'install') pushToast('success', '安装完成', '现在可以开始游戏了。')
    }, 1700)
    return () => window.clearTimeout(timer)
  }, [task, progress, pushToast])

  const openCreate = useCallback(async () => {
    if (versions.length === 0) {
      const loaded = await loadVersions()
      if (loaded.length === 0) return
    }
    setCreateOpen(true)
  }, [versions.length, loadVersions])

  const navigate = useCallback((next: View) => {
    setDetailId(null)
    setView(next)
    if (next === 'browse') {
      const first = data?.instances[0]
      setBrowseSeed({ instanceId: first?.id || null, kind: first?.loader.type === 'vanilla' ? 'resourcepack' : 'mod' })
    }
  }, [data?.instances])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void openCreate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openCreate])

  const startInstall = useCallback(
    async (instanceId: string): Promise<void> => {
      const instance = data?.instances.find((item) => item.id === instanceId)
      setProgress((current) => ({ ...current, [instanceId]: undefined }))
      setTask({
        instanceId,
        instanceName: instance?.name || '实例',
        mode: 'install',
        startedAt: Date.now()
      })
      try {
        await api.instances.install(instanceId)
        await refresh()
      } catch (error) {
        const message = errorMessage(error)
        setProgress((current) => ({
          ...current,
          [instanceId]: {
            jobId: 'local',
            instanceId,
            kind: 'preparing',
            phase: '安装失败',
            message,
            current: 0,
            total: 1,
            percent: 0,
            done: true,
            error: message
          }
        }))
      }
    },
    [data?.instances, refresh]
  )

  const launch = useCallback(
    async (instanceId: string): Promise<void> => {
      if (!data) return
      if (!data.activeAccountId) {
        setAccountOpen(true)
        pushToast('info', '请先添加游戏账户', '离线用户名会显示在游戏内。')
        return
      }
      const instance = data.instances.find((item) => item.id === instanceId)
      if (!instance) return
      if (runningIds.includes(instanceId)) return
      setProgress((current) => ({ ...current, [instanceId]: undefined }))
      setLaunchingId(instanceId)
      setTask({
        instanceId,
        instanceName: instance.name,
        mode: 'launch',
        startedAt: Date.now()
      })
      try {
        await api.instances.launch(instanceId)
        setRunningIds((current) => (current.includes(instanceId) ? current : [...current, instanceId]))
        await refresh()
      } catch (error) {
        const message = errorMessage(error)
        setProgress((current) => ({
          ...current,
          [instanceId]: {
            jobId: 'local',
            instanceId,
            kind: 'preparing',
            phase: '启动失败',
            message,
            current: 0,
            total: 1,
            percent: 0,
            done: true,
            error: message
          }
        }))
        pushToast('error', '游戏启动失败', message)
      } finally {
        setLaunchingId(null)
      }
    },
    [data, runningIds, refresh, pushToast]
  )

  const stop = useCallback(
    (instanceId: string) => {
      const instance = data?.instances.find((item) => item.id === instanceId)
      setConfirm({
        title: '结束游戏进程？',
        description: `“${instance?.name || '游戏'}” 将被强制关闭，未保存的世界进度可能丢失。`,
        confirmLabel: '结束游戏',
        danger: true,
        action: async () => {
          await api.instances.kill(instanceId)
          pushToast('info', '正在结束游戏', '等待游戏进程退出…')
        }
      })
    },
    [data?.instances, pushToast]
  )

  const deleteInstance = useCallback(
    (instanceId: string) => {
      const instance = data?.instances.find((item) => item.id === instanceId)
      setConfirm({
        title: '删除这个实例？',
        description: `“${instance?.name || '实例'}” 的存档、模组和所有游戏文件都会被永久删除。此操作不可恢复。`,
        confirmLabel: '永久删除',
        danger: true,
        action: async () => {
          await api.instances.delete(instanceId)
          if (detailId === instanceId) setDetailId(null)
          await refresh()
          pushToast('success', '实例已删除')
        }
      })
    },
    [data?.instances, detailId, refresh, pushToast]
  )

  const duplicateInstance = useCallback(
    async (instanceId: string): Promise<void> => {
      try {
        const copy = await api.instances.duplicate(instanceId)
        await refresh()
        pushToast('success', '实例副本已创建', copy.name)
      } catch (error) {
        pushToast('error', '创建副本失败', errorMessage(error))
      }
    },
    [refresh, pushToast]
  )

  const updateInstance = useCallback(
    async (instanceId: string, patch: Partial<Instance>): Promise<void> => {
      await api.instances.update(instanceId, patch)
      await refresh()
    },
    [refresh]
  )

  const updateSettings = useCallback(
    async (patch: Partial<Settings>): Promise<void> => {
      setData((current) =>
        current ? { ...current, settings: { ...current.settings, ...patch } } : current
      )
      try {
        const next = await api.settings.update(patch)
        setData((current) => (current ? { ...current, settings: next } : current))
      } catch (error) {
        await refresh()
        throw error
      }
    },
    [refresh]
  )

  const addOffline = useCallback(
    async (username: string): Promise<void> => {
      await api.accounts.addOffline(username)
      await refresh()
      pushToast('success', '账户已添加', username)
    },
    [refresh, pushToast]
  )

  const removeAccount = useCallback(
    async (id: string): Promise<void> => {
      await api.accounts.remove(id)
      await refresh()
      pushToast('success', '账户已移除')
    },
    [refresh, pushToast]
  )

  const setActive = useCallback(
    async (id: string): Promise<void> => {
      await api.accounts.setActive(id)
      await refresh()
    },
    [refresh]
  )

  const openBrowse = useCallback(
    (instanceId?: string, kind?: ContentKind) => {
      const instance = data?.instances.find((item) => item.id === instanceId) || data?.instances[0]
      setBrowseSeed({
        instanceId: instance?.id || null,
        kind: kind || (instance?.loader.type === 'vanilla' ? 'resourcepack' : 'mod')
      })
      setDetailId(null)
      setView('browse')
    },
    [data?.instances]
  )

  const pageName = useMemo(() => {
    if (detailId) return selectedInstanceName(data, detailId)
    return { library: '游戏库', browse: '资源中心', settings: '设置' }[view]
  }, [view, detailId, data])

  const selectedInstance = data?.instances.find((instance) => instance.id === detailId) || null
  const activeAccount = data?.accounts.find((account) => account.id === data.activeAccountId) || null

  if (!data && !fatalError) {
    return (
      <div className="boot-screen">
        <div className="boot-glow" />
        <img src={logo} alt="" />
        <h1>零式悖论</h1>
        <span className="boot-tagline">ZEROPARADOX LAUNCHER</span>
        <div className="boot-loader"><span /></div>
        <p>正在整理你的世界…</p>
      </div>
    )
  }

  if (fatalError || !data) {
    return (
      <div className="boot-screen error">
        <AlertTriangle size={40} />
        <h1>启动器未能加载</h1>
        <p>{fatalError || '未知错误'}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          <RefreshCw size={16} /> 重试
        </button>
      </div>
    )
  }

  return (
    <div className="app" data-theme="dark">
      <TitleBar pageName={pageName} onHome={() => navigate('library')} />
      <div className="app-body">
        <Sidebar
          view={view}
          instanceCount={data.instances.length}
          runningIds={runningIds}
          accounts={data.accounts}
          activeAccountId={data.activeAccountId}
          onNavigate={navigate}
          onAccountClick={() => setAccountOpen(true)}
        />
        <main className="content">
          {selectedInstance ? (
            <InstanceDetail
              instance={selectedInstance}
              running={runningIds.includes(selectedInstance.id)}
              launching={launchingId === selectedInstance.id}
              accountName={activeAccount?.username || null}
              logs={logs[selectedInstance.id] || []}
              onBack={() => setDetailId(null)}
              onLaunch={() => void launch(selectedInstance.id)}
              onStop={() => stop(selectedInstance.id)}
              onBrowse={(id, kind) => openBrowse(id, kind)}
              onVerify={() => void startInstall(selectedInstance.id)}
              onUpdate={(patch) => updateInstance(selectedInstance.id, patch)}
              onDelete={() => deleteInstance(selectedInstance.id)}
              onDuplicate={() => void duplicateInstance(selectedInstance.id)}
              onToast={pushToast}
            />
          ) : view === 'library' ? (
            <LibraryView
              instances={data.instances}
              runningIds={runningIds}
              launchingId={launchingId}
              onNew={() => void openCreate()}
              onOpen={setDetailId}
              onLaunch={(id) => void launch(id)}
              onStop={stop}
              onDuplicate={(id) => void duplicateInstance(id)}
              onDelete={deleteInstance}
            />
          ) : view === 'browse' ? (
            <BrowseView
              instances={data.instances}
              initialInstanceId={browseSeed.instanceId}
              initialKind={browseSeed.kind}
              onToast={pushToast}
              onNewInstance={() => void openCreate()}
            />
          ) : (
            <SettingsView
              settings={data.settings}
              appInfo={appInfo}
              dataDir={data.dataDir}
              totalMemoryMb={data.totalMemoryMb}
              activeAccountName={activeAccount?.username || null}
              onUpdate={updateSettings}
              onAccount={() => setAccountOpen(true)}
              onToast={pushToast}
            />
          )}
        </main>
      </div>

      {createOpen && (
        <CreateInstanceModal
          versions={versions}
          latestRelease={latestRelease || versions[0]?.id || ''}
          showSnapshotsDefault={data.settings.showSnapshots}
          onClose={() => setCreateOpen(false)}
          onCreate={async (input) => {
            const instance = await api.instances.create({
              ...input,
              icon: '◆',
              color: '#ff4d4f'
            })
            setCreateOpen(false)
            await refresh()
            setView('library')
            setDetailId(instance.id)
            void startInstall(instance.id)
          }}
        />
      )}

      {accountOpen && (
        <AccountModal
          accounts={data.accounts}
          activeAccountId={data.activeAccountId}
          onClose={() => setAccountOpen(false)}
          onAddOffline={addOffline}
          onRemove={removeAccount}
          onSetActive={setActive}
        />
      )}

      {task && (
        <TaskModal
          task={task}
          progress={progress[task.instanceId] || null}
          logs={logs[task.instanceId] || []}
          onClose={() => setTask(null)}
          onCancel={() => {
            void api.instances.cancelJob(task.instanceId)
            setLaunchingId(null)
          }}
        />
      )}

      {confirm && (
        <Modal
          title={confirm.title}
          width="sm"
          onClose={() => {
            if (!confirmBusy) setConfirm(null)
          }}
          footer={
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirm(null)} disabled={confirmBusy}>
                取消
              </button>
              <button
                className={confirm.danger ? 'btn btn-danger' : 'btn btn-primary'}
                disabled={confirmBusy}
                onClick={async () => {
                  setConfirmBusy(true)
                  try {
                    await confirm.action()
                    setConfirm(null)
                  } catch (error) {
                    pushToast('error', '操作失败', errorMessage(error))
                  } finally {
                    setConfirmBusy(false)
                  }
                }}
              >
                {confirmBusy ? <Loader2 size={15} className="spin" /> : null}
                {confirm.confirmLabel}
              </button>
            </div>
          }
        >
          <p className="confirm-text">{confirm.description}</p>
        </Modal>
      )}

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  )
}

function selectedInstanceName(data: Bootstrap | null, id: string): string {
  return data?.instances.find((instance) => instance.id === id)?.name || '实例'
}
