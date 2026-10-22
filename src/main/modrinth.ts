import AdmZip from 'adm-zip'
import { promises as fs } from 'fs'
import path from 'path'
import type {
  ContentEntry,
  ContentImportResult,
  ContentKind,
  InstallSummary,
  Instance,
  ModrinthProject,
  ModrinthSearchHit,
  ModrinthSearchResult,
  ModrinthVersion,
  WorldEntry
} from '../shared/types'
import { gameDir, instanceDir } from './paths'
import { downloadFile, fetchJson, throwIfAborted } from './http'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './util'
import { store } from './store'

const API = 'https://api.modrinth.com/v2'

interface RawSearchHit {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  icon_url: string | null
  downloads: number
  follows: number
  categories: string[]
  versions: string[]
  project_type: string
  date_modified: string
}

interface RawSearchResponse {
  hits: RawSearchHit[]
  offset: number
  limit: number
  total_hits: number
}

interface RawProject {
  id: string
  slug: string
  title: string
  description: string
  body: string
  icon_url: string | null
  categories: string[]
  client_side: string
  server_side: string
  downloads: number
  followers: number
  source_url: string | null
  issues_url: string | null
  project_type: string
}

interface RawVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  version_type: string
  game_versions: string[]
  loaders: string[]
  date_published: string
  downloads: number
  dependencies: Array<{
    version_id: string | null
    project_id: string | null
    dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
  }>
  files: Array<{
    url: string
    filename: string
    primary: boolean
    size: number
    hashes: Record<string, string>
  }>
}

interface ContentMeta {
  fileName: string
  title: string
  iconUrl: string | null
  projectId: string
  versionNumber: string
  source: 'modrinth'
  installedAt: string
}

interface ContentIndex {
  [fileName: string]: ContentMeta
}

const searchCache = new Map<string, { at: number; value: ModrinthSearchResult }>()
const projectCache = new Map<string, { at: number; value: ModrinthProject }>()

const KIND_FOLDER: Record<ContentKind, string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  datapack: 'datapacks'
}

const PROJECT_TYPE: Record<ContentKind, string> = {
  mod: 'mod',
  resourcepack: 'resourcepack',
  shader: 'shader',
  datapack: 'datapack'
}

export async function searchProjects(input: {
  query: string
  kind: ContentKind
  gameVersion?: string
  loader?: string
  offset?: number
  limit?: number
  sort?: 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'
}): Promise<ModrinthSearchResult> {
  const limit = Math.min(40, Math.max(1, input.limit || 20))
  const offset = Math.max(0, input.offset || 0)
  const facets: string[][] = [[`project_type:${PROJECT_TYPE[input.kind]}`]]
  if (input.gameVersion) facets.push([`versions:${input.gameVersion}`])
  if (input.loader && input.kind === 'mod' && input.loader !== 'vanilla') {
    facets.push([`categories:${input.loader}`])
  }
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    index: input.sort || (input.query ? 'relevance' : 'downloads'),
    facets: JSON.stringify(facets)
  })
  if (input.query.trim()) params.set('query', input.query.trim())
  const key = params.toString()
  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.at < 3 * 60_000) return cached.value
  const raw = await fetchJson<RawSearchResponse>(`${API}/search?${params.toString()}`, { retries: 2 })
  const value: ModrinthSearchResult = {
    hits: raw.hits.map(mapHit),
    offset: raw.offset,
    limit: raw.limit,
    totalHits: raw.total_hits
  }
  searchCache.set(key, { at: Date.now(), value })
  return value
}

function mapHit(hit: RawSearchHit): ModrinthSearchHit {
  return {
    projectId: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    author: hit.author,
    iconUrl: hit.icon_url || null,
    downloads: hit.downloads,
    follows: hit.follows,
    categories: hit.categories || [],
    versions: hit.versions || [],
    projectType: hit.project_type,
    dateModified: hit.date_modified
  }
}

export async function getProject(id: string): Promise<ModrinthProject> {
  const cached = projectCache.get(id)
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value
  const raw = await fetchJson<RawProject>(`${API}/project/${encodeURIComponent(id)}`, { retries: 2 })
  const project: ModrinthProject = {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    description: raw.description,
    body: raw.body || '',
    iconUrl: raw.icon_url || null,
    categories: raw.categories || [],
    clientSide: raw.client_side,
    serverSide: raw.server_side,
    downloads: raw.downloads,
    followers: raw.followers,
    sourceUrl: raw.source_url || null,
    issuesUrl: raw.issues_url || null,
    projectType: raw.project_type
  }
  projectCache.set(id, { at: Date.now(), value: project })
  return project
}

export async function getProjectVersions(
  projectId: string,
  gameVersion: string,
  loader: string,
  kind: ContentKind
): Promise<ModrinthVersion[]> {
  const params = new URLSearchParams()
  params.set('game_versions', JSON.stringify([gameVersion]))
  if (kind === 'mod' && loader !== 'vanilla') params.set('loaders', JSON.stringify([loader]))
  const raw = await fetchJson<RawVersion[]>(
    `${API}/project/${encodeURIComponent(projectId)}/version?${params.toString()}`,
    { retries: 2 }
  )
  return raw.map(mapVersion)
}

function mapVersion(raw: RawVersion): ModrinthVersion {
  return {
    id: raw.id,
    name: raw.name,
    versionNumber: raw.version_number,
    versionType: raw.version_type,
    gameVersions: raw.game_versions,
    loaders: raw.loaders,
    datePublished: raw.date_published,
    downloads: raw.downloads,
    dependencies: raw.dependencies.map((dep) => ({
      versionId: dep.version_id,
      projectId: dep.project_id,
      dependencyType: dep.dependency_type
    })),
    files: raw.files.map((file) => ({
      url: file.url,
      filename: file.filename,
      primary: file.primary,
      size: file.size,
      hashes: file.hashes
    }))
  }
}

export async function installProject(
  instanceId: string,
  projectId: string,
  kind: ContentKind,
  versionId?: string,
  signal?: AbortSignal
): Promise<InstallSummary> {
  const instance = store.requireInstance(instanceId)
  const project = await getProject(projectId)
  let version: ModrinthVersion | null = null
  if (versionId) {
    const raw = await fetchJson<RawVersion>(`${API}/version/${encodeURIComponent(versionId)}`, { signal })
    version = mapVersion(raw)
  } else {
    const versions = await getProjectVersions(projectId, instance.gameVersion, instance.loader.type, kind)
    version = versions[0] || null
  }
  if (!version) {
    throw new Error(`这个项目没有适配 Minecraft ${instance.gameVersion} 的版本`)
  }
  const summary: InstallSummary = { installed: [], warnings: [] }
  const visited = new Set<string>()
  await installVersionRecursive(instance, project, kind, version, summary, visited, signal)
  return summary
}

async function installVersionRecursive(
  instance: Instance,
  project: ModrinthProject,
  kind: ContentKind,
  version: ModrinthVersion,
  summary: InstallSummary,
  visited: Set<string>,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal)
  if (visited.has(version.id)) return
  visited.add(version.id)
  const primary = version.files.find((file) => file.primary) || version.files[0]
  if (!primary) throw new Error(`项目 ${project.title} 的版本没有可下载文件`)
  const folder = path.join(gameDir(instance.id), KIND_FOLDER[kind])
  await ensureDir(folder)
  const storedName = sanitizeFileName(primary.filename)
  const destination = path.join(folder, storedName)
  await downloadFile(primary.url, destination, {
    sha1: primary.hashes.sha1,
    size: primary.size,
    signal,
    timeoutMs: 10 * 60_000
  })
  const index = await readContentIndex(instance.id)
  index[storedName] = {
    fileName: storedName,
    title: project.title,
    iconUrl: project.iconUrl,
    projectId: project.id,
    versionNumber: version.versionNumber,
    source: 'modrinth',
    installedAt: new Date().toISOString()
  }
  await writeContentIndex(instance.id, index)
  summary.installed.push(storedName)

  for (const dependency of version.dependencies) {
    if (dependency.dependencyType !== 'required') continue
    try {
      let depVersion: ModrinthVersion | null = null
      let depProjectId = dependency.projectId || ''
      if (dependency.versionId) {
        const raw = await fetchJson<RawVersion>(`${API}/version/${encodeURIComponent(dependency.versionId)}`, {
          signal
        })
        depVersion = mapVersion(raw)
        depProjectId = depProjectId || raw.project_id
      } else if (dependency.projectId) {
        const versions = await getProjectVersions(
          dependency.projectId,
          instance.gameVersion,
          instance.loader.type,
          kind
        )
        depVersion = versions[0] || null
      }
      if (!depVersion) {
        summary.warnings.push(`依赖 ${dependency.projectId || dependency.versionId} 没有兼容版本`)
        continue
      }
      let depProject: ModrinthProject
      try {
        depProject = await getProject(depProjectId)
      } catch {
        depProject = fallbackProject(depProjectId || depVersion.id)
      }
      await installVersionRecursive(instance, depProject, kind, depVersion, summary, visited, signal)
    } catch (error) {
      summary.warnings.push(`依赖 ${dependency.projectId || dependency.versionId} 安装失败：${messageOf(error)}`)
    }
  }
}

function fallbackProject(id: string): ModrinthProject {
  return {
    id,
    slug: id,
    title: id,
    description: '',
    body: '',
    iconUrl: null,
    categories: [],
    clientSide: 'unknown',
    serverSide: 'unknown',
    downloads: 0,
    followers: 0,
    sourceUrl: null,
    issuesUrl: null,
    projectType: 'mod'
  }
}

export async function listContent(instanceId: string, kind: ContentKind): Promise<ContentEntry[]> {
  const instance = store.requireInstance(instanceId)
  const folder = path.join(gameDir(instance.id), KIND_FOLDER[kind])
  await ensureDir(folder)
  const index = await readContentIndex(instanceId)
  let names: string[] = []
  try {
    names = await fs.readdir(folder)
  } catch {
    return []
  }
  const entries: ContentEntry[] = []
  for (const rawName of names) {
    const disabled = /\.disabled$/i.test(rawName)
    const fileName = disabled ? rawName.replace(/\.disabled$/i, '') : rawName
    const ext = path.extname(fileName).toLowerCase()
    const expected = kind === 'mod' || kind === 'datapack' ? '.jar' : '.zip'
    if (ext !== expected) continue
    const full = path.join(folder, rawName)
    const stat = await fs.stat(full).catch(() => null)
    if (!stat?.isFile()) continue
    const meta = index[fileName]
    let title = meta?.title || fileName.replace(/\.(jar|zip)$/i, '')
    let description: string | undefined
    if (!meta && kind === 'mod') {
      const parsed = await readJarMetadata(full)
      if (parsed) {
        title = parsed.name || title
        description = parsed.description
      }
    }
    entries.push({
      name: title,
      fileName: rawName,
      size: stat.size,
      enabled: !disabled,
      path: full,
      source: meta ? 'modrinth' : 'local',
      description,
      iconUrl: meta?.iconUrl || null
    })
  }
  return entries.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, 'zh-CN'))
}

export async function toggleContent(instanceId: string, kind: ContentKind, fileName: string): Promise<void> {
  const instance = store.requireInstance(instanceId)
  const folder = path.join(gameDir(instance.id), KIND_FOLDER[kind])
  const safe = path.basename(fileName)
  const full = path.join(folder, safe)
  if (!(await pathExists(full))) throw new Error('文件不存在')
  const isDisabled = /\.disabled$/i.test(safe)
  const next = isDisabled ? full.replace(/\.disabled$/i, '') : `${full}.disabled`
  await fs.rename(full, next)
}

export async function deleteContent(instanceId: string, kind: ContentKind, fileName: string): Promise<void> {
  const instance = store.requireInstance(instanceId)
  const folder = path.join(gameDir(instance.id), KIND_FOLDER[kind])
  const full = path.join(folder, path.basename(fileName))
  await fs.rm(full, { force: true })
  const index = await readContentIndex(instanceId)
  delete index[fileName.replace(/\.disabled$/i, '')]
  await writeContentIndex(instanceId, index)
}

async function uniqueContentTarget(folder: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName)
  const base = path.basename(fileName, ext)
  let candidate = path.join(folder, fileName)
  let index = 1
  while (await fs.stat(candidate).then(() => true, () => false)) {
    candidate = path.join(folder, `${base} (${index})${ext}`)
    index += 1
  }
  return candidate
}

/**
 * 导入用户拖进来的文件（.jar 用于模组/数据包，.zip 用于资源包/光影）。
 * 同名文件不会覆盖，会自动加序号。
 */
export async function importContentFiles(
  instanceId: string,
  kind: ContentKind,
  filePaths: string[]
): Promise<ContentImportResult> {
  const instance = store.requireInstance(instanceId)
  const folder = path.join(gameDir(instance.id), KIND_FOLDER[kind])
  await ensureDir(folder)
  const expected = kind === 'mod' || kind === 'datapack' ? '.jar' : '.zip'
  const result: ContentImportResult = { imported: [], skipped: [] }

  for (const raw of filePaths.slice(0, 200)) {
    const source = path.resolve(String(raw))
    const original = path.basename(source)
    if (path.extname(original).toLowerCase() !== expected) {
      result.skipped.push({ file: original, reason: `只支持 ${expected} 文件` })
      continue
    }
    const stat = await fs.stat(source).catch(() => null)
    if (!stat?.isFile()) {
      result.skipped.push({ file: original, reason: '文件不存在或无法读取' })
      continue
    }
    if (path.dirname(source).toLowerCase() === folder.toLowerCase()) {
      result.skipped.push({ file: original, reason: '文件已经在目标文件夹中' })
      continue
    }
    const destination = await uniqueContentTarget(folder, original)
    await fs.copyFile(source, destination)
    result.imported.push(path.basename(destination))
  }
  return result
}

export async function listWorlds(instanceId: string): Promise<WorldEntry[]> {
  const instance = store.requireInstance(instanceId)
  const saves = path.join(gameDir(instance.id), 'saves')
  await ensureDir(saves)
  let dirs: string[] = []
  try {
    dirs = (await fs.readdir(saves, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
  const worlds: WorldEntry[] = []
  for (const name of dirs) {
    const full = path.join(saves, name)
    const stat = await fs.stat(full).catch(() => null)
    let icon: string | null = null
    try {
      const iconPath = path.join(full, 'icon.png')
      const buf = await fs.readFile(iconPath)
      if (buf.length < 512 * 1024) icon = `data:image/png;base64,${buf.toString('base64')}`
    } catch {
      // World has no icon.
    }
    worlds.push({
      name,
      folder: name,
      lastModified: stat?.mtimeMs || 0,
      size: 0,
      icon
    })
  }
  return worlds.sort((a, b) => b.lastModified - a.lastModified)
}

async function readContentIndex(instanceId: string): Promise<ContentIndex> {
  return readJson<ContentIndex>(path.join(instanceDir(instanceId), 'content-index.json'), {})
}

async function writeContentIndex(instanceId: string, index: ContentIndex): Promise<void> {
  await writeJsonAtomic(path.join(instanceDir(instanceId), 'content-index.json'), index)
}

async function readJarMetadata(file: string): Promise<{ name: string; description: string } | null> {
  try {
    const zip = new AdmZip(file)
    const fabric = zip.getEntry('fabric.mod.json')
    if (fabric) {
      const json = JSON.parse(zip.readAsText(fabric)) as {
        name?: string
        description?: string | Record<string, string>
      }
      return {
        name: typeof json.name === 'string' ? json.name : '',
        description:
          typeof json.description === 'string'
            ? json.description
            : typeof json.description === 'object'
              ? Object.values(json.description)[0] || ''
              : ''
      }
    }
    const quilt = zip.getEntry('quilt.mod.json')
    if (quilt) {
      const json = JSON.parse(zip.readAsText(quilt)) as { quilt_loader?: { metadata?: { name?: string; description?: string } } }
      const meta = json.quilt_loader?.metadata
      return { name: meta?.name || '', description: meta?.description || '' }
    }
    const toml = zip.getEntry('META-INF/mods.toml') || zip.getEntry('META-INF/neoforge.mods.toml')
    if (toml) {
      const text = zip.readAsText(toml)
      const name = text.match(/^\s*displayName\s*=\s*["']([^"']+)["']/m)?.[1] || ''
      const description = text.match(/^\s*description\s*=\s*["']([^"']+)["']/m)?.[1] || ''
      return { name, description }
    }
    return null
  } catch {
    return null
  }
}

function sanitizeFileName(name: string): string {
  return path.basename(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 只把某个版本的主文件下载到指定目录，不安装到任何实例。 */
export async function downloadVersionFile(
  versionId: string,
  targetDir: string,
  signal?: AbortSignal
): Promise<string> {
  const dir = path.resolve(String(targetDir || '').trim())
  if (!dir) throw new Error('请选择保存目录')
  const stat = await fs.stat(dir).catch(() => null)
  if (!stat?.isDirectory()) throw new Error('保存目录不存在')
  const raw = await fetchJson<RawVersion>(`${API}/version/${encodeURIComponent(versionId)}`, { signal })
  const version = mapVersion(raw)
  const file = version.files.find((item) => item.primary) || version.files[0]
  if (!file) throw new Error('这个版本没有可下载的文件')
  const target = path.join(dir, path.basename(file.filename))
  await downloadFile(file.url, target, {
    sha1: file.hashes?.sha1,
    size: file.size,
    signal
  })
  return target
}
