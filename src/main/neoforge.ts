import { promises as fs } from 'fs'
import path from 'path'
import type { ForgeLoader, Instance, Settings } from '../shared/types'
import { getPaths } from './paths'
import { downloadFile, fetchText, throwIfAborted } from './http'
import { ensureJavaRuntime } from './java'
import { ensureVersionJson } from './mojang'
import { pathExists } from './util'
import { store } from './store'
import {
  detectInstalledVersionId,
  ensureLauncherProfiles,
  readInstallProfile,
  runInstaller,
  type ForgeInstallOptions,
  type ForgeProgressUpdate
} from './forge'

/** NeoForge 的 Maven 仓库。1.20.1 走旧的 net.neoforged:forge，1.20.2+ 是 net.neoforged:neoforge。 */
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases'
const NEOFORGE_METADATA = `${NEOFORGE_MAVEN}/net/neoforged/neoforge/maven-metadata.xml`
const LEGACY_METADATA = `${NEOFORGE_MAVEN}/net/neoforged/forge/maven-metadata.xml`

function isLegacyVersion(gameVersion: string): boolean {
  return gameVersion === '1.20.1'
}

function progress(
  callback: ForgeInstallOptions['onProgress'],
  phase: string,
  message: string,
  percent: number,
  bytes?: number,
  bytesTotal?: number
): void {
  const update: ForgeProgressUpdate = { phase, message, percent, bytes, bytesTotal }
  callback?.(update)
}

/** 列出某个 Minecraft 版本可用的 NeoForge 版本。 */
export async function getNeoForgeLoaders(
  gameVersion: string,
  signal?: AbortSignal
): Promise<ForgeLoader[]> {
  const version = gameVersion.trim()
  if (!version) throw new Error('请选择游戏版本')
  throwIfAborted(signal)

  const legacy = isLegacyVersion(version)
  let metadata: string
  try {
    metadata = await fetchText(legacy ? LEGACY_METADATA : NEOFORGE_METADATA, {
      signal,
      timeoutMs: 30_000,
      retries: 2
    })
  } catch (error) {
    throw new Error(
      `无法连接 NeoForge 仓库（maven.neoforged.net）：${error instanceof Error ? error.message : String(error)}。请检查网络，必要时使用代理。`
    )
  }
  const all = [...metadata.matchAll(/<version>([^<]+)<\/version>/g)].map((match) => match[1].trim())

  let list: string[]
  if (legacy) {
    list = all.filter((item) => item.startsWith('1.20.1-')).map((item) => item.slice('1.20.1-'.length))
  } else {
    const [, minor = '', patch = ''] = version.split('.')
    const prefix = `${Number(minor)}.${Number(patch)}.`
    list = all.filter((item) => item.startsWith(prefix))
  }
  if (list.length === 0) {
    throw new Error(`NeoForge 还没有支持 Minecraft ${version} 的版本`)
  }
  return list
    .filter((item) => /^[0-9A-Za-z._-]+$/.test(item))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((item, index) => ({ version: item, recommended: index === 0, latest: index === 0 }))
}

export async function ensureNeoForgeInstalled(
  instance: Instance,
  options: ForgeInstallOptions
): Promise<Instance> {
  if (instance.loader.type !== 'neoforge') return instance
  const jsonPath = path.join(getPaths().versions, instance.versionId, `${instance.versionId}.json`)
  if (await pathExists(jsonPath)) return instance

  const neoVersion = instance.loader.version?.trim()
  if (!neoVersion) throw new Error('NeoForge 版本信息缺失，请重新创建实例')

  const result = await installNeoForge(instance.gameVersion, neoVersion, options)
  if (result.versionId === instance.versionId) return instance
  return store.updateInstance(instance.id, { versionId: result.versionId })
}

export async function installNeoForge(
  gameVersion: string,
  neoVersion: string,
  options: ForgeInstallOptions
): Promise<{ versionId: string; javaPath: string }> {
  throwIfAborted(options.signal)
  const legacy = isLegacyVersion(gameVersion)
  const artifactVersion = legacy ? `${gameVersion}-${neoVersion}` : neoVersion
  const artifactId = legacy ? 'forge' : 'neoforge'
  const installerName = `${artifactId}-${artifactVersion}-installer.jar`
  const installerUrl = `${NEOFORGE_MAVEN}/net/neoforged/${artifactId}/${artifactVersion}/${installerName}`
  const installerPath = path.join(getPaths().cache, 'neoforge', installerName)
  const expectedVersionId = `${gameVersion}-neoforge-${neoVersion}`

  progress(options.onProgress, 'NeoForge', `正在下载 NeoForge ${neoVersion} 安装器…`, 2)
  const sha1 = await fetchText(`${installerUrl}.sha1`, { signal: options.signal, retries: 1 })
    .then((text) => (text.match(/[a-f0-9]{40}/i) || [])[0]?.toLowerCase())
    .catch(() => undefined)

  await downloadFile(installerUrl, installerPath, {
    sha1,
    signal: options.signal,
    timeoutMs: 10 * 60_000,
    onProgress: (received, total) => {
      progress(
        options.onProgress,
        'NeoForge',
        `正在下载 NeoForge 安装器 ${(received / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`,
        2 + 18 * (received / Math.max(1, total)),
        received,
        total
      )
    }
  })

  const profile = await readInstallProfile(installerPath)
  const vanilla = await ensureVersionJson(gameVersion, options.source, options.signal)
  const javaMajor = vanilla.javaVersion?.majorVersion || 21
  const javaComponent = vanilla.javaVersion?.component || 'java-runtime-delta'
  const settings = options.settings || store.getSettings()
  const java = await ensureJavaRuntime(
    javaMajor,
    javaComponent,
    settings,
    options.signal,
    (runtime) => {
      progress(
        options.onProgress,
        'NeoForge',
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
  progress(options.onProgress, 'NeoForge', '正在运行 NeoForge 安装器，首次安装需要下载依赖…', 35)

  let lineCount = 0
  let lastProgressAt = 0
  await runInstaller(java.path, installerPath, dataDir, options.signal, (line) => {
    lineCount += 1
    if (/^Patching /i.test(line)) return
    const now = Date.now()
    if (now - lastProgressAt < 280) return
    lastProgressAt = now
    progress(options.onProgress, 'NeoForge', line.slice(0, 140), Math.min(92, 35 + lineCount * 0.15))
  })

  let versionId = profile.version || profile.versionInfo?.id || expectedVersionId
  let installedJson = path.join(getPaths().versions, versionId, `${versionId}.json`)
  if (!(await pathExists(installedJson))) {
    const detected = await detectInstalledVersionId(gameVersion)
    if (detected) {
      versionId = detected
      installedJson = path.join(getPaths().versions, versionId, `${versionId}.json`)
    }
  }
  if (!(await pathExists(installedJson))) {
    throw new Error('NeoForge 安装完成，但没有找到生成的版本文件')
  }

  progress(options.onProgress, 'NeoForge', 'NeoForge 安装完成', 96)
  return { versionId, javaPath: java.path }
}

export type { Settings }
