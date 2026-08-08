// The credentials HARD WALL: Vynel never types into a password field, no
// matter what the model was told. Best-effort detection over what the
// accessibility tree exposes — the role (AccessKit maps password inputs to a
// password-ish role) and the platform's raw properties (Windows UIA ships
// `IsPassword`; xa11y surfaces provider keys in `raw`). A miss here is not the
// only line of defense (instructions + approval cards remain), but a HIT is
// non-negotiable: detection = refusal, with no override parameter by design.

export type A11yControlShape = {
  role: string
  raw: Record<string, unknown>
}

export function isPasswordControl(control: A11yControlShape): boolean {
  if (/password/i.test(control.role)) return true
  for (const [key, value] of Object.entries(control.raw)) {
    if (!/password/i.test(key)) continue
    if (value === true || value === 'true' || value === 1) return true
  }
  return false
}

/** The refusal message — names the wall AND the human path forward. */
export function passwordControlRefusal(appName: string): string {
  return (
    `Refused: the target element in "${appName}" is a PASSWORD field. Vynel never enters ` +
    'passwords, codes, or other credentials — ask the user to type it themselves, then continue.'
  )
}
