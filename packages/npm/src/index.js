'use strict'

/* @flow */

import Path from 'path'
import FS from 'fs'
import invariant from 'assert'
import promisify from 'sb-promisify'
import { exec } from 'sb-exec'
import semver from 'semver'
import { versionFromRange, getManifestPath } from './helpers'
import { readJSON } from 'motion-fs'

type Installer$Options = {
  rootDirectory: string,
  filter: Function
}

class Installer {
  options: Installer$Options;

  constructor({rootDirectory, filter}: Installer$Options) {
    invariant(typeof rootDirectory === 'string', 'rootDirectory must be a string')
    invariant(!filter || typeof filter === 'function', 'filter must be a function')

    this.options = { rootDirectory, filter }
  }
  async install(name: string): Promise<void> {
    await exec('npm', ['install', '--save', name], { cwd: this.options.rootDirectory })
  }
  async uninstall(name: string): Promise<void> {
    await exec('npm', ['uninstall', '--save', name], { cwd: this.options.rootDirectory })
  }
  async installPeerDependencies(
    name: string,
    onStarted?: ((packages: Array<Array<string>>) => void),
    onProgress?: ((packageName: string, error: ?Error) => void),
    onComplete?: (() => void)
  ): Promise<void> {
    const rootDirectory = this.options.rootDirectory
    const manifestPath = await getManifestPath(rootDirectory, name)
    const manifestContents = readJSON(manifestPath)
    const peerDependencies = manifestContents && manifestContents.peerDependencies || {}

    if (peerDependencies && typeof peerDependencies === 'object') {
      let dependencies = Object.keys(peerDependencies)
      if (this.options.filter) {
        dependencies = this.options.filter(dependencies)
      }
      const versions = dependencies.map(function(name) {
        const range = peerDependencies[name]
        const version = semver.maxSatisfying(versionFromRange(range), range)
        return [name, version]
      })

      if (onStarted) {
        onStarted(versions)
      }

      await Promise.all(versions.map(async function([name, version]) {
        try {
          await exec('npm', ['install', `${name}@${version}`], { cwd: rootDirectory })
          if (onProgress) {
            onProgress(name, null)
          }
        } catch (_) {
          if (onProgress) {
            onProgress(name, _)
          } else throw _
        }
      }))

      if (onComplete) {
        onComplete()
      }
    }
  }
}

module.exports = Installer
