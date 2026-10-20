import type { NewsItem } from '../shared/types'
import { fetchJson } from './http'

interface NewsEntry {
  title: string
  category: string
  date: string
  text: string
  playPageImage?: { url?: string }
  newsPageImage?: { url?: string }
  readMoreLink?: string
  newsType?: string[]
}

interface NewsResponse {
  entries: NewsEntry[]
}

let cache: { at: number; items: NewsItem[] } | null = null

export async function getNews(): Promise<NewsItem[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.items
  try {
    const data = await fetchJson<NewsResponse>('https://launchercontent.mojang.com/v2/news.json', { retries: 2 })
    const items = data.entries
      .filter((entry) => entry.title && entry.text && !entry.newsType?.includes('Bedrock'))
      .slice(0, 8)
      .map((entry) => {
        const imagePath = entry.newsPageImage?.url || entry.playPageImage?.url || ''
        return {
          title: entry.title,
          category: entry.category || 'Minecraft',
          date: entry.date,
          text: entry.text.trim(),
          image: imagePath ? `https://launchercontent.mojang.com${imagePath}` : null,
          url: entry.readMoreLink || null
        }
      })
    cache = { at: Date.now(), items }
    return items
  } catch {
    return cache?.items || fallbackNews()
  }
}

function fallbackNews(): NewsItem[] {
  return [
    {
      title: '欢迎来到零式悖论',
      category: '启动器',
      date: new Date().toISOString().slice(0, 10),
      text: '选择一个游戏版本，创建你的第一个实例。启动器会自动补全游戏文件、资源与 Java 运行时。',
      image: null,
      url: null
    }
  ]
}
