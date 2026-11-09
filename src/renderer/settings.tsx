import { useState } from 'react'
import { listFonts, supportsVolumeKeys } from './platform'
import { THEMES, type Settings } from './model'

interface SettingsProps {
  value: Settings
  change(next: Settings): void
  volumeAvailable: boolean
}

/** 阅读外观与操作设置。 */
export function ReaderSettings({ value, change, volumeAvailable }: SettingsProps) {
  const [localFonts, setLocalFonts] = useState<string[]>([])
  const [fontMessage, setFontMessage] = useState('')
  const fonts = [['serif', '系统衬线'], ['sans-serif', 'Sans-serif'], ['monospace', 'Monospace'], ['Lato', 'Lato'], ['阿里巴巴普惠体', '阿里巴巴普惠体'], ['阿里妈妈数黑体', '阿里妈妈数黑体']]
  const update = <K extends keyof Settings>(key: K, next: Settings[K]) => change({ ...value, [key]: next })
  async function loadFonts() {
    try {
      const result = await listFonts()
      setLocalFonts([...new Set(result)].filter(name => !fonts.some(([id]) => id === name)).sort())
      setFontMessage(result.length ? '已载入本机字体' : '系统暂未提供本机字体列表')
    } catch {
      setFontMessage('无法读取本机字体列表')
    }
  }

  return <div className="settings-fields">
    <h3>外观</h3>
    <div className="theme-options">{Object.entries(THEMES).map(([id, theme]) => <button key={id} style={{ background: theme.bg, color: theme.fg }}
      aria-pressed={value.theme === id && !value.background} onClick={() => change({ ...value, theme: id as Settings['theme'], background: '' })}>{theme.name}</button>)}</div>
    <label>自定义背景色 <input type="color" value={value.background || THEMES[value.theme].bg} onChange={event => update('background', event.target.value)} /></label>
    <label>阅读区亮度 <output>{value.brightness}%</output><input type="range" min="25" max="100" value={value.brightness} onChange={event => update('brightness', +event.target.value)} /></label>
    <label>字号 <output>{value.size}px</output><input type="range" min="12" max="48" value={value.size} onChange={event => update('size', +event.target.value)} /></label>
    <label>行间距 <output>{value.spacing.toFixed(1)}</output><input type="range" min="1" max="3" step="0.1" value={value.spacing} onChange={event => update('spacing', +event.target.value)} /></label>
    <label>字体 <select value={value.font} onChange={event => update('font', event.target.value)}>
      {fonts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      {!fonts.some(([id]) => id === value.font) && !localFonts.includes(value.font) && <option>{value.font}</option>}
      {localFonts.map(name => <option key={name}>{name}</option>)}
    </select></label>
    <button onClick={() => void loadFonts()}>载入本机字体</button>
    {fontMessage && <small role="status">{fontMessage}</small>}
    <h3>阅读操作</h3>
    <label>阅读模式 <select value={value.mode} onChange={event => update('mode', event.target.value as Settings['mode'])}><option value="page">翻页</option><option value="scroll">滚动</option></select></label>
    {supportsVolumeKeys && volumeAvailable && <label><input type="checkbox" checked={value.volume} disabled={value.mode !== 'page'} onChange={event => update('volume', event.target.checked)} /> 音量键翻页</label>}
    <label><input type="checkbox" checked={value.tap} disabled={value.mode !== 'page'} onChange={event => update('tap', event.target.checked)} /> 轻点页面左右翻页</label>
    <label>屏幕关闭时间 <select value={value.idle} onChange={event => update('idle', +event.target.value)}>
      <option value="0">永不</option>{[5, 10, 30].map(minutes => <option value={minutes} key={minutes}>{minutes} 分钟</option>)}
    </select></label>
    <h3>页面信息</h3>
    {([['chapter', '显示章节名'], ['battery', '显示电量'], ['clock', '显示时间']] as const).map(([key, label]) =>
      <label key={key}><input type="checkbox" checked={value[key]} onChange={event => update(key, event.target.checked)} /> {label}</label>)}
  </div>
}
