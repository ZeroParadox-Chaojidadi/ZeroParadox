import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'
import type { Settings } from '../shared/types'
import { getPaths } from './paths'
import { concurrentMap, downloadFile, fetchJson, throwIfAborted } from './http'
import { ensureDir, pathExists } from './util'

const execFileAsync = promisify(execFile)

const JAVA_RUNTIME_MANIFEST =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

interface JavaRuntimePlatformEntry {
  manifest: { sha1: string; size: number; url: string }
  version: { name: string }
}

interface JavaRuntimeFile {
  type: 'file' | 'directory' | 'link'
  executable?: boolean
  target?: string
  downloads?: {
    raw?: { sha1: string; size: number; url: string }
    lzma?: { sha1: string; size: number; url: string }
  }
}

interface JavaRuntimeManifest {
  files: Record<string, JavaRuntimeFile>
}

export interface JavaCandidate {
  path: string
  launcherPath: string
  major: number
  label: string
  source: 'local' | 'downloaded'
}

const javaVersionCache = new Map<string, { major: number; label: string }>()

function javaExecutable(dir: string, launcher = false): string {
  const exe = launcher && process.platform === 'win32' ? 'javaw.exe' : 'java.exe'
  return path.join(dir, 'bin', exe)
}

export async function inspectJava(javaPath: string): Promise<{ major: number; label: string } | null> {
  const cached = javaVersionCache.get(javaPath)
  if (cached) return cached
  if (!(await pathExists(javaPath))) return null
  try {
    const { stderr, stdout } = await execFileAsync(javaPath, ['-version'], {
      timeout: 8000,
      windowsHide: true
    })
    const text = `${stdout}\n${stderr}`
    const match = text.match(/version "([^"]+)"/)
    if (!match) return null
    const version = match[1]
    const major = version.startsWith('1.') ? Number(version.split('.')[1]) : Number(version.split('.')[0])
    if (!Number.isFinite(major)) return null
    const result = { major, label: version }
    javaVersionCache.set(javaPath, result)
    return result
  } catch (error) {
    const candidate = error as { stderr?: string; stdout?: string }
    const match = `${candidate.stdout || ''}\n${candidate.stderr || ''}`.match(/version "([^"]+)"/)
    if (!match) return null
    const version = match[1]
    const major = version.startsWith('1.') ? Number(version.split('.')[1]) : Number(version.split('.')[0])
    const result = { major, label: version }
    javaVersionCache.set(javaPath, result)
    return result
  }
}

async function expandJavaHomes(): Promise<string[]> {
  const roots = new Set<string>()
  const env = process.env
  if (env.JAVA_HOME) roots.add(env.JAVA_HOME)
  const programDirs = [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs') : ''
  ].filter(Boolean) as string[]
  const vendors = ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'BellSoft', 'Amazon Corretto', 'Semeru']
  for (const base of programDirs) {
    for (const vendor of vendors) {
      const dir = path.join(base, vendor)
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) roots.add(path.join(dir, entry.name))
        }
      } catch {
        // Not installed.
      }
    }
  }
  const paths = getPaths()
  try {
    const entries = await fs.readdir(paths.runtimes, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) roots.add(path.join(paths.runtimes, entry.name))
    }
  } catch {
    // No downloaded runtimes.
  }
  try {
    const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where.exe' : 'which', ['java'], {
      timeout: 4000,
      windowsHide: true
    })
    const first = stdout.split(/\r?\n/).find(Boolean)
    if (first) roots.add(path.dirname(path.dirname(first.trim())))
  } catch {
    // Java not on PATH.
  }
  return [...roots]
}

export async function findJavaCandidates(settings: Settings): Promise<JavaCandidate[]> {
  const homes = await expandJavaHomes()
  if (settings.javaPath) homes.unshift(path.dirname(path.dirname(settings.javaPath)))
  const results: JavaCandidate[] = []
  const seen = new Set<string>()
  for (const home of homes) {
    const probe = javaExecutable(home, false)
    const normalized = path.resolve(probe).toLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    const info = await inspectJava(probe)
    if (!info) continue
    const launcher = javaExecutable(home, true)
    results.push({
      path: probe,
      launcherPath: (await pathExists(launcher)) ? launcher : probe,
      major: info.major,
      label: `Java ${info.label}`,
      source: 'local'
    })
  }
  return results.sort((a, b) => a.major - b.major)
}

function runtimeComponentFor(major: number, preferred?: string): string {
  if (preferred) return preferred
  if (major <= 8) return 'jre-legacy'
  if (major <= 16) return 'java-runtime-alpha'
  if (major <= 17) return 'java-runtime-gamma'
  if (major <= 21) return 'java-runtime-delta'
  return 'java-runtime-epsilon'
}

function runtimePlatformKey(): string {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'windows-arm64' : 'windows-x64'
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  return process.arch === 'ia32' ? 'linux-i386' : 'linux'
}

export interface JavaProgress {
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
  label: string
}

export async function ensureJavaRuntime(
  requiredMajor: number,
  component: string,
  settings: Settings,
  signal: AbortSignal | undefined,
  onProgress: (progress: JavaProgress) => void,
  options: { exact?: boolean } = {}
): Promise<JavaCandidate> {
  const candidates = await findJavaCandidates(settings)
  const explicit = settings.javaPath ? candidates.find((item) => path.resolve(item.path) === path.resolve(settings.javaPath)) : null
  if (explicit) {
    if (explicit.major < requiredMajor) {
      throw new Error(`所选 Java 版本过低：需要 Java ${requiredMajor} 或更高，当前为 Java ${explicit.major}`)
    }
    if (options.exact && explicit.major !== requiredMajor) {
      throw new Error(`这个加载器需要 Java ${requiredMajor}，当前选择的是 Java ${explicit.major}`)
    }
    return explicit
  }
  if (options.exact) {
    const exact = candidates.find((item) => item.major === requiredMajor)
    if (exact) return exact
    return downloadJavaRuntime(requiredMajor, component, signal, onProgress)
  }
  const compatible = candidates
    .filter((item) => item.major >= requiredMajor && item.major <= requiredMajor + 8)
    .sort((a, b) => a.major - b.major)
  if (compatible[0]) return compatible[0]

  const target = await downloadJavaRuntime(requiredMajor, component, signal, onProgress)
  return target
}

async function downloadJavaRuntime(
  requiredMajor: number,
  preferredComponent: string,
  signal: AbortSignal | undefined,
  onProgress: (progress: JavaProgress) => void
): Promise<JavaCandidate> {
  const platform = runtimePlatformKey()
  const components = [
    runtimeComponentFor(requiredMajor, preferredComponent),
    runtimeComponentFor(requiredMajor),
    'java-runtime-gamma',
    'java-runtime-delta',
    'java-runtime-epsilon'
  ].filter((value, index, arr) => arr.indexOf(value) === index)
  const all = await fetchJson<Record<string, Record<string, JavaRuntimePlatformEntry[]>>>(JAVA_RUNTIME_MANIFEST, {
    signal,
    retries: 3
  })
  const platformData = all[platform]
  if (!platformData) throw new Error(`当前平台 ${platform} 没有可用的 Java 运行时`)
  const chosen = components.find((name) => platformData[name]?.length)
  if (!chosen) throw new Error('Mojang 没有提供适配此版本的 Java 运行时，请手动安装 Java')
  const entry = platformData[chosen][0]
  const targetDir = path.join(getPaths().runtimes, chosen)
  const manifestFile = path.join(targetDir, '.manifest.json')
  let manifest = await readManifest(manifestFile)
  if (!manifest) {
    manifest = await fetchJson<JavaRuntimeManifest>(entry.manifest.url, { signal, retries: 3 })
    await ensureDir(targetDir)
    await fs.writeFile(manifestFile, JSON.stringify(manifest), 'utf8').catch(() => undefined)
  }
  const files = Object.entries(manifest.files).filter(([, file]) => file.type === 'file' && file.downloads?.raw)
  const bytesTotal = files.reduce((sum, [, file]) => sum + (file.downloads?.raw?.size || 0), 0)
  let filesDone = 0
  let bytesDone = 0
  const emit = (): void =>
    onProgress({ filesDone, filesTotal: files.length, bytesDone, bytesTotal, label: `Java ${entry.version.name}` })

  // Directory entries and links first.
  for (const [relative, file] of Object.entries(manifest.files)) {
    const destination = path.join(targetDir, relative)
    if (file.type === 'directory') await ensureDir(destination)
    if (file.type === 'link' && file.target) {
      await ensureDir(path.dirname(destination))
      const linkTarget = path.resolve(path.dirname(destination), file.target)
      if (!(await pathExists(destination))) {
        await fs.symlink(linkTarget, destination).catch(() => undefined)
      }
    }
  }

  await concurrentMap(files, 6, async ([relative, file]) => {
    throwIfAborted(signal)
    const raw = file.downloads!.raw!
    const destination = path.join(targetDir, relative)
    await downloadFile(raw.url, destination, {
      sha1: raw.sha1,
      size: raw.size,
      // 运行时清单里含 Welcome.html 等非二进制条目，sha1 校验已经能保证完整性。
      allowHtml: true,
      signal,
      timeoutMs: 10 * 60_000,
      onProgress: (received) => {
        const current = bytesDone + received
        onProgress({
          filesDone,
          filesTotal: files.length,
          bytesDone: Math.min(current, bytesTotal),
          bytesTotal,
          label: `Java ${entry.version.name}`
        })
      }
    })
    bytesDone += raw.size
    filesDone += 1
    if (file.executable && process.platform !== 'win32') {
      await fs.chmod(destination, 0o755).catch(() => undefined)
    }
    emit()
  })

  const launcher = javaExecutable(targetDir, true)
  const probe = javaExecutable(targetDir, false)
  if (!(await pathExists(launcher)) && !(await pathExists(probe))) {
    throw new Error('Java 运行时下载完成，但没有找到 java 可执行文件')
  }
  const info = (await inspectJava(probe)) || { major: requiredMajor, label: entry.version.name }
  return {
    path: probe,
    launcherPath: (await pathExists(launcher)) ? launcher : probe,
    major: info.major,
    label: `Java ${info.label}`,
    source: 'downloaded'
  }
}

async function readManifest(file: string): Promise<JavaRuntimeManifest | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as JavaRuntimeManifest
    if (parsed.files && Object.keys(parsed.files).length > 0) return parsed
  } catch {
    // Redownload.
  }
  return null
}
