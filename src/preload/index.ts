import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
import type {
  Account,
  AppInfo,
  Bootstrap,
  ContentEntry,
  ContentImportResult,
  ExistingFolderInfo,
  ContentKind,
  ForgeLoader,
  GameExitEvent,
  InstallSummary,
  Instance,
  LaunchResult,
  LauncherApi,
  LogEvent,
  ModrinthProject,
  ModrinthSearchResult,
  ModrinthVersion,
  MicrosoftDeviceCodeInfo,
  NewsItem,
  PackInspectResult,
  ProgressEvent,
  Settings,
  VersionManifestResult,
  WindowState,
  WorldEntry
} from '../shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: LauncherApi = {
  getBootstrap: () => ipcRenderer.invoke('app:bootstrap') as Promise<Bootstrap>,
  getAppInfo: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  files: {
    pathForFile: (file: unknown) => {
      try {
        return webUtils.getPathForFile(file as Parameters<typeof webUtils.getPathForFile>[0])
      } catch {
        return ''
      }
    }
  },
  java: {
    detect: () => ipcRenderer.invoke('java:detect') as Promise<import('../shared/types').JavaDetection[]>
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize') as Promise<WindowState>,
    close: () => ipcRenderer.invoke('window:close') as Promise<void>,
    isMaximized: () => ipcRenderer.invoke('window:isMaximized') as Promise<WindowState>,
    onState: (callback) => subscribe<WindowState>('window:state', callback)
  },
  settings: {
    update: (patch: Partial<Settings>) =>
      ipcRenderer.invoke('settings:update', patch) as Promise<Settings>,
    setDataDir: (dir: string, mode: 'move' | 'switch') =>
      ipcRenderer.invoke('settings:setDataDir', dir, mode) as Promise<string>,
    setResourceDir: (dir: string | null) =>
      ipcRenderer.invoke('settings:setResourceDir', dir) as Promise<string | null>,
    getResourceDir: () => ipcRenderer.invoke('settings:getResourceDir') as Promise<string | null>
  },
  relaunch: () => ipcRenderer.invoke('app:relaunch') as Promise<void>,
  versions: {
    list: (force = false) => ipcRenderer.invoke('versions:list', force) as Promise<VersionManifestResult>
  },
  forge: {
    versions: (gameVersion: string) =>
      ipcRenderer.invoke('forge:versions', gameVersion) as Promise<ForgeLoader[]>
  },
  neoforge: {
    versions: (gameVersion: string) =>
      ipcRenderer.invoke('neoforge:versions', gameVersion) as Promise<ForgeLoader[]>
  },
  instances: {
    create: (input) => ipcRenderer.invoke('instances:create', input) as Promise<Instance>,
    update: (id: string, patch: Partial<Instance>) =>
      ipcRenderer.invoke('instances:update', id, patch) as Promise<Instance>,
    setGameDir: (id: string, dir: string | null) =>
      ipcRenderer.invoke('instances:setGameDir', id, dir) as Promise<Instance>,
    inspectFolder: (dir: string) =>
      ipcRenderer.invoke('instances:inspectFolder', dir) as Promise<ExistingFolderInfo>,
    scanFolder: (dir: string) =>
      ipcRenderer.invoke('instances:scanFolder', dir) as Promise<ExistingFolderInfo[]>,
    addExistingMany: (dirs: string[]) =>
      ipcRenderer.invoke('instances:addExistingMany', dirs) as Promise<{
        added: Instance[]
        failed: Array<{ dir: string; error: string }>
      }>,
    addExisting: (dir: string, override) =>
      ipcRenderer.invoke('instances:addExisting', dir, override) as Promise<Instance>,
    delete: (id: string) => ipcRenderer.invoke('instances:delete', id) as Promise<boolean>,
    duplicate: (id: string) => ipcRenderer.invoke('instances:duplicate', id) as Promise<Instance>,
    openFolder: (id: string) => ipcRenderer.invoke('instances:openFolder', id) as Promise<void>,
    openLogs: (id?: string) => ipcRenderer.invoke('instances:openLogs', id) as Promise<void>,
    install: (id: string) => ipcRenderer.invoke('instances:install', id) as Promise<boolean>,
    launch: (id: string) => ipcRenderer.invoke('instances:launch', id) as Promise<LaunchResult>,
    kill: (id: string) => ipcRenderer.invoke('instances:kill', id) as Promise<boolean>,
    running: () => ipcRenderer.invoke('instances:running') as Promise<string[]>,
    logTail: (id: string, lines = 300) => ipcRenderer.invoke('instances:logTail', id, lines) as Promise<string>,
    cancelJob: (id: string) => ipcRenderer.invoke('jobs:cancel', id) as Promise<boolean>,
    onProgress: (callback) => subscribe<ProgressEvent>('progress:event', callback),
    onLog: (callback) => subscribe<LogEvent>('log:event', callback),
    onGameExit: (callback) => subscribe<GameExitEvent>('game:exit', callback)
  },
  accounts: {
    addOffline: (username: string) => ipcRenderer.invoke('accounts:addOffline', username) as Promise<Account>,
    remove: (id: string) => ipcRenderer.invoke('accounts:remove', id) as Promise<boolean>,
    setActive: (id: string) => ipcRenderer.invoke('accounts:setActive', id) as Promise<boolean>,
    microsoftStart: () => ipcRenderer.invoke('accounts:microsoftStart') as Promise<MicrosoftDeviceCodeInfo>,
    microsoftWait: (flowId: string) => ipcRenderer.invoke('accounts:microsoftWait', flowId) as Promise<Account>,
    microsoftCancel: (flowId: string) => ipcRenderer.invoke('accounts:microsoftCancel', flowId) as Promise<boolean>
  },
  news: {
    list: () => ipcRenderer.invoke('news:list') as Promise<NewsItem[]>
  },
  modrinth: {
    search: (input) => ipcRenderer.invoke('modrinth:search', input) as Promise<ModrinthSearchResult>,
    project: (id: string) => ipcRenderer.invoke('modrinth:project', id) as Promise<ModrinthProject>,
    versions: (projectId: string, gameVersion: string, loader: string, kind: ContentKind) =>
      ipcRenderer.invoke('modrinth:versions', projectId, gameVersion, loader, kind) as Promise<
        ModrinthVersion[]
      >,
    install: (instanceId: string, projectId: string, kind: ContentKind, versionId?: string) =>
      ipcRenderer.invoke('modrinth:install', instanceId, projectId, kind, versionId) as Promise<InstallSummary>
  },
  content: {
    list: (instanceId: string, kind: ContentKind) =>
      ipcRenderer.invoke('content:list', instanceId, kind) as Promise<ContentEntry[]>,
    toggle: (instanceId: string, kind: ContentKind, fileName: string) =>
      ipcRenderer.invoke('content:toggle', instanceId, kind, fileName) as Promise<void>,
    delete: (instanceId: string, kind: ContentKind, fileName: string) =>
      ipcRenderer.invoke('content:delete', instanceId, kind, fileName) as Promise<void>,
    import: (instanceId: string, kind: ContentKind, paths: string[]) =>
      ipcRenderer.invoke('content:import', instanceId, kind, paths) as Promise<ContentImportResult>
  },
  worlds: {
    list: (instanceId: string) => ipcRenderer.invoke('worlds:list', instanceId) as Promise<WorldEntry[]>
  },
  dialog: {
    pickJava: () => ipcRenderer.invoke('dialog:pickJava') as Promise<string | null>,
    pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory') as Promise<string | null>,
    pickModpack: () => ipcRenderer.invoke('dialog:pickModpack') as Promise<string | null>
  },
  modpacks: {
    inspect: (path: string) =>
      ipcRenderer.invoke('modpacks:inspect', path) as Promise<PackInspectResult>,
    createFromPack: (path: string) =>
      ipcRenderer.invoke('modpacks:createFromPack', path) as Promise<Instance>,
    applyPack: (instanceId: string, path: string) =>
      ipcRenderer.invoke('modpacks:applyPack', instanceId, path) as Promise<void>,
    applyZip: (instanceId: string, path: string) =>
      ipcRenderer.invoke('modpacks:applyZip', instanceId, path) as Promise<void>
  },
  shell: {
    openPath: (target: string) => ipcRenderer.invoke('shell:openPath', target) as Promise<string>,
    showItem: (target: string) => ipcRenderer.invoke('shell:showItem', target) as Promise<void>,
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url) as Promise<void>,
    openInstanceFolder: (id: string) => ipcRenderer.invoke('shell:openInstanceFolder', id) as Promise<void>
  }
}

contextBridge.exposeInMainWorld('zeroparadox', api)
