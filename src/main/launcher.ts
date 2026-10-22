import { ChildProcess, spawn } from 'child_process'
import { createWriteStream, promises as fs } from 'fs'
import path from 'path'
import type { Instance, LaunchResult, LogEvent } from '../shared/types'
import { getPaths, gameDir, instanceDir, instanceNativesDir } from './paths'
import { mirrorUrl } from './http'
import type { ResolvedVersion } from './mojang'
import { resolveVersion } from './mojang'
import { buildClasspath, buildLaunchArguments, collectClasspath } from './version'
import { ensureDir, pathExists, sha1File } from './util'
import { installInstance, InstallProgressUpdate } from './installer'
import { ensureJavaRuntime } from './java'
import { store } from './store'
import { ensureMicrosoftSession } from './auth'
import { ensureForgeInstalled } from './forge'
import { ensureNeoForgeInstalled } from './neoforge'
import { CancelledError } from './http'

interface RunningGame {
  process: ChildProcess
  instanceId: string
  startedAt: number
  logPath: string
  logStream: ReturnType<typeof createWriteStream>
  stdoutBuffer: string
  stderrBuffer: string
  xmlBuffer: string
  inXmlEvent: boolean
}

const running = new Map<string, RunningGame>()
let logHandler: ((event: LogEvent) => void) | null = null
let exitHandler: ((instanceId: string, code: number | null) => void) | null = null

export function setLaunchCallbacks(callbacks: {
  onLog: (event: LogEvent) => void
  onExit: (instanceId: string, code: number | null) => void
}): void {
  logHandler = callbacks.onLog
  exitHandler = callbacks.onExit
}

export function runningInstanceIds(): string[] {
  return [...running.keys()]
}

export function isInstanceRunning(id: string): boolean {
  return running.has(id)
}

export function recentLogPath(id: string): string | null {
  return running.get(id)?.logPath || null
}

export interface LaunchProgress {
  kind: 'preparing' | 'java' | 'install' | 'starting'
  phase: string
  message: string
  percent: number
}

export async function launchInstance(
  instanceId: string,
  options: {
    signal?: AbortSignal
    onInstallProgress?: (update: InstallProgressUpdate) => void
    onLaunchProgress?: (update: LaunchProgress) => void
    onLog?: (event: LogEvent) => void
  } = {}
): Promise<LaunchResult> {
  if (running.has(instanceId)) throw new Error('这个实例已经在运行了')
  let instance = store.requireInstance(instanceId)
  const settings = store.getSettings()
  let account = store.getActiveAccount()
  if (!account) throw new Error('请先添加并选择一个游戏账户')
  const emit = (update: LaunchProgress): void => options.onLaunchProgress?.(update)
  const log = (line: string, stream: LogEvent['stream'] = 'system'): void => {
    options.onLog?.({ instanceId, stream, line, time: Date.now() })
  }

  if (account.type === 'microsoft') {
    emit({ kind: 'preparing', phase: '账户', message: '正在检查 Microsoft 登录状态…', percent: 1 })
    try {
      account = await ensureMicrosoftSession(account)
    } catch (error) {
      throw new Error(`Microsoft 账户验证失败：${messageOf(error)}`)
    }
    if (!account.accessToken) throw new Error('Microsoft 登录状态无效，请重新登录')
    log(`使用 Microsoft 账户 ${account.username}`)
  }

  emit({ kind: 'preparing', phase: '准备启动', message: '正在检查游戏文件…', percent: 2 })
  if (instance.loader.type === 'forge') {
    emit({ kind: 'preparing', phase: 'Forge', message: '正在检查 Forge 安装…', percent: 2 })
    try {
      instance = await ensureForgeInstalled(instance, {
        source: settings.downloadSource,
        signal: options.signal,
        settings,
        onProgress: (update) => {
          emit({
            kind: 'install',
            phase: update.phase,
            message: update.message,
            percent: Math.min(88, update.percent)
          })
        }
      })
    } catch (error) {
      if (error instanceof CancelledError) throw error
      throw new Error(`安装 Forge 失败：${messageOf(error)}`)
    }
  }
  if (instance.loader.type === 'neoforge') {
    emit({ kind: 'preparing', phase: 'NeoForge', message: '正在检查 NeoForge 安装…', percent: 2 })
    try {
      instance = await ensureNeoForgeInstalled(instance, {
        source: settings.downloadSource,
        signal: options.signal,
        settings,
        onProgress: (update) => {
          emit({
            kind: 'install',
            phase: update.phase,
            message: update.message,
            percent: Math.min(88, update.percent)
          })
        }
      })
    } catch (error) {
      if (error instanceof CancelledError) throw error
      throw new Error(`安装 NeoForge 失败：${messageOf(error)}`)
    }
  }
  let resolved: ResolvedVersion
  try {
    resolved = await resolveVersion(instance.versionId, settings.downloadSource, options.signal)
  } catch (error) {
    throw new Error(`读取版本信息失败：${messageOf(error)}`)
  }

  const installed = await isFullyInstalled(instance, resolved)
  if (!installed) {
    log('检测到游戏文件不完整，正在自动补全…')
    try {
      await installInstance(instance, {
        source: settings.downloadSource,
        concurrency: settings.downloadConcurrency,
        signal: options.signal,
        onProgress: (update) => {
          options.onInstallProgress?.(update)
          emit({
            kind: 'install',
            phase: update.phase,
            message: update.message,
            percent: Math.min(88, 3 + update.percent * 0.85)
          })
        }
      })
    } catch (error) {
      if (error instanceof CancelledError) throw error
      throw new Error(`补全游戏文件失败：${messageOf(error)}`)
    }
  } else {
    emit({ kind: 'preparing', phase: '准备启动', message: '游戏文件完整', percent: 20 })
  }

  const java = await ensureJavaRuntime(
    resolved.javaMajor,
    resolved.javaComponent,
    settings,
    options.signal,
    (progress) => {
      emit({
        kind: 'java',
        phase: 'Java 运行时',
        message: `${progress.label} · ${formatMb(progress.bytesDone)} / ${formatMb(progress.bytesTotal)}`,
        percent: 88 + 7 * (progress.bytesTotal > 0 ? progress.bytesDone / progress.bytesTotal : 0)
      })
    },
    { exact: instance.loader.type === 'forge' || instance.loader.type === 'neoforge' }
  )
  log(`使用 ${java.label}：${java.path}`)

  const classpathEntries = collectClasspath(getPaths().dataDir, resolved)
  const clientJar = path.join(getPaths().versions, resolved.baseVersionId, `${resolved.baseVersionId}.jar`)
  if (!(await pathExists(clientJar))) throw new Error('客户端核心文件缺失，请重新安装实例')
  const missing = []
  for (const entry of classpathEntries) {
    if (!(await pathExists(entry.path))) missing.push(path.basename(entry.path))
  }
  if (missing.length > 0) {
    throw new Error(`依赖库缺失（${missing.slice(0, 3).join('、')}${missing.length > 3 ? ' 等' : ''}），请重新安装实例`)
  }
  const javaPaths = [clientJar, ...classpathEntries.map((entry) => entry.path)]
  const classpath = buildClasspath(javaPaths)
  const loggingArgument = await getLoggingArgument(resolved, settings.downloadSource, options.signal)
  const nativesDir = instanceNativesDir(instance.id)
  await ensureDir(nativesDir)
  await ensureDir(path.join(nativesDir, 'java'))
  const assetIndexId = resolved.versionJson.assetIndex?.id || resolved.versionJson.assets || 'legacy'

  const memory = clampMemory(instance.memoryMb ?? settings.memoryMb)
  const args = buildLaunchArguments({
    instance,
    resolved,
    javaPath: java.launcherPath,
    username: account.username,
    uuid: account.uuid,
    accessToken: account.accessToken || '0',
    userType: account.type === 'microsoft' ? 'msa' : 'legacy',
    xuid: account.xuid,
    clientId: account.clientId,
    gameDir: gameDir(instance.id),
    assetsDir: getPaths().assets,
    nativesDir,
    classpath,
    libraryDirectory: getPaths().libraries,
    assetIndex: assetIndexId,
    loggingArgument,
    memoryMb: memory,
    extraJvmArgs: instance.jvmArgs,
    extraGameArgs: instance.gameArgs
  }).args

  await ensureDir(gameDir(instance.id))
  await applyFullscreenOption(instance)
  await ensureDir(getPaths().logs)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = path.join(getPaths().logs, `${stamp}-${instance.id}.log`)
  const logStream = createWriteStream(logPath, { flags: 'a' })
  logStream.write(`# ZeroParadox launch ${new Date().toISOString()}\n`)
  logStream.write(`# Instance: ${instance.name} (${instance.versionId})\n`)
  logStream.write(`# Java: ${java.path}\n`)
  logStream.write(`# Memory: ${memory} MB\n`)
  const printableArgs = args.map((arg, index) =>
    args[index - 1] === '--accessToken' ? '<redacted>' : arg
  )
  logStream.write(`# Command: ${printableArgs.map(quoteArg).join(' ')}\n\n`)
  log(`游戏日志：${logPath}`)

  emit({ kind: 'starting', phase: '启动游戏', message: '正在创建游戏进程…', percent: 98 })
  const childEnv = { ...process.env }
  delete childEnv.JAVA_TOOL_OPTIONS
  delete childEnv._JAVA_OPTIONS
  let child: ChildProcess
  try {
    child = spawn(java.launcherPath, args, {
      cwd: gameDir(instance.id),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv
    })
  } catch (error) {
    logStream.end()
    throw new Error(`无法启动 Java：${messageOf(error)}`)
  }
  if (!child.pid) {
    logStream.end()
    throw new Error('Java 进程创建失败')
  }

  const game: RunningGame = {
    process: child,
    instanceId,
    startedAt: Date.now(),
    logPath,
    logStream,
    stdoutBuffer: '',
    stderrBuffer: '',
    xmlBuffer: '',
    inXmlEvent: false
  }
  running.set(instanceId, game)
  const emitLine = (line: string, stream: 'stdout' | 'stderr' | 'system'): void => {
    logStream.write(`[${stream}] ${line}\n`)
    const event: LogEvent = { instanceId, stream, line, time: Date.now() }
    logHandler?.(event)
    options.onLog?.(event)
  }
  const handleData = (data: Buffer, stream: 'stdout' | 'stderr'): void => {
    const key = stream === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer'
    const text = game[key] + data.toString('utf8')
    const lines = text.split(/\r?\n/)
    game[key] = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      if (stream === 'stdout' && (game.inXmlEvent || line.includes('<log4j:Event'))) {
        game.inXmlEvent = true
        game.xmlBuffer += `${line}\n`
        if (line.includes('</log4j:Event>')) {
          const cleaned = cleanLog4jEvent(game.xmlBuffer)
          game.inXmlEvent = false
          game.xmlBuffer = ''
          if (cleaned) emitLine(cleaned, 'stdout')
        }
        continue
      }
      emitLine(line, stream)
    }
  }
  child.stdout?.on('data', (data: Buffer) => handleData(data, 'stdout'))
  child.stderr?.on('data', (data: Buffer) => handleData(data, 'stderr'))
  child.on('error', (error) => {
    emitLine(`进程错误：${error.message}`, 'system')
    logStream.write(`[error] ${error.message}\n`)
  })
  child.on('exit', (code) => {
    if (game.stdoutBuffer.trim()) emitLine(game.stdoutBuffer, 'stdout')
    if (game.stderrBuffer.trim()) emitLine(game.stderrBuffer, 'stderr')
    if (game.xmlBuffer.trim()) {
      const cleaned = cleanLog4jEvent(game.xmlBuffer)
      if (cleaned) emitLine(cleaned, 'stdout')
    }
    const elapsed = Date.now() - game.startedAt
    game.logStream.write(`\n# Process exited with code ${code} after ${Math.round(elapsed / 1000)}s\n`)
    game.logStream.end()
    running.delete(instanceId)
    void store.addPlaytime(instanceId, elapsed)
    const event: LogEvent = {
      instanceId,
      stream: 'system',
      line: `游戏已退出${code === null ? '' : `（代码 ${code}）`}`,
      time: Date.now()
    }
    logHandler?.(event)
    options.onLog?.(event)
    exitHandler?.(instanceId, code)
  })

  await store.markPlayed(instanceId)
  log(`游戏进程已启动（PID ${child.pid}）`)
  emit({ kind: 'starting', phase: '启动游戏', message: '游戏已启动', percent: 100 })
  return { pid: child.pid, logPath }
}

export async function killInstance(instanceId: string): Promise<void> {
  const game = running.get(instanceId)
  if (!game) throw new Error('该实例没有正在运行的游戏')
  if (process.platform === 'win32' && game.process.pid) {
    spawn('taskkill', ['/pid', String(game.process.pid), '/T', '/F'], { windowsHide: true })
  } else {
    game.process.kill('SIGTERM')
    setTimeout(() => {
      if (!game.process.killed) game.process.kill('SIGKILL')
    }, 3000)
  }
}

async function getLoggingArgument(
  resolved: ResolvedVersion,
  source: 'official' | 'bmclapi',
  signal?: AbortSignal
): Promise<string | undefined> {
  const logging = resolved.versionJson.logging?.client
  if (!logging) return undefined
  const logDir = path.join(getPaths().assets, 'log_configs')
  const logPath = path.join(logDir, logging.file.id)
  await ensureDir(logDir)
  const exists = await pathExists(logPath)
  if (!exists || (await sha1File(logPath)).toLowerCase() !== logging.file.sha1.toLowerCase()) {
    const { downloadFile } = await import('./http')
    await downloadFile(mirrorUrl(logging.file.url, source), logPath, {
      sha1: logging.file.sha1,
      size: logging.file.size,
      signal,
      timeoutMs: 60_000
    })
  }
  return logging.argument.includes('${path}')
    ? logging.argument.replace('${path}', logPath)
    : `${logging.argument}${logPath}`
}

async function isFullyInstalled(instance: Instance, resolved: ResolvedVersion): Promise<boolean> {
  if (!instance.installedAt) return false
  try {
    const versionFile = path.join(getPaths().versions, resolved.id, `${resolved.id}.json`)
    const clientFile = path.join(getPaths().versions, resolved.baseVersionId, `${resolved.baseVersionId}.jar`)
    if (!(await pathExists(versionFile)) || !(await pathExists(clientFile))) return false
    if (!(await pathExists(path.join(instanceDir(instance.id), 'natives')))) return false
    const indexId = resolved.versionJson.assetIndex?.id
    if (indexId) {
      return pathExists(path.join(getPaths().assets, 'indexes', `${indexId}.json`))
    }
    return true
  } catch {
    return false
  }
}

async function applyFullscreenOption(instance: Instance): Promise<void> {
  if (!instance.resolution.fullscreen) return
  const file = path.join(gameDir(instance.id), 'options.txt')
  try {
    const text = await fs.readFile(file, 'utf8')
    if (/^fullscreen:true$/m.test(text)) return
    const next = /^fullscreen:/m.test(text)
      ? text.replace(/^fullscreen:.*$/m, 'fullscreen:true')
      : `${text.replace(/\s*$/, '')}\nfullscreen:true\n`
    await fs.writeFile(file, next, 'utf8')
  } catch {
    // options.txt will be generated by the game; fullscreen can still be toggled in-game.
  }
}

function clampMemory(memory: number): number {
  return Math.max(512, Math.min(65536, Math.round(memory)))
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function quoteArg(value: string): string {
  return /[\s"]/g.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

function cleanLog4jEvent(xml: string): string {
  const level = xml.match(/<log4j:Event[^>]*\blevel="([^"]+)"/)?.[1] || 'INFO'
  const thread = xml.match(/<log4j:Event[^>]*\bthread="([^"]+)"/)?.[1] || 'main'
  const message =
    xml.match(/<log4j:Message><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Message>/)?.[1] ||
    xml.match(/<log4j:Message>([\s\S]*?)<\/log4j:Message>/)?.[1] ||
    ''
  const throwable =
    xml.match(/<log4j:Throwable><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Throwable>/)?.[1] || ''
  const text = `${message}${throwable ? `\n${throwable}` : ''}`.trim()
  if (!text) return ''
  return `[${thread}/${level}] ${text}`
}

export async function readLogTail(instanceId: string, lines = 300): Promise<string> {
  const game = running.get(instanceId)
  let logPath = game?.logPath
  if (!logPath) {
    const dir = getPaths().logs
    try {
      const files = (await fs.readdir(dir))
        .filter((file) => file.includes(instanceId) && file.endsWith('.log'))
        .sort()
      const latest = files[files.length - 1]
      if (!latest) return ''
      logPath = path.join(dir, latest)
    } catch {
      return ''
    }
  }
  try {
    const text = await fs.readFile(logPath, 'utf8')
    return text.split(/\r?\n/).slice(-lines).join('\n')
  } catch {
    return ''
  }
}
