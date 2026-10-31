import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import type { ForgeLoader, Instance, Settings } from '../shared/types'
import { getPaths } from './paths'
import {
  CancelledError,
  downloadFile,
  fetchJson,
  fetchText,
  throwIfAborted
} from './http'
import { ensureJavaRuntime } from './java'
import { ensureVersionJson } from './mojang'
import { pathExists, writeJsonAtomic } from './util'
import { store } from './store'

const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'
const FORGE_METADATA = `${FORGE_MAVEN}/maven-metadata.xml`
const FORGE_PROMOTIONS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'

export interface ForgeProgressUpdate {
  phase: string
  message: string
  percent: number
  bytes?: number
  bytesTotal?: number
}

export interface ForgeInstallOptions {
  source: 'official' | 'bmclapi'
  signal?: AbortSignal
  onProgress?: (update: ForgeProgressUpdate) => void
  settings?: Settings
}

interface InstallProfile {
  version?: string
  install?: {
    filePath?: string
    path?: string
    version?: string
    minecraft?: string
  }
  versionInfo?: {
    id?: string
    inheritsFrom?: string
    mainClass?: string
    minecraftArguments?: string
    assets?: string
    type?: string
    time?: string
    releaseTime?: string
    minimumLauncherVersion?: number
    jar?: string
    libraries?: Array<{ name?: string; url?: string; checksums?: string[] }>
  }
}

interface PromotionsFile {
  promos: Record<string, string>
}

function progress(
  callback: ForgeInstallOptions['onProgress'],
  phase: string,
  message: string,
  percent: number,
  bytes?: number,
  bytesTotal?: number
): void {
  callback?.({ phase, message, percent, bytes, bytesTotal })
}

export async function getForgeLoaders(gameVersion: string, signal?: AbortSignal): Promise<ForgeLoader[]> {
  const version = gameVersion.trim()
  if (!version) throw new Error('请选择游戏版本')
  throwIfAborted(signal)

  const [promotions, metadata] = await Promise.allSettled([
    fetchJson<PromotionsFile>(FORGE_PROMOTIONS, { signal, retries: 1 }),
    fetchTextWithRetry(FORGE_METADATA, signal)
  ])

  const promo = promotions.status === 'fulfilled' ? promotions.value.promos || {} : {}
  const recommended = promo[`${version}-recommended`] || ''
  const latest = promo[`${version}-latest`] || ''
  const versions = new Set<string>()

  if (metadata.status === 'fulfilled') {
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matcher = new RegExp(`<version>${escaped}-([^<]+)</version>`, 'g')
    for (const match of metadata.value.matchAll(matcher)) {
      if (match[1]) versions.add(match[1].trim())
    }
  }
  if (recommended) versions.add(recommended)
  if (latest) versions.add(latest)

  if (versions.size === 0) {
    throw new Error(`Forge 还没有支持 Minecraft ${version} 的版本`)
  }

  return [...versions]
    .filter((item) => /^[0-9A-Za-z._-]+$/.test(item))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((item) => ({
      version: item,
      recommended: item === recommended,
      latest: item === latest
    }))
}

export async function ensureForgeInstalled(instance: Instance, options: ForgeInstallOptions): Promise<Instance> {
  if (instance.loader.type !== 'forge') return instance
  const jsonPath = path.join(getPaths().versions, instance.versionId, `${instance.versionId}.json`)
  if (await pathExists(jsonPath)) {
    if (await forgeArtifactsComplete(jsonPath)) return instance
  }

  const forgeVersion = instance.loader.version?.trim()
  if (!forgeVersion) throw new Error('Forge 版本信息缺失，请重新创建实例')

  const result = await installForge(instance.gameVersion, forgeVersion, options)
  if (result.versionId === instance.versionId) return instance
  return store.updateInstance(instance.id, { versionId: result.versionId })
}

async function forgeArtifactsComplete(jsonPath: string): Promise<boolean> {
  try {
    const data = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as {
      libraries?: Array<{ downloads?: { artifact?: { path?: string; url?: string } } }>
    }
    for (const library of data.libraries || []) {
      const artifact = library.downloads?.artifact
      if (artifact?.path && !artifact.url) {
        if (!(await pathExists(path.join(getPaths().libraries, artifact.path)))) return false
      }
    }
    return true
  } catch {
    return false
  }
}

export async function installForge(
  gameVersion: string,
  forgeVersion: string,
  options: ForgeInstallOptions
): Promise<{ versionId: string; javaPath: string }> {
  throwIfAborted(options.signal)
  // 1.7.10 这类老版本的构件目录会把 MC 版本重复一遍：
  // 1.7.10-10.13.4.1614 → 1.7.10-10.13.4.1614-1.7.10，两种拼法都试一遍。
  const candidates = forgeVersion.startsWith(`${gameVersion}-`)
    ? [forgeVersion]
    : [`${gameVersion}-${forgeVersion}`, `${gameVersion}-${forgeVersion}-${gameVersion}`]

  let installerName = ''
  let installerUrl = ''
  let sha1: string | undefined
  for (const candidate of candidates) {
    throwIfAborted(options.signal)
    const name = `forge-${candidate}-installer.jar`
    const url = `${FORGE_MAVEN}/${candidate}/${name}`
    try {
      const text = await fetchText(`${url}.sha1`, { signal: options.signal, retries: 0 })
      installerName = name
      installerUrl = url
      sha1 = (text.match(/[a-f0-9]{40}/i) || [])[0]?.toLowerCase()
      break
    } catch {
      // 换下一种拼法继续找。
    }
  }
  if (!installerUrl) {
    throw new Error(`找不到 Forge ${gameVersion}-${forgeVersion} 的安装器（可能该版本未发布）`)
  }

  const installerPath = path.join(getPaths().cache, 'forge', installerName)
  const expectedVersionId = `${gameVersion}-forge-${forgeVersion}`

  progress(options.onProgress, 'Forge', `正在下载 Forge ${forgeVersion} 安装器…`, 2)

  await downloadFile(installerUrl, installerPath, {
    sha1,
    signal: options.signal,
    timeoutMs: 10 * 60_000,
    onProgress: (received, total) => {
      progress(
        options.onProgress,
        'Forge',
        `正在下载 Forge 安装器 ${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`,
        2 + 18 * (received / Math.max(1, total)),
        received,
        total
      )
    }
  })

  const profile = await readInstallProfile(installerPath)
  const vanilla = await ensureVersionJson(gameVersion, options.source, options.signal)
  const javaMajor = vanilla.javaVersion?.majorVersion || 8
  const javaComponent = vanilla.javaVersion?.component || 'jre-legacy'
  const settings = options.settings || store.getSettings()
  const java = await ensureJavaRuntime(
    javaMajor,
    javaComponent,
    settings,
    options.signal,
    (runtime) => {
      progress(
        options.onProgress,
        'Forge',
        `准备 Java ${runtime.label}…`,
        22 + 12 * (runtime.bytesTotal > 0 ? runtime.bytesDone / runtime.bytesTotal : 0),
        runtime.bytesDone,
        runtime.bytesTotal
      )
    },
    { exact: true }
  )

  const dataDir = getPaths().dataDir
  await ensureLauncherProfiles(dataDir)

  const useClientFlag = await installerSupportsInstallClient(java.path, installerPath)
  let versionId: string
  if (useClientFlag) {
    progress(options.onProgress, 'Forge', '正在运行 Forge 安装器，首次安装需要下载依赖…', 35)
    let lineCount = 0
    let lastProgressAt = 0
    await runInstaller(java.path, installerPath, dataDir, options.signal, (line) => {
      lineCount += 1
      if (/^Patching /i.test(line)) return
      const now = Date.now()
      if (now - lastProgressAt < 280) return
      lastProgressAt = now
      progress(
        options.onProgress,
        'Forge',
        line.slice(0, 140),
        Math.min(92, 35 + lineCount * 0.15)
      )
    })
    versionId = profile.version || profile.versionInfo?.id || expectedVersionId
  } else {
    progress(options.onProgress, 'Forge', '老版 Forge 安装器只支持图形界面，改为按清单直接安装…', 40)
    versionId = await synthesizeLegacyForgeVersion(profile, expectedVersionId)
  }
  let installedJson = path.join(getPaths().versions, versionId, `${versionId}.json`)
  if (!(await pathExists(installedJson))) {
    const detected = await detectInstalledVersionId(gameVersion)
    if (detected) {
      versionId = detected
      installedJson = path.join(getPaths().versions, versionId, `${versionId}.json`)
    }
  }
  if (!(await pathExists(installedJson))) {
    throw new Error('Forge 安装完成，但没有找到生成的版本文件')
  }

  progress(options.onProgress, 'Forge', 'Forge 安装完成', 96)
  return { versionId, javaPath: java.path }
}

export async function readInstallProfile(installerPath: string): Promise<InstallProfile> {
  try {
    const zip = new AdmZip(installerPath)
    const entry = zip.getEntry('install_profile.json')
    if (!entry) return {}
    return JSON.parse(entry.getData().toString('utf8')) as InstallProfile
  } catch {
    return {}
  }
}

export async function detectInstalledVersionId(gameVersion: string): Promise<string | null> {
  const versionsDir = getPaths().versions
  let entries: string[] = []
  try {
    entries = await fs.readdir(versionsDir)
  } catch {
    return null
  }
  const matches: Array<{ id: string; mtime: number }> = []
  for (const id of entries) {
    const file = path.join(versionsDir, id, `${id}.json`)
    if (!(await pathExists(file))) continue
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8')) as { inheritsFrom?: string; id?: string }
      if (data.inheritsFrom === gameVersion && /forge/i.test(data.id || id)) {
        const stat = await fs.stat(file)
        matches.push({ id, mtime: stat.mtimeMs })
      }
    } catch {
      // Ignore malformed version files and keep looking.
    }
  }
  matches.sort((a, b) => b.mtime - a.mtime)
  return matches[0]?.id || null
}

export async function ensureLauncherProfiles(dataDir: string): Promise<void> {
  const file = path.join(dataDir, 'launcher_profiles.json')
  if (await pathExists(file)) return
  await writeJsonAtomic(file, { profiles: {}, settings: {}, version: 3 })
}

/**
 * 1.7.10 那批老安装器（SimpleInstaller）没有 --installClient 选项：
 * 不传参数就是装客户端，只认 --extract / --installServer / --offline。
 * 这里跑一次 --help 探明支持的选项，避免给老安装器传它不认识的参数。
 */
async function installerSupportsInstallClient(
  javaPath: string,
  installerPath: string
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let output = ''
    let settled = false
    const done = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const child = spawn(javaPath, ['-jar', installerPath, '--help'], {
        windowsHide: true,
        env: { ...process.env }
      })
      const timer = setTimeout(() => {
        child.kill()
        done(true)
      }, 60_000)
      const collect = (chunk: Buffer): void => {
        if (output.length < 20_000) output += chunk.toString('utf8')
      }
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)
      child.on('error', () => {
        clearTimeout(timer)
        done(true)
      })
      child.on('exit', () => {
        clearTimeout(timer)
        done(/installClient/i.test(output))
      })
    } catch {
      done(true)
    }
  })
}


/** Forge 官方 maven 走 BMCLAPI 镜像（会 302 到 USTC 镜像，实测可用）。 */
const FORGE_MAVEN_MIRROR = 'https://bmclapi2.bangbang93.com/maven/'

/** 把 "group:artifact:version[:classifier]" 解析成 maven 相对路径与镜像地址。 */
function mavenArtifact(name: string | undefined): { path: string; url: string } | null {
  const parts = String(name || '').split(':')
  if (parts.length < 3) return null
  const [group, artifact, version, classifier] = parts
  if (!group || !artifact || !version) return null
  const dir = group.replace(/\./g, '/')
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`
  const relative = `${dir}/${artifact}/${version}/${file}`
  return { path: relative, url: `${FORGE_MAVEN_MIRROR}${relative}` }
}

/**
 * 1.7.10 那批老安装器（SimpleInstaller）只有图形界面：不认 --installClient，
 * 无参数启动会弹 Swing 窗口等人点按钮，没法无头安装。
 * 这里直接读 jar 内的 install_profile.json，用 versionInfo 生成版本描述，
 * 依赖统一指向 BMCLAPI 镜像，再交给常规下载流程补齐。
 */
async function synthesizeLegacyForgeVersion(
  profile: InstallProfile,
  fallbackId: string
): Promise<string> {
  const info = profile.versionInfo
  if (!info?.libraries?.length) {
    throw new Error('这个 Forge 安装器既没有 --installClient 选项，也没有可用的安装清单')
  }
  const universal = profile.install?.filePath || ''
  const classifier = /-universal\.jar$/i.test(universal) ? 'universal' : undefined

  const libraries = info.libraries.map((library) => {
    const name = String(library.name || '')
    const isForge = name.startsWith('net.minecraftforge:forge:')
    const resolved = mavenArtifact(isForge && classifier ? `${name}:${classifier}` : name)
    return {
      name,
      downloads: {
        artifact: {
          path: resolved?.path,
          url: resolved?.url,
          sha1: library.checksums?.[0]
        }
      }
    }
  })

  const versionId = info.id || fallbackId
  const payload = {
    id: versionId,
    inheritsFrom: info.inheritsFrom,
    mainClass: info.mainClass,
    minecraftArguments: info.minecraftArguments,
    assets: info.assets,
    type: info.type || 'release',
    time: info.time,
    releaseTime: info.releaseTime,
    minimumLauncherVersion: info.minimumLauncherVersion,
    jar: info.jar,
    libraries
  }

  const targetDir = path.join(getPaths().versions, versionId)
  await fs.mkdir(targetDir, { recursive: true })
  await fs.writeFile(
    path.join(targetDir, `${versionId}.json`),
    JSON.stringify(payload, null, 2),
    'utf8'
  )
  return versionId
}

export async function runInstaller(
  javaPath: string,
  installerPath: string,
  dataDir: string,
  signal: AbortSignal | undefined,
  onLine: (line: string) => void
): Promise<void> {
  throwIfAborted(signal)
  // --help 探测要在 Promise executor 之外做，executor 不能是 async。
  const useClientFlag = await installerSupportsInstallClient(javaPath, installerPath)
  const installerArgs = useClientFlag
    ? ['-jar', installerPath, '--installClient', dataDir]
    : ['-jar', installerPath]
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let lastLines: string[] = []
    let stdoutBuffer = ''
    let stderrBuffer = ''
    const child = spawn(javaPath, installerArgs, {
      cwd: dataDir,
      windowsHide: true,
      env: { ...process.env }
    })

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = (): void => {
      child.kill()
      finish(new CancelledError())
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('安装器超时，请检查网络后重试'))
    }, 20 * 60_000)

    signal?.addEventListener('abort', abort, { once: true })

    const handleOutput = (chunk: string, stream: 'stdout' | 'stderr'): void => {
      if (stream === 'stdout') stdoutBuffer += chunk
      else stderrBuffer += chunk
      const pieces = (stream === 'stdout' ? stdoutBuffer : stderrBuffer).split(/\r?\n/)
      const remaining = pieces.pop() || ''
      if (stream === 'stdout') stdoutBuffer = remaining
      else stderrBuffer = remaining
      for (const raw of pieces) {
        const line = raw.replace(/\u001b\[[0-9;]*m/g, '').trim()
        if (!line) continue
        lastLines.push(line)
        if (lastLines.length > 30) lastLines = lastLines.slice(-30)
        onLine(line)
      }
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => handleOutput(chunk, 'stdout'))
    child.stderr?.on('data', (chunk: string) => handleOutput(chunk, 'stderr'))
    child.on('error', (error) => finish(new Error(`无法启动 Forge 安装器：${error.message}`)))
    child.on('exit', (code) => {
      if (code === 0) {
        finish()
        return
      }
      const detail = lastLines.slice(-6).join(' · ')
      finish(new Error(`Forge 安装器退出码 ${code ?? '未知'}${detail ? `：${detail}` : ''}`))
    })
  })
}

async function fetchTextWithRetry(url: string, signal?: AbortSignal, retries = 2): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    throwIfAborted(signal)
    try {
      return await fetchText(url, { signal, timeoutMs: 30_000 })
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw new CancelledError()
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
