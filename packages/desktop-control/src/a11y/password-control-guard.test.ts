import { describe, it, expect } from 'vitest'
import { isPasswordControl, passwordControlRefusal } from './password-control-guard.js'

describe('isPasswordControl', () => {
  it('detects a password-ish role (AccessKit mapping)', () => {
    expect(isPasswordControl({ role: 'password_input', raw: {} })).toBe(true)
    expect(isPasswordControl({ role: 'PasswordText', raw: {} })).toBe(true)
  })

  it('detects a truthy platform password property (Windows UIA IsPassword)', () => {
    expect(isPasswordControl({ role: 'edit', raw: { uia_is_password: true } })).toBe(true)
    expect(isPasswordControl({ role: 'edit', raw: { IsPassword: 'true' } })).toBe(true)
  })

  it('does not flag a plain text field, and ignores FALSY password properties', () => {
    expect(isPasswordControl({ role: 'edit', raw: {} })).toBe(false)
    expect(isPasswordControl({ role: 'edit', raw: { uia_is_password: false } })).toBe(false)
    expect(isPasswordControl({ role: 'text_input', raw: { uia_control_type: 'Edit' } })).toBe(false)
  })

  it('does not flag a field merely NAMED like a password manager (role/props only)', () => {
    // The guard reads the control's SEMANTICS, not its label — a search box in
    // a password-manager app must stay typable.
    expect(isPasswordControl({ role: 'edit', raw: { name: 'Search passwords' } })).toBe(false)
  })
})

describe('passwordControlRefusal', () => {
  it('names the wall and the human path forward', () => {
    const message = passwordControlRefusal('Chrome')
    expect(message).toContain('PASSWORD')
    expect(message.toLowerCase()).toContain('ask the user')
  })
})
