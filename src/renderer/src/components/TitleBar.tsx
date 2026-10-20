import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { api } from '../lib/utils'
import logo from '../assets/logo.png'

export default function TitleBar({ pageName, onHome }: { pageName: string; onHome: () => void }): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void api.window.isMaximized().then((state) => setMaximized(state.maximized))
    return api.window.onState((state) => setMaximized(state.maximized))
  }, [])

  return (
    <header className="titlebar">
      <button className="titlebar-brand" onClick={onHome}>
        <img src={logo} alt="" className="brand-logo" />
        <div className="brand-text">
          <strong>零式悖论</strong>
          <span>ZEROPARADOX</span>
        </div>
      </button>
      <div className="titlebar-drag">
        <span className="titlebar-page">{pageName}</span>
      </div>
      <div className="window-controls">
        <button aria-label="最小化" onClick={() => void api.window.minimize()}>
          <Minus size={15} />
        </button>
        <button aria-label={maximized ? '还原' : '最大化'} onClick={() => void api.window.toggleMaximize()}>
          {maximized ? <Copy size={13} /> : <Square size={13} />}
        </button>
        <button className="window-close" aria-label="关闭" onClick={() => void api.window.close()}>
          <X size={16} />
        </button>
      </div>
    </header>
  )
}
