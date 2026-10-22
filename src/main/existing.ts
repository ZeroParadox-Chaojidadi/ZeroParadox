import { promises as fs } from 'fs'
import path from 'path'
import type { ExistingFolderInfo, Instance } from '../shared/types'
import { installFabricProfile, getVersionManifest } from './mojang'
import { getForgeLoaders } from './forge'
import { getNeoForgeLoaders } from './neoforge'
import { store } from './store'
import { safeName } from './util'

async function isDir(target: string): Promise<boolean> {
  const stat = await fs.stat(target).catch(() => null)
  return Boolean(stat?.isDirectory())
}

async function guessGameVersion(gameRoot: string): Promise<string | undefined> {
  const ids = (await fs.readdir(path.join(gameRoot, 'versions')).catch(() => []))
    .filter((name) => /^\d+\.\d+(\.\d+)?$/.test(name))
  if (ids.length === 0) return undefined
  const manifest = await getVersionManifest().catch(() => null)
  const order = new Map((manifest?.versions || []).map((item, index) => [item.id, index]))
  const known = ids.filter((id) => order.has(id))
  if (known.length > 0) {
    known.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    return known[0]
  }
  return ids[0]
}

interface PackMeta {
  gameVersion?: string
  loaderType?: 'vanilla' | 'fabric' | 'forge' | 'neoforge'
  loaderVersion?: string
  unsupported?: string
}

/** 读取 MultiMC/Prism 的 mmc-pack.json。 */
async function readMmcPack(folder: string): Promise<PackMeta | null> {
  const raw = await fs.readFile(path.join(folder, 'mmc-pack.json'), 'utf8').catch(() => null)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { components?: Array<{ uid?: string; version?: string }> }
    const components = parsed.components || []
    const game = components.find((item) => item.uid === 'net.minecraft')
    const fabric = components.find((item) => item.uid === 'net.fabricmc.fabric-loader')
    const forge = components.find((item) => item.uid === 'net.minecraftforge')
    const neoforge = components.find(
      (item) => item.uid === 'net.neoforged' || item.uid === 'net.neoforged.neoforge'
    )
    return {
      gameVersion: game?.version,
      loaderType: fabric ? 'fabric' : neoforge ? 'neoforge' : forge ? 'forge' : 'vanilla',
      loaderVersion: fabric?.version || neoforge?.version || forge?.version
    }
  } catch {
    return null
  }
}

/** 尝试从 instance.cfg 里取实例名称。 */async function readInstanceName(folder: string): Promise<string | undefined> {
  const raw = await fs.readFile(path.join(folder, 'instance.cfg'), 'utf8').catch(() => null)
  if (!raw) return undefined
  const match = raw.match(/^name=(.+)$/m)
  return match?.[1]?.trim() || undefined
}

/** 从 HMCL/PCL 的版本目录（<实例>.json）里读出 Minecraft 版本与加载器。 */
async function readVersionJson(folder: string): Promise<PackMeta | null> {
  // 有些整合包会在版本目录里带一份 modrinth.index.json，信息最完整。
  const modrinthRaw = await fs.readFile(path.join(folder, 'modrinth.index.json'), 'utf8').catch(() => null)
  if (modrinthRaw) {
    try {
      const index = JSON.parse(modrinthRaw) as { dependencies?: Record<string, string> }
      const deps = index.dependencies || {}
      if (deps.minecraft) {
        return {
          gameVersion: deps.minecraft,
          loaderType: deps['fabric-loader'] ? 'fabric' : deps.forge ? 'forge' : 'vanilla',
          loaderVersion: deps['fabric-loader'] || deps.forge
        }
      }
    } catch {
      // 继续尝试版本 JSON。
    }
  }

  const files = (await fs.readdir(folder).catch(() => [])).filter((name) => name.toLowerCase().endsWith('.json'))
  const preferred = `${path.basename(folder)}.json`
  files.sort((a, b) => Number(b === preferred) - Number(a === preferred))
  for (const file of files) {
    const raw = await fs.readFile(path.join(folder, file), 'utf8').catch(() => null)
    if (!raw) continue
    let json: {
      id?: string
      inheritsFrom?: string
      clientVersion?: string
      assetIndex?: { id?: string }
      libraries?: Array<{ name?: string }>
    }
    try {
      json = JSON.parse(raw)
    } catch {
      continue
    }
    if (!Array.isArray(json.libraries)) continue
    // HMCL/PCL 的 assetIndex.id 是资源索引编号（如 17、34），游戏版本在 clientVersion 里。
    const looksLikeVersion = (value?: string): boolean => /^\d+\.\d+(\.\d+)?$/.test(value || '')
    const gameVersion =
      json.inheritsFrom ||
      (looksLikeVersion(json.clientVersion) ? json.clientVersion : undefined) ||
      (looksLikeVersion(json.assetIndex?.id) ? json.assetIndex?.id : undefined) ||
      (looksLikeVersion(json.id) ? json.id : undefined)
    if (!gameVersion) continue
    let loaderType: 'vanilla' | 'fabric' | 'forge' | 'neoforge' = 'vanilla'
    let loaderVersion: string | undefined
    let neoForgeMarker = false
    for (const lib of json.libraries) {
      const libName = String(lib?.name || '')
      if (libName.startsWith('net.neoforged.fancymodloader:')) {
        neoForgeMarker = true
        continue
      }
      if (libName.startsWith('net.fabricmc:fabric-loader:')) {
        loaderType = 'fabric'
        loaderVersion = libName.split(':')[2]
        break
      }
      if (libName.startsWith('net.neoforged:neoforge:')) {
        loaderType = 'neoforge'
        loaderVersion = libName.split(':')[2]
        break
      }
      if (libName.startsWith('net.neoforged:forge:')) {
        loaderType = 'neoforge'
        const rawVersion = libName.split(':')[2] || ''
        loaderVersion = rawVersion.replace(/^\d+\.\d+(\.\d+)?-/, '')
        break
      }
      if (libName.startsWith('net.minecraftforge:forge:')) {
        loaderType = 'forge'
        loaderVersion = libName.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1]
        break
      }
    }
    if (neoForgeMarker && loaderType === 'vanilla') loaderType = 'neoforge'
    return { gameVersion, loaderType, loaderVersion }
  }
  return null
}

/** 识别一个已有实例目录：Prism/MultiMC 实例、.minecraft 目录，或直接是游戏目录。 */
export async function inspectExistingFolder(input: string): Promise<ExistingFolderInfo> {
  const dir = path.resolve(String(input || '').trim())
  if (!(await isDir(dir))) throw new Error('文件夹不存在')
  const parent = path.dirname(dir)
  const baseName = path.basename(dir) || '现有实例'

  // 选中的是 MultiMC/Prism 实例目录（里面含 .minecraft）
  if (await isDir(path.join(dir, '.minecraft'))) {
    const gameRoot = path.join(dir, '.minecraft')
    const meta = (await readMmcPack(dir)) || {}
    const name = (await readInstanceName(dir)) || baseName
    return {
      kind: 'prism',
      gameDir: gameRoot,
      name,
      gameVersion: meta.gameVersion || (await guessGameVersion(gameRoot)),
      loaderType: meta.loaderType,
      loaderVersion: meta.loaderVersion
    }
  }

  // 选中的是 .minecraft 本身或别的游戏目录
  const looksLikeGame =
    (await isDir(path.join(dir, 'versions'))) ||
    (await isDir(path.join(dir, 'mods'))) ||
    (await isDir(path.join(dir, 'saves'))) ||
    (await isDir(path.join(dir, 'config')))
  if (looksLikeGame) {
    // 优先级：本目录的 mmc-pack.json → 上一级的 mmc-pack.json → 本目录的版本 JSON（HMCL/PCL）。
    const meta =
      (await readMmcPack(dir)) || (await readMmcPack(parent)) || (await readVersionJson(dir)) || {}
    const name =
      baseName.toLowerCase() === '.minecraft' || baseName.toLowerCase() === 'minecraft'
        ? (await readInstanceName(parent)) || path.basename(parent) || baseName
        : (await readInstanceName(dir)) || baseName
    return {
      kind: 'minecraft',
      gameDir: dir,
      name,
      gameVersion: meta.gameVersion || (await guessGameVersion(dir)),
      loaderType: meta.loaderType,
      loaderVersion: meta.loaderVersion,
      unsupported: meta.unsupported
    }
  }

  return { kind: 'unknown', gameDir: dir, name: baseName }
}

/** 把已有目录挂成实例（不复制文件）。 */
export async function addExistingInstance(
  input: string,
  override?: {
    name?: string
    gameVersion?: string
    loaderType?: 'vanilla' | 'fabric' | 'forge'
    loaderVersion?: string
  }
): Promise<Instance> {
  const info = await inspectExistingFolder(input)
  if (info.unsupported) throw new Error(`暂不支持 ${info.unsupported} 实例`)
  const gameVersion = String(override?.gameVersion || info.gameVersion || '').trim()
  if (!gameVersion) throw new Error('无法识别游戏版本，请指定版本后再添加')
  const loaderType = override?.loaderType || info.loaderType || 'vanilla'
  const loaderVersion = override?.loaderVersion || info.loaderVersion

  let versionId = gameVersion
  let loader: Instance['loader'] = { type: 'vanilla' }
  if (loaderType === 'fabric') {
    const profile = await installFabricProfile(gameVersion, undefined, loaderVersion)
    versionId = profile.profileId
    loader = { type: 'fabric', version: profile.loaderVersion }
  } else if (loaderType === 'forge') {
    const available = await getForgeLoaders(gameVersion)
    const match =
      (loaderVersion &&
        (available.find((item) => item.version === loaderVersion) ||
          available.find((item) => item.version.startsWith(`${loaderVersion}-`)))) ||
      available[0]
    if (!match) throw new Error(`找不到适用于 Minecraft ${gameVersion} 的 Forge 版本`)
    versionId = `${gameVersion}-forge-${match.version}`
    loader = { type: 'forge', version: match.version }
  } else if (loaderType === 'neoforge') {
    const available = await getNeoForgeLoaders(gameVersion)
    const match =
      (loaderVersion &&
        (available.find((item) => item.version === loaderVersion) ||
          available.find((item) => item.version.startsWith(`${loaderVersion}-`)))) ||
      available[0]
    if (!match) throw new Error(`找不到适用于 Minecraft ${gameVersion} 的 NeoForge 版本`)
    versionId = `${gameVersion}-neoforge-${match.version}`
    loader = { type: 'neoforge', version: match.version }
  }

  return store.createInstance({
    name: safeName(override?.name || info.name) || '现有实例',
    gameVersion,
    versionId,
    loader,
    gameDir: info.gameDir,
    notes: `从现有目录添加：${info.gameDir}`
  })
}

/** 扫描一个目录，找出里面所有可添加的实例（多版本目录、实例根目录都支持）。 */
export async function scanExistingFolders(input: string): Promise<ExistingFolderInfo[]> {
  const dir = path.resolve(String(input || '').trim())
  if (!(await isDir(dir))) throw new Error('文件夹不存在')
  const results: ExistingFolderInfo[] = []

  // 1) versions/ 目录（HMCL/PCL 多版本）：每个子目录就是一个实例。
  const versionsDir =
    path.basename(dir).toLowerCase() === 'versions' ? dir : path.join(dir, 'versions')
  if (await isDir(versionsDir)) {
    for (const name of await fs.readdir(versionsDir).catch(() => [])) {
      const sub = path.join(versionsDir, name)
      if (!(await isDir(sub))) continue
      const info = await inspectExistingFolder(sub)
      if (info.gameVersion) results.push(info)
    }
    if (results.length > 0) return results
  }

  // 2) 实例根目录：子目录各自像实例（带 .minecraft 或 mods）。
  for (const name of await fs.readdir(dir).catch(() => [])) {
    const sub = path.join(dir, name)
    if (!(await isDir(sub))) continue
    if ((await isDir(path.join(sub, '.minecraft'))) || (await isDir(path.join(sub, 'mods')))) {
      const info = await inspectExistingFolder(sub)
      if (info.gameVersion) results.push(info)
    }
  }
  if (results.length > 0) return results

  // 3) 就是单个实例目录。
  return [await inspectExistingFolder(dir)]
}

export interface BatchAddResult {
  added: Instance[]
  failed: Array<{ dir: string; error: string }>
}

/** 批量添加，单个失败不影响其它。 */
export async function addExistingMany(dirs: string[]): Promise<BatchAddResult> {
  const added: Instance[] = []
  const failed: Array<{ dir: string; error: string }> = []
  for (const dir of dirs.slice(0, 50)) {
    try {
      added.push(await addExistingInstance(dir))
    } catch (error) {
      failed.push({ dir, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { added, failed }
}
