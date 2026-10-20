export type View = 'library' | 'browse' | 'settings'

export type InstanceTab = 'overview' | 'mods' | 'resourcepacks' | 'shaders' | 'worlds' | 'logs' | 'settings'

export interface ToastMessage {
  id: number
  type: 'success' | 'error' | 'info'
  title: string
  detail?: string
}

export interface TaskState {
  instanceId: string
  instanceName: string
  mode: 'install' | 'launch'
  startedAt: number
}
