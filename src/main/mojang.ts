import { promises as fs } from 'fs'
import path from 'path'
import type { FabricLoader, VersionManifestResult, VersionSummary } from '../shared/types'
import { getPaths } from './paths'
import { fetchJson } from './http'
import { ensureDir, pathExists, readJson, sha1File, writeJsonAtomic } from './util'

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const FABRIC_LOADERS_URL = 'https://meta.fabricmc.net/v2/versions/loader'
const FABRIC_PROFILE_URL = 'https://meta.fabricmc.net/v2/versions/loader'

export interface VersionJson {
  id: string
  type?: string
  mainClass?: string
  assets?: string
  assetIndex?: { id: string; sha1: string; size: number; url: string; totalSize?: number }
  downloads?: {
    client?: { sha1: string; size: number; url: string }
    server?: { sha1: string; size: number; url: string }
  }
  javaVersion?: { component: string; majorVersion: number }
  libraries?: LibraryJson[]
  arguments?: {
    game?: ArgumentEntry[]
    jvm?: ArgumentEntry[]
  }
  minecraftArguments?: string
  logging?: {
    client?: {
      argument: string
      file: { id: string; sha1: string; size: number; url: string }
      type: string
    }
  }
  inheritsFrom?: string
  releaseTime?: string
  time?: string
  complianceLevel?: number
}

export type ArgumentEntry =
  | string
  | {
      rules?: Rule[]
      value: string | string[]
    }

export interface Rule {
  action: 'allow' | 'deny'
  os?: {
    name?: string
    arch?: string
    version?: string
  }
  features?: Record<string, boolean>
}

export interface LibraryDownloads {
  artifact?: {
    path: string
    sha1: string
    size: number
    url: string
  }
  classifiers?: Record<
    string,
    {
      path: string
      sha1: string
      size: number
      url: string
    }
  >
}

export interface LibraryJson {
  name: string
  downloads?: LibraryDownloads
  url?: string
  rules?: Rule[]
  natives?: Record<string, string>
  extract?: { exclude?: string[] }
  sha1?: string
  size?: number
}

export interface ResolvedVersion {
  id: string
  versionJson: VersionJson
  baseVersionId: string
  client: { sha1: string; size: number; url: string }
  libraries: LibraryJson[]
  javaMajor: number
  javaComponent: string
  isLegacy: boolean
  releaseTime?: string
  type: string
}

let manifestCache: VersionManifestResult | null = null
let manifestCacheTime = 0

function manifestPath(): string {
  return path.join(getPaths().cache, 'version_manifest_v2.json')
}

export async function getVersionManifest(force = false): Promise<VersionManifestResult> {
  if (!force && manifestCache && Date.now() - manifestCacheTime < 5 * 60_000) return manifestCache
  if (!force) {
    const cached = await readJson<VersionManifestResult | null>(manifestPath(), null)
    if (cached?.versions?.length && cached.fetchedAt && Date.now() - cached.fetchedAt < 10 * 60_000) {
      manifestCache = cached
      manifestCacheTime = cached.fetchedAt
      return cached
    }
  }
  const sourceUrl = MANIFEST_URL
  let raw: {
    latest: { release: string; snapshot: string }
    versions: VersionSummary[]
  }
  try {
    raw = await fetchJson(sourceUrl, { retries: 2 })
  } catch (primaryError) {
    try {
      raw = await fetchJson('https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json', { retries: 2 })
    } catch {
      throw primaryError
    }
  }
  const manifest: VersionManifestResult = {
    latest: raw.latest,
    versions: raw.versions,
    fetchedAt: Date.now()
  }
  await ensureDir(path.dirname(manifestPath()))
  await writeJsonAtomic(manifestPath(), manifest)
  manifestCache = manifest
  manifestCacheTime = manifest.fetchedAt
  return manifest
}

export function findVersion(manifest: VersionManifestResult, id: string): VersionSummary {
  const version = manifest.versions.find((item) => item.id === id)
  if (!version) throw new Error(`找不到游戏版本 ${id}`)
  return version
}

export async function ensureVersionJson(
  id: string,
  source: 'official' | 'bmclapi',
  signal?: AbortSignal,
  force = false
): Promise<VersionJson> {
  const file = path.join(getPaths().versions, id, `${id}.json`)
  if (!force && (await pathExists(file))) {
    const local = await readJson<VersionJson | null>(file, null)
    if (local?.id) return local
  }
  const manifest = await getVersionManifest()
  const summary = findVersion(manifest, id)
  const url = source === 'bmclapi' ? summary.url.replace('piston-meta.mojang.com', 'bmclapi2.bangbang93.com') : summary.url
  const data = await fetchJson<VersionJson>(url, { signal, retries: 3 })
  await ensureDir(path.dirname(file))
  await writeJsonAtomic(file, data)
  return data
}

export async function loadLocalVersion(id: string): Promise<VersionJson> {
  const file = path.join(getPaths().versions, id, `${id}.json`)
  const data = await readJson<VersionJson | null>(file, null)
  if (!data?.id) throw new Error(`版本文件缺失：${id}`)
  return data
}

export async function resolveVersion(
  id: string,
  source: 'official' | 'bmclapi',
  signal?: AbortSignal
): Promise<ResolvedVersion> {
  const chain: VersionJson[] = []
  let currentId = id
  for (let depth = 0; depth < 8; depth += 1) {
    const json = await ensureVersionJson(currentId, source, signal)
    chain.push(json)
    if (!json.inheritsFrom) break
    currentId = json.inheritsFrom
  }
  if (chain.length === 0) throw new Error('版本信息为空')
  const ordered = [...chain].reverse()
  const merged: VersionJson = { ...ordered[0], id }
  merged.libraries = []
  merged.arguments = { game: [], jvm: [] }
  for (const json of ordered) {
    if (json.libraries) merged.libraries.push(...json.libraries)
    if (json.arguments?.game) merged.arguments!.game!.push(...json.arguments.game)
    if (json.arguments?.jvm) merged.arguments!.jvm!.push(...json.arguments.jvm)
    if (json.mainClass) merged.mainClass = json.mainClass
    if (json.javaVersion) merged.javaVersion = json.javaVersion
    if (json.logging) merged.logging = json.logging
    if (json.assets) merged.assets = json.assets
    if (json.assetIndex) merged.assetIndex = json.assetIndex
    if (json.downloads) merged.downloads = json.downloads
    if (json.minecraftArguments) merged.minecraftArguments = json.minecraftArguments
    if (json.type) merged.type = json.type
    if (json.releaseTime) merged.releaseTime = json.releaseTime
  }
  const seen = new Set<string>()
  merged.libraries = merged.libraries.filter((library) => {
    const key = library.name
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const clientOwner = [...chain].reverse().find((json) => json.downloads?.client)
  if (!clientOwner?.downloads?.client) throw new Error('该版本没有可用的客户端下载信息')
  const baseVersionId = clientOwner.id
  const javaVersion = merged.javaVersion || { component: 'jre-legacy', majorVersion: 8 }
  return {
    id,
    versionJson: merged,
    baseVersionId,
    client: clientOwner.downloads.client,
    libraries: merged.libraries,
    javaMajor: javaVersion.majorVersion,
    javaComponent: javaVersion.component,
    isLegacy: Boolean(merged.minecraftArguments),
    releaseTime: merged.releaseTime,
    type: merged.type || 'release'
  }
}

export function libraryKey(library: LibraryJson): string {
  return library.name
}

export function mavenPath(name: string): string {
  const [rawCoords, extRaw] = name.split('@')
  const parts = rawCoords.split(':')
  const [group, artifact, version, classifier] = parts
  const ext = extRaw || 'jar'
  if (!group || !artifact || !version) throw new Error(`无效的 Maven 坐标：${name}`)
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`
}

export function mavenUrl(library: LibraryJson): string | null {
  const artifactPath = mavenPath(library.name)
  const base = library.url || 'https://libraries.minecraft.net/'
  return new URL(artifactPath, base.endsWith('/') ? base : `${base}/`).toString()
}

export function libraryArtifact(library: LibraryJson):
  | { path: string; sha1?: string; size?: number; url: string; name: string }
  | null {
  if (library.downloads?.artifact) {
    return { ...library.downloads.artifact, name: library.name }
  }
  try {
    return {
      path: mavenPath(library.name),
      sha1: library.sha1,
      size: library.size,
      url: mavenUrl(library) || '',
      name: library.name
    }
  } catch {
    return null
  }
}

export async function getFabricLoaders(signal?: AbortSignal): Promise<FabricLoader[]> {
  const data = await fetchJson<Array<{ version: string; stable: boolean }>>(FABRIC_LOADERS_URL, {
    signal,
    retries: 2
  })
  return data.map((item) => ({ version: item.version, stable: Boolean(item.stable) }))
}

export async function installFabricProfile(
  gameVersion: string,
  signal?: AbortSignal,
  preferredLoaderVersion?: string
): Promise<{ profileId: string; loaderVersion: string; profile: VersionJson }> {
  const loaders = await getFabricLoaders(signal)
  const loader =
    (preferredLoaderVersion && loaders.find((item) => item.version === preferredLoaderVersion)) ||
    loaders.find((item) => item.stable) ||
    loaders[0]
  if (!loader) throw new Error('无法获取 Fabric Loader 版本列表')
  const url = `${FABRIC_PROFILE_URL}/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loader.version)}/profile/json`
  const profile = await fetchJson<VersionJson>(url, { signal, retries: 2 })
  if (!profile?.id || !profile.inheritsFrom) throw new Error('Fabric 返回了无效的版本信息')
  const dir = path.join(getPaths().versions, profile.id)
  await ensureDir(dir)
  await writeJsonAtomic(path.join(dir, `${profile.id}.json`), profile)
  return { profileId: profile.id, loaderVersion: loader.version, profile }
}

export async function verifyVersionFile(id: string): Promise<boolean> {
  try {
    const manifest = await getVersionManifest()
    const summary = findVersion(manifest, id)
    const file = path.join(getPaths().versions, id, `${id}.json`)
    if (!(await pathExists(file))) return false
    return (await sha1File(file)).toLowerCase() === summary.sha1.toLowerCase()
  } catch {
    return false
  }
}

export async function readClientJarBase(resolved: ResolvedVersion): Promise<string> {
  return path.join(getPaths().versions, resolved.baseVersionId, `${resolved.baseVersionId}.jar`)
}

export async function ensureClientJar(
  resolved: ResolvedVersion,
  source: 'official' | 'bmclapi',
  download: (url: string, dest: string, sha1: string, size: number) => Promise<void>
): Promise<string> {
  const dir = path.join(getPaths().versions, resolved.baseVersionId)
  await ensureDir(dir)
  const jar = path.join(dir, `${resolved.baseVersionId}.jar`)
  const url =
    source === 'bmclapi'
      ? resolved.client.url.replace('piston-data.mojang.com', 'bmclapi2.bangbang93.com')
      : resolved.client.url
  await download(url, jar, resolved.client.sha1, resolved.client.size)
  return jar
}

export async function clearManifestCache(): Promise<void> {
  manifestCache = null
  manifestCacheTime = 0
  await fs.rm(manifestPath(), { force: true }).catch(() => undefined)
}
