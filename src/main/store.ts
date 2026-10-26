import { promises as fs } from 'fs'
import path from 'path'
import type {
  Account,
  AccountRecord,
  Instance,
  PublicState,
  Settings
} from '../shared/types'
import { BUILT_IN_MICROSOFT_CLIENT_ID } from '../shared/azure'
import { BUILT_IN_CURSEFORGE_API_KEY } from '../shared/curseforge'
import { resolveAvatarUrl } from '../shared/avatar'
import { getPaths, gameDir, instanceDir, setCustomGameDirResolver } from './paths'
import { ensureDir, newId, readJson, safeName, writeJsonAtomic } from './util'

interface PersistedState {
  version: number
  settings: Settings
  accounts: AccountRecord[]
  activeAccountId: string | null
  instances: Instance[]
}

export const defaultSettings: Settings = {
  language: 'zh-CN',
  theme: 'dark',
  accent: '#ff4d4f',
  memoryMb: 4096,
  autoMemory: true,
  javaPath: '',
  downloadSource: 'official',
  downloadConcurrency: 8,
  showSnapshots: false,
  keepLauncherOpen: true,
  minimizeOnLaunch: false,
  checkUpdates: true,
  closeAfterGameExit: false,
  microsoftClientId: BUILT_IN_MICROSOFT_CLIENT_ID,
  curseforgeApiKey: BUILT_IN_CURSEFORGE_API_KEY,
  extraJavaPaths: []
}

const palette = ['#ff4d4f', '#e5484d', '#b42318', '#ff7a7a', '#d92d20', '#ff2e63', '#f43f5e']
const icons = ['◆', '▲', '✦', '⬢', '✕', '◈', '☾', '⚑', '◇', '▣']

function initialState(): PersistedState {
  return {
    version: 1,
    settings: { ...defaultSettings },
    accounts: [],
    activeAccountId: null,
    instances: []
  }
}

function normalizeInstance(raw: Partial<Instance>): Instance {
  const id = raw.id || newId('inst_')
  const now = new Date().toISOString()
  return {
    id,
    name: raw.name?.trim() || '未命名实例',
    gameVersion: raw.gameVersion || '26.3',
    versionId: raw.versionId || raw.gameVersion || '26.3',
    loader: raw.loader || { type: 'vanilla' },
    icon: raw.icon || icons[Math.floor(Math.random() * icons.length)],
    color: raw.color || palette[Math.floor(Math.random() * palette.length)],
    notes: raw.notes || '',
    createdAt: raw.createdAt || now,
    lastPlayedAt: raw.lastPlayedAt || null,
    installedAt: raw.installedAt || null,
    playtimeMs: Number(raw.playtimeMs) || 0,
    memoryMb: typeof raw.memoryMb === 'number' ? raw.memoryMb : null,
    javaPath: raw.javaPath || null,
    gameDir: raw.gameDir?.trim() || null,
    jvmArgs: raw.jvmArgs || '',
    gameArgs: raw.gameArgs || '',
    resolution: {
      width: raw.resolution?.width || 1280,
      height: raw.resolution?.height || 720,
      custom: Boolean(raw.resolution?.custom),
      fullscreen: Boolean(raw.resolution?.fullscreen)
    }
  }
}

export class LauncherStore {
  private state: PersistedState = initialState()
  private loaded = false
  private saveChain: Promise<void> = Promise.resolve()

  async load(): Promise<void> {
    if (this.loaded) return
    const paths = getPaths()
    await ensureDir(paths.dataDir)
    await ensureDir(paths.instances)
    const raw = await readJson<Partial<PersistedState>>(paths.stateFile, {})
    const merged = initialState()
    if (raw.settings) merged.settings = { ...defaultSettings, ...raw.settings }
    // 旧版本默认值为空字符串，迁移到内置的已审批 appID。
    if (!merged.settings.microsoftClientId.trim()) {
      merged.settings.microsoftClientId = BUILT_IN_MICROSOFT_CLIENT_ID
    }
    if (!merged.settings.curseforgeApiKey?.trim()) {
      merged.settings.curseforgeApiKey = BUILT_IN_CURSEFORGE_API_KEY
    }
    if (Array.isArray(raw.accounts)) merged.accounts = raw.accounts.filter((a) => a && a.id)
    // 早期版本用 mc-heads.net，该域名在部分网络下返回 403，迁移到可用的头像服务。
    for (const account of merged.accounts) {
      if (account.avatarUrl) {
        account.avatarUrl = resolveAvatarUrl(account.avatarUrl, account.uuid)
      }
    }
    if (raw.activeAccountId) merged.activeAccountId = raw.activeAccountId
    if (Array.isArray(raw.instances)) merged.instances = raw.instances.map(normalizeInstance)
    this.state = merged
    if (merged.activeAccountId && !merged.accounts.some((a) => a.id === merged.activeAccountId)) {
      this.state.activeAccountId = merged.accounts[0]?.id || null
    }
    this.loaded = true
    await this.persist()
  }

  private persist(): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify(this.state)) as PersistedState
    this.saveChain = this.saveChain.then(async () => {
      await writeJsonAtomic(getPaths().stateFile, snapshot)
    })
    return this.saveChain
  }

  getSettings(): Settings {
    return { ...this.state.settings }
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    this.state.settings = { ...this.state.settings, ...patch }
    await this.persist()
    return this.getSettings()
  }

  getInstances(): Instance[] {
    return [...this.state.instances]
  }

  getInstance(id: string): Instance | undefined {
    return this.state.instances.find((instance) => instance.id === id)
  }

  requireInstance(id: string): Instance {
    const instance = this.getInstance(id)
    if (!instance) throw new Error('实例不存在或已被删除')
    return instance
  }

  async createInstance(input: {
    name: string
    gameVersion: string
    versionId: string
    loader: Instance['loader']
    icon?: string
    color?: string
    memoryMb?: number | null
    notes?: string
    /** 指向已有游戏目录（添加现有实例时使用）；为空则用数据目录下的默认位置。 */
    gameDir?: string | null
  }): Promise<Instance> {
    const instance = normalizeInstance({
      id: newId('inst_'),
      name: safeName(input.name) || `${input.gameVersion} 实例`,
      gameVersion: input.gameVersion,
      versionId: input.versionId,
      loader: input.loader,
      icon: input.icon,
      color: input.color,
      memoryMb: input.memoryMb ?? null,
      notes: input.notes,
      gameDir: input.gameDir ?? null
    })
    await ensureDir(instanceDir(instance.id))
    await ensureDir(gameDir(instance.id))
    await ensureDir(path.join(gameDir(instance.id), 'mods'))
    await ensureDir(path.join(gameDir(instance.id), 'saves'))
    this.state.instances.unshift(instance)
    await this.persist()
    return instance
  }

  async updateInstance(id: string, patch: Partial<Instance>): Promise<Instance> {
    const index = this.state.instances.findIndex((instance) => instance.id === id)
    if (index < 0) throw new Error('实例不存在')
    const previous = this.state.instances[index]
    const next = normalizeInstance({ ...previous, ...patch, id: previous.id })
    this.state.instances[index] = next
    await this.persist()
    return next
  }

  async deleteInstance(id: string): Promise<void> {
    const index = this.state.instances.findIndex((instance) => instance.id === id)
    if (index < 0) throw new Error('实例不存在')
    this.state.instances.splice(index, 1)
    await this.persist()
    await fs.rm(instanceDir(id), { recursive: true, force: true }).catch(() => undefined)
  }

  async duplicateInstance(id: string): Promise<Instance> {
    const source = this.requireInstance(id)
    const copy = normalizeInstance({
      ...source,
      id: newId('inst_'),
      name: `${source.name} 副本`,
      createdAt: new Date().toISOString(),
      lastPlayedAt: null,
      playtimeMs: 0,
      gameDir: null
    })
    await ensureDir(instanceDir(copy.id))
    await fs.cp(gameDir(id), gameDir(copy.id), { recursive: true, errorOnExist: false }).catch(() => undefined)
    this.state.instances.unshift(copy)
    await this.persist()
    return copy
  }

  async markPlayed(id: string): Promise<void> {
    const instance = this.getInstance(id)
    if (!instance) return
    instance.lastPlayedAt = new Date().toISOString()
    await this.persist()
  }

  async addPlaytime(id: string, ms: number): Promise<void> {
    const instance = this.getInstance(id)
    if (!instance) return
    instance.playtimeMs += Math.max(0, Math.round(ms))
    instance.lastPlayedAt = new Date().toISOString()
    await this.persist()
  }

  getAccounts(): AccountRecord[] {
    return this.state.accounts.map((account) => ({ ...account }))
  }

  getAccount(id: string): AccountRecord | undefined {
    const account = this.state.accounts.find((item) => item.id === id)
    return account ? { ...account } : undefined
  }

  getActiveAccount(): AccountRecord | undefined {
    if (!this.state.activeAccountId) return undefined
    return this.getAccount(this.state.activeAccountId)
  }

  async addAccount(account: AccountRecord): Promise<Account> {
    this.state.accounts.push(account)
    this.state.activeAccountId = account.id
    await this.persist()
    return publicAccount(account)
  }

  async updateAccount(id: string, patch: Partial<AccountRecord>): Promise<AccountRecord> {
    const index = this.state.accounts.findIndex((item) => item.id === id)
    if (index < 0) throw new Error('账户不存在')
    this.state.accounts[index] = { ...this.state.accounts[index], ...patch, id }
    await this.persist()
    return { ...this.state.accounts[index] }
  }

  async removeAccount(id: string): Promise<void> {
    this.state.accounts = this.state.accounts.filter((account) => account.id !== id)
    if (this.state.activeAccountId === id) {
      this.state.activeAccountId = this.state.accounts[0]?.id || null
    }
    await this.persist()
  }

  async setActiveAccount(id: string): Promise<void> {
    if (!this.state.accounts.some((account) => account.id === id)) throw new Error('账户不存在')
    this.state.activeAccountId = id
    await this.persist()
  }

  publicState(
    appVersion: string,
    platform: string,
    isPackaged: boolean,
    totalMemoryMb = 0,
    logicalCpus = 0
  ): PublicState {
    return {
      settings: this.getSettings(),
      instances: this.getInstances(),
      accounts: this.state.accounts.map(publicAccount),
      activeAccountId: this.state.activeAccountId,
      appVersion,
      dataDir: getPaths().dataDir,
      platform,
      isPackaged,
      totalMemoryMb,
      logicalCpus
    }
  }
}

export function publicAccount(account: AccountRecord): Account {
  return {
    id: account.id,
    type: account.type,
    username: account.username,
    uuid: account.uuid,
    avatarUrl: account.avatarUrl,
    skinModel: account.skinModel
  }
}

export const store = new LauncherStore()

// 实例可以覆盖默认游戏目录，路径工具通过这个回调读取，避免 paths ↔ store 循环依赖。
setCustomGameDirResolver((instanceId) => store.getInstance(instanceId)?.gameDir ?? null)
