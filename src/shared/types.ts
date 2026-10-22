export type LoaderType = 'vanilla' | 'fabric' | 'forge' | 'neoforge';

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
  /** 自定义游戏目录；为空时使用数据目录下的 instances/<id>/minecraft。 */
  gameDir?: string | null;
  jvmArgs: string;
  gameArgs: string;
  resolution: Resolution;
}

export type AccountType = 'offline' | 'microsoft' | 'yggdrasil';

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
  /** 第三方登录（Yggdrasil）的 API 根地址。 */
  server?: string;
  clientToken?: string;
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
  /** 手动添加的 Java 路径（会出现在 Java 列表里）。 */
  extraJavaPaths: string[];
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
  source: 'local' | 'downloaded' | 'custom';
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

export interface ForgeLoader {
  version: string;
  recommended: boolean;
  latest: boolean;
}

export type ProgressKind =
  | 'preparing'
  | 'version'
  | 'fabric'
  | 'forge'
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

export interface ExistingFolderInfo {
  kind: 'prism' | 'minecraft' | 'unknown';
  gameDir: string;
  name: string;
  gameVersion?: string;
  loaderType?: 'vanilla' | 'fabric' | 'forge' | 'neoforge';
  loaderVersion?: string;
  /** 当前启动器不支持的加载器。 */
  unsupported?: string;
}

export interface ContentImportResult {
  imported: string[];
  skipped: Array<{ file: string; reason: string }>;
}

export type PackKind = 'mrpack' | 'curseforge' | 'prism' | 'generic';

export interface PackInspectResult {
  kind: PackKind;
  name?: string;
  summary?: string;
  gameVersion?: string;
  loaderType?: 'vanilla' | 'fabric' | 'forge' | 'neoforge';
  loaderVersion?: string;
  /** CurseForge 包需要在线下载的模组数量（本启动器暂不自动下载）。 */
  missingFiles?: number;
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
  files: {
    /** 把拖进窗口的 File 换成磁盘路径（File 的系统路径只能在 preload 里读取）。 */
    pathForFile: (file: unknown) => string;
  };
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
    /** 更改启动器数据目录；move 表示把现有数据搬过去。重启后生效。 */
    setDataDir: (dir: string, mode: 'move' | 'switch') => Promise<string>;
    /** 复用其他启动器的 assets/libraries 目录（null 表示恢复默认）。重启后生效。 */
    setResourceDir: (dir: string | null) => Promise<string | null>;
    getResourceDir: () => Promise<string | null>;
  };
  /** 重启启动器（数据目录变更后使用）。 */
  relaunch: () => Promise<void>;
  versions: {
    list: (force?: boolean) => Promise<VersionManifestResult>;
  };
  forge: {
    versions: (gameVersion: string) => Promise<ForgeLoader[]>;
  };
  neoforge: {
    versions: (gameVersion: string) => Promise<ForgeLoader[]>;
  };
  instances: {
    create: (input: {
      name: string;
      gameVersion: string;
      loaderType: 'vanilla' | 'fabric' | 'forge' | 'neoforge';
      forgeVersion?: string;
      neoforgeVersion?: string;
      icon?: string;
      color?: string;
      memoryMb?: number | null;
      notes?: string;
    }) => Promise<Instance>;
    update: (id: string, patch: Partial<Instance>) => Promise<Instance>;
    /** 更改实例的游戏目录（null 表示恢复默认位置），会移动已有文件。 */
    setGameDir: (id: string, dir: string | null) => Promise<Instance>;
    /** 识别一个已有实例/游戏目录。 */
    inspectFolder: (dir: string) => Promise<ExistingFolderInfo>;
    /** 扫描目录下的所有实例（versions/ 多版本、实例根目录）。 */
    scanFolder: (dir: string) => Promise<ExistingFolderInfo[]>;
    /** 批量添加已有目录，返回成功与失败明细。 */
    addExistingMany: (
      dirs: string[]
    ) => Promise<{ added: Instance[]; failed: Array<{ dir: string; error: string }> }>;
    /** 把已有目录挂成实例（不复制文件）。 */
    addExisting: (
      dir: string,
      override?: {
        name?: string;
        gameVersion?: string;
        loaderType?: 'vanilla' | 'fabric' | 'forge' | 'neoforge';
        loaderVersion?: string;
      }
    ) => Promise<Instance>;
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
    yggdrasilLogin: (server: string, username: string, password: string) => Promise<Account>;
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
    /** 只下载某个版本的主文件到指定目录，返回保存路径。 */
    downloadFile: (versionId: string, targetDir: string) => Promise<string>;
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
    import: (instanceId: string, kind: ContentKind, paths: string[]) => Promise<ContentImportResult>;
  };
  worlds: {
    list: (instanceId: string) => Promise<WorldEntry[]>;
  };
  dialog: {
    pickJava: () => Promise<string | null>;
    pickDirectory: () => Promise<string | null>;
    pickModpack: () => Promise<string | null>;
  };
  modpacks: {
    /** 识别 zip 整合包的类型与版本信息。 */
    inspect: (path: string) => Promise<PackInspectResult>;
    /** 按整合包信息创建实例（不写文件）。 */
    createFromPack: (path: string) => Promise<Instance>;
    /** 把整合包内容写入实例，带进度事件。 */
    applyPack: (instanceId: string, path: string) => Promise<void>;
    /** 把 zip 整合包的文件铺进已有实例。 */
    applyZip: (instanceId: string, path: string) => Promise<void>;
  };
  shell: {
    openPath: (target: string) => Promise<string>;
    showItem: (target: string) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    openInstanceFolder: (id: string) => Promise<void>;
  };
}

