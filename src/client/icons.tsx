/**
 * Notification bell glyph. The official icon set has no bell, so the plugin
 * ships its own in the same style (16px viewBox, `fill="currentColor"`,
 * `{size, className}` props) — the identical path is added to the official
 * ui-primitives set for the settings nav once the harness client rebuilds.
 */
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

export type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/** The bell body path (shared with the ui-primitives addition). */
export const BELL_BODY_PATH =
  'M8 2C5.79 2 4 3.79 4 6V8.59L2.7 9.88C2.52 10.06 2.65 10.36 2.9 10.36H13.1C13.35 10.36 13.48 10.06 13.3 9.88L12 8.59V6C12 3.79 10.21 2 8 2Z'

/** The bell clapper path (shared with the ui-primitives addition). */
export const BELL_CLAPPER_PATH =
  'M6.6 12.1C6.83 12.79 7.37 13.1 8 13.1C8.63 13.1 9.17 12.79 9.4 12.1H6.6Z'

/** ic_ds_bell_outline_16 (notification glyph). */
export const IconBell16 = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d={BELL_BODY_PATH} fill="currentColor" />
    <path d={BELL_CLAPPER_PATH} fill="currentColor" />
  </svg>
)

/** The bell as a data URI, used as the browser Notification icon. */
export const BELL_ICON_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#fff" d="${BELL_BODY_PATH}"/><path fill="#fff" d="${BELL_CLAPPER_PATH}"/></svg>`,
)}`
