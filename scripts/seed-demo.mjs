// Seed a small, offline demo state for UI screenshots and manual testing.
// Usage: node scripts/seed-demo.mjs <data-dir>
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { createHash, randomUUID } from 'crypto'

const dataDir = process.argv[2]
if (!dataDir) {
  console.error('usage: node scripts/seed-demo.mjs <data-dir>')
  process.exit(1)
}

function offlineUuid(name) {
  const hash = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const now = new Date()
const iso = (offsetDays = 0) => new Date(now.getTime() - offsetDays * 86400000).toISOString()
const accountId = 'acc_demo_steve'
const instances = [
  {
    id: 'inst_demo_meadow',
    name: '暮色群岛',
    gameVersion: '26.3',
    versionId: 'fabric-loader-0.19.5-26.3',
    loader: { type: 'fabric', version: '0.19.5' },
    icon: '◆',
    color: '#ff4d4f',
    notes: '主世界出生点在海边。已经建好刷怪塔，下次记得把下界交通修完。\n服务器：mc.example.net:25565',
    createdAt: iso(40),
    lastPlayedAt: iso(0.1),
    installedAt: iso(33),
    playtimeMs: 31 * 3600 * 1000 + 22 * 60 * 1000,
    memoryMb: 6144,
    javaPath: null,
    jvmArgs: '-XX:+UseG1GC',
    gameArgs: '',
    resolution: { width: 1920, height: 1080, custom: false, fullscreen: false }
  },
  {
    id: 'inst_demo_redstone',
    name: '红石工坊',
    gameVersion: '1.21.4',
    versionId: '1.21.4',
    loader: { type: 'vanilla' },
    icon: '▲',
    color: '#e5484d',
    notes: '原版测试世界，用来验证红石机器和刷铁机。',
    createdAt: iso(20),
    lastPlayedAt: iso(4),
    installedAt: iso(12),
    playtimeMs: 9 * 3600 * 1000,
    memoryMb: 4096,
    javaPath: null,
    jvmArgs: '',
    gameArgs: '',
    resolution: { width: 1600, height: 900, custom: true, fullscreen: false }
  },
  {
    id: 'inst_demo_ocean',
    name: '深海观测站',
    gameVersion: '26.2',
    versionId: 'fabric-loader-0.19.5-26.2',
    loader: { type: 'fabric', version: '0.19.5' },
    icon: '◇',
    color: '#ff2e63',
    notes: '海底玻璃穹顶计划，已完成外壳。缺少海晶灯。',
    createdAt: iso(8),
    lastPlayedAt: iso(2),
    installedAt: null,
    playtimeMs: 2 * 3600 * 1000,
    memoryMb: null,
    javaPath: null,
    jvmArgs: '',
    gameArgs: '',
    resolution: { width: 1280, height: 720, custom: false, fullscreen: false }
  }
]

const state = {
  version: 1,
  settings: {
    language: 'zh-CN',
    theme: 'dark',
    accent: '#ff4d4f',
    memoryMb: 4096,
    autoMemory: true,
    javaPath: '',
    downloadSource: 'official',
    downloadConcurrency: 8,
    showSnapshots: false,
    keepLauncherOpen: true,
    minimizeOnLaunch: false,
    checkUpdates: true,
    closeAfterGameExit: false,
    microsoftClientId: ''
  },
  accounts: [
    {
      id: accountId,
      type: 'offline',
      username: 'Steve_Block',
      uuid: offlineUuid('Steve_Block'),
      avatarUrl: null,
      skinModel: 'classic'
    }
  ],
  activeAccountId: accountId,
  instances
}

await mkdir(dataDir, { recursive: true })
await writeFile(path.join(dataDir, 'launcher.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
for (const instance of instances) {
  await mkdir(path.join(dataDir, 'instances', instance.id, 'minecraft', 'mods'), { recursive: true })
  await mkdir(path.join(dataDir, 'instances', instance.id, 'minecraft', 'saves'), { recursive: true })
}
console.log(`seeded ${dataDir}`)
