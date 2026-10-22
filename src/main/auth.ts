import type { AccountRecord } from '../shared/types'
import { BUILT_IN_MICROSOFT_CLIENT_ID } from '../shared/azure'
import { minecraftAvatarUrl } from '../shared/avatar'
import { CancelledError } from './http'
import { newId } from './util'
import { store } from './store'

const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
const DEVICE_CODE_URL = `${AUTHORITY}/devicecode`
const TOKEN_URL = `${AUTHORITY}/token`
const XBL_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'
const SCOPE = 'XboxLive.signin offline_access'
const USER_AGENT = 'ZeroParadox/1.0.0 (Minecraft launcher)'

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
  message?: string
}

interface MsaTokenResponse {
  token_type: string
  scope?: string
  expires_in: number
  access_token: string
  refresh_token?: string
}

interface XboxResponse {
  Token: string
  DisplayClaims: {
    xui: Array<{
      uhs: string
      xid?: string
    }>
  }
}

interface MinecraftTokenResponse {
  access_token: string
  expires_in: number
}

interface MinecraftProfile {
  id: string
  name: string
  skins?: Array<{ state?: string; url?: string; variant?: string }>
}

export class MicrosoftAuthError extends Error {
  constructor(
    message: string,
    public readonly oauthError?: string,
    public readonly status?: number,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'MicrosoftAuthError'
  }
}

export function getConfiguredClientId(): string {
  const clientId = store.getSettings().microsoftClientId.trim()
  return clientId || BUILT_IN_MICROSOFT_CLIENT_ID
}

export async function requestDeviceCode(clientId: string, signal?: AbortSignal): Promise<DeviceCodeResponse> {
  if (!clientId.trim()) {
    throw new MicrosoftAuthError('请先填写 Microsoft Azure 应用 Client ID')
  }
  try {
    return await postForm<DeviceCodeResponse>(
      DEVICE_CODE_URL,
      { client_id: clientId.trim(), scope: SCOPE },
      signal
    )
  } catch (error) {
    if (
      error instanceof MicrosoftAuthError &&
      (error.oauthError === 'invalid_client' || error.message.includes('AADSTS70002'))
    ) {
      throw new MicrosoftAuthError(
        'Azure 应用还不是公共客户端。请在“身份验证”中添加“移动和桌面应用程序”平台，并开启“允许公共客户端流”后保存。',
        error.oauthError,
        error.status,
        error.details
      )
    }
    throw error
  }
}

export async function pollForMicrosoftToken(
  deviceCode: string,
  clientId: string,
  intervalSeconds: number,
  expiresInSeconds: number,
  signal?: AbortSignal
): Promise<MsaTokenResponse> {
  const deadline = Date.now() + Math.max(30, expiresInSeconds) * 1000
  let interval = Math.max(2, intervalSeconds || 5)
  let networkFailures = 0
  while (Date.now() < deadline) {
    await abortableSleep(interval * 1000, signal)
    try {
      return await postForm<MsaTokenResponse>(
        TOKEN_URL,
        {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: clientId,
          device_code: deviceCode
        },
        signal
      )
    } catch (error) {
      if (!(error instanceof MicrosoftAuthError)) throw error
      if (!error.oauthError) {
        // 网络抖动（fetch failed）不应中断整个登录：设备码还有效就继续轮询。
        networkFailures += 1
        if (networkFailures < 3) continue
        throw error
      }
      networkFailures = 0
      if (error.oauthError === 'authorization_pending') continue
      if (error.oauthError === 'slow_down') {
        interval += 5
        continue
      }
      if (error.oauthError === 'expired_token' || error.oauthError === 'bad_verification_code') {
        throw new MicrosoftAuthError('设备码已过期，请重新开始登录')
      }
      if (error.oauthError === 'authorization_declined') {
        throw new MicrosoftAuthError('你已取消微软登录授权')
      }
      throw error
    }
  }
  throw new MicrosoftAuthError('登录等待超时，请重新开始')
}

async function refreshMicrosoftToken(refreshToken: string, clientId: string, signal?: AbortSignal): Promise<MsaTokenResponse> {
  return postForm<MsaTokenResponse>(
    TOKEN_URL,
    {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      scope: SCOPE
    },
    signal
  )
}

export async function completeMicrosoftLogin(
  token: MsaTokenResponse,
  clientId: string,
  signal?: AbortSignal
): Promise<AccountRecord> {
  const session = await loginToMinecraft(token.access_token, signal)
  return {
    id: newId('acc_ms_'),
    type: 'microsoft',
    username: session.profile.name,
    uuid: session.profile.id,
    avatarUrl: minecraftAvatarUrl(session.profile.id),
    skinModel: session.profile.skins?.find((skin) => skin.state === 'ACTIVE')?.variant === 'SLIM' ? 'slim' : 'classic',
    accessToken: session.accessToken,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + Math.max(60, session.expiresIn) * 1000,
    xuid: session.xuid,
    clientId
  }
}

export async function ensureMicrosoftSession(account: AccountRecord): Promise<AccountRecord> {
  if (account.type !== 'microsoft') return account
  if (account.accessToken && account.expiresAt && account.expiresAt - Date.now() > 5 * 60_000) {
    return account
  }
  if (!account.refreshToken) {
    throw new MicrosoftAuthError('Microsoft 登录已失效，请在账户窗口重新登录')
  }
  const clientId = account.clientId || getConfiguredClientId()
  if (!clientId) {
    throw new MicrosoftAuthError('缺少 Microsoft Client ID，请重新登录')
  }
  const refreshed = await refreshMicrosoftToken(account.refreshToken, clientId)
  const session = await loginToMinecraft(refreshed.access_token)
  const updated = await store.updateAccount(account.id, {
    accessToken: session.accessToken,
    refreshToken: refreshed.refresh_token || account.refreshToken,
    expiresAt: Date.now() + Math.max(60, session.expiresIn) * 1000,
    clientId,
    xuid: session.xuid,
    username: session.profile.name,
    uuid: session.profile.id,
    skinModel: session.profile.skins?.find((skin) => skin.state === 'ACTIVE')?.variant === 'SLIM' ? 'slim' : 'classic'
  })
  return updated
}

async function loginToMinecraft(
  microsoftAccessToken: string,
  signal?: AbortSignal
): Promise<{
  accessToken: string
  expiresIn: number
  xuid: string
  profile: MinecraftProfile
}> {
  const xbl = await postJson<XboxResponse>(
    XBL_URL,
    {
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${microsoftAccessToken}`
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    },
    signal
  )

  let xsts: XboxResponse
  try {
    xsts = await postJson<XboxResponse>(
      XSTS_URL,
      {
        Properties: {
          SandboxId: 'RETAIL',
          UserTokens: [xbl.Token]
        },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT'
      },
      signal
    )
  } catch (error) {
    throw new MicrosoftAuthError(xstsError(error), undefined, 401, (error as MicrosoftAuthError).details)
  }

  const uhs = xsts.DisplayClaims?.xui?.[0]?.uhs
  const xuid = xsts.DisplayClaims?.xui?.[0]?.xid || ''
  if (!uhs) throw new MicrosoftAuthError('微软返回的 Xbox 账户信息不完整')

  let minecraft: MinecraftTokenResponse
  try {
    minecraft = await postJson<MinecraftTokenResponse>(
      MC_LOGIN_URL,
      { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` },
      signal
    )
  } catch (error) {
    if (error instanceof MicrosoftAuthError && error.status === 403) {
      throw new MicrosoftAuthError(
        'Mojang 尚未授权这个 Azure 应用。请先通过 aka.ms/AppRegInfo 提交启动器应用审批，审批通过后再使用同一个 Client ID 登录。',
        undefined,
        403,
        error.details
      )
    }
    throw error
  }
  const profile = await getJson<MinecraftProfile>(MC_PROFILE_URL, minecraft.access_token, signal)
  return {
    accessToken: minecraft.access_token,
    expiresIn: minecraft.expires_in,
    xuid,
    profile
  }
}

async function getJson<T>(url: string, token: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(30_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
      Accept: 'application/json'
    },
    signal: combined
  })
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (response.status === 404) {
    throw new MicrosoftAuthError('这个 Microsoft 账户没有 Minecraft Java 版')
  }
  if (!response.ok) {
    throw new MicrosoftAuthError(extractMessage(data) || `Minecraft 服务返回 HTTP ${response.status}`, undefined, response.status, data)
  }
  return data as T
}

async function postForm<T>(
  url: string,
  form: Record<string, string>,
  signal?: AbortSignal
): Promise<T> {
  return post<T>(
    url,
    new URLSearchParams(form).toString(),
    'application/x-www-form-urlencoded',
    signal
  )
}

async function postJson<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T> {
  return post<T>(url, JSON.stringify(body), 'application/json', signal)
}

async function post<T>(url: string, body: string, contentType: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(30_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'User-Agent': USER_AGENT,
        Accept: 'application/json'
      },
      body,
      signal: combined
    })
  } catch (error) {
    if (signal?.aborted) throw new CancelledError()
    throw new MicrosoftAuthError(`无法连接微软登录服务：${error instanceof Error ? error.message : String(error)}`)
  }
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok) {
    const details = data as Record<string, unknown> | null
    const oauthError = typeof details?.error === 'string' ? details.error : undefined
    throw new MicrosoftAuthError(
      extractMessage(data) || `微软服务返回 HTTP ${response.status}`,
      oauthError,
      response.status,
      data
    )
  }
  return data as T
}

function extractMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const record = data as Record<string, unknown>
  const candidates = [record.error_description, record.Message, record.message, record.error]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function xstsError(error: unknown): string {
  const detail = error as MicrosoftAuthError
  const data = detail.details as { XErr?: number; Message?: string } | undefined
  switch (data?.XErr) {
    case 2148916233:
      return '这个 Microsoft 账户还没有 Xbox 档案，请先登录 Xbox 创建档案'
    case 2148916235:
      return 'Xbox Live 在你所在的国家或地区不可用'
    case 2148916236:
      return '需要在 Xbox 页面完成成人验证'
    case 2148916237:
      return '这个 Microsoft 账户没有 Xbox 档案'
    case 2148916238:
      return '未成年账户需要先加入 Microsoft 家庭组'
    case 2148916227:
      return '这个 Xbox 账户已被封禁'
    default:
      return data?.Message || detail.message || 'Xbox 身份验证失败'
  }
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new CancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
