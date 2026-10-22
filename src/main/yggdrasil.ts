import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { downloadFile, fetchJson, throwIfAborted } from './http'
import { getPaths } from './paths'
import { ensureDir, pathExists } from './util'

export interface YggdrasilProfile {
  id: string
  name: string
}

export interface YggdrasilSession {
  server: string
  accessToken: string
  clientToken: string
  profile: YggdrasilProfile
}

const INJECTOR_LATEST = [
  'https://bmclapi2.bangbang93.com/mirrors/authlib-injector/artifact/latest.json',
  'https://authlib-injector.yushi.moe/artifact/latest.json'
]

/** 把用户填的地址规整成 API 根（去掉结尾斜杠与已知的子路径）。 */
export function normalizeYggdrasilServer(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) throw new Error('请填写第三方登录地址')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('第三方登录地址格式不正确')
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('第三方登录地址必须是 http(s)')
  let pathname = url.pathname.replace(/\/+$/, '')
  for (const suffix of ['/authserver', '/sessionserver', '/api']) {
    if (pathname.endsWith(suffix)) pathname = pathname.slice(0, -suffix.length)
  }
  return `${url.origin}${pathname}`
}

interface AuthenticateResponse {
  accessToken?: string
  clientToken?: string
  selectedProfile?: { id?: string; name?: string }
  error?: string
  errorMessage?: string
  message?: string
}

/** 用用户名密码登录 Yggdrasil（外置登录 / Blessing Skin 等）。 */
export async function authenticateYggdrasil(
  server: string,
  username: string,
  password: string,
  signal?: AbortSignal
): Promise<YggdrasilSession> {
  const base = normalizeYggdrasilServer(server)
  const name = String(username || '').trim()
  if (!name) throw new Error('请填写用户名')
  if (!password) throw new Error('请填写密码')
  throwIfAborted(signal)

  const response = await fetch(`${base}/authserver/authenticate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      username: name,
      password,
      agent: { name: 'Minecraft', version: 1 },
      requestUser: false
    }),
    signal
  }).catch((error: unknown) => {
    throw new Error(`无法连接登录服务器：${error instanceof Error ? error.message : String(error)}`)
  })

  const text = await response.text()
  let data: AuthenticateResponse = {}
  try {
    data = text ? (JSON.parse(text) as AuthenticateResponse) : {}
  } catch {
    throw new Error('登录服务器返回了无法解析的内容')
  }

  if (!response.ok) {
    const reason = data.errorMessage || data.message || data.error || `HTTP ${response.status}`
    throw new Error(`登录失败：${reason}`)
  }
  if (!data.accessToken || !data.selectedProfile?.id) {
    throw new Error('登录失败：服务器没有返回角色信息')
  }

  return {
    server: base,
    accessToken: data.accessToken,
    clientToken: data.clientToken || '',
    profile: {
      id: data.selectedProfile.id.replace(/-/g, ''),
      name: data.selectedProfile.name || name
    }
  }
}

interface InjectorLatest {
  version?: string
  download_url?: string
  checksums?: { sha256?: string }
}

/** 下载（或复用）authlib-injector，用于第三方登录启动时注入。 */
export async function ensureAuthlibInjector(signal?: AbortSignal): Promise<string> {
  const dir = path.join(getPaths().cache, 'authlib-injector')
  const file = path.join(dir, 'authlib-injector.jar')
  if (await pathExists(file)) {
    const stat = await fs.stat(file).catch(() => null)
    if (stat && stat.size > 100_000) return file
  }
  await ensureDir(dir)

  let latest: InjectorLatest | null = null
  let lastError: unknown
  for (const url of INJECTOR_LATEST) {
    try {
      latest = await fetchJson<InjectorLatest>(url, { signal, retries: 1, timeoutMs: 20_000 })
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!latest?.download_url) {
    throw new Error(
      `无法获取 authlib-injector：${lastError instanceof Error ? lastError.message : '所有下载源均不可用'}`
    )
  }

  await downloadFile(latest.download_url, file, { signal, timeoutMs: 5 * 60_000 })
  const expected = latest.checksums?.sha256
  if (expected) {
    const buffer = await fs.readFile(file)
    const actual = createHash('sha256').update(buffer).digest('hex')
    if (actual !== expected.toLowerCase()) {
      await fs.rm(file, { force: true })
      throw new Error('authlib-injector 校验失败，请重试')
    }
  }
  return file
}

/**
 * 从 Yggdrasil 服务器取皮肤，并把头部裁成 64x64 的 data URL（供账户列表显示）。
 * 皮肤站通常提供 64x64 或 128x128 的整张皮肤图，这里只取头部 8x8 区域。
 */
export async function fetchYggdrasilHead(
  server: string,
  uuid: string,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const base = normalizeYggdrasilServer(server)
    const id = String(uuid || '').replace(/-/g, '')
    if (!id) return null
    const profileRes = await fetch(`${base}/sessionserver/session/minecraft/profile/${id}`, { signal })
    if (!profileRes.ok) return null
    const profile = (await profileRes.json()) as {
      properties?: Array<{ name?: string; value?: string }>
    }
    const prop = (profile.properties || []).find((item) => item.name === 'textures')
    if (!prop?.value) return null
    const payload = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8')) as {
      textures?: { SKIN?: { url?: string } }
    }
    const skinUrl = payload.textures?.SKIN?.url
    if (!skinUrl) return null

    const skinRes = await fetch(skinUrl, { signal })
    if (!skinRes.ok) return null
    const buffer = Buffer.from(await skinRes.arrayBuffer())
    const { nativeImage } = await import('electron')
    const image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) return null
    const size = image.getSize()
    if (size.width < 64 || size.height < 32) return null
    const scale = size.width / 64
    const head = image
      .crop({
        x: Math.floor(8 * scale),
        y: Math.floor(8 * scale),
        width: Math.floor(8 * scale),
        height: Math.floor(8 * scale)
      })
      .resize({ width: 64, height: 64, quality: 'best' })
    return head.toDataURL()
  } catch {
    return null
  }
}
