import path from 'path'
import type { Instance } from '../shared/types'
import type {
  ArgumentEntry,
  LibraryJson,
  ResolvedVersion,
  Rule,
  VersionJson
} from './mojang'
import { libraryArtifact, mavenPath } from './mojang'
import { architectureName, platformName } from './util'

export function rulesAllow(rules: Rule[] | undefined, features: Record<string, boolean>): boolean {
  if (!rules || rules.length === 0) return true
  let allowed = false
  const platform = platformName()
  const arch = architectureName()
  for (const rule of rules) {
    let matches = true
    if (rule.os?.name && rule.os.name !== platform) matches = false
    if (rule.os?.arch) {
      const expected = rule.os.arch
      const actual = arch === 'x64' ? 'x86_64' : arch
      if (expected === 'x86') {
        if (arch !== 'x86') matches = false
      } else if (expected !== actual) {
        matches = false
      }
    }
    if (rule.features) {
      for (const [key, value] of Object.entries(rule.features)) {
        if (Boolean(features[key]) !== Boolean(value)) matches = false
      }
    }
    if (matches) allowed = rule.action === 'allow'
  }
  return allowed
}

export function flattenArguments(
  entries: ArgumentEntry[] | undefined,
  features: Record<string, boolean>
): string[] {
  if (!entries) return []
  const out: string[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      out.push(entry)
      continue
    }
    if (!rulesAllow(entry.rules, features)) continue
    if (Array.isArray(entry.value)) out.push(...entry.value)
    else if (typeof entry.value === 'string') out.push(entry.value)
  }
  return out
}

function classifierArch(classifier: string): 'x64' | 'arm64' | 'x86' | null {
  if (/arm64|aarch64/i.test(classifier)) return 'arm64'
  if (/x86(?!_64)|i386|i686/i.test(classifier)) return 'x86'
  return 'x64'
}

export function nativeClassifier(library: LibraryJson): string | null {
  if (library.natives) {
    const platform = platformName()
    const template = library.natives[platform]
    if (!template) return null
    return template.replace('${arch}', architectureName() === 'x86' ? '32' : '64')
  }
  const parts = library.name.split(':')
  const classifier = parts[3]?.split('@')[0]
  if (classifier?.startsWith('natives-')) {
    const target = classifierArch(classifier)
    if (target !== architectureName()) return null
    return classifier
  }
  return null
}

export interface NativeArtifact {
  name: string
  path: string
  url: string
  sha1?: string
  size?: number
  exclude: string[]
}

export function nativeArtifact(library: LibraryJson): NativeArtifact | null {
  const classifier = nativeClassifier(library)
  if (!classifier) return null
  if (library.downloads?.classifiers?.[classifier]) {
    const info = library.downloads.classifiers[classifier]
    return {
      name: library.name,
      path: info.path,
      url: info.url,
      sha1: info.sha1,
      size: info.size,
      exclude: library.extract?.exclude || []
    }
  }
  if (library.downloads?.artifact && library.name.split(':')[3]?.startsWith('natives-')) {
    const info = library.downloads.artifact
    return {
      name: library.name,
      path: info.path,
      url: info.url,
      sha1: info.sha1,
      size: info.size,
      exclude: library.extract?.exclude || []
    }
  }
  return null
}

export interface ClasspathEntry {
  path: string
  url: string
  sha1?: string
  size?: number
  name: string
}

export function collectClasspath(root: string, resolved: ResolvedVersion): ClasspathEntry[] {
  const libRoot = path.join(root, 'libraries')
  const out: ClasspathEntry[] = []
  const seen = new Set<string>()
  for (const library of resolved.libraries) {
    if (!rulesAllow(library.rules, {})) continue
    const artifact = libraryArtifact(library)
    if (!artifact) continue
    if (!artifact.url) continue
    if (seen.has(artifact.path)) continue
    seen.add(artifact.path)
    out.push({
      path: path.join(libRoot, artifact.path),
      url: artifact.url,
      sha1: artifact.sha1,
      size: artifact.size,
      name: artifact.name
    })
  }
  return out
}

export function buildClasspath(entries: string[]): string {
  return entries.join(path.delimiter)
}

export interface TemplateValues {
  [key: string]: string
}

export function fillTemplate(input: string, values: TemplateValues): string {
  return input.replace(/\$\{([^}]+)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) return values[key]
    return match
  })
}

export function buildLaunchArguments(options: {
  instance: Instance
  resolved: ResolvedVersion
  javaPath: string
  username: string
  uuid: string
  accessToken: string
  userType: string
  gameDir: string
  assetsDir: string
  nativesDir: string
  classpath: string
  libraryDirectory: string
  assetIndex: string
  loggingArgument?: string
  memoryMb: number
  extraJvmArgs: string
  extraGameArgs: string
}): { args: string[]; mainClass: string } {
  const { instance, resolved } = options
  const features = {
    is_demo_user: false,
    has_custom_resolution: Boolean(instance.resolution.custom),
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false
  }
  const values: TemplateValues = {
    auth_player_name: options.username,
    version_name: resolved.id,
    game_directory: options.gameDir,
    assets_root: options.assetsDir,
    game_assets: path.join(options.assetsDir, 'virtual', 'legacy'),
    assets_index_name: options.assetIndex,
    auth_uuid: options.uuid,
    auth_access_token: options.accessToken,
    auth_session: `token:${options.accessToken}:${options.uuid}`,
    clientid: '',
    auth_xuid: '',
    user_type: options.userType,
    version_type: resolved.type,
    natives_directory: options.nativesDir,
    launcher_name: 'ZeroParadox',
    launcher_version: '1.0.0',
    classpath: options.classpath,
    classpath_separator: path.delimiter,
    library_directory: options.libraryDirectory,
    resolution_width: String(instance.resolution.width),
    resolution_height: String(instance.resolution.height)
  }
  const jvmArgs: string[] = []
  for (const raw of flattenArguments(resolved.versionJson.arguments?.jvm, features)) {
    jvmArgs.push(...splitSingleArgument(fillTemplate(raw, values)))
  }
  if (resolved.versionJson.minecraftArguments) {
    // Very old versions have no modern jvm argument list. Add the essentials.
    jvmArgs.push(
      `-Djava.library.path=${options.nativesDir}`,
      '-Dminecraft.launcher.brand=ZeroParadox',
      '-Dminecraft.launcher.version=1.0.0'
    )
  }
  if (options.loggingArgument) jvmArgs.push(options.loggingArgument)
  jvmArgs.push(`-Xms${Math.min(1024, options.memoryMb)}M`, `-Xmx${options.memoryMb}M`)
  if (options.extraJvmArgs.trim()) {
    jvmArgs.push(...splitArgs(options.extraJvmArgs))
  }
  jvmArgs.push('-cp', options.classpath)
  const mainClass = resolved.versionJson.mainClass || 'net.minecraft.client.main.Main'
  jvmArgs.push(mainClass)

  const gameArgs: string[] = []
  if (resolved.versionJson.arguments?.game) {
    for (const raw of flattenArguments(resolved.versionJson.arguments.game, features)) {
      gameArgs.push(...splitSingleArgument(fillTemplate(raw, values)))
    }
  } else if (resolved.versionJson.minecraftArguments) {
    gameArgs.push(...splitArgs(fillTemplate(resolved.versionJson.minecraftArguments, values)))
  }
  if (options.extraGameArgs.trim()) gameArgs.push(...splitArgs(options.extraGameArgs))
  return { args: [...jvmArgs, ...gameArgs], mainClass }
}

function splitSingleArgument(value: string): string[] {
  // Argument lists in version JSON are already tokenized. Only split embedded
  // legacy options such as "-DFabricMcEmu= net.minecraft.client.main.Main ".
  if (value.startsWith('-DFabricMcEmu= net.minecraft.client.main.Main')) {
    return ['-DFabricMcEmu=net.minecraft.client.main.Main']
  }
  return [value]
}

export function splitArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escape = false
  for (const char of input) {
    if (escape) {
      current += char
      escape = false
      continue
    }
    if (char === '\\' && quote) {
      escape = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) args.push(current)
  return args
}

export function libraryLogName(library: LibraryJson): string {
  try {
    return mavenPath(library.name)
  } catch {
    return library.name
  }
}

export function hasModernArguments(version: VersionJson): boolean {
  return Boolean(version.arguments?.jvm?.length)
}
