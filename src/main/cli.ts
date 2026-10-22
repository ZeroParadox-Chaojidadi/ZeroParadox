/**
 * Developer integration CLI.
 *
 * Run with Electron (not Node):
 *   electron out/main/cli.js install
 *   electron out/main/cli.js launch
 *
 * Environment:
 *   ZP_DATA_DIR       isolated data root (required)
 *   ZP_CLI_VERSION    Minecraft version (default 26.3)
 *   ZP_CLI_LOADER     vanilla | fabric | forge (default fabric)
 *   ZP_CLI_FORGE_VERSION  required when loader=forge
 *   ZP_CLI_INSTANCE   reuse an existing instance id
 *   ZP_CLI_WAIT       seconds to wait for a launch (default 20)
 */
import { app } from 'electron'
import path from 'path'
import { initPaths, gameDir, instanceDir } from './paths'
import { store } from './store'
import { moveDir } from './util'
import { getVersionManifest, findVersion, installFabricProfile } from './mojang'
import { installInstance } from './installer'
import { launchInstance } from './launcher'
import { listContent, searchProjects, installProject } from './modrinth'
import {
  completeMicrosoftLogin,
  getConfiguredClientId,
  pollForMicrosoftToken,
  requestDeviceCode
} from './auth'
import { installForge } from './forge'
import { getNeoForgeLoaders, installNeoForge } from './neoforge'
import { ensureAuthlibInjector } from './yggdrasil'
import { addExistingInstance, inspectExistingFolder, scanExistingFolders } from './existing'
import {
  applyModpackFiles,
  applyZipToInstance,
  createInstanceFromMeta,
  createInstanceFromPack,
  inspectPack,
  loadModpack,
  openPackZip
} from './modpack'
import { newId, offlineUuid } from './util'

async function main(): Promise<void> {
  const mode = process.argv[2] || 'install'
  const version = process.env.ZP_CLI_VERSION || '26.3'
  const loaderType = (process.env.ZP_CLI_LOADER || 'fabric') as 'vanilla' | 'fabric' | 'forge'
  initPaths()
  await store.load()

  if (mode === 'forge-install') {
    const gameVersion = process.env.ZP_CLI_VERSION || '1.20.1'
    const forgeVersion = process.env.ZP_CLI_FORGE_VERSION?.trim()
    if (!forgeVersion) throw new Error('Set ZP_CLI_FORGE_VERSION')
    const result = await installForge(gameVersion, forgeVersion, {
      source: (process.env.ZP_CLI_SOURCE as 'official' | 'bmclapi') || 'official',
      onProgress: (update) => console.log(`[forge ${Math.round(update.percent)}%] ${update.message}`)
    })
    console.log(`[forge] version=${result.versionId} java=${result.javaPath}`)
    setTimeout(() => app.quit(), 300)
    return
  }

  if (mode === 'modpack-import') {
    const packPath = process.env.ZP_CLI_PACK?.trim()
    if (!packPath) throw new Error('Set ZP_CLI_PACK to a .mrpack file')
    const { zip, index } = await loadModpack(packPath)
    const instance = await createInstanceFromPack(packPath, index)
    await applyModpackFiles(instance, zip, index, {
      concurrency: 4,
      onProgress: (update) =>
        console.log(`[modpack ${update.percent}%] ${update.phase}: ${update.message}`)
    })
    console.log(`[modpack] instance=${instance.id} name=${instance.name} version=${instance.gameVersion}`)
    setTimeout(() => app.quit(), 300)
    return
  }

  if (mode === 'authlib-check') {
    const jar = await ensureAuthlibInjector()
    const stat = await (await import('fs')).promises.stat(jar)
    console.log(`[authlib] ${jar} (${Math.round(stat.size / 1024)} KB)`)
    setTimeout(() => app.quit(), 300)
    return
  }

  if (mode === 'neoforge-install') {
    const version = process.env.ZP_CLI_VERSION || '1.20.1'
    const neo = process.env.ZP_CLI_NEOFORGE_VERSION?.trim()
    if (!neo) throw new Error('Set ZP_CLI_NEOFORGE_VERSION')
    const result = await installNeoForge(version, neo, {
      source: 'official',
      onProgress: (update) => console.log(`[neo ${Math.round(update.percent)}%] ${update.message}`)
    })
    console.log(`[neo] versionId=${result.versionId} java=${result.javaPath}`)
    setTimeout(() => app.quit(), 300)
    return
  }

  if (mode === 'neoforge-list') {
    const version = process.env.ZP_CLI_VERSION || '1.20.1'
    const list = await getNeoForgeLoaders(version)
    console.log(`[neo] ${version}: ${list.slice(0, 5).map((item) => item.version).join(', ')} ... total=${list.length}`)
    setTimeout(() => app.quit(), 300)
    return
  }

  if (mode === 'scan-folder') {
    const dir = process.env.ZP_CLI_DIR?.trim()
    if (!dir) throw new Error('Set ZP_CLI_DIR')
    const list = await scanExistingFolders(dir)
    for (const item of list) {
      console.log(
        `[scan] ${item.name} | ${item.gameVersion || '?'} | ${item.unsupported ? 'UNSUPPORTED:' + item.unsupported : (item.loaderType || '?') + ' ' + (item.loaderVersion || '')} | ${item.gameDir}`
      )
    }
    setTimeout(() => app.quit(), 300)
    return
  }

  if (mode === 'add-folder') {
    const dir = process.env.ZP_CLI_DIR?.trim()
    if (!dir) throw new Error('Set ZP_CLI_DIR')
    const info = await inspectExistingFolder(dir)
    console.log(`[folder] meta ${JSON.stringify(info)}`)
    const instance = await addExistingInstance(dir)
    console.log(`[folder] instance=${instance.id} name=${instance.name} gameDir=${instance.gameDir}`)
    setTimeout(() => app.quit(), 300)
    return
  }

  if (mode === 'gamedir') {
    const instanceId = process.env.ZP_CLI_INSTANCE?.trim()
    if (!instanceId) throw new Error('Set ZP_CLI_INSTANCE')
    const instance = store.requireInstance(instanceId)
    const from = gameDir(instance.id)
    const target = process.env.ZP_CLI_DIR?.trim()
    const to = target ? path.resolve(target) : path.join(instanceDir(instance.id), 'minecraft')
    await moveDir(from, to)
    const updated = await store.updateInstance(instance.id, { gameDir: target ? to : null })
    console.log(`[gamedir] ${from} -> ${to} gameDir=${updated.gameDir}`)
    setTimeout(() => app.quit(), 300)
    return
  }

  if (mode === 'zip-import') {
    const packPath = process.env.ZP_CLI_PACK?.trim()
    if (!packPath) throw new Error('Set ZP_CLI_PACK to a .zip pack')
    const meta = await inspectPack(packPath)
    console.log(`[zip] meta ${JSON.stringify(meta)}`)
    const zip = await openPackZip(packPath)
    const instance = await createInstanceFromMeta(packPath, meta)
    await applyZipToInstance(instance, zip, {
      onProgress: (update) => console.log(`[zip ${update.percent}%] ${update.phase}: ${update.message}`)
    })
    console.log(`[zip] instance=${instance.id} name=${instance.name}`)
    setTimeout(() => app.quit(), 300)
    return
  }

  if (mode === 'mslogin') {
    const clientId = process.env.ZP_MS_CLIENT_ID || getConfiguredClientId()
    if (!clientId) throw new Error('Set ZP_MS_CLIENT_ID or microsoftClientId first')
    const device = await requestDeviceCode(clientId)
    console.log(`[mslogin] URL ${device.verification_uri}`)
    console.log(`[mslogin] CODE ${device.user_code}`)
    console.log(`[mslogin] EXPIRES ${device.expires_in}s`)
    const token = await pollForMicrosoftToken(
      device.device_code,
      clientId,
      device.interval || 5,
      device.expires_in || 900
    )
    const record = await completeMicrosoftLogin(token, clientId)
    const existing = store
      .getAccounts()
      .find((account) => account.type === 'microsoft' && account.uuid === record.uuid)
    if (existing) {
      await store.updateAccount(existing.id, { ...record, id: existing.id })
      await store.setActiveAccount(existing.id)
    } else {
      await store.addAccount(record)
    }
    await store.updateSettings({ microsoftClientId: clientId })
    console.log(`[mslogin] SUCCESS ${record.username} ${record.uuid}`)
    setTimeout(() => app.quit(), 300)
    return
  }

  if (store.getAccounts().length === 0) {
    const username = 'TestPlayer'
    await store.addAccount({
      id: newId('acc_'),
      type: 'offline',
      username,
      uuid: offlineUuid(username),
      avatarUrl: null,
      skinModel: 'classic'
    })
  }

  let instance = process.env.ZP_CLI_INSTANCE
    ? store.getInstance(process.env.ZP_CLI_INSTANCE)
    : undefined

  if (!instance) {
    const manifest = await getVersionManifest()
    findVersion(manifest, version)
    let versionId = version
    let loader: { type: 'vanilla' | 'fabric' | 'forge'; version?: string } = { type: 'vanilla' }
    if (loaderType === 'fabric') {
      const profile = await installFabricProfile(version)
      versionId = profile.profileId
      loader = { type: 'fabric', version: profile.loaderVersion }
    } else if (loaderType === 'forge') {
      const forgeVersion = process.env.ZP_CLI_FORGE_VERSION?.trim()
      if (!forgeVersion) throw new Error('Set ZP_CLI_FORGE_VERSION for a Forge test')
      versionId = `${version}-forge-${forgeVersion}`
      loader = { type: 'forge', version: forgeVersion }
    }
    instance = await store.createInstance({
      name: `Integration ${version}`,
      gameVersion: version,
      versionId,
      loader,
      icon: '🧪',
      color: '#ff4d4f'
    })
    console.log(`[cli] created instance ${instance.id}`)
  }

  console.log(`[cli] instance=${instance.id} version=${instance.gameVersion} loader=${instance.loader.type}`)
  console.log(`[cli] game dir=${gameDir(instance.id)}`)

  if (mode === 'install' || mode === 'launch') {
    const started = Date.now()
    let lastPercent = -1
    await installInstance(instance, {
      source: (process.env.ZP_CLI_SOURCE as 'official' | 'bmclapi') || 'official',
      concurrency: Number(process.env.ZP_CLI_CONCURRENCY || 8),
      onProgress: (update) => {
        const percent = Math.floor(update.percent / 5) * 5
        if (percent !== lastPercent) {
          lastPercent = percent
          console.log(`[install ${String(percent).padStart(3)}%] ${update.phase} · ${update.message}`)
        }
      }
    })
    console.log(`[cli] install finished in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  }

  if (mode === 'launch') {
    let settled = false
    const timeout = Number(process.env.ZP_CLI_WAIT || 30) * 1000
    const result = await launchInstance(instance.id, {
      onLaunchProgress: (update) => {
        console.log(`[launch ${Math.round(update.percent)}%] ${update.message}`)
      },
      onLog: (event) => {
        console.log(`[game:${event.stream}] ${event.line}`)
        if (
          /OpenAL initialized|Sound engine started|Created: .*textures-atlas|Backend library: LWJGL/i.test(event.line)
        ) {
          settled = true
        }
      }
    })
    console.log(`[cli] pid=${result.pid} log=${result.logPath}`)
    await new Promise<void>((resolve) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (settled || Date.now() - started > timeout) {
          clearInterval(timer)
          resolve()
        }
      }, 500)
    })
    const { killInstance } = await import('./launcher')
    await killInstance(instance.id).catch(() => undefined)
    console.log(`[cli] launch ${settled ? 'verified' : 'timed out waiting for window log'}`)
    if (!settled) process.exitCode = 2
  }

  if (mode === 'modrinth') {
    const result = await searchProjects({
      query: process.env.ZP_CLI_MOD_QUERY || 'Fabric API',
      kind: 'mod',
      gameVersion: instance.gameVersion,
      loader: instance.loader.type,
      limit: 5
    })
    console.log(
      `[cli] search "${process.env.ZP_CLI_MOD_QUERY || 'Fabric API'}" → ${result.totalHits} hits`
    )
    for (const hit of result.hits) console.log(`  ${hit.title} (${hit.projectId}) by ${hit.author}`)
    const target = result.hits[0]
    if (!target) throw new Error('No Modrinth project found')
    const summary = await installProject(instance.id, target.projectId, 'mod')
    console.log(`[cli] installed: ${summary.installed.join(', ')}`)
    if (summary.warnings.length) console.warn(`[cli] warnings: ${summary.warnings.join('; ')}`)
    const content = await listContent(instance.id, 'mod')
    console.log(`[cli] mods in instance: ${content.map((entry) => entry.fileName).join(', ') || '(none)'}`)
  }

  setTimeout(() => app.quit(), 500)
}

app.whenReady().then(main).catch((error) => {
  console.error('[cli] failed:', error)
  process.exitCode = 1
  app.quit()
})
