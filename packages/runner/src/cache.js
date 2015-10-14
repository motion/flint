import path from 'path'
import log from './lib/log'

const name = f => path.relative(baseDir, f)

type ViewArray = Array<string>
type ImportArray = Array<string>

type File = {
  views?: ViewArray,
  imports?: ImportArray
}

let files: { name: File } = {}
let imports: ImportArray = []
let baseDir

export default {
  setBaseDir(dir : string) {
    baseDir = path.resolve(dir, '..')
    log('cache: cache: baseDir', baseDir)
  },

  add(file: string) {
    if (!file) return
    files[name(file)] = files[name(file)] || {}
  },

  get(file: string) {
    return files[name(file)]
  },

  remove(file: string) {
    delete files[name(file)]
    log('cache: remove', files)
  },

  setViews(file: string, views: ViewArray) {
    if (!file) return
    files[name(file)].views = views
    log('cache: setViews', files)
  },

  setImports(_imports: ImportArray) {
    log('cache: setImports', _imports)
    imports = _imports
  },

  setFileImports(file: string, imports: ImportArray) {
    files[name(file)].imports = imports
    log('cache: setImports', file, imports)
  },

  getViews(file?: string) {
    return files[name(file)].views
  },

  getImports(file?: string) {
    if (!file) {
      let allImports = [].concat(imports)
      console.log('FILES', files)
      Object.keys(files).forEach(file => {
        allImports = allImports.concat(files[file].imports)
      })
      log('cache: getImports: ', allImports)
      return allImports
    }

    return files[name(file)].imports
  }
}