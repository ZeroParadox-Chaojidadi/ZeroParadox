import { promises as fs } from 'fs'
import path from 'path'
import type { Instance } from '../shared/types'
import { BUILT_IN_CURSEFORGE_API_KEY } from '../shared/curseforge'
import { downloadFile, throwIfAborted } from './http'
import { gameDir, instanceDir } from './paths'
import { ensureDir, pathExists } from './util'

const API = 'https://api.curseforge.com/v1'

export interface CurseforgeManifest {
  name?: string
  version?: string
  minecraft?: { version?: string; modLoaders?: Array<{ id?: string; primary?: boolean }> }
  files?: Array<{ projectID?: number; fileID?: number; required?: boolean }>
}

export interface CurseforgeProgress {
  phase: string
  message: string
  current: number
  total: number
  percent: number
  bytes?: number
  bytesTotal?: number
}

export interface CurseforgeInfo {
  name: string
  total: number
}

export interface CurseforgeResult {
  downloaded: number
  skipped: number
  failed: string[]
}

/** 读取导入时保留的 CurseForge 清单。 */
export async function readCurseforgeManifest(instanceId: string): Promise<CurseforgeManifest | null> {
  const file = path.join(instanceDir(instanceId), 'curseforge-manifest.json')
  const raw = await fs.readFile(file, 'utf8').catch(() => null)
  if (!raw) return null
  try {
    return JSON.parse(raw) as CurseforgeManifest
  } catch {
    return null
  }
}

export async function getCurseforgeInfo(instanceId: string): Promise<CurseforgeInfo | null> {
  const manifest = await readCurseforgeManifest(instanceId)
  if (!manifest) return null
  const files = (manifest.files || []).filter((item) => item.projectID && item.fileID)
  if (files.length === 0) return null
  return { name: manifest.name || 'CurseForge 整合包', total: files.length }
}

async function resolveDownloadUrl(
  modId: number,
  fileId: number,
  apiKey: string,
  signal?: AbortSignal
): Promise<{ url: string; fileName: string }> {
  // 用 GET 单文件接口：POST /mods/{id}/files 在部分网络下会被 CloudFront 拦成 403。
  const response = await fetch(`${API}/mods/${modId}/files/${fileId}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-api-key': apiKey
    },
    signal
  })
  if (response.status === 403) throw new Error('API Key 无效或没有权限')
  if (!response.ok) throw new Error(`CurseForge API 返回 ${response.status}`)
  const payload = (await response.json()) as {
    data?: { downloadUrl?: string | null; fileName?: string }
  }
  const file = payload.data
  if (!file?.downloadUrl) throw new Error('作者未开放第三方下载（downloadUrl 为空）')
  return {
    url: file.downloadUrl,
    fileName:
      file.fileName || decodeURIComponent(file.downloadUrl.split('/').pop() || `${modId}.jar`)
  }
}

/** 按清单把模组逐个下载到实例的 mods 目录。 */
export async function downloadCurseforgeMods(
  instance: Instance,
  apiKey: string,
  options: { signal?: AbortSignal; onProgress: (update: CurseforgeProgress) => void }
): Promise<CurseforgeResult> {
  const key = String(apiKey || '').trim() || BUILT_IN_CURSEFORGE_API_KEY
  const manifest = await readCurseforgeManifest(instance.id)
  const files = (manifest?.files || []).filter((item) => item.projectID && item.fileID)
  if (files.length === 0) throw new Error('这个实例没有 CurseForge 清单，无法自动补模组')

  const modsDir = path.join(gameDir(instance.id), 'mods')
  await ensureDir(modsDir)

  const result: CurseforgeResult = { downloaded: 0, skipped: 0, failed: [] }
  let done = 0
  for (const entry of files) {
    throwIfAborted(options.signal)
    const modId = Number(entry.projectID)
    const fileId = Number(entry.fileID)
    try {
      const resolved = await resolveDownloadUrl(modId, fileId, key, options.signal)
      const target = path.join(modsDir, path.basename(resolved.fileName))
      if (await pathExists(target)) {
        result.skipped += 1
      } else {
        await downloadFile(resolved.url, target, { signal: options.signal, timeoutMs: 10 * 60_000 })
        result.downloaded += 1
      }
    } catch (error) {
      if (options.signal?.aborted) throw error
      result.failed.push(
        `${modId}/${fileId}：${error instanceof Error ? error.message : String(error)}`
      )
    }
    done += 1
    options.onProgress({
      phase: '下载整合包模组',
      message: `第 ${done} / ${files.length} 个`,
      current: done,
      total: files.length,
      percent: Math.round((done / files.length) * 100)
    })
  }
  return result
}
