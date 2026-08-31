/**
 * Test-time stand-in for `@deepseek-ai/dsh-client-ui-primitives` (not
 * installed in this repo; the web profile seeds it at runtime). The Menu
 * stub renders the anchor and, when open, the item list so component specs
 * can drive the sound picker.
 */
import type { ReactNode } from 'react'

/** Anchored dropdown menu stub. */
export function Menu({ open, anchor, items, selectedId, onSelect }: {
  open: boolean
  anchor: ReactNode
  items: ReadonlyArray<{ id: string; label: string }>
  selectedId?: string
  onSelect: (id: string) => void
}) {
  return (
    <>
      {anchor}
      {open && (
        <div data-testid="menu-items">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              data-testid={`menu-item-${item.id}`}
              data-active={item.id === selectedId ? 'true' : undefined}
              onClick={() => { onSelect(item.id) }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

/** Button stub: a plain native button (the official primitive is a token-
 *  styled capsule; variant/size are visual only and irrelevant here). */
export function Button({ variant, size, className, children, ...rest }: {
  variant?: string
  size?: string
  className?: string | undefined
  children?: ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={className} {...rest}>
      {children}
    </button>
  )
}

/** Icon stubs: the section only needs their presence. */
export const IconAgentPresetOutline16 = () => null
export const IconChevronDownOutline14 = () => null
export const IconCheckOutline16 = () => null
export const IconChecklistOutline14 = () => null
export const IconQuestionOutline14 = () => null
export const IconTrashOutline16 = () => null
export const IconWarningOutline16 = () => null
