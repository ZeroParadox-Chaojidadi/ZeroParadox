import { createHash, randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

export function newId(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as T
  } catch {
    return fallback
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file))
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await fs.rename(temp, file)
  } catch {
    await fs.rm(file, { force: true })
    await fs.rename(temp, file)
  }
}

export async function replaceFile(temp: string, target: string): Promise<void> {
  try {
    await fs.rename(temp, target)
  } catch {
    await fs.rm(target, { force: true })
    await fs.rename(temp, target)
  }
}

export function sha1(data: string | Buffer): string {
  return createHash('sha1').update(data).digest('hex')
}

export async function sha1File(file: string): Promise<string> {
  const hash = createHash('sha1')
  await new Promise<void>((resolve, reject) => {
    const stream = require('fs').createReadStream(file)
    stream.on('data', (chunk: Buffer) => hash.update(chunk))
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

export function offlineUuid(name: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : digits)} ${units[i]}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function platformName(): 'windows' | 'osx' | 'linux' {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'osx'
  return 'linux'
}

export function architectureName(): string {
  if (process.arch === 'arm64') return 'arm64'
  if (process.arch === 'ia32') return 'x86'
  return 'x64'
}

export async function copyDir(from: string, to: string, filter?: (src: string) => boolean): Promise<void> {
  await ensureDir(to)
  const entries = await fs.readdir(from, { withFileTypes: true })
  for (const entry of entries) {
    const src = path.join(from, entry.name)
    if (filter && !filter(src)) continue
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) {
      await copyDir(src, dst, filter)
    } else if (entry.isFile()) {
      await ensureDir(path.dirname(dst))
      await fs.copyFile(src, dst)
    }
  }
}

export async function dirSize(dir: string): Promise<number> {
  let total = 0
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const target = path.join(dir, entry.name)
      try {
        if (entry.isDirectory()) total += await dirSize(target)
        else if (entry.isFile()) total += (await fs.stat(target)).size
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  } catch {
    return 0
  }
  return total
}

export function safeName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\.+$/g, '')
    .trim()
    .slice(0, 64)
}
