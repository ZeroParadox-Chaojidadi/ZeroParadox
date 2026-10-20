import type { LauncherApi } from '../../shared/types'

declare global {
  interface Window {
    zeroparadox: LauncherApi
  }
}

export {}
