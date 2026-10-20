export type LoaderType = 'vanilla' | 'fabric';

export interface LoaderInfo {
  type: LoaderType;
  version?: string;
}

export interface Resolution {
  width: number;
  height: number;
  custom: boolean;
  fullscreen: boolean;
}

export interface Instance {
  id: string;
  name: string;
  gameVersion: string;
  versionId: string;
  loader: LoaderInfo;
  icon: string;
  color: string;
  notes: string;
  createdAt: string;
  lastPlayedAt: string | null;
  installedAt: string | null;
  playtimeMs: number;
  memoryMb: number | null;
  javaPath: string | null;
  jvmArgs: string;
  gameArgs: string;
  resolution: Resolution;
}

export type AccountType = 'offline' | 'microsoft';

export interface Account {
  id: string;
  type: AccountType;
  username: string;
  uuid: string;
  avatarUrl?: string | null;
  skinModel?: 'classic' | 'slim';
}

export interface AccountRecord extends Account {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  xuid?: string;
  clientId?: string;
}

export interface Settings {
  language: 'zh-CN';
  theme: 'dark' | 'midnight';
  accent: string;
  memoryMb: number;
  autoMemory: boolean;
  javaPath: string;
  downloadSource: 'official' | 'bmclapi';
  downloadConcurrency: number;
  showSnapshots: boolean;
  keepLauncherOpen: boolean;
  minimizeOnLaunch: boolean;
  checkUpdates: boolean;
  closeAfterGameExit: boolean;
  microsoftClientId: string;
}

export interface PublicState {
  settings: Settings;
  instances: Instance[];
  accounts: Account[];
  activeAccountId: string | null;
  appVersion: string;
  dataDir: string;
  platform: string;
  isPackaged: boolean;
  totalMemoryMb: number;
  logicalCpus: number;
}

export interface JavaDetection {
  path: string;
  major: number;
  label: string;
  source: 'local' | 'downloaded';
}

export interface MicrosoftDeviceCodeInfo {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  message?: string;
}

export interface VersionSummary {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha' | string;
  releaseTime: string;
  url: string;
  sha1: string;
}

export interface VersionManifestResult {
  latest: { release: string; snapshot: string };
  versions: VersionSummary[];
  fetchedAt: number;
}

export interface FabricLoader {
  version: string;
  stable: boolean;
}

export type ProgressKind =
  | 'preparing'
  | 'version'
  | 'fabric'
  | 'libraries'
  | 'assets'
  | 'java'
  | 'natives'
  | 'launch'
  | 'done';

export interface ProgressEvent {
  jobId: string;
  instanceId: string;
  kind: ProgressKind;
  phase: string;
  message: string;
  current: number;
  total: number;
  bytes?: number;
  bytesTotal?: number;
  percent: number;
  done?: boolean;
  error?: string;
}

export interface LogEvent {
  instanceId: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  time: number;
}

export interface LaunchResult {
  pid: number;
  logPath: string;
}

export interface NewsItem {
  title: string;
  category: string;
  date: string;
  text: string;
  image: string | null;
  url: string | null;
}

export type ContentKind = 'mod' | 'resourcepack' | 'shader' | 'datapack';

export interface ModrinthSearchHit {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  iconUrl: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  versions: string[];
  projectType: string;
  dateModified: string;
}

export interface ModrinthSearchResult {
  hits: ModrinthSearchHit[];
  offset: number;
  limit: number;
  totalHits: number;
}

export interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  iconUrl: string | null;
  categories: string[];
  clientSide: string;
  serverSide: string;
  downloads: number;
  followers: number;
  sourceUrl: string | null;
  issuesUrl: string | null;
  projectType: string;
}

export interface ModrinthVersion {
  id: string;
  name: string;
  versionNumber: string;
  versionType: string;
  gameVersions: string[];
  loaders: string[];
  datePublished: string;
  downloads: number;
  dependencies: {
    versionId: string | null;
    projectId: string | null;
    dependencyType: 'required' | 'optional' | 'incompatible' | 'embedded';
  }[];
  files: {
    url: string;
    filename: string;
    primary: boolean;
    size: number;
    hashes: Record<string, string>;
  }[];
}

export interface ContentEntry {
  name: string;
  fileName: string;
  size: number;
  enabled: boolean;
  path: string;
  source: 'modrinth' | 'local';
  description?: string;
  iconUrl?: string | null;
}

export interface WorldEntry {
  name: string;
  folder: string;
  lastModified: number;
  size: number;
  icon: string | null;
}

export interface InstallSummary {
  installed: string[];
  warnings: string[];
}

export interface Bootstrap extends PublicState {}

export interface ApiError {
  message: string;
  code?: string;
}

export interface AppInfo {
  version: string;
  electron: string;
  node: string;
  chrome: string;
}

export interface WindowState {
  maximized: boolean;
}

export interface GameExitEvent {
  instanceId: string;
  code: number | null;
}

export interface LauncherApi {
  getBootstrap: () => Promise<Bootstrap>;
  getAppInfo: () => Promise<AppInfo>;
  java: {
    detect: () => Promise<JavaDetection[]>;
  };
  window: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<WindowState>;
    close: () => Promise<void>;
    isMaximized: () => Promise<WindowState>;
    onState: (callback: (state: WindowState) => void) => () => void;
  };
  settings: {
    update: (patch: Partial<Settings>) => Promise<Settings>;
  };
  versions: {
    list: (force?: boolean) => Promise<VersionManifestResult>;
  };
  instances: {
    create: (input: {
      name: string;
      gameVersion: string;
      loaderType: 'vanilla' | 'fabric';
      icon?: string;
      color?: string;
      memoryMb?: number | null;
      notes?: string;
    }) => Promise<Instance>;
    update: (id: string, patch: Partial<Instance>) => Promise<Instance>;
    delete: (id: string) => Promise<boolean>;
    duplicate: (id: string) => Promise<Instance>;
    openFolder: (id: string) => Promise<void>;
    openLogs: (id?: string) => Promise<void>;
    install: (id: string) => Promise<boolean>;
    launch: (id: string) => Promise<LaunchResult>;
    kill: (id: string) => Promise<boolean>;
    running: () => Promise<string[]>;
    logTail: (id: string, lines?: number) => Promise<string>;
    cancelJob: (id: string) => Promise<boolean>;
    onProgress: (callback: (event: ProgressEvent) => void) => () => void;
    onLog: (callback: (event: LogEvent) => void) => () => void;
    onGameExit: (callback: (event: GameExitEvent) => void) => () => void;
  };
  accounts: {
    addOffline: (username: string) => Promise<Account>;
    remove: (id: string) => Promise<boolean>;
    setActive: (id: string) => Promise<boolean>;
    microsoftStart: () => Promise<MicrosoftDeviceCodeInfo>;
    microsoftWait: (flowId: string) => Promise<Account>;
    microsoftCancel: (flowId: string) => Promise<boolean>;
  };
  news: {
    list: () => Promise<NewsItem[]>;
  };
  modrinth: {
    search: (input: {
      query: string;
      kind: ContentKind;
      gameVersion?: string;
      loader?: string;
      offset?: number;
      limit?: number;
      sort?: 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';
    }) => Promise<ModrinthSearchResult>;
    project: (id: string) => Promise<ModrinthProject>;
    versions: (
      projectId: string,
      gameVersion: string,
      loader: string,
      kind: ContentKind
    ) => Promise<ModrinthVersion[]>;
    install: (
      instanceId: string,
      projectId: string,
      kind: ContentKind,
      versionId?: string
    ) => Promise<InstallSummary>;
  };
  content: {
    list: (instanceId: string, kind: ContentKind) => Promise<ContentEntry[]>;
    toggle: (instanceId: string, kind: ContentKind, fileName: string) => Promise<void>;
    delete: (instanceId: string, kind: ContentKind, fileName: string) => Promise<void>;
  };
  worlds: {
    list: (instanceId: string) => Promise<WorldEntry[]>;
  };
  dialog: {
    pickJava: () => Promise<string | null>;
    pickDirectory: () => Promise<string | null>;
  };
  shell: {
    openPath: (target: string) => Promise<string>;
    showItem: (target: string) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    openInstanceFolder: (id: string) => Promise<void>;
  };
}

