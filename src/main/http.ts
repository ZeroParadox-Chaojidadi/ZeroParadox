import { createWriteStream, promises as fs } from 'fs'
import path from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import { ensureDir, replaceFile, sha1File, sleep } from './util'

export const USER_AGENT = 'ZeroParadox/1.0.0 (Minecraft launcher)'

export class DownloadError extends Error {
  constructor(
    message: string,
    public readonly url: string
  ) {
    super(message)
    this.name = 'DownloadError'
  }
}

export class CancelledError extends Error {
  constructor() {
    super('操作已取消')
    this.name = 'CancelledError'
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError()
}

export function mirrorUrl(url: string, source: 'official' | 'bmclapi'): string {
  if (source !== 'bmclapi') return url
  const base = 'https://bmclapi2.bangbang93.com'
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'piston-meta.mojang.com' || parsed.hostname === 'launchermeta.mojang.com') {
      return `${base}${parsed.pathname}`
    }
    if (parsed.hostname === 'piston-data.mojang.com' || parsed.hostname === 'launcher.mojang.com') {
      return `${base}${parsed.pathname}`
    }
    if (parsed.hostname === 'libraries.minecraft.net') {
      return `${base}/maven${parsed.pathname}`
    }
    if (parsed.hostname === 'resources.download.minecraft.net') {
      return `${base}/assets${parsed.pathname}`
    }
    return url
  } catch {
    return url
  }
}

function isHtmlResponse(response: Response): boolean {
  return (response.headers.get('content-type') || '').includes('text/html')
}

async function openResponse(
  url: string,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    redirect: 'follow',
    signal: combined
  })
  if (!response.ok) {
    throw new DownloadError(`服务器返回 HTTP ${response.status}`, url)
  }
  if (isHtmlResponse(response)) {
    throw new DownloadError('下载源返回了网页而不是文件，请切换下载源', url)
  }
  return response
}

export interface DownloadOptions {
  sha1?: string
  size?: number
  signal?: AbortSignal
  timeoutMs?: number
  retries?: number
  onProgress?: (received: number, total: number) => void
}

export async function downloadFile(
  sourceUrl: string,
  destination: string,
  options: DownloadOptions = {}
): Promise<void> {
  const retries = options.retries ?? 3
  const timeoutMs = options.timeoutMs ?? 15 * 60_000
  await ensureDir(path.dirname(destination))

  if (await isAlreadyDownloaded(destination, options.sha1, options.size)) {
    const stat = await fs.stat(destination).catch(() => null)
    options.onProgress?.(stat?.size || 0, stat?.size || 0)
    return
  }

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    throwIfAborted(options.signal)
    const temp = `${destination}.${process.pid}.${Date.now()}.part`
    try {
      const response = await openResponse(sourceUrl, options.signal, timeoutMs)
      const headerLength = Number(response.headers.get('content-length')) || 0
      const total = headerLength || options.size || 0
      let received = 0
      let lastTick = 0
      if (!response.body) throw new DownloadError('下载响应为空', sourceUrl)
      const progress = new Transform({
        transform(chunk: Buffer, _enc, done) {
          received += chunk.length
          const now = Date.now()
          if (now - lastTick > 120) {
            lastTick = now
            options.onProgress?.(received, total)
          }
          done(null, chunk)
        }
      })
      await pipeline(
        Readable.fromWeb(response.body as unknown as WebReadableStream),
        progress,
        createWriteStream(temp)
      )
      options.onProgress?.(received, total || received)
      throwIfAborted(options.signal)
      if (options.size && received !== options.size) {
        throw new DownloadError(`文件大小不一致（${received} / ${options.size}）`, sourceUrl)
      }
      if (options.sha1) {
        const actual = await sha1File(temp)
        if (actual.toLowerCase() !== options.sha1.toLowerCase()) {
          throw new DownloadError('文件校验失败，请重试或切换下载源', sourceUrl)
        }
      }
      await replaceFile(temp, destination)
      return
    } catch (error) {
      lastError = error
      await fs.rm(temp, { force: true }).catch(() => undefined)
      if (options.signal?.aborted) throw new CancelledError()
      if (attempt < retries) await sleep(500 * 2 ** attempt)
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new DownloadError(`下载失败：${detail}`, sourceUrl)
}

async function isAlreadyDownloaded(file: string, expectedSha1?: string, expectedSize?: number): Promise<boolean> {
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size === 0) return false
    if (expectedSize && stat.size !== expectedSize) return false
    if (!expectedSha1) return Boolean(expectedSize)
    return (await sha1File(file)).toLowerCase() === expectedSha1.toLowerCase()
  } catch {
    return false
  }
}

export async function fetchJson<T>(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number; retries?: number } = {}
): Promise<T> {
  const retries = options.retries ?? 2
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    throwIfAborted(options.signal)
    try {
      const response = await openResponse(url, options.signal, options.timeoutMs ?? 30_000)
      return (await response.json()) as T
    } catch (error) {
      lastError = error
      if (options.signal?.aborted) throw new CancelledError()
      if (attempt < retries) await sleep(400 * 2 ** attempt)
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new DownloadError(`获取数据失败：${detail}`, url)
}

export async function fetchText(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number; retries?: number } = {}
): Promise<string> {
  const response = await openResponse(url, options.signal, options.timeoutMs ?? 30_000)
  return response.text()
}

export async function concurrentMap<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  const size = Math.max(1, Math.min(limit, items.length))
  let cursor = 0
  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}
