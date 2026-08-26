// Pins "Which project?" — what the scanner says about a folder the user
// pointed at. The three answers matter because each drives a different screen:
// adopt it, tick which ones, or offer "add it anyway".

import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { scanFolderForProjects } from './scan-folder-for-projects.js'

async function withTempFolder(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'vynel-scan-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function makeProject(root: string, name: string, marker = 'package.json'): Promise<string> {
  const directory = path.join(root, name)
  await mkdir(directory, { recursive: true })
  if (marker === '.git') await mkdir(path.join(directory, '.git'))
  else await writeFile(path.join(directory, marker), '{}')
  return directory
}

describe('scanFolderForProjects', () => {
  it('a folder that IS a project answers single', async () => {
    await withTempFolder(async (root) => {
      const project = await makeProject(root, 'my-shop')

      const scan = await scanFolderForProjects(project)

      expect(scan.kind).toBe('single')
      if (scan.kind !== 'single') return
      expect(scan.project.name).toBe('my-shop')
      expect(scan.project.foundBy).toBe('package.json')
    })
  })

  it('git alone is enough — not every project is npm', async () => {
    await withTempFolder(async (root) => {
      const project = await makeProject(root, 'notes', '.git')

      const scan = await scanFolderForProjects(project)

      expect(scan.kind).toBe('single')
      if (scan.kind !== 'single') return
      expect(scan.project.foundBy).toBe('.git')
    })
  })

  it('so is a Python or Go marker — those users are not unrecognisable', async () => {
    await withTempFolder(async (root) => {
      const python = await makeProject(root, 'scraper', 'pyproject.toml')
      const go = await makeProject(root, 'daemon', 'go.mod')

      expect((await scanFolderForProjects(python)).kind).toBe('single')
      expect((await scanFolderForProjects(go)).kind).toBe('single')
    })
  })

  it('a folder that HOLDS projects answers several, named and sorted', async () => {
    await withTempFolder(async (root) => {
      await makeProject(root, 'quizforma')
      await makeProject(root, 'letterman', '.git')
      await makeProject(root, 'mintbird')

      const scan = await scanFolderForProjects(root)

      expect(scan.kind).toBe('several')
      if (scan.kind !== 'several') return
      expect(scan.projects.map((project) => project.name)).toEqual([
        'letterman',
        'mintbird',
        'quizforma',
      ])
    })
  })

  it('never calls node_modules or dist a project', async () => {
    await withTempFolder(async (root) => {
      await makeProject(root, 'node_modules')
      await makeProject(root, 'dist')
      await makeProject(root, '.cache')
      await makeProject(root, 'the-real-one')

      const scan = await scanFolderForProjects(root)

      expect(scan.kind).toBe('several')
      if (scan.kind !== 'several') return
      expect(scan.projects.map((project) => project.name)).toEqual(['the-real-one'])
    })
  })

  it('an empty folder answers none — the screen offers "add it anyway"', async () => {
    await withTempFolder(async (root) => {
      const empty = path.join(root, 'nothing-here')
      await mkdir(empty)

      expect((await scanFolderForProjects(empty)).kind).toBe('none')
    })
  })

  it('only looks ONE level down — a project buried deeper is not guessed at', async () => {
    await withTempFolder(async (root) => {
      const buried = path.join(root, 'a', 'b')
      await mkdir(buried, { recursive: true })
      await writeFile(path.join(buried, 'package.json'), '{}')

      expect((await scanFolderForProjects(root)).kind).toBe('none')
    })
  })

  it('a single child project still asks — never adopt a folder the user did not name', async () => {
    await withTempFolder(async (root) => {
      await makeProject(root, 'only-one')

      const scan = await scanFolderForProjects(root)

      expect(scan.kind).toBe('several')
      if (scan.kind !== 'several') return
      expect(scan.projects).toHaveLength(1)
    })
  })

  it('a folder that does not exist is a validation error, not a crash', async () => {
    await expect(
      scanFolderForProjects(path.join(tmpdir(), 'vynel-missing-scan-target')),
    ).rejects.toThrow()
  })
})
