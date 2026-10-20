import AdmZip from 'adm-zip'
import { promises as fs } from 'fs'
import path from 'path'
import type { Instance } from '../shared/types'
import { getPaths, gameDir, instanceNativesDir } from './paths'
import { concurrentMap, downloadFile, mirrorUrl, throwIfAborted } from './http'
import type { ResolvedVersion } from './mojang'
import { resolveVersion } from './mojang'
import { ensureForgeInstalled } from './forge'
import { collectClasspath, nativeArtifact, rulesAllow } from './version'
import { ensureDir, pathExists, writeJsonAtomic } from './util'
import { store } from './store'

interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>
  virtual?: boolean
  map_to_resources?: boolean
}

export interface InstallProgressUpdate {
  kind: 'preparing' | 'version' | 'forge' | 'libraries' | 'natives' | 'assets' | 'done'
  phase: string
  message: string
  current: number
  total: number
  bytes?: number
  bytesTotal?: number
  percent: number
}

export type InstallReporter = (update: InstallProgressUpdate) => void

export interface InstallResult {
  resolved: ResolvedVersion
  loggingArgument?: string
  assetIndexId: string
}

interface DownloadUnit {
  url: string
  destination: string
  sha1?: string
  size?: number
}

export async function installInstance(
  instance: Instance,
  options: {
    source: 'official' | 'bmclapi'
    concurrency: number
    signal?: AbortSignal
    onProgress: InstallReporter
  }
): Promise<InstallResult> {
  const { signal, source, concurrency, onProgress } = options
  const paths = getPaths()
  const report = (update: InstallProgressUpdate): void => onProgress(update)
  throwIfAborted(signal)

  instance = await ensureForgeInstalled(instance, {
    source,
    signal,
    onProgress: (update) => {
      report({
        kind: 'forge',
        phase: update.phase,
        message: update.message,
        current: 0,
        total: 1,
        bytes: update.bytes,
        bytesTotal: update.bytesTotal,
        percent: update.percent
      })
    }
  })

  report({
    kind: 'preparing',
    phase: '准备安装',
    message: '正在读取版本信息…',
    current: 0,
    total: 1,
    percent: 1
  })

  const resolved = await resolveVersion(instance.versionId, source, signal)
  const versionName = resolved.id
  report({
    kind: 'version',
    phase: '游戏核心',
    message: `正在准备 Minecraft ${instance.gameVersion}…`,
    current: 0,
    total: 1,
    percent: 3
  })

  await ensureDir(path.join(paths.versions, resolved.baseVersionId))
  const clientJar = path.join(paths.versions, resolved.baseVersionId, `${resolved.baseVersionId}.jar`)
  const clientUrl = mirrorUrl(resolved.client.url, source)
  await downloadFile(clientUrl, clientJar, {
    sha1: resolved.client.sha1,
    size: resolved.client.size,
    signal,
    timeoutMs: 15 * 60_000,
    onProgress: (received, total) => {
      report({
        kind: 'version',
        phase: '游戏核心',
        message: `正在下载游戏核心 ${(received / 1024 / 1024).toFixed(0)} / ${(total / 1024 / 1024).toFixed(0)} MB`,
        current: received,
        total: total || resolved.client.size,
        bytes: received,
        bytesTotal: total || resolved.client.size,
        percent: 3 + 4 * (received / Math.max(1, total || resolved.client.size))
      })
    }
  })

  const classpathEntries = collectClasspath(paths.dataDir, resolved)
  const nativeDownloads: DownloadUnit[] = []
  for (const library of resolved.libraries) {
    if (!rulesAllow(library.rules, {})) continue
    const native = nativeArtifact(library)
    if (native) {
      nativeDownloads.push({
        url: mirrorUrl(native.url, source),
        destination: path.join(paths.libraries, native.path),
        sha1: native.sha1,
        size: native.size
      })
    }
  }
  const libraryUnits: DownloadUnit[] = classpathEntries
    .filter((entry) => entry.url)
    .map((entry) => ({
      url: mirrorUrl(entry.url, source),
      destination: entry.path,
      sha1: entry.sha1,
      size: entry.size
    }))
  const allLibraries = dedupeUnits([...libraryUnits, ...nativeDownloads])
  const libraryBytesTotal = allLibraries.reduce((sum, unit) => sum + (unit.size || 0), 0)
  let libraryDone = 0
  let libraryBytesDone = 0
  const libraryRunning = new Map<string, number>()
  const libraryPercent = (): number => {
    const fraction =
      libraryBytesTotal > 0
        ? (libraryBytesDone + sumValues(libraryRunning)) / libraryBytesTotal
        : libraryDone / Math.max(1, allLibraries.length)
    return 7 + 11 * Math.min(1, fraction)
  }
  const reportLibrary = (): void => {
    report({
      kind: 'libraries',
      phase: '依赖库',
      message:
        allLibraries.length === 0
          ? '无需下载依赖库'
          : `依赖库 ${Math.min(libraryDone, allLibraries.length)} / ${allLibraries.length}`,
      current: libraryDone,
      total: allLibraries.length,
      bytes: libraryBytesDone + sumValues(libraryRunning),
      bytesTotal: libraryBytesTotal,
      percent: libraryPercent()
    })
  }
  report({
    kind: 'libraries',
    phase: '依赖库',
    message: `正在检查 ${allLibraries.length} 个依赖库…`,
    current: 0,
    total: allLibraries.length,
    bytes: 0,
    bytesTotal: libraryBytesTotal,
    percent: 7
  })
  await concurrentMap(allLibraries, concurrency, async (unit) => {
    throwIfAborted(signal)
    const existing = await fileSize(unit.destination)
    if (existing !== null && unit.size && existing === unit.size) {
      libraryDone += 1
      libraryBytesDone += unit.size
      reportLibrary()
      return
    }
    await downloadFile(unit.url, unit.destination, {
      sha1: unit.sha1,
      size: unit.size,
      signal,
      timeoutMs: 10 * 60_000,
      onProgress: (received) => {
        libraryRunning.set(unit.destination, received)
        reportLibrary()
      }
    })
    libraryRunning.delete(unit.destination)
    libraryDone += 1
    libraryBytesDone += unit.size || (await fileSize(unit.destination)) || 0
    reportLibrary()
  })
  libraryRunning.clear()
  libraryBytesDone = Math.max(libraryBytesDone, 0)

  report({
    kind: 'natives',
    phase: '本地库',
    message: '正在解压本地库…',
    current: 0,
    total: nativeDownloads.length || 1,
    percent: 18
  })
  const nativesDir = instanceNativesDir(instance.id)
  await fs.rm(nativesDir, { recursive: true, force: true }).catch(() => undefined)
  await ensureDir(nativesDir)
  let nativeDone = 0
  for (const native of nativeDownloads) {
    throwIfAborted(signal)
    const jarPath = native.destination
    if (await pathExists(jarPath)) {
      await extractNatives(jarPath, nativesDir)
    }
    nativeDone += 1
    report({
      kind: 'natives',
      phase: '本地库',
      message: `已解压 ${nativeDone} / ${nativeDownloads.length} 个本地库`,
      current: nativeDone,
      total: nativeDownloads.length || 1,
      percent: 18 + 4 * (nativeDone / Math.max(1, nativeDownloads.length))
    })
  }
  await Promise.all([
    ensureDir(path.join(nativesDir, 'java')),
    ensureDir(path.join(nativesDir, 'jna')),
    ensureDir(path.join(nativesDir, 'lwjgl'))
  ])

  const assetIndex = resolved.versionJson.assetIndex
  let assetIndexId = resolved.versionJson.assets || 'legacy'
  let loggingArgument: string | undefined
  if (assetIndex) {
    assetIndexId = assetIndex.id
    const indexDir = path.join(paths.assets, 'indexes')
    const indexPath = path.join(indexDir, `${assetIndex.id}.json`)
    await ensureDir(indexDir)
    await downloadFile(mirrorUrl(assetIndex.url, source), indexPath, {
      sha1: assetIndex.sha1,
      size: assetIndex.size,
      signal,
      timeoutMs: 120_000
    })
    const index = await readAssetIndex(indexPath)
    const objects = Object.entries(index.objects)
    const objectDir = path.join(paths.assets, 'objects')
    const totalBytes = objects.reduce((sum, [, value]) => sum + value.size, 0)
    const runningAssets = new Map<string, number>()
    let completed = 0
    let bytesDone = 0
    const reportAssets = (): void => {
      const activeBytes = sumValues(runningAssets)
      const bytes = Math.min(totalBytes, bytesDone + activeBytes)
      const fraction = totalBytes > 0 ? bytes / totalBytes : completed / Math.max(1, objects.length)
      report({
        kind: 'assets',
        phase: '游戏资源',
        message: `游戏资源 ${completed} / ${objects.length}`,
        current: completed,
        total: objects.length,
        bytes,
        bytesTotal: totalBytes,
        percent: 23 + 70 * Math.min(1, fraction)
      })
    }
    report({
      kind: 'assets',
      phase: '游戏资源',
      message: `正在检查 ${objects.length} 个资源文件…`,
      current: 0,
      total: objects.length,
      bytes: 0,
      bytesTotal: totalBytes,
      percent: 23
    })
    await concurrentMap(objects, concurrency, async ([, object]) => {
      throwIfAborted(signal)
      const prefix = object.hash.slice(0, 2)
      const target = path.join(objectDir, prefix, object.hash)
      const existing = await fileSize(target)
      if (existing === object.size) {
        completed += 1
        bytesDone += object.size
        reportAssets()
        return
      }
      await downloadFile(mirrorUrl(`https://resources.download.minecraft.net/${prefix}/${object.hash}`, source), target, {
        sha1: object.hash,
        size: object.size,
        signal,
        timeoutMs: 10 * 60_000,
        onProgress: (received) => {
          runningAssets.set(object.hash, received)
          reportAssets()
        }
      })
      runningAssets.delete(object.hash)
      completed += 1
      bytesDone += object.size
      reportAssets()
    })
    reportAssets()

    if (index.virtual || index.map_to_resources) {
      const destinationRoot = index.map_to_resources
        ? path.join(gameDir(instance.id), 'resources')
        : path.join(paths.assets, 'virtual', assetIndex.id)
      await ensureDir(destinationRoot)
      for (const [name, object] of Object.entries(index.objects)) {
        const sourceFile = path.join(objectDir, object.hash.slice(0, 2), object.hash)
        const target = path.join(destinationRoot, ...name.split('/'))
        await ensureDir(path.dirname(target))
        await fs.copyFile(sourceFile, target).catch(() => undefined)
      }
    }
  } else {
    report({
      kind: 'assets',
      phase: '游戏资源',
      message: '该版本不需要资源索引',
      current: 1,
      total: 1,
      percent: 23
    })
  }

  const logging = resolved.versionJson.logging?.client
  if (logging) {
    const logDir = path.join(paths.assets, 'log_configs')
    const logPath = path.join(logDir, logging.file.id)
    await ensureDir(logDir)
    await downloadFile(mirrorUrl(logging.file.url, source), logPath, {
      sha1: logging.file.sha1,
      size: logging.file.size,
      signal,
      timeoutMs: 60_000
    })
    if (logging.argument.includes('${path}')) {
      loggingArgument = logging.argument.replace('${path}', logPath)
    } else {
      loggingArgument = `${logging.argument}${logPath}`
    }
  }

  await writeJsonAtomic(path.join(paths.versions, versionName, 'install.json'), {
    installedAt: new Date().toISOString(),
    versionId: versionName,
    baseVersionId: resolved.baseVersionId,
    assetIndexId,
    libraryCount: allLibraries.length,
    assetCount: resolved.versionJson.assetIndex ? 'indexed' : 0
  })
  await store.updateInstance(instance.id, { installedAt: new Date().toISOString() })
  report({
    kind: 'done',
    phase: '完成',
    message: '安装完成，可以开始游戏了',
    current: 1,
    total: 1,
    percent: 100
  })
  return { resolved, loggingArgument, assetIndexId }
}

function dedupeUnits(units: DownloadUnit[]): DownloadUnit[] {
  const map = new Map<string, DownloadUnit>()
  for (const unit of units) map.set(unit.destination.toLowerCase(), unit)
  return [...map.values()]
}

function sumValues(map: Map<string, number>): number {
  let total = 0
  for (const value of map.values()) total += value
  return total
}

async function readAssetIndex(file: string): Promise<AssetIndex> {
  const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as AssetIndex
  if (!parsed.objects || typeof parsed.objects !== 'object') throw new Error('资源索引格式无效')
  return parsed
}

async function fileSize(file: string): Promise<number | null> {
  try {
    const stat = await fs.stat(file)
    return stat.isFile() ? stat.size : null
  } catch {
    return null
  }
}

async function extractNatives(jarPath: string, nativesDir: string): Promise<void> {
  const zip = new AdmZip(jarPath)
  const entries = zip.getEntries()
  const copies: { data: Buffer; name: string }[] = []
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = entry.entryName.replace(/\\/g, '/')
    if (name.startsWith('META-INF/') || name === 'META-INF') continue
    if (name.includes('..')) continue
    const lower = name.toLowerCase()
    if (!/\.(dll|so|dylib|jnilib)$/.test(lower) && !lower.endsWith('.so.1')) continue
    const data = entry.getData()
    if (!data.length) continue
    copies.push({ data, name })
  }
  for (const copy of copies) {
    const baseName = path.basename(copy.name)
    for (const destination of [
      path.join(nativesDir, baseName),
      path.join(nativesDir, 'java', baseName),
      path.join(nativesDir, 'lwjgl', baseName)
    ]) {
      await ensureDir(path.dirname(destination))
      await fs.writeFile(destination, copy.data)
      if (process.platform !== 'win32') await fs.chmod(destination, 0o755).catch(() => undefined)
    }
  }
}
