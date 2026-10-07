import { describe, it, expect } from 'vitest'
import { loadSettings, saveSettings, isConfigured, isValidWorkerUrl } from './settings.js'

describe('settings', () => {
  it('returns empty settings when nothing is stored or storage is corrupt', () => {
    expect(loadSettings()).toEqual({ workerUrl: '', appToken: '' })
    localStorage.setItem('mymaps-ai.settings', '{bad json')
    expect(loadSettings()).toEqual({ workerUrl: '', appToken: '' })
  })

  it('saves normalized values and loads them back', () => {
    saveSettings({ workerUrl: ' https://w.example.dev/// ', appToken: ' tok ' })
    expect(loadSettings()).toEqual({ workerUrl: 'https://w.example.dev', appToken: 'tok' })
  })

  it('validates worker URLs', () => {
    expect(isValidWorkerUrl('https://w.workers.dev')).toBe(true)
    expect(isValidWorkerUrl('http://localhost:8787')).toBe(true)
    expect(isValidWorkerUrl('http://w.workers.dev')).toBe(false)
    expect(isValidWorkerUrl('nope')).toBe(false)
  })

  it('is configured only with both values', () => {
    expect(isConfigured({ workerUrl: 'https://w.dev', appToken: '' })).toBe(false)
    expect(isConfigured({ workerUrl: 'https://w.dev', appToken: 't' })).toBe(true)
  })
})
