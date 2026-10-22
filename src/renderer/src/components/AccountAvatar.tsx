import { useState } from 'react'
import type { Account } from '../../../shared/types'
import { isLegacyAvatarUrl, minecraftAvatarFallbacks } from '../../../shared/avatar'

interface AccountAvatarProps {
  account: Account
}

/**
 * 账户头像。按主源、备用源的顺序依次尝试，全部失败时退回名字首字母，
 * 避免界面上出现破损图片。
 */
export default function AccountAvatar({ account }: AccountAvatarProps): React.JSX.Element {
  const custom =
    account.avatarUrl && !isLegacyAvatarUrl(account.avatarUrl) ? account.avatarUrl : null
  // 第三方账户的皮肤来自它自己的服务器，不能用 Mojang 头像服务兜底。
  const candidates = custom
    ? [custom]
    : account.type === 'yggdrasil' || !account.uuid
      ? []
      : minecraftAvatarFallbacks(account.uuid)
  const [failed, setFailed] = useState(0)
  const url = candidates[failed]

  if (!url) {
    return <>{account.username.slice(0, 1).toUpperCase()}</>
  }

  return <img src={url} alt="" onError={() => setFailed((value) => value + 1)} />
}
