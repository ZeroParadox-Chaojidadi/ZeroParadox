/**
 * Minecraft 头像服务。
 *
 * 主源用 api.mineatar.io（实测最快）；mc-heads.net 在部分网络下返回 403，
 * minotar.net、skins.mcstats.com 作为备用源按顺序回退。
 */
const LEGACY_AVATAR_HOSTS = /^https?:\/\/(mc-heads\.net|crafatar\.com|minotar\.net)\//i

export function minecraftAvatarUrl(uuid: string): string {
  return `https://api.mineatar.io/face/${encodeURIComponent(uuid)}?scale=8`
}

/** 依次尝试的头像地址：主源 + 两个备用源。 */
export function minecraftAvatarFallbacks(uuid: string): string[] {
  return [
    minecraftAvatarUrl(uuid),
    `https://minotar.net/avatar/${encodeURIComponent(uuid)}/64`,
    `https://skins.mcstats.com/face/${encodeURIComponent(uuid)}`
  ]
}

export function isLegacyAvatarUrl(url: string): boolean {
  return LEGACY_AVATAR_HOSTS.test(url)
}

/** 把早期存下的失效头像地址换成当前主源；其余地址原样返回。 */
export function resolveAvatarUrl(
  avatarUrl: string | null | undefined,
  uuid?: string | null
): string | null {
  if (avatarUrl && !isLegacyAvatarUrl(avatarUrl)) return avatarUrl
  if (uuid) return minecraftAvatarUrl(uuid)
  return avatarUrl || null
}
