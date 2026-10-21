// O que o servidor guarda em disco (sobrevive a reiniciar): estado do DJ e as fotos do fotógrafo. Fica em
// data/ na raiz do projeto (BCR_DATA aponta outra pasta).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DATA_DIR = process.env.BCR_DATA ?? fileURLToPath(new URL('../data', import.meta.url))

export function dataPath(...parts: string[]) {
  return join(DATA_DIR, ...parts)
}

export function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(dataPath(name), 'utf8')) as T
  } catch {
    return fallback
  }
}

// grava inteiro num temporário e troca (nunca fica arquivo pela metade)
export function writeJson(name: string, value: unknown) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const file = dataPath(name)
    writeFileSync(`${file}.tmp`, JSON.stringify(value))
    renameSync(`${file}.tmp`, file)
  } catch (e) {
    console.error('[store] não gravou', name, e instanceof Error ? e.message : e)
  }
}
