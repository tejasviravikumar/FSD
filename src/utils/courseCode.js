import { randomInt } from 'node:crypto'

export function generateCourseCode() {
  const firstLetter = String.fromCharCode(65 + randomInt(26))
  const suffix = randomInt(36 ** 7).toString(36).padStart(7, '0').toUpperCase()
  return `NX-${firstLetter}${suffix}`
}
