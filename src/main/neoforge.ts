import AdmZip from 'adm-zip'
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

/**
 * NeoForge 的 Maven 仓库根。官方源在国内常被 DNS 污染，优先用 QLU 的 BMCLAPI 镜像；
 * 两者路径结构一致：<root>/net/neoforged/<neoforge|forge>/...
 */
const NEOFORGE_ROOTS = [
  'https://mirrors.qlu.edu.cn/bmclapi',
  'https://maven.neoforged.net/releases'
] as const

function isLegacyVersion(gameVersion: string): boolean {
  return gameVersion === '1.20.1'
}

/** 依次尝试各镜像源，返回第一个成功的响应。 */
async function fetchFirst(
  pathname: string,
  options: { signal?: AbortSignal; retries?: number; timeoutMs?: number }
): Promise<string> {
  const errors: string[] = []
  for (const root of NEOFORGE_ROOTS) {
    try {
      return await fetchText(`${root}${pathname}`, {
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? 30_000,
        retries: options.retries ?? 1
      })
    } catch (error) {
      errors.push(`${root}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`无法连接 NeoForge 仓库（${errors.join('；')}）`)
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
  const metadata = await fetchFirst(
    legacy ? '/net/neoforged/forge/maven-metadata.xml' : '/net/neoforged/neoforge/maven-metadata.xml',
    { signal, retries: 1 }
  )
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

/**
 * NeoForge 安装器内部写死了 maven.neoforged.net 的下载地址，国内访问不到。
 * 这里把安装器里 JSON 的地址改写到镜像，再执行安装。
 */
async function patchInstallerMirror(jarPath: string): Promise<string> {
  try {
    const zip = new AdmZip(jarPath)
    let changed = false
    for (const entry of zip.getEntries()) {
      if (!/\.json$/i.test(entry.entryName)) continue
      const text = entry.getData().toString('utf8')
      if (!text.includes('maven.neoforged.net/releases/')) continue
      const next = text.split('https://maven.neoforged.net/releases/').join('https://mirrors.qlu.edu.cn/bmclapi/')
      zip.updateFile(entry.entryName, Buffer.from(next, 'utf8'))
      changed = true
    }
    if (!changed) return jarPath
    const patched = jarPath.replace(/\.jar$/i, '-mirror.jar')
    zip.writeZip(patched)
    return patched
  } catch {
    return jarPath
  }
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
  const installerPath = path.join(getPaths().cache, 'neoforge', installerName)
  const expectedVersionId = `${gameVersion}-neoforge-${neoVersion}`
  const pathname = `/net/neoforged/${artifactId}/${artifactVersion}/${installerName}`

  progress(options.onProgress, 'NeoForge', `正在下载 NeoForge ${neoVersion} 安装器…`, 2)

  // 镜像不一定提供 .sha1 旁文件，所以直接试着下载，失败再换下一个源。
  let installerUrl = ''
  let lastError: unknown
  for (const root of NEOFORGE_ROOTS) {
    throwIfAborted(options.signal)
    const url = `${root}${pathname}`
    try {
      const sha1 = await fetchText(`${url}.sha1`, {
        signal: options.signal,
        retries: 0,
        timeoutMs: 15_000
      })
        .then((text) => (text.match(/[a-f0-9]{40}/i) || [])[0]?.toLowerCase())
        .catch(() => undefined)
      await downloadFile(url, installerPath, {
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
      installerUrl = url
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!installerUrl) {
    throw new Error(
      `下载 NeoForge ${neoVersion} 安装器失败：${lastError instanceof Error ? lastError.message : String(lastError)}`
    )
  }

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

  const installerToRun = await patchInstallerMirror(installerPath)
  let lineCount = 0
  let lastProgressAt = 0
  await runInstaller(java.path, installerToRun, dataDir, options.signal, (line) => {
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
