import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'

let dataDir = ''
let stateFile = ''

export interface LauncherPaths {
  dataDir: string
  instances: string
  assets: string
  libraries: string
  versions: string
  runtimes: string
  logs: string
  stateFile: string
  cache: string
}

let paths: LauncherPaths | null = null

/** 记住用户选择的数据目录（放在 userData 下，搬走数据目录也不会丢）。 */
function configFile(): string {
  return path.join(app.getPath('appData'), 'ZeroParadox', 'launcher-config.json')
}

interface LauncherConfig {
  dataDir?: string | null
  resourceDir?: string | null
}

function readConfig(): LauncherConfig {
  try {
    return JSON.parse(readFileSync(configFile(), 'utf8')) as LauncherConfig
  } catch {
    return {}
  }
}

function writeConfig(patch: LauncherConfig): void {
  const file = configFile()
  mkdirSync(path.dirname(file), { recursive: true })
  const next = { ...readConfig(), ...patch }
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

export function readConfiguredDataDir(): string | null {
  const raw = readConfig()
  return raw.dataDir ? path.resolve(raw.dataDir) : null
}

export function writeConfiguredDataDir(dir: string | null): void {
  writeConfig({ dataDir: dir })
}

/** 复用的资源目录（其他启动器的 .minecraft，里面有 assets/ 与 libraries/）。 */
export function readConfiguredResourceDir(): string | null {
  const raw = readConfig()
  return raw.resourceDir ? path.resolve(raw.resourceDir) : null
}

export function writeConfiguredResourceDir(dir: string | null): void {
  writeConfig({ resourceDir: dir })
}

export function initPaths(): LauncherPaths {
  const override = process.env.ZP_DATA_DIR?.trim()
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim()
  const configured = readConfiguredDataDir()
  if (override) {
    dataDir = path.resolve(override)
  } else if (configured) {
    dataDir = configured
  } else if (portableDir) {
    dataDir = path.join(portableDir, 'ZeroParadoxData')
  } else {
    dataDir = path.join(app.getPath('userData'), 'data')
  }
  const resourceDir = readConfiguredResourceDir()
  stateFile = path.join(dataDir, 'launcher.json')
  paths = {
    dataDir,
    instances: path.join(dataDir, 'instances'),
    assets: resourceDir ? path.join(resourceDir, 'assets') : path.join(dataDir, 'assets'),
    libraries: resourceDir ? path.join(resourceDir, 'libraries') : path.join(dataDir, 'libraries'),
    versions: path.join(dataDir, 'versions'),
    runtimes: path.join(dataDir, 'runtimes'),
    logs: path.join(dataDir, 'logs'),
    stateFile,
    cache: path.join(dataDir, 'cache')
  }
  return paths
}

export function getPaths(): LauncherPaths {
  if (!paths) throw new Error('Launcher paths have not been initialized')
  return paths
}

export function instanceDir(instanceId: string): string {
  return path.join(getPaths().instances, instanceId)
}

export function gameDir(instanceId: string): string {
  const custom = customGameDir?.(instanceId)
  if (custom) return path.resolve(custom)
  return path.join(instanceDir(instanceId), 'minecraft')
}

let customGameDir: ((instanceId: string) => string | null | undefined) | null = null

/** 由 store 注册：实例可以覆盖默认的 minecraft 目录。 */
export function setCustomGameDirResolver(
  resolver: (instanceId: string) => string | null | undefined
): void {
  customGameDir = resolver
}

export function instanceNativesDir(instanceId: string): string {
  return path.join(instanceDir(instanceId), 'natives')
}
