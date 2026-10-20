import { app } from 'electron'
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

export function initPaths(): LauncherPaths {
  const override = process.env.ZP_DATA_DIR?.trim()
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim()
  if (override) {
    dataDir = path.resolve(override)
  } else if (portableDir) {
    dataDir = path.join(portableDir, 'ZeroParadoxData')
  } else {
    dataDir = path.join(app.getPath('userData'), 'data')
  }
  stateFile = path.join(dataDir, 'launcher.json')
  paths = {
    dataDir,
    instances: path.join(dataDir, 'instances'),
    assets: path.join(dataDir, 'assets'),
    libraries: path.join(dataDir, 'libraries'),
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
  return path.join(instanceDir(instanceId), 'minecraft')
}

export function instanceNativesDir(instanceId: string): string {
  return path.join(instanceDir(instanceId), 'natives')
}
