// @vitest-environment jsdom
/**
 * Notifications settings section: rendering, switches, sound picker, volume,
 * and the permission flow. ui-primitives resolves to the local stub through
 * the vitest alias (the plugin repo has no harness packages installed).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NotificationsSection, type NotificationsSectionProps } from '../src/client/NotificationsSection.tsx'
import { zh } from '../src/client/locales.ts'
import { DEFAULT_NOTIFICATION_SETTINGS } from '../src/settings.ts'
import type { NotificationsState } from '../src/client/settings-store.ts'

afterEach(() => { cleanup() })

const t = (key: string): string => (zh as Record<string, string>)[key] ?? String(key)

function stateOf(overrides: Partial<NotificationsState> = {}): NotificationsState {
  return {
    status: 'ready',
    writable: true,
    settings: structuredClone(DEFAULT_NOTIFICATION_SETTINGS),
    permission: 'default',
    customSounds: {},
    ...overrides,
  }
}

function renderSection(state: NotificationsState, callbacks: Partial<NotificationsSectionProps> = {}) {
  const props = {
    t: t as unknown as NotificationsSectionProps['t'],
    useStore: (() => state) as unknown as NotificationsSectionProps['useStore'],
    setBrowserEnabled: vi.fn(async () => {}),
    setNotifyCurrent: vi.fn(),
    setSoundEnabled: vi.fn(),
    setVolume: vi.fn(),
    setType: vi.fn(),
    testSound: vi.fn(),
    requestPermission: vi.fn(async () => {}),
    testBrowserNotification: vi.fn(),
    uploadCustomSound: vi.fn(async () => {}),
    close: vi.fn(),
    ...callbacks,
  } as unknown as NotificationsSectionProps
  render(<NotificationsSection {...props} />)
  return props as unknown as {
    setBrowserEnabled: ReturnType<typeof vi.fn>
    setNotifyCurrent: ReturnType<typeof vi.fn>
    setSoundEnabled: ReturnType<typeof vi.fn>
    setVolume: ReturnType<typeof vi.fn>
    setType: ReturnType<typeof vi.fn>
    testSound: ReturnType<typeof vi.fn>
    requestPermission: ReturnType<typeof vi.fn>
    testBrowserNotification: ReturnType<typeof vi.fn>
    uploadCustomSound: ReturnType<typeof vi.fn>
  }
}

describe('NotificationsSection', () => {
  it('renders the section title, intro, and the four kind rows', () => {
    renderSection(stateOf())
    expect(screen.getByText(zh['section.title'])).toBeTruthy()
    expect(screen.getByText(zh['section.intro'])).toBeTruthy()
    expect(screen.getByText(zh['type.completed.title'])).toBeTruthy()
    expect(screen.getByText(zh['type.failed.title'])).toBeTruthy()
    expect(screen.getByText(zh['type.question.title'])).toBeTruthy()
    expect(screen.getByText(zh['type.permission.title'])).toBeTruthy()
  })

  it('renders seven switches: browser, current-session, sound, and one per kind', () => {
    renderSection(stateOf())
    expect(screen.getAllByRole('switch')).toHaveLength(7)
  })

  it('toggles the current-session alert switch through setNotifyCurrent', () => {
    const callbacks = renderSection(stateOf())
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[1]) // current-session row switch
    expect(callbacks.setNotifyCurrent).toHaveBeenCalledWith(true)
  })

  it('renders the sound pickers with the current sound label', () => {
    renderSection(stateOf())
    // Four pickers plus the sound master switch share the "提示音" label.
    expect(screen.getAllByLabelText(zh['sound.title'])).toHaveLength(5)
    expect(screen.getAllByText(zh['sound.chime'])).toHaveLength(1)
    expect(screen.getAllByText(zh['sound.alert'])).toHaveLength(1)
  })

  it('picks a sound from the menu and writes it through setType', () => {
    const callbacks = renderSection(stateOf())
    const pickers = screen.getAllByLabelText(zh['sound.title'])
    // pickers[0] is the master sound switch; pickers[2] is the failed row.
    fireEvent.click(pickers[2])
    expect(screen.getByTestId('menu-items')).toBeTruthy()
    fireEvent.click(screen.getByTestId('menu-item-fault'))
    expect(callbacks.setType).toHaveBeenCalledWith('failed', { sound: 'fault' })
  })

  it('toggles a kind enable switch through setType', () => {
    const callbacks = renderSection(stateOf())
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[4]) // failed row switch
    expect(callbacks.setType).toHaveBeenCalledWith('failed', { enabled: false })
  })

  it('previews the kind sound', () => {
    const callbacks = renderSection(stateOf())
    fireEvent.click(screen.getAllByText(zh['test.play'])[0])
    expect(callbacks.testSound).toHaveBeenCalledWith('chime')
  })

  it('hides the preview button for a muted kind', () => {
    const state = stateOf()
    state.settings.types.completed = { enabled: true, sound: 'none' }
    renderSection(state)
    expect(screen.queryAllByText(zh['test.play'])).toHaveLength(3)
  })

  it('writes the volume slider through setVolume', () => {
    const callbacks = renderSection(stateOf())
    const slider = screen.getByRole('slider')
    expect(slider.getAttribute('aria-valuenow')).toBe('60')
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(callbacks.setVolume).toHaveBeenCalledWith(0.65)
    fireEvent.keyDown(slider, { key: 'End' })
    expect(callbacks.setVolume).toHaveBeenCalledWith(1)
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(callbacks.setVolume).toHaveBeenCalledWith(0)
  })

  it('offers the 自定义 option in every sound picker', () => {
    renderSection(stateOf())
    const pickers = screen.getAllByLabelText(zh['sound.title'])
    fireEvent.click(pickers[2]) // failed row picker
    expect(screen.getByTestId('menu-item-custom')).toBeTruthy()
    expect(screen.getByTestId('menu-item-none')).toBeTruthy()
  })

  it('selecting 自定义 with no file opens the file picker instead of persisting', () => {
    const callbacks = renderSection(stateOf())
    const pickers = screen.getAllByLabelText(zh['sound.title'])
    fireEvent.click(pickers[2]) // failed row picker
    fireEvent.click(screen.getByTestId('menu-item-custom'))
    expect(callbacks.setType).not.toHaveBeenCalled()
    expect(screen.getAllByLabelText(zh['sound.custom'])).toHaveLength(4)
  })

  it('shows replace only while 自定义 is selected with a stored file', () => {
    const state = stateOf()
    state.settings.types.failed = { enabled: true, sound: 'custom' }
    state.customSounds.failed = 'data:audio/wav;base64,AAA'
    renderSection(state)
    expect(screen.getByText(zh['custom.replace'])).toBeTruthy()
  })

  it('hides replace while a stored file is dormant (自定义 not selected)', () => {
    const state = stateOf()
    state.customSounds.failed = 'data:audio/wav;base64,AAA'
    renderSection(state)
    expect(screen.queryByText(zh['custom.replace'])).toBeNull()
  })

  it('previews the custom audio when 自定义 is selected', () => {
    const state = stateOf()
    state.settings.types.failed = { enabled: true, sound: 'custom' }
    state.customSounds.failed = 'data:audio/wav;base64,BBB'
    const callbacks = renderSection(state)
    // Row order: completed, failed, question, permission — the failed row's preview.
    fireEvent.click(screen.getAllByText(zh['test.play'])[1])
    expect(callbacks.testSound).toHaveBeenCalledWith('custom', 'data:audio/wav;base64,BBB')
  })

  it('shows the permission request button while permission is default', () => {
    const callbacks = renderSection(stateOf())
    fireEvent.click(screen.getByText(zh['permission.request']))
    expect(callbacks.requestPermission).toHaveBeenCalled()
  })

  it('shows no status text or request button once granted', () => {
    renderSection(stateOf({ permission: 'granted' }))
    expect(screen.queryByText(zh['permission.granted'])).toBeNull()
    expect(screen.queryByText(zh['permission.request'])).toBeNull()
  })

  it('shows the denied state once denied', () => {
    renderSection(stateOf({ permission: 'denied' }))
    expect(screen.getByText(zh['permission.denied'])).toBeTruthy()
  })

  it('shows the unsupported state when the environment lacks notifications', () => {
    renderSection(stateOf({ permission: 'unsupported' }))
    expect(screen.getByText(zh['permission.unsupported'])).toBeTruthy()
  })

  it('shows the paused hint while enabled but permission is default', () => {
    renderSection(stateOf({
      permission: 'default',
      settings: { ...structuredClone(DEFAULT_NOTIFICATION_SETTINGS), browserEnabled: true },
    }))
    expect(screen.getByText(zh['permission.paused'])).toBeTruthy()
  })

  it('shows the paused hint while enabled but permission is denied', () => {
    renderSection(stateOf({
      permission: 'denied',
      settings: { ...structuredClone(DEFAULT_NOTIFICATION_SETTINGS), browserEnabled: true },
    }))
    expect(screen.getByText(zh['permission.paused'])).toBeTruthy()
  })

  it('shows no paused hint while the switch is off', () => {
    renderSection(stateOf())
    expect(screen.queryByText(zh['permission.paused'])).toBeNull()
  })

  it('sends a test notification once granted and enabled', () => {
    const callbacks = renderSection(stateOf({
      permission: 'granted',
      settings: { ...structuredClone(DEFAULT_NOTIFICATION_SETTINGS), browserEnabled: true },
    }))
    fireEvent.click(screen.getByText(zh['test.send']))
    expect(callbacks.testBrowserNotification).toHaveBeenCalled()
  })

  it('hides the test button while disabled or permission is missing', () => {
    renderSection(stateOf({ permission: 'granted' }))
    expect(screen.queryByText(zh['test.send'])).toBeNull()
    renderSection(stateOf({
      permission: 'default',
      settings: { ...structuredClone(DEFAULT_NOTIFICATION_SETTINGS), browserEnabled: true },
    }))
    expect(screen.queryByText(zh['test.send'])).toBeNull()
  })

  it('requests permission when the browser switch is turned on without permission', () => {
    const callbacks = renderSection(stateOf())
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0])
    expect(callbacks.setBrowserEnabled).toHaveBeenCalledWith(true)
  })
})
