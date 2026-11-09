import { useState } from 'react'
import { listFonts, supportsVolumeKeys } from './platform'
import { THEMES, type Settings } from './model'

interface SettingsProps {
  value: Settings
  change(next: Settings): void
  volumeAvailable: boolean
  page: 'appearance' | 'more'
  more?(): void
  paragraphSpacingAvailable?: boolean
}

/** 阅读外观与操作设置。 */
export function ReaderSettings({ value, change, volumeAvailable, page, more, paragraphSpacingAvailable }: SettingsProps) {
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

  if (page === 'appearance') return <div className="settings-fields appearance-fields">
    <div className="theme-options">{Object.entries(THEMES).map(([id, theme]) => <button key={id} style={{ background: theme.bg, color: theme.fg }}
      aria-label={theme.name} title={theme.name} aria-pressed={value.theme === id && !value.background} onClick={() => change({ ...value, theme: id as Settings['theme'], background: '' })}>{id === 'dark' ? '☾' : 'Aa'}</button>)}</div>
    <label>自定义背景色 <input type="color" value={value.background || THEMES[value.theme].bg} onChange={event => update('background', event.target.value)} /></label>
    <label>阅读区亮度 <output>{value.brightness}%</output><input type="range" min="25" max="100" value={value.brightness} onChange={event => update('brightness', +event.target.value)} /></label>
    <label>行间距 <output>{value.spacing.toFixed(1)}</output><input type="range" min="1" max="3" step="0.1" value={value.spacing} onChange={event => update('spacing', +event.target.value)} /></label>
    {paragraphSpacingAvailable && <label>段落间距 <select value={value.paragraphSpacing ?? 'original'}
      onChange={event => update('paragraphSpacing', event.target.value === 'original' ? null : Number(event.target.value))}>
      <option value="original">原书</option><option value="0">无间距</option><option value="0.5">紧凑</option>
      <option value="1">标准</option><option value="1.5">宽松</option>
    </select></label>}
    <div className="font-size-setting"><span>文字大小</span><button aria-label="减小字号" disabled={value.size <= 12} onClick={() => update('size', value.size - 1)}>A−</button>
      <output>{value.size}px</output><button aria-label="增大字号" disabled={value.size >= 48} onClick={() => update('size', value.size + 1)}>A+</button></div>
    <label>字体 <select value={value.font} onChange={event => update('font', event.target.value)}>
      {fonts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      {!fonts.some(([id]) => id === value.font) && !localFonts.includes(value.font) && <option>{value.font}</option>}
      {localFonts.map(name => <option key={name}>{name}</option>)}
    </select></label>
    <button onClick={() => void loadFonts()}>载入本机字体</button>
    {fontMessage && <small role="status">{fontMessage}</small>}
    <button className="settings-more-link" onClick={more}>更多设置 <span aria-hidden="true">›</span></button>
  </div>

  return <div className="settings-fields more-fields">
    <label>阅读模式 <select value={value.mode} onChange={event => update('mode', event.target.value as Settings['mode'])}><option value="page">翻页</option><option value="scroll">滚动</option></select></label>
    {supportsVolumeKeys && volumeAvailable && <label>音量键翻页 <input role="switch" aria-label="音量键翻页" type="checkbox" checked={value.volume} disabled={value.mode !== 'page'} onChange={event => update('volume', event.target.checked)} /></label>}
    <label>轻点页面左右翻页 <input role="switch" type="checkbox" checked={value.tap} disabled={value.mode !== 'page'} onChange={event => update('tap', event.target.checked)} /></label>
    <label>屏幕关闭时间 <select value={value.idle} onChange={event => update('idle', +event.target.value)}>
      <option value="0">永不</option>{[5, 10, 30].map(minutes => <option value={minutes} key={minutes}>{minutes} 分钟</option>)}
    </select></label>

    {([['chapter', '显示章节名'], ['battery', '显示电量'], ['clock', '显示时间']] as const).map(([key, label]) =>
      <label key={key}>{label}<input role="switch" type="checkbox" checked={value[key]} onChange={event => update(key, event.target.checked)} /></label>)}
  </div>
}
