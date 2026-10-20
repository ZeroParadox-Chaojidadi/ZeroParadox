'use strict'

const { promises: fs } = require('fs')
const path = require('path')

/**
 * Rename the Electron executable and place the tiny native launcher in its
 * place. The launcher clears ELECTRON_RUN_AS_NODE and starts Electron with
 * --no-sandbox, which is required in some Windows sessions where Chromium's
 * sandbox cannot initialize.
 *
 * electron-builder's shortcut, installer and portable launchers all target
 * ZeroParadox.exe, so they automatically use the wrapper.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const appDir = context.appOutDir
  const originalExe = path.join(appDir, `${context.packager.appInfo.productFilename}.exe`)
  const actualExe = path.join(appDir, 'ZeroParadoxApp.exe')
  const launcher = path.join(__dirname, 'ZeroParadoxLauncher.exe')

  if (!(await exists(originalExe))) {
    throw new Error(`afterPack: executable not found at ${originalExe}`)
  }
  if (!(await exists(actualExe))) {
    await fs.rename(originalExe, actualExe)
  } else {
    await fs.rm(originalExe, { force: true })
  }
  await fs.copyFile(launcher, originalExe)
  console.log('  • wrapped Electron executable with ZeroParadox launcher')
}

async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}
