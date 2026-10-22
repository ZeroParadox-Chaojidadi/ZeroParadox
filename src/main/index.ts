import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
app.setName('ZeroParadox')
app.setPath('userData', path.join(app.getPath('appData'), 'ZeroParadox'))
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import type {
  Account,
  AccountRecord,
  AppInfo,
  ContentKind,
  Instance,
  JavaDetection,
  LaunchResult,
  ProgressEvent,
  Settings,
  VersionManifestResult,
  WindowState
} from '../shared/types'
import { initPaths, getPaths, gameDir, instanceDir, readConfiguredResourceDir, writeConfiguredDataDir, writeConfiguredResourceDir } from './paths'
import { store } from './store'
import { getVersionManifest, findVersion, installFabricProfile } from './mojang'
import { getForgeLoaders } from './forge'
import { getNeoForgeLoaders } from './neoforge'
import { installInstance } from './installer'
import {
  launchInstance,
  killInstance,
  readLogTail,
  runningInstanceIds,
  setLaunchCallbacks
} from './launcher'
import { inspectJava } from './java'
import { getNews } from './news'
import {
  deleteContent,
  getProject,
  getProjectVersions,
  importContentFiles,
  installProject,
  listContent,
  listWorlds,
  searchProjects,
  toggleContent
} from './modrinth'
import {
  applyModpackFiles,
  applyZipToInstance,
  createInstanceFromMeta,
  createInstanceFromPack,
  inspectPack,
  loadModpack,
  openPackZip
} from './modpack'
import { addExistingInstance, addExistingMany, inspectExistingFolder, scanExistingFolders } from './existing'
import { authenticateYggdrasil } from './yggdrasil'
import { moveDir, newId, offlineUuid, pathExists } from './util'
import { CancelledError } from './http'
import {
  completeMicrosoftLogin,
  getConfiguredClientId,
  pollForMicrosoftToken,
  requestDeviceCode
} from './auth'

let mainWindow: BrowserWindow | null = null
const jobs = new Map<string, { abort: AbortController; startedAt: number; instanceId: string }>()
const gameStartTimes = new Map<string, number>()
const progressTimes = new Map<string, number>()
const microsoftFlows = new Map<
  string,
  { abort: AbortController; deviceCode: string; clientId: string; interval: number; expiresIn: number }
>()

function send(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

async function captureScreenshot(window: BrowserWindow): Promise<void> {
  try {
    const delay = Number(process.env.ZP_SCREENSHOT_DELAY || 2200)
    await new Promise((resolve) => setTimeout(resolve, delay))
    if (process.env.ZP_SCREENSHOT_JS) {
      await window.webContents.executeJavaScript(process.env.ZP_SCREENSHOT_JS)
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.ZP_SCREENSHOT_AFTER_JS || 1000)))
    }
    const image = await window.webContents.capturePage()
    const target = path.resolve(process.env.ZP_SCREENSHOT_PATH!)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, image.toPNG())
    console.log(`[screenshot] ${target}`)
  } catch (error) {
    console.error('[screenshot] failed', error)
  } finally {
    app.quit()
  }
}

function createWindow(): void {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../build/icon.png')
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#0b0f13',
    title: '零式悖论',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  let closeConfirmed = false
  mainWindow.on('close', (event) => {
    if (runningInstanceIds().length === 0 || closeConfirmed) return
    event.preventDefault()
    void dialog
      .showMessageBox(mainWindow!, {
        type: 'question',
        title: '游戏仍在运行',
        message: '游戏仍在运行，确定退出启动器吗？',
        detail: '游戏进程不会被关闭。你也可以先回到启动器。',
        buttons: ['返回启动器', '退出启动器'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      .then(({ response }) => {
        if (response === 1) {
          closeConfirmed = true
          mainWindow?.close()
        }
      })
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (process.env.ZP_SCREENSHOT_PATH) {
      void captureScreenshot(mainWindow!)
    }
  })
  mainWindow.on('maximize', () => send('window:state', { maximized: true } satisfies WindowState))
  mainWindow.on('unmaximize', () => send('window:state', { maximized: false } satisfies WindowState))
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function emitProgress(instanceId: string, jobId: string, progress: Omit<ProgressEvent, 'jobId' | 'instanceId'>): void {
  const now = Date.now()
  const last = progressTimes.get(instanceId) || 0
  if (!progress.done && now - last < 120) return
  progressTimes.set(instanceId, now)
  send('progress:event', {
    ...progress,
    jobId,
    instanceId
  } satisfies ProgressEvent)
}

async function runJob<T>(
  instanceId: string,
  fn: (jobId: string, signal: AbortSignal) => Promise<T>
): Promise<T> {
  if ([...jobs.values()].some((job) => job.instanceId === instanceId)) {
    throw new Error('这个实例已有任务正在进行，请稍候')
  }
  const jobId = newId('job_')
  const abort = new AbortController()
  jobs.set(jobId, { abort, startedAt: Date.now(), instanceId })
  try {
    return await fn(jobId, abort.signal)
  } finally {
    jobs.delete(jobId)
  }
}

async function installJob(instanceId: string): Promise<void> {
  const instance = store.requireInstance(instanceId)
  const settings = store.getSettings()
  await runJob(instanceId, async (jobId, signal) => {
    try {
      await installInstance(instance, {
        source: settings.downloadSource,
        concurrency: settings.downloadConcurrency,
        signal,
        onProgress: (update) => {
          emitProgress(instanceId, jobId, {
            kind: update.kind,
            phase: update.phase,
            message: update.message,
            current: update.current,
            total: update.total,
            bytes: update.bytes,
            bytesTotal: update.bytesTotal,
            percent: update.percent
          })
        }
      })
      emitProgress(instanceId, jobId, {
        kind: 'done',
        phase: '完成',
        message: '安装完成',
        current: 1,
        total: 1,
        percent: 100,
        done: true
      })
    } catch (error) {
      const message = error instanceof CancelledError ? '安装已取消' : errorMessage(error)
      emitProgress(instanceId, jobId, {
        kind: 'preparing',
        phase: '失败',
        message,
        current: 0,
        total: 1,
        percent: 0,
        done: true,
        error: message
      })
      throw error
    }
  })
}

async function launchJob(instanceId: string): Promise<LaunchResult> {
  return runJob(instanceId, async (jobId, signal) => {
    gameStartTimes.set(instanceId, Date.now())
    try {
      const result = await launchInstance(instanceId, {
        signal,
        onInstallProgress: (update) => {
          emitProgress(instanceId, jobId, {
            kind: update.kind,
            phase: update.phase,
            message: update.message,
            current: update.current,
            total: update.total,
            bytes: update.bytes,
            bytesTotal: update.bytesTotal,
            percent: Math.min(90, update.percent * 0.9)
          })
        },
        onLaunchProgress: (update) => {
          emitProgress(instanceId, jobId, {
            kind: update.kind === 'java' ? 'java' : update.kind === 'starting' ? 'launch' : 'preparing',
            phase: update.phase,
            message: update.message,
            current: 1,
            total: 1,
            percent: update.percent
          })
        }
      })
      emitProgress(instanceId, jobId, {
        kind: 'done',
        phase: '已启动',
        message: '游戏已启动',
        current: 1,
        total: 1,
        percent: 100,
        done: true
      })
      return result
    } catch (error) {
      const message = error instanceof CancelledError ? '启动已取消' : errorMessage(error)
      emitProgress(instanceId, jobId, {
        kind: 'preparing',
        phase: '启动失败',
        message,
        current: 0,
        total: 1,
        percent: 0,
        done: true,
        error: message
      })
      throw error
    }
  })
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', () => {
    return store.publicState(
      app.getVersion(),
      process.platform,
      app.isPackaged,
      Math.round(os.totalmem() / 1024 / 1024),
      os.cpus().length
    )
  })

  ipcMain.handle('java:detect', async (): Promise<JavaDetection[]> => {
    const { findJavaCandidates, inspectJava } = await import('./java')
    const settings = store.getSettings()
    const candidates = await findJavaCandidates(settings)
    const result: JavaDetection[] = candidates.map((candidate) => ({
      path: candidate.path,
      major: candidate.major,
      label: candidate.label,
      source: candidate.source
    }))
    // 手动添加的 Java 追加到列表里（去重，且必须仍然可执行）。
    for (const custom of settings.extraJavaPaths || []) {
      const normalized = path.resolve(custom).toLowerCase()
      if (result.some((item) => path.resolve(item.path).toLowerCase() === normalized)) continue
      const info = await inspectJava(custom)
      if (!info) continue
      result.push({ path: custom, major: info.major, label: info.label, source: 'custom' })
    }
    return result
  })

  ipcMain.handle('app:info', (): AppInfo => {
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome
    }
  })

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:toggleMaximize', (): WindowState => {
    if (!mainWindow) return { maximized: false }
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return { maximized: mainWindow.isMaximized() }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', (): WindowState => ({ maximized: Boolean(mainWindow?.isMaximized()) }))

  ipcMain.handle('settings:setDataDir', async (_event, dir: string, mode: 'move' | 'switch'): Promise<string> => {
    const target = path.resolve(String(dir || '').trim())
    if (!target) throw new Error('请选择目录')
    if (/^[a-zA-Z]:[\\/]?$/.test(target)) {
      const drive = target.replace(/[\\/]+$/, '')
      throw new Error(`不能直接使用磁盘根目录，请先在 ${drive} 下新建文件夹（例如 ${drive}\\ZeroParadoxData）再选择`)
    }
    const current = getPaths().dataDir
    if (target === current) throw new Error('这已经是当前数据目录')
    if (mode === 'move') {
      await moveDir(current, target)
    } else {
      const stat = await fs.stat(target).catch(() => null)
      if (stat) {
        const entries = await fs.readdir(target).catch(() => [])
        if (entries.length > 0) throw new Error('目标目录不是空的，请选择空目录')
      }
      await fs.mkdir(target, { recursive: true })
    }
    writeConfiguredDataDir(target)
    return target
  })

  ipcMain.handle('settings:setResourceDir', async (_event, dir: string | null): Promise<string | null> => {
    if (dir === null) {
      writeConfiguredResourceDir(null)
      return null
    }
    const target = path.resolve(String(dir || '').trim())
    if (!target) throw new Error('请选择目录')
    const hasAssets = await fs.stat(path.join(target, 'assets')).then((stat) => stat.isDirectory(), () => false)
    const hasLibraries = await fs.stat(path.join(target, 'libraries')).then((stat) => stat.isDirectory(), () => false)
    if (!hasAssets && !hasLibraries) {
      throw new Error('这个目录里没有 assets/ 或 libraries/，请选择其他启动器的 .minecraft 目录')
    }
    writeConfiguredResourceDir(target)
    return target
  })

  ipcMain.handle('settings:getResourceDir', async () => readConfiguredResourceDir())

  ipcMain.handle('app:relaunch', async (): Promise<void> => {
    app.relaunch()
    setTimeout(() => app.exit(0), 200)
  })

  ipcMain.handle('settings:update', async (_event, patch: Partial<Settings>) => {
    const allowed: Partial<Settings> = {}
    const keys: (keyof Settings)[] = [
      'language',
      'theme',
      'accent',
      'memoryMb',
      'autoMemory',
      'javaPath',
      'downloadSource',
      'downloadConcurrency',
      'showSnapshots',
      'keepLauncherOpen',
      'minimizeOnLaunch',
      'checkUpdates',
      'closeAfterGameExit',
      'microsoftClientId',
      'extraJavaPaths'
    ]
    for (const key of keys) {
      if (patch[key] !== undefined) (allowed as Record<string, unknown>)[key] = patch[key]
    }
    if (allowed.memoryMb !== undefined) {
      allowed.memoryMb = Math.max(512, Math.min(65536, Number(allowed.memoryMb) || 4096))
    }
    if (allowed.downloadConcurrency !== undefined) {
      allowed.downloadConcurrency = Math.max(1, Math.min(32, Number(allowed.downloadConcurrency) || 8))
    }
    if (allowed.extraJavaPaths !== undefined) {
      const list = Array.isArray(allowed.extraJavaPaths) ? allowed.extraJavaPaths : []
      allowed.extraJavaPaths = Array.from(
        new Set(list.map((item) => String(item).trim()).filter((item) => item.length > 0))
      ).slice(0, 20)
    }
    if (allowed.checkUpdates === undefined && patch.checkUpdates !== undefined) {
      allowed.checkUpdates = Boolean(patch.checkUpdates)
    }
    if (allowed.microsoftClientId !== undefined) {
      allowed.microsoftClientId = String(allowed.microsoftClientId).trim().slice(0, 100)
    }
    return store.updateSettings(allowed)
  })

  ipcMain.handle('versions:list', async (_event, force: boolean): Promise<VersionManifestResult> => {
    return getVersionManifest(Boolean(force))
  })

  ipcMain.handle('forge:versions', async (_event, gameVersion: string) => {
    return getForgeLoaders(String(gameVersion || '').trim())
  })

  ipcMain.handle('neoforge:versions', async (_event, gameVersion: string) => {
    return getNeoForgeLoaders(String(gameVersion || '').trim())
  })

  ipcMain.handle(
    'instances:create',
    async (
      _event,
      input: {
        name: string
        gameVersion: string
        loaderType: 'vanilla' | 'fabric' | 'forge' | 'neoforge'
        forgeVersion?: string
        neoforgeVersion?: string
        icon?: string
        color?: string
        memoryMb?: number | null
        notes?: string
      }
    ): Promise<Instance> => {
      const name = String(input.name || '').trim()
      if (!name) throw new Error('请输入实例名称')
      if (name.length > 40) throw new Error('实例名称不能超过 40 个字符')
      const manifest = await getVersionManifest()
      const summary = findVersion(manifest, input.gameVersion)
      let versionId = summary.id
      let loader: Instance['loader'] = { type: 'vanilla' }
      if (input.loaderType === 'fabric') {
        const profile = await installFabricProfile(input.gameVersion)
        versionId = profile.profileId
        loader = { type: 'fabric', version: profile.loaderVersion }
      } else if (input.loaderType === 'forge') {
        const forgeVersion = String(input.forgeVersion || '').trim()
        if (!forgeVersion) throw new Error('请选择 Forge 版本')
        const available = await getForgeLoaders(input.gameVersion)
        if (!available.some((item) => item.version === forgeVersion)) {
          throw new Error(`Forge ${forgeVersion} 不支持 Minecraft ${input.gameVersion}`)
        }
        versionId = `${input.gameVersion}-forge-${forgeVersion}`
        loader = { type: 'forge', version: forgeVersion }
      } else if (input.loaderType === 'neoforge') {
        const neoVersion = String(input.neoforgeVersion || '').trim()
        if (!neoVersion) throw new Error('请选择 NeoForge 版本')
        const available = await getNeoForgeLoaders(input.gameVersion)
        if (!available.some((item) => item.version === neoVersion)) {
          throw new Error(`NeoForge ${neoVersion} 不支持 Minecraft ${input.gameVersion}`)
        }
        versionId = `${input.gameVersion}-neoforge-${neoVersion}`
        loader = { type: 'neoforge', version: neoVersion }
      }
      return store.createInstance({
        name,
        gameVersion: input.gameVersion,
        versionId,
        loader,
        icon: input.icon,
        color: input.color,
        memoryMb: input.memoryMb ?? null,
        notes: input.notes
      })
    }
  )

  ipcMain.handle('instances:update', async (_event, id: string, patch: Partial<Instance>): Promise<Instance> => {
    const allowed: Partial<Instance> = {}
    if (patch.name !== undefined) allowed.name = String(patch.name).slice(0, 60)
    if (patch.icon !== undefined) allowed.icon = String(patch.icon).slice(0, 8)
    if (patch.color !== undefined) allowed.color = String(patch.color)
    if (patch.notes !== undefined) allowed.notes = String(patch.notes).slice(0, 5000)
    if (patch.memoryMb !== undefined) {
      allowed.memoryMb = patch.memoryMb === null ? null : Math.max(512, Math.min(65536, Number(patch.memoryMb) || 4096))
    }
    if (patch.javaPath !== undefined) allowed.javaPath = patch.javaPath || null
    if (patch.jvmArgs !== undefined) allowed.jvmArgs = String(patch.jvmArgs).slice(0, 4000)
    if (patch.gameArgs !== undefined) allowed.gameArgs = String(patch.gameArgs).slice(0, 4000)
    if (patch.resolution !== undefined) allowed.resolution = patch.resolution
    return store.updateInstance(id, allowed)
  })

  ipcMain.handle('instances:setGameDir', async (_event, id: string, dir: string | null): Promise<Instance> => {
    const instance = store.requireInstance(String(id))
    const from = gameDir(instance.id)
    const target = dir ? path.resolve(String(dir)) : path.join(instanceDir(instance.id), 'minecraft')
    if (target === from) return instance
    await moveDir(from, target)
    return store.updateInstance(instance.id, { gameDir: dir ? target : null })
  })

  ipcMain.handle('instances:inspectFolder', async (_event, dir: string) =>
    inspectExistingFolder(String(dir || ''))
  )

  ipcMain.handle('instances:scanFolder', async (_event, dir: string) =>
    scanExistingFolders(String(dir || ''))
  )

  ipcMain.handle('instances:addExistingMany', async (_event, dirs: string[]) =>
    addExistingMany(Array.isArray(dirs) ? dirs.map((item) => String(item)) : [])
  )

  ipcMain.handle(
    'instances:addExisting',
    async (
      _event,
      dir: string,
      override?: {
        name?: string
        gameVersion?: string
        loaderType?: 'vanilla' | 'fabric' | 'forge'
        loaderVersion?: string
      }
    ) => addExistingInstance(String(dir || ''), override)
  )

  ipcMain.handle('instances:delete', async (_event, id: string) => {
    if (runningInstanceIds().includes(id)) throw new Error('游戏正在运行，无法删除实例')
    await store.deleteInstance(id)
    return true
  })

  ipcMain.handle('instances:duplicate', async (_event, id: string) => store.duplicateInstance(id))
  ipcMain.handle('instances:openFolder', async (_event, id: string) => {
    await fs.mkdir(gameDir(id), { recursive: true })
    await shell.openPath(gameDir(id))
  })
  ipcMain.handle('instances:openLogs', async () => {
    await fs.mkdir(getPaths().logs, { recursive: true })
    await shell.openPath(getPaths().logs)
  })
  ipcMain.handle('instances:install', async (_event, id: string) => {
    await installJob(id)
    return true
  })

  ipcMain.handle('modpacks:inspect', async (_event, packPath: string) => inspectPack(String(packPath || '')))

  ipcMain.handle('modpacks:createFromPack', async (_event, packPath: string): Promise<Instance> => {
    const source = String(packPath || '').trim()
    if (!source) throw new Error('请选择整合包文件')
    const meta = await inspectPack(source)
    if (!meta.gameVersion) throw new Error('无法识别整合包的游戏版本，请先新建实例再导入')
    if (meta.kind === 'mrpack') {
      const { index } = await loadModpack(source)
      return createInstanceFromPack(source, index)
    }
    return createInstanceFromMeta(source, meta)
  })

  ipcMain.handle('modpacks:applyPack', async (_event, instanceId: string, packPath: string): Promise<void> => {
    const instance = store.requireInstance(String(instanceId))
    const source = String(packPath || '').trim()
    if (!source) throw new Error('请选择整合包文件')
    const meta = await inspectPack(source)
    const settings = store.getSettings()
    const report = (jobId: string) => (update: {
      phase: string
      message: string
      current: number
      total: number
      percent: number
      bytes?: number
      bytesTotal?: number
    }): void =>
      emitProgress(instance.id, jobId, {
        kind: 'preparing',
        phase: update.phase,
        message: update.message,
        current: update.current,
        total: update.total,
        percent: update.percent,
        bytes: update.bytes,
        bytesTotal: update.bytesTotal
      })
    try {
      await runJob(instance.id, async (jobId, signal) => {
        if (meta.kind === 'mrpack') {
          const { zip, index } = await loadModpack(source)
          await applyModpackFiles(instance, zip, index, {
            signal,
            concurrency: settings.downloadConcurrency,
            onProgress: report(jobId)
          })
        } else {
          const zip = await openPackZip(source)
          await applyZipToInstance(instance, zip, { signal, onProgress: report(jobId) })
        }
        emitProgress(instance.id, jobId, {
          kind: 'done',
          phase: '完成',
          message: '整合包导入完成',
          current: 1,
          total: 1,
          percent: 100,
          done: true
        })
      })
    } catch (error) {
      const message = error instanceof CancelledError ? '导入已取消' : errorMessage(error)
      emitProgress(instance.id, 'modpack', {
        kind: 'preparing',
        phase: '失败',
        message,
        current: 0,
        total: 1,
        percent: 0,
        done: true,
        error: message
      })
      throw error
    }
  })

  ipcMain.handle('modpacks:applyZip', async (_event, instanceId: string, packPath: string): Promise<void> => {
    const instance = store.requireInstance(String(instanceId))
    const source = String(packPath || '').trim()
    if (!source) throw new Error('请选择整合包文件')
    const zip = await openPackZip(source)
    await runJob(instance.id, async (jobId, signal) => {
      await applyZipToInstance(instance, zip, {
        signal,
        onProgress: (update) =>
          emitProgress(instance.id, jobId, {
            kind: 'preparing',
            phase: update.phase,
            message: update.message,
            current: update.current,
            total: update.total,
            percent: update.percent
          })
      })
      emitProgress(instance.id, jobId, {
        kind: 'done',
        phase: '完成',
        message: '整合包文件已写入',
        current: 1,
        total: 1,
        percent: 100,
        done: true
      })
    })
  })

  ipcMain.handle('instances:launch', async (_event, id: string): Promise<LaunchResult> => {
    const settings = store.getSettings()
    if (settings.minimizeOnLaunch) mainWindow?.minimize()
    return launchJob(id)
  })
  ipcMain.handle('instances:kill', async (_event, id: string) => {
    await killInstance(id)
    return true
  })
  ipcMain.handle('instances:running', (): string[] => runningInstanceIds())
  ipcMain.handle('instances:logTail', async (_event, id: string, lines?: number) => readLogTail(id, lines || 300))

  ipcMain.handle('jobs:cancel', (_event, instanceId: string) => {
    for (const [jobId, job] of jobs) {
      if (job.instanceId === instanceId) {
        job.abort.abort()
        jobs.delete(jobId)
        return true
      }
    }
    return false
  })

  ipcMain.handle('accounts:addOffline', async (_event, username: string): Promise<Account> => {
    const name = String(username || '').trim()
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      throw new Error('离线用户名需为 3–16 位字母、数字或下划线')
    }
    if (store.getAccounts().some((account) => account.username.toLowerCase() === name.toLowerCase())) {
      throw new Error('已存在同名账户')
    }
    const account = {
      id: newId('acc_'),
      type: 'offline' as const,
      username: name,
      uuid: offlineUuid(name),
      avatarUrl: null,
      skinModel: 'classic' as const
    }
    return store.addAccount(account)
  })
  ipcMain.handle('accounts:remove', async (_event, id: string) => {
    await store.removeAccount(id)
    return true
  })
  ipcMain.handle('accounts:setActive', async (_event, id: string) => {
    await store.setActiveAccount(id)
    return true
  })

  ipcMain.handle(
    'accounts:yggdrasilLogin',
    async (_event, server: string, username: string, password: string): Promise<Account> => {
      const session = await authenticateYggdrasil(String(server || ''), String(username || ''), String(password || ''))
      const record: AccountRecord = {
        id: newId('acc_ys_'),
        type: 'yggdrasil',
        username: session.profile.name,
        uuid: session.profile.id,
        accessToken: session.accessToken,
        clientToken: session.clientToken,
        server: session.server
      }
      const existing = store
        .getAccounts()
        .find((account) => account.type === 'yggdrasil' && account.server === record.server && account.uuid === record.uuid)
      if (existing) {
        await store.updateAccount(existing.id, record)
        await store.setActiveAccount(existing.id)
        return store.getAccounts().find((account) => account.id === existing.id) as Account
      }
      return store.addAccount(record)
    }
  )

  ipcMain.handle('accounts:microsoftStart', async () => {
    const clientId = getConfiguredClientId()
    if (!clientId) {
      throw new Error('请先填写 Microsoft Azure 应用 Client ID')
    }
    const device = await requestDeviceCode(clientId)
    const flowId = newId('ms_')
    const abort = new AbortController()
    microsoftFlows.set(flowId, {
      abort,
      deviceCode: device.device_code,
      clientId,
      interval: device.interval || 5,
      expiresIn: device.expires_in || 900
    })
    return {
      flowId,
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      expiresIn: device.expires_in || 900,
      interval: device.interval || 5,
      message: device.message
    }
  })

  ipcMain.handle('accounts:microsoftWait', async (_event, flowId: string): Promise<Account> => {
    const flow = microsoftFlows.get(flowId)
    if (!flow) throw new Error('登录会话不存在或已取消')
    try {
      const token = await pollForMicrosoftToken(
        flow.deviceCode,
        flow.clientId,
        flow.interval,
        flow.expiresIn,
        flow.abort.signal
      )
      const record = await completeMicrosoftLogin(token, flow.clientId, flow.abort.signal)
      const existing = store
        .getAccounts()
        .find((account) => account.type === 'microsoft' && account.uuid === record.uuid)
      if (existing) {
        const updated = await store.updateAccount(existing.id, {
          ...record,
          id: existing.id
        })
        await store.setActiveAccount(existing.id)
        return {
          id: updated.id,
          type: updated.type,
          username: updated.username,
          uuid: updated.uuid,
          avatarUrl: updated.avatarUrl,
          skinModel: updated.skinModel
        }
      }
      return store.addAccount(record)
    } finally {
      microsoftFlows.delete(flowId)
    }
  })

  ipcMain.handle('accounts:microsoftCancel', (_event, flowId: string) => {
    const flow = microsoftFlows.get(flowId)
    if (!flow) return false
    flow.abort.abort()
    microsoftFlows.delete(flowId)
    return true
  })

  ipcMain.handle('news:list', async () => getNews())

  ipcMain.handle(
    'modrinth:search',
    async (
      _event,
      input: {
        query: string
        kind: ContentKind
        gameVersion?: string
        loader?: string
        offset?: number
        sort?: 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'
      }
    ) => searchProjects(input)
  )
  ipcMain.handle('modrinth:project', async (_event, id: string) => getProject(id))
  ipcMain.handle(
    'modrinth:versions',
    async (_event, projectId: string, gameVersion: string, loader: string, kind: ContentKind) =>
      getProjectVersions(projectId, gameVersion, loader, kind)
  )
  ipcMain.handle(
    'modrinth:install',
    async (_event, instanceId: string, projectId: string, kind: ContentKind, versionId?: string) =>
      installProject(instanceId, projectId, kind, versionId)
  )

  ipcMain.handle('content:list', async (_event, instanceId: string, kind: ContentKind) =>
    listContent(instanceId, kind)
  )
  ipcMain.handle('content:toggle', async (_event, instanceId: string, kind: ContentKind, fileName: string) =>
    toggleContent(instanceId, kind, fileName)
  )
  ipcMain.handle('content:delete', async (_event, instanceId: string, kind: ContentKind, fileName: string) =>
    deleteContent(instanceId, kind, fileName)
  )
  ipcMain.handle(
    'content:import',
    async (_event, instanceId: string, kind: ContentKind, paths: string[]) => {
      if (!Array.isArray(paths) || paths.length === 0) {
        return { imported: [], skipped: [] }
      }
      return importContentFiles(instanceId, kind, paths.map((value) => String(value)))
    }
  )
  ipcMain.handle('worlds:list', async (_event, instanceId: string) => listWorlds(instanceId))

  ipcMain.handle('dialog:pickJava', async (): Promise<string | null> => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Java 可执行文件',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Java 可执行文件', extensions: ['exe'] }]
          : [{ name: '所有文件', extensions: ['*'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    let selected = result.filePaths[0]
    if (process.platform === 'win32' && path.basename(selected).toLowerCase() === 'javaw.exe') {
      selected = path.join(path.dirname(selected), 'java.exe')
    }
    const info = await inspectJava(selected)
    if (!info) throw new Error('无法识别该文件，请选择 java.exe 或 javaw.exe')
    return selected
  })

  ipcMain.handle('dialog:pickModpack', async (): Promise<string | null> => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Modrinth 整合包',
      properties: ['openFile'],
      filters: [{ name: 'Modrinth 整合包', extensions: ['mrpack', 'zip'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:pickDirectory', async (): Promise<string | null> => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0] || null
  })

  ipcMain.handle('shell:openPath', async (_event, target: string) => {
    const resolved = path.resolve(target)
    if (!(await pathExists(resolved))) throw new Error('路径不存在')
    return shell.openPath(resolved)
  })
  ipcMain.handle('shell:showItem', (_event, target: string) => shell.showItemInFolder(path.resolve(target)))
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('仅支持打开网页链接')
    await shell.openExternal(url)
  })
  ipcMain.handle('shell:openInstanceFolder', async (_event, id: string) => {
    await fs.mkdir(instanceDir(id), { recursive: true })
    await shell.openPath(gameDir(id))
  })
}


function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const clean = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    return clean
  }
  return String(error)
}

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  electronApp.setAppUserModelId('com.zeroparadox.launcher')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initPaths()
  await store.load()
  registerIpc()
  setLaunchCallbacks({
    onLog: (event) => send('log:event', event),
    onExit: (instanceId, code) => {
      const started = gameStartTimes.get(instanceId)
      if (started) gameStartTimes.delete(instanceId)
      send('game:exit', { instanceId, code })
    }
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  for (const job of jobs.values()) job.abort.abort()
  for (const flow of microsoftFlows.values()) flow.abort.abort()
})
