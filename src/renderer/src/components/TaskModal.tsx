import { X } from 'lucide-react'
import type { ProgressEvent } from '../../../shared/types'
import { cn, formatBytes } from '../lib/utils'
import type { TaskState } from '../types'

interface TaskModalProps {
  task: TaskState
  progress: ProgressEvent | null
  logs: string[]
  onClose: () => void
  onCancel: () => void
}

export default function TaskModal({ task, progress, logs, onClose, onCancel }: TaskModalProps): React.JSX.Element {
  const done = Boolean(progress?.done)
  const failed = Boolean(progress?.error)
  const percent = Math.max(0, Math.min(100, progress?.percent || 0))
  const install = task.mode === 'install'
  const title = failed
    ? install
      ? '安装失败'
      : '启动失败'
    : done
      ? install
        ? '安装完成'
        : '游戏已启动'
      : install
        ? '正在安装'
        : '正在启动'
  const visibleLogs = logs.slice(-5)

  return (
    <div className="modal-backdrop task-backdrop">
      <div className="task-panel simple-task">
        <div className="simple-task-head">
          <div>
            <h2>{title}</h2>
            <p>{task.instanceName}</p>
          </div>
          {done && (
            <button className="icon-button" onClick={onClose} aria-label="关闭">
              <X size={17} />
            </button>
          )}
        </div>

        <div className="simple-task-progress">
          <div className="task-progress-row">
            <span>{progress?.phase || '准备中'}</span>
            <strong>{Math.round(percent)}%</strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${percent}%` }} className={cn('progress-fill', failed && 'failed')} />
          </div>
          <p className={cn('task-message', failed && 'error')}>{progress?.message || '正在准备…'}</p>
          {progress?.bytes !== undefined && progress.bytesTotal ? (
            <div className="task-bytes">
              <span>{formatBytes(progress.bytes)}</span>
              <span>/</span>
              <span>{formatBytes(progress.bytesTotal)}</span>
            </div>
          ) : null}
        </div>

        {visibleLogs.length > 0 && (
          <div className="task-console">
            {visibleLogs.map((line, index) => (
              <div key={`${index}-${line.slice(0, 20)}`} className="task-console-line">
                {line}
              </div>
            ))}
          </div>
        )}

        <div className="simple-task-footer">
          {!done ? (
            <>
              <span>请保持启动器开启</span>
              <button className="btn btn-ghost" onClick={onCancel}>
                取消
              </button>
            </>
          ) : (
            <button className={cn('btn', failed ? 'btn-outline' : 'btn-primary')} onClick={onClose}>
              {failed ? '关闭' : '完成'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
