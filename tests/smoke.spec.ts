import { describe, expect, it } from 'vitest'
import { name } from '../src/index.ts'

describe('scaffold', () => {
  it('exports the plugin name', () => {
    expect(name).toBe('dsh-sidechat')
  })
})
