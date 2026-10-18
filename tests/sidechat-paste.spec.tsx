/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { Context } from '../src/client/host/contracts.ts'
import type { Composer } from '../src/client/sidechat/composer.ts'
import { ComposerBar } from '../src/client/sidechat/ComposerBar.tsx'
import { createAnnotationStore } from '../src/client/annotations/model.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('attaches clipboard images only when accepted, leaving text and unavailable intake alone', () => {
  const attachImages = vi.fn(() => true)
  const composer: Composer = {
    machine: true, draft: 'existing draft', sendError: null, canSubmit: true,
    setDraft: vi.fn(), appendDraft: vi.fn(), submit: vi.fn(),
    phase: 'plain', draftRev: 0, imageIds: [], imagePreviews: [], canAttach: true,
    attachImages, removeImage: vi.fn(),
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const render = (canAttach = true) => act(() => { root.render(<ComposerBar
    ctx={{} as Context} session={undefined} composer={{ ...composer, canAttach }}
    running={false} visible={true} modelName={null} childId={undefined}
    onModelSwitched={() => {}} annotations={createAnnotationStore(() => 1, null)}
  />) })
  const paste = (files: File[]) => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files } })
    act(() => { host.querySelector('textarea')!.dispatchEvent(event) })
    return event
  }
  const png = new File(['png'], 'clipboard.png', { type: 'image/png' })
  const jpeg = new File(['jpeg'], 'clipboard.jpg', { type: 'image/jpeg' })
  const pdf = new File(['pdf'], 'document.pdf', { type: 'application/pdf' })
  try {
    render()
    expect(paste([png, pdf, jpeg]).defaultPrevented).toBe(true)
    expect(attachImages).toHaveBeenCalledExactlyOnceWith([png, jpeg])
    expect(paste([]).defaultPrevented).toBe(false)
    expect(paste([pdf]).defaultPrevented).toBe(false)
    render(false)
    expect(paste([png]).defaultPrevented).toBe(false)
    expect(attachImages).toHaveBeenCalledTimes(1)
    render()
    attachImages.mockReturnValue(false)
    expect(paste([png]).defaultPrevented).toBe(false)
    expect(attachImages).toHaveBeenCalledTimes(2)
    expect(host.querySelector('textarea')!.value).toBe('existing draft')
    expect(composer.setDraft).not.toHaveBeenCalled()
  } finally {
    act(() => { root.unmount() }); host.remove()
  }
})
