import { describe, it, expect } from 'vitest'
import { insertText } from '../src/main/services/inserter'
import type { PasteVerdict } from '../src/main/services/inserter'

function fakeClipboard() {
  let clip = 'старое'
  return {
    clipboard: {
      readText: () => clip,
      writeText: (t: string) => {
        clip = t
      }
    },
    getClip: () => clip
  }
}

const attempt = (v: PasteVerdict) => async () => v

describe('insertText: цепочка способов вставки', () => {
  it('первый способ вставил — остальные не вызываются', async () => {
    const f = fakeClipboard()
    const called: number[] = []
    const r = await insertText('новый', {
      clipboard: f.clipboard,
      attempts: [
        async () => {
          called.push(1)
          return 'pasted'
        },
        async () => {
          called.push(2)
          return 'pasted'
        }
      ]
    })
    expect(r).toBe('inserted')
    expect(called).toEqual([1])
    expect(f.getClip()).toBe('новый')
  })
  it('«нет поля ввода» прекращает попытки сразу — карточка, без слепой вставки', async () => {
    const f = fakeClipboard()
    const called: number[] = []
    const r = await insertText('новый', {
      clipboard: f.clipboard,
      attempts: [
        async () => {
          called.push(1)
          return 'no-field'
        },
        async () => {
          called.push(2)
          return 'pasted'
        }
      ]
    })
    expect(r).toBe('clipboard-only')
    expect(called).toEqual([1])
  })
  it('сбой первого — переход ко второму; исключение считается сбоем', async () => {
    const f = fakeClipboard()
    const r = await insertText('новый', {
      clipboard: f.clipboard,
      attempts: [
        attempt('failed'),
        async () => {
          throw new Error('blocked')
        },
        attempt('pasted')
      ]
    })
    expect(r).toBe('inserted')
  })
  it('все способы отказали — clipboard-only, текст остаётся в буфере', async () => {
    const f = fakeClipboard()
    const r = await insertText('новый', {
      clipboard: f.clipboard,
      attempts: [attempt('failed'), attempt('failed')]
    })
    expect(r).toBe('clipboard-only')
    expect(f.getClip()).toBe('новый')
  })
})
