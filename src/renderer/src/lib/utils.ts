export const api = window.zeroparadox

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
      .replace(/^Error invoking remote method '[^']+': Error: /, '')
      .replace(/^Error: /, '')
  }
  return String(error)
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

export function formatDate(input: string | number | null | undefined): string {
  if (!input) return '从未'
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return '未知'
  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatPlaytime(ms: number): string {
  if (!ms || ms < 60_000) return '不足 1 分钟'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 100) return `${hours} 小时 ${minutes % 60} 分`
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
}

export function loaderLabel(loader: { type: string; version?: string }): string {
  if (loader.type === 'fabric') return `Fabric${loader.version ? ` ${loader.version.split('.').slice(0, 2).join('.')}` : ''}`
  if (loader.type === 'forge') return `Forge${loader.version ? ` ${loader.version}` : ''}`
  if (loader.type === 'neoforge') return `NeoForge${loader.version ? ` ${loader.version}` : ''}`
  return '原版'
}

export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}
