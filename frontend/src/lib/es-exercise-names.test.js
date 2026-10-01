import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import es from '../exercise-names/es.js'
import { EXDB } from './exercises-data.js'
import { EXERCISE_NAME_LANGS, _setLangState, exerciseNameFor, exerciseNameSearchText } from './i18n-core.js'

describe('Spanish exercise names', () => {
  const source = JSON.parse(readFileSync(new URL('../../../scripts/exercise-name-sources/es.json', import.meta.url), 'utf8'))
  afterEach(() => _setLangState('en', {}, null, null))

  test('covers the complete built-in exercise catalogue', () => {
    expect(Object.keys(es)).toHaveLength(EXDB.length)
    expect(es).toEqual(source)
    expect(EXERCISE_NAME_LANGS).toContain('es')
    for (const exercise of EXDB) expect(es[exercise.id]?.trim(), exercise.id).toBeTruthy()
  })

  test('shows the Spanish name and keeps the English name searchable', () => {
    const exercise = EXDB[0]
    _setLangState('es', {}, null, es)
    expect(exerciseNameFor(exercise)).toBe(`${es[exercise.id]} (${exercise.n})`)
    expect(exerciseNameSearchText(exercise)).toContain(es[exercise.id])
    expect(exerciseNameSearchText(exercise)).toContain(exercise.n)
  })

  test('does not change custom exercise names', () => {
    const custom = { id: 'custom-1', n: 'Mi ejercicio personalizado' }
    _setLangState('es', {}, null, es)
    expect(exerciseNameFor(custom)).toBe(custom.n)
  })
})
