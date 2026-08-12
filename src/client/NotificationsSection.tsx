/**
 * Notifications settings section: the `settings.section` entry owned by the
 * notification plugin, in the settings-panel design language (models-page
 * vocabulary: 16/24 section title, 14/22 row names, 12/18 captions, capsule
 * controls). Master rows (browser notifications, sound, volume) plus one flat
 * hairline row per notification kind — each with an enable switch, the
 * kind's sound picker (the official Menu), a custom-audio upload, and a
 * preview button. All copy rides the standard locale seat; reads go through
 * `useStore`, business writes through the injected controller callbacks.
 */
import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type {
  PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconAgentPresetOutline16, IconCheckOutline16, IconChevronDownOutline14,
  IconQuestionOutline14, IconWarningOutline16, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { NotificationsKey } from './locales.ts'
import { SOUND_IDS } from '../settings.ts'
import type {
  NotificationType, NotificationTypeSettings, SoundId,
} from '../settings.ts'
import type { createNotificationsStore } from './settings-store.ts'
import css from './NotificationsSection.module.css'

/** Injected business face: preference writes, sound preview, permission and
 *  custom-audio flows. */
export interface NotificationsSectionInjected {
  /** Persist the browser-notification master switch (grants permission first). */
  setBrowserEnabled: (enabled: boolean) => Promise<void>
  /** Persist whether the current session also alerts. */
  setNotifyCurrent: (enabled: boolean) => void
  /** Persist the sound master switch. */
  setSoundEnabled: (enabled: boolean) => void
  /** Persist the master volume. */
  setVolume: (volume: number) => void
  /** Persist one per-kind preference. */
  setType: (kind: NotificationType, patch: Partial<NotificationTypeSettings>) => void
  /** Preview one sound effect (custom carries the data URL). */
  testSound: (sound: SoundId, customUrl?: string) => void
  /** Request browser notification permission (user gesture). */
  requestPermission: () => Promise<void>
  /** Show one system notification immediately, to verify the channel. */
  testBrowserNotification: () => void
  /** Store one kind's custom audio from a picked file. */
  uploadCustomSound: (kind: NotificationType, file: File) => Promise<void>
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type NotificationsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsStore<ReturnType<typeof createNotificationsStore>>
  & PropsLocale<'notifications'>
  & NotificationsSectionInjected

/** Kind row metadata: icon, copy keys. */
const KIND_ROWS: readonly {
  kind: NotificationType
  Icon: typeof IconCheckOutline16
  title: NotificationsKey
  desc: NotificationsKey
}[] = [
  { kind: 'completed', Icon: IconCheckOutline16, title: 'type.completed.title', desc: 'type.completed.desc' },
  { kind: 'failed', Icon: IconWarningOutline16, title: 'type.failed.title', desc: 'type.failed.desc' },
  { kind: 'question', Icon: IconQuestionOutline14, title: 'type.question.title', desc: 'type.question.desc' },
  { kind: 'permission', Icon: IconAgentPresetOutline16, title: 'type.permission.title', desc: 'type.permission.desc' },
]

/** Sound menu entries: the four effects, Custom, then None. */
const SOUND_OPTIONS: readonly SoundId[] = [...SOUND_IDS, 'custom', 'none']

/** Copy key for each sound id (type-safe dynamic lookup for the Menu). */
const SOUND_KEY: Record<SoundId, NotificationsKey> = {
  chime: 'sound.chime',
  fault: 'sound.fault',
  pop: 'sound.pop',
  alert: 'sound.alert',
  none: 'sound.none',
  custom: 'sound.custom',
}

/** Official switch: role=switch button with a track + thumb. */
function Switch({ on, label, onChange }: {
  on: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      className={css.switch}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => { onChange(!on) }}
    >
      <span className={css.switchTrack} data-on={on || undefined} aria-hidden="true">
        <span className={css.switchThumb} />
      </span>
    </button>
  )
}

/**
 * Official-style volume slider (no native range input): a track with a
 * filled portion and a draggable thumb, driven by pointer and keyboard.
 */
function VolumeSlider({ value, label, onChange }: {
  value: number
  label: string
  onChange: (volume: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const valueFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (rect === undefined || rect.width === 0) return value
    const ratio = (clientX - rect.left) / rect.width
    return Math.min(1, Math.max(0, ratio))
  }
  const commit = (clientX: number): void => {
    onChange(Math.round(valueFromClientX(clientX) * 20) / 20)
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    commit(event.clientX)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragging) commit(event.clientX)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = 0.05
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      onChange(Math.min(1, value + step))
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      onChange(Math.max(0, value - step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      onChange(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      onChange(1)
    }
  }
  const percent = Math.round(value * 100)
  return (
    <div className={css.volumeControl}>
      <div
        ref={trackRef}
        className={css.slider}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => { setDragging(false) }}
        onPointerCancel={() => { setDragging(false) }}
        onKeyDown={onKeyDown}
      >
        <span className={css.sliderRail} aria-hidden="true" />
        <span className={css.sliderFill} style={{ width: `${percent}%` }} aria-hidden="true" />
        <span className={css.sliderThumb} style={{ left: `${percent}%` }} aria-hidden="true" />
      </div>
      <span className={css.volumeValue}>{percent}%</span>
    </div>
  )
}

/**
 * Render the Notifications settings section.
 * @param props - composed slot props.
 */
export function NotificationsSection({
  t, useStore, setBrowserEnabled, setNotifyCurrent, setSoundEnabled, setVolume, setType, testSound,
  requestPermission, testBrowserNotification, uploadCustomSound,
}: NotificationsSectionProps) {
  const { settings, permission, customSounds } = useStore(state => state)

  // The permission state is shown honestly: denied/unsupported explain why
  // nothing can fire, and an enabled switch without permission reads as
  // paused (permission was granted earlier and later revoked, or the
  // preference predates a permission reset) with a re-grant affordance.
  const deniedLabel = permission === 'denied' ? t('permission.denied') : undefined

  return (
    <div className={css.section}>
      <h3 className={css.title}>{t('section.title')}</h3>
      <p className={css.intro}>{t('section.intro')}</p>

      <ul className={css.rows}>
        <li className={css.row}>
          <div className={css.rowText}>
            <div className={css.rowTitle}>{t('browser.title')}</div>
            <div className={css.desc}>{t('browser.desc')}</div>
          </div>
          <div className={css.rowActions}>
            {permission === 'granted' && settings.browserEnabled && (
              <button type="button" className={css.actionButton} onClick={testBrowserNotification}>
                {t('test.send')}
              </button>
            )}
            {deniedLabel !== undefined && <span className={css.permissionState}>{deniedLabel}</span>}
            {permission === 'unsupported' && <span className={css.permissionState}>{t('permission.unsupported')}</span>}
            {permission === 'default' && (
              <button type="button" className={css.actionButton} onClick={() => { void requestPermission() }}>
                {t('permission.request')}
              </button>
            )}
            {settings.browserEnabled && permission !== 'granted' && (
              <span className={css.permissionState}>{t('permission.paused')}</span>
            )}
            <Switch on={settings.browserEnabled} label={t('browser.title')} onChange={(next) => { void setBrowserEnabled(next) }} />
          </div>
        </li>

        <li className={css.row}>
          <div className={css.rowText}>
            <div className={css.rowTitle}>{t('current.title')}</div>
            <div className={css.desc}>{t('current.desc')}</div>
          </div>
          <div className={css.rowActions}>
            <Switch on={settings.notifyCurrent} label={t('current.title')} onChange={setNotifyCurrent} />
          </div>
        </li>

        <li className={css.row}>
          <div className={css.rowText}>
            <div className={css.rowTitle}>{t('sound.title')}</div>
            <div className={css.desc}>{t('sound.desc')}</div>
          </div>
          <div className={css.rowActions}>
            <Switch on={settings.soundEnabled} label={t('sound.title')} onChange={setSoundEnabled} />
          </div>
        </li>

        <li className={css.row}>
          <div className={css.rowText}>
            <div className={css.rowTitle}>{t('volume.title')}</div>
            <div className={css.desc}>{t('volume.desc')}</div>
          </div>
          <div className={css.rowActions}>
            <VolumeSlider value={settings.volume} label={t('volume.title')} onChange={setVolume} />
          </div>
        </li>

        {KIND_ROWS.map(({ kind, Icon, title, desc }) => (
          <TypeRow
            key={kind}
            kind={kind}
            Icon={Icon}
            title={t(title)}
            desc={t(desc)}
            type={settings.types[kind]}
            customUrl={customSounds[kind]}
            t={t}
            onTypeChange={(patch) => { setType(kind, patch) }}
            onTest={() => {
              const customUrl = customSounds[kind]
              if (settings.types[kind].sound === 'custom' && customUrl !== undefined && customUrl.length > 0) {
                testSound('custom', customUrl)
              } else if (settings.types[kind].sound !== 'none') {
                testSound(settings.types[kind].sound)
              }
            }}
            onUpload={(file) => { void uploadCustomSound(kind, file) }}
          />
        ))}
      </ul>
    </div>
  )
}

/** One notification-kind row: icon, copy, preview, picker (Custom included), switch. */
function TypeRow({ kind, Icon, title, desc, type, customUrl, t, onTypeChange, onTest, onUpload }: {
  kind: NotificationType
  Icon: typeof IconCheckOutline16
  title: string
  desc: string
  type: NotificationTypeSettings
  customUrl: string | undefined
  t: (key: NotificationsKey) => string
  onTypeChange: (patch: Partial<NotificationTypeSettings>) => void
  onTest: () => void
  onUpload: (file: File) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const hasCustom = customUrl !== undefined && customUrl.length > 0
  const customSelected = type.sound === 'custom'
  const audible = (customSelected && hasCustom) || (type.sound !== 'none' && type.sound !== 'custom')
  /** Selecting 自定义 with no file yet opens the picker; with a file it just
   *  selects. The uploaded file's handler persists the selection afterwards. */
  const handleSoundSelect = (sound: SoundId): void => {
    if (sound === 'custom' && !hasCustom) {
      fileRef.current?.click()
      return
    }
    onTypeChange({ sound })
  }
  return (
    <li className={css.row}>
      <Icon className={css.rowIcon} aria-hidden="true" />
      <div className={css.rowText}>
        <div className={css.rowTitle}>{title}</div>
        <div className={css.desc}>{desc}</div>
      </div>
      <div className={css.rowActions}>
        {customSelected && hasCustom && (
          <button type="button" className={css.actionButton} onClick={() => { fileRef.current?.click() }}>
            {t('custom.replace')}
          </button>
        )}
        {audible && (
          <button type="button" className={css.actionButton} onClick={onTest}>
            {t('test.play')}
          </button>
        )}
        <SoundMenu value={type.sound} t={t} onSelect={handleSoundSelect} />
        <Switch on={type.enabled} label={title} onChange={(next) => { onTypeChange({ enabled: next }) }} />
      </div>
      <input
        ref={fileRef}
        className={css.fileInput}
        type="file"
        accept="audio/*"
        aria-label={t('sound.custom')}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file !== undefined) onUpload(file)
          event.currentTarget.value = ''
        }}
      />
    </li>
  )
}

/** One kind's sound picker (the official Menu). */
function SoundMenu({ value, onSelect, t }: {
  value: SoundId
  onSelect: (sound: SoundId) => void
  t: (key: NotificationsKey) => string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={SOUND_OPTIONS.map(sound => ({
        id: sound,
        label: t(SOUND_KEY[sound]),
      }))}
      selectedId={value}
      onSelect={(id) => {
        setOpen(false)
        onSelect(id as SoundId)
      }}
      align="end"
      portal
      anchor={(
        <button
          type="button"
          className={css.selector}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('sound.title')}
          onClick={() => { setOpen(value => !value) }}
        >
          {t(SOUND_KEY[value])}
          <IconChevronDownOutline14 className={css.chevron} />
        </button>
      )}
    />
  )
}
