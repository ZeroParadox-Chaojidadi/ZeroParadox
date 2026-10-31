import AdmZip from 'adm-zip'
import { promises as fs } from 'fs'
import path from 'path'
import type { Instance, PackInspectResult } from '../shared/types'
import { concurrentMap, downloadFile, throwIfAborted } from './http'
import { getForgeLoaders } from './forge'
import { getNeoForgeLoaders } from './neoforge'
import { gameDir, instanceDir } from './paths'
import { installFabricProfile } from './mojang'
import { store } from './store'
import { ensureDir, safeName } from './util'

export interface ModpackFileEntry {
  path: string
  hashes?: Record<string, string>
  env?: { client?: string; server?: string }
  downloads: string[]
  fileSize?: number
}

export interface ModpackIndex {
  formatVersion: number
  name?: string
  versionId?: string
  summary?: string
  files: ModpackFileEntry[]
  dependencies: Record<string, string>
}

export interface ModpackLoadResult {
  zip: AdmZip
  index: ModpackIndex
}

export interface ModpackProgress {
  phase: string
  message: string
  current: number
  total: number
  percent: number
  bytes?: number
  bytesTotal?: number
}

export type ModpackReporter = (update: ModpackProgress) => void

const PACK_INDEX = 'modrinth.index.json'

/** 读取 .mrpack，取出清单；不是 Modrinth 整合包时给出明确错误。 */
export async function loadModpack(packPath: string): Promise<ModpackLoadResult> {
  const stat = await fs.stat(packPath).catch(() => null)
  if (!stat?.isFile()) throw new Error('整合包文件不存在')
  let zip: AdmZip
  try {
    zip = new AdmZip(packPath)
  } catch {
    throw new Error('无法读取整合包，文件可能已损坏')
  }
  const entry = zip.getEntry(PACK_INDEX)
  if (!entry) throw new Error('这不是 Modrinth 整合包：缺少 modrinth.index.json')
  let index: ModpackIndex
  try {
    index = JSON.parse(zip.readAsText(entry)) as ModpackIndex
  } catch {
    throw new Error('整合包清单无法解析')
  }
  if (!index?.dependencies?.minecraft) throw new Error('整合包缺少 Minecraft 版本信息')
  if (!Array.isArray(index.files)) index.files = []
  return { zip, index }
}

/** 根据清单里的版本与加载器创建实例。 */
export async function createInstanceFromPack(
  packPath: string,
  index: ModpackIndex
): Promise<Instance> {
  const gameVersion = index.dependencies.minecraft
  const fabricLoader = index.dependencies['fabric-loader']
  const forgeVersion = index.dependencies['forge']
  const neoVersion = index.dependencies['neoforge']
  if (fabricLoader) {
    return createInstanceFromMeta(packPath, {
      kind: 'mrpack',
      name: index.name,
      summary: index.summary,
      gameVersion,
      loaderType: 'fabric',
      loaderVersion: fabricLoader
    })
  }
  if (neoVersion) {
    return createInstanceFromMeta(packPath, {
      kind: 'mrpack',
      name: index.name,
      summary: index.summary,
      gameVersion,
      loaderType: 'neoforge',
      loaderVersion: neoVersion
    })
  }
  if (forgeVersion) {
    return createInstanceFromMeta(packPath, {
      kind: 'mrpack',
      name: index.name,
      summary: index.summary,
      gameVersion,
      loaderType: 'forge',
      loaderVersion: forgeVersion
    })
  }
  return createInstanceFromMeta(packPath, {
    kind: 'mrpack',
    name: index.name,
    summary: index.summary,
    gameVersion,
    loaderType: 'vanilla'
  })
}

/** 按识别结果创建实例（供 .mrpack 与 zip 共用）。 */
export async function createInstanceFromMeta(
  packPath: string,
  meta: PackInspectResult
): Promise<Instance> {
  const gameVersion = meta.gameVersion
  if (!gameVersion) throw new Error('整合包缺少 Minecraft 版本信息')
  let versionId = gameVersion
  let loader: Instance['loader'] = { type: 'vanilla' }

  if (meta.loaderType === 'fabric') {
    const profile = await installFabricProfile(gameVersion, undefined, meta.loaderVersion)
    versionId = profile.profileId
    loader = { type: 'fabric', version: profile.loaderVersion }
  } else if (meta.loaderType === 'forge') {
    const available = await getForgeLoaders(gameVersion)
    const match =
      (meta.loaderVersion &&
        (available.find((item) => item.version === meta.loaderVersion) ||
          available.find((item) => item.version.startsWith(`${meta.loaderVersion}-`)))) ||
      available[0]
    if (!match) throw new Error(`找不到适用于 Minecraft ${gameVersion} 的 Forge 版本`)
    versionId = `${gameVersion}-forge-${match.version}`
    loader = { type: 'forge', version: match.version }
  } else if (meta.loaderType === 'neoforge') {
    const available = await getNeoForgeLoaders(gameVersion)
    const match =
      (meta.loaderVersion &&
        (available.find((item) => item.version === meta.loaderVersion) ||
          available.find((item) => item.version.startsWith(`${meta.loaderVersion}-`)))) ||
      available[0]
    if (!match) throw new Error(`找不到适用于 Minecraft ${gameVersion} 的 NeoForge 版本`)
    versionId = `${gameVersion}-neoforge-${match.version}`
    loader = { type: 'neoforge', version: match.version }
  }

  const fallbackName = path.basename(packPath).replace(/\.(mrpack|zip)$/i, '')
  return store.createInstance({
    name: safeName(meta.name || fallbackName) || '整合包实例',
    gameVersion,
    versionId,
    loader,
    notes: meta.summary || `从整合包 ${path.basename(packPath)} 导入`
  })
}

/** 下载清单里的文件并把 overrides 铺进实例目录。 */
export async function applyModpackFiles(
  instance: Instance,
  zip: AdmZip,
  index: ModpackIndex,
  options: { signal?: AbortSignal; onProgress: ModpackReporter; concurrency?: number }
): Promise<void> {
  const root = gameDir(instance.id)
  const files = index.files.filter(
    (file) => file.env?.client !== 'unsupported' && Array.isArray(file.downloads) && file.downloads.length > 0
  )
  const totalBytes = files.reduce((sum, file) => sum + (file.fileSize || 0), 0)
  let done = 0
  let receivedBytes = 0

  await concurrentMap(files, Math.max(1, Math.min(options.concurrency || 6, 8)), async (file) => {
    throwIfAborted(options.signal)
    const relative = String(file.path || '').replace(/\\/g, '/')
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) {
      done += 1
      return
    }
    const destination = path.join(root, relative)
    await downloadFile(file.downloads[0], destination, {
      sha1: file.hashes?.sha1,
      size: file.fileSize,
      signal: options.signal
    })
    done += 1
    receivedBytes += file.fileSize || 0
    options.onProgress({
      phase: '下载整合包内容',
      message: path.basename(relative),
      current: done,
      total: files.length,
      percent: files.length > 0 ? Math.round((done / files.length) * 100) : 0,
      bytes: receivedBytes,
      bytesTotal: totalBytes
    })
  })

  const overrides = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && /^(overrides|client-overrides)\//.test(entry.entryName))
  let wrote = 0
  let lastEmit = 0
  const total = overrides.length
  const dirsReady = new Set<string>()
  for (const entry of overrides) {
    throwIfAborted(options.signal)
    const relative = entry.entryName.replace(/^(overrides|client-overrides)\//, '')
    if (!relative || relative.split('/').includes('..')) continue
    const destination = path.join(root, relative)
    const dir = path.dirname(destination)
    if (!dirsReady.has(dir)) {
      await ensureDir(dir)
      dirsReady.add(dir)
    }
    await fs.writeFile(destination, entry.getData())
    wrote += 1
    const now = Date.now()
    if (now - lastEmit >= 120 || wrote === total) {
      lastEmit = now
      options.onProgress({
        phase: '写入配置与覆盖文件',
        message: path.basename(relative),
        current: wrote,
        total,
        percent: total > 0 ? Math.round((wrote / total) * 100) : 0
      })
    }
    if (wrote % 32 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

function parseLoaderId(raw: string | undefined): {
  loaderType: 'vanilla' | 'fabric' | 'forge' | 'neoforge'
  loaderVersion?: string
} {
  const value = String(raw || '').trim()
  if (!value) return { loaderType: 'vanilla' }
  if (/^fabric[-_]/i.test(value)) return { loaderType: 'fabric', loaderVersion: value.replace(/^fabric[-_]/i, '') }
  if (/^neoforge[-_]/i.test(value)) return { loaderType: 'neoforge', loaderVersion: value.replace(/^neoforge[-_]/i, '') }
  if (/^(forge|net\.minecraftforge)[-_]/i.test(value)) {
    return { loaderType: 'forge', loaderVersion: value.replace(/^(forge|net\.minecraftforge)[-_]/i, '') }
  }
  return { loaderType: 'vanilla' }
}

/** 打开 zip 文件；损坏或不存在时给出明确错误。 */
export async function openPackZip(packPath: string): Promise<AdmZip> {
  const stat = await fs.stat(packPath).catch(() => null)
  if (!stat?.isFile()) throw new Error('整合包文件不存在')
  try {
    // 用异步读取再交给 AdmZip：AdmZip(path) 会同步读整个文件，
    // 几百 MB 的整合包（GTNH 这类）会把主进程卡住好几秒。
    const buffer = await fs.readFile(packPath)
    return new AdmZip(buffer)
  } catch {
    throw new Error('无法读取整合包，文件可能已损坏')
  }
}

/**
 * 很多整合包会整体放在一层同名目录里（如 “GT New Horizons 2.8.4/”）。
 * 返回该前缀（带结尾斜杠），没有则返回空串。
 */
function detectPackRoot(entryNames: string[]): string {
  const tops = new Set(entryNames.map((name) => name.split('/')[0]))
  if (tops.size !== 1) return ''
  const only = [...tops][0]
  if (!only || !entryNames.some((name) => name.startsWith(`${only}/`))) return ''
  return `${only}/`
}

/** 识别 zip 整合包的来源与版本信息，用于决定导入方式。 */
export async function inspectPack(packPath: string): Promise<PackInspectResult> {
  const zip = await openPackZip(packPath)
  const entryNames = zip.getEntries().map((entry) => entry.entryName.replace(/\\/g, '/'))
  const names = new Set(entryNames)
  const root = detectPackRoot(entryNames)
  const has = (file: string): boolean => names.has(`${root}${file}`)
  const read = (file: string): string => zip.readAsText(zip.getEntry(`${root}${file}`) as AdmZip.IZipEntry)
  const folderName = root.replace(/\/$/, '')

  if (has(PACK_INDEX)) {
    const index = JSON.parse(read(PACK_INDEX)) as ModpackIndex
    const loader = index.dependencies?.['fabric-loader']
      ? parseLoaderId(`fabric-${index.dependencies['fabric-loader']}`)
      : index.dependencies?.['neoforge']
        ? parseLoaderId(`neoforge-${index.dependencies['neoforge']}`)
        : index.dependencies?.['forge']
          ? parseLoaderId(`forge-${index.dependencies['forge']}`)
          : { loaderType: 'vanilla' as const }
    return {
      kind: 'mrpack',
      name: index.name,
      summary: index.summary,
      gameVersion: index.dependencies?.minecraft,
      loaderType: loader.loaderType,
      loaderVersion: loader.loaderVersion
    }
  }

  if (has('manifest.json')) {
    const manifest = JSON.parse(read('manifest.json')) as {
      name?: string
      version?: string
      files?: unknown[]
      minecraft?: { version?: string; modLoaders?: Array<{ id?: string }> }
    }
    const loader = parseLoaderId(manifest.minecraft?.modLoaders?.[0]?.id)
    return {
      kind: 'curseforge',
      name: manifest.name,
      summary: manifest.version,
      gameVersion: manifest.minecraft?.version,
      loaderType: loader.loaderType,
      loaderVersion: loader.loaderVersion,
      missingFiles: Array.isArray(manifest.files) ? manifest.files.length : 0
    }
  }

  if (has('mmc-pack.json')) {
    const pack = JSON.parse(read('mmc-pack.json')) as {
      components?: Array<{ uid?: string; version?: string }>
    }
    const components = pack.components || []
    const game = components.find((item) => item.uid === 'net.minecraft')
    const fabric = components.find((item) => item.uid === 'net.fabricmc.fabric-loader')
    const forge = components.find((item) => item.uid === 'net.minecraftforge')
    return {
      kind: 'prism',
      name: folderName || undefined,
      gameVersion: game?.version,
      loaderType: fabric ? 'fabric' : forge ? 'forge' : 'vanilla',
      loaderVersion: fabric?.version || forge?.version
    }
  }

  return {
    kind: 'generic',
    name: folderName || path.basename(packPath).replace(/\.(zip|mrpack)$/i, '')
  }
}

const PACK_META_FILES = new Set([
  'manifest.json',
  'modrinth.index.json',
  'mmc-pack.json',
  'instance.cfg',
  'pack.png',
  'modrinth.index.json.bak'
])

/** 把普通 zip / CurseForge / Prism 整合包的文件铺进已有实例。 */
export async function applyZipToInstance(
  instance: Instance,
  zip: AdmZip,
  options: { signal?: AbortSignal; onProgress: ModpackReporter }
): Promise<void> {
  const root = gameDir(instance.id)
  const allEntries = zip.getEntries()
  const packRoot = detectPackRoot(allEntries.map((entry) => entry.entryName.replace(/\\/g, '/')))

  // CurseForge 包只有 manifest（记录 projectID/fileID），把清单留在实例目录，
  // 之后配置了 API Key 就能按清单补下载模组。
  const manifestEntry = zip.getEntry(`${packRoot}manifest.json`)
  if (manifestEntry) {
    await ensureDir(instanceDir(instance.id))
    await fs.writeFile(
      path.join(instanceDir(instance.id), 'curseforge-manifest.json'),
      manifestEntry.getData()
    )
  }


  // 先算出目标相对路径：剥掉包根目录与 MultiMC/CurseForge 的容器目录。
  const planned: Array<{ entry: AdmZip.IZipEntry; relative: string }> = []
  for (const entry of allEntries) {
    if (entry.isDirectory) continue
    let relative = entry.entryName.replace(/\\/g, '/')
    if (packRoot && relative.startsWith(packRoot)) relative = relative.slice(packRoot.length)
    relative = relative.replace(/^(overrides|client-overrides|\.minecraft|minecraft)\//i, '')
    if (!relative || relative.split('/').includes('..')) continue
    if (PACK_META_FILES.has(relative) || PACK_META_FILES.has(relative.split('/').pop() || '')) continue
    planned.push({ entry, relative })
  }

  let done = 0
  let lastEmit = 0
  const total = planned.length
  // 目录只需要建一次：GTNH 这类包有上万个小文件，逐个 mkdir 是主要开销之一。
  const dirsReady = new Set<string>()
  const ensureParent = async (filePath: string): Promise<void> => {
    const dir = path.dirname(filePath)
    if (dirsReady.has(dir)) return
    await ensureDir(dir)
    dirsReady.add(dir)
  }
  // 大型整合包（GTNH 之类）动辄数万个小文件：逐条 emit 会把 IPC 灌爆，
  // 同步解压连续调用又会饿死主进程 event loop，界面看起来就是“卡死”。
  // 这里按时间节流上报，并定期让出事件循环，保证窗口与进度条始终有响应。
  const emit = (message: string, force = false): void => {
    const now = Date.now()
    if (!force && now - lastEmit < 120) return
    lastEmit = now
    options.onProgress({
      phase: '写入整合包文件',
      message,
      current: done,
      total,
      percent: total > 0 ? Math.round((done / total) * 100) : 0
    })
  }
  emit(`准备写入 ${total} 个文件`, true)
  for (const item of planned) {
    throwIfAborted(options.signal)
    const destination = path.join(root, item.relative)
    await ensureParent(destination)
    await fs.writeFile(destination, item.entry.getData())
    done += 1
    emit(path.basename(item.relative))
    // 每 32 个文件让出一次事件循环，取消按钮和窗口重绘才有机会执行。
    if (done % 32 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
  }
  emit('整合包文件写入完成', true)
}
