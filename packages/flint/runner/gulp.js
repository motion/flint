import chokidar from 'chokidar'
import merge from 'merge-stream'
import multipipe from 'multipipe'
import flintTransform from 'flint-transform'
import through from 'through2'
import gulp from 'gulp'
import loadPlugins from 'gulp-load-plugins'
import bridge from './bridge'
import cache from './cache'
import builder from './builder'
import bundler from './bundler'
import superStream from './lib/superStream'
import dirAddStream from './lib/dirAddStream'
import compiler from './compiler'
import babel from './lib/gulp-babel'
import opts from './opts'
import writeStyle from './lib/writeStyle'
import onMeta from './lib/onMeta'
import { findBabelRuntimeRequires } from './lib/findRequires'
import SCRIPTS_GLOB from './const/scriptsGlob'
import { _, fs, path, glob, readdir, p, rm, handleError, logError, log } from './lib/fns'

const LOG = 'gulp'
const $ = loadPlugins()

let OPTS
let hasRunCurrentBuild = true
let buildingOnce = false

const serializeCache = _.throttle(cache.serialize, 200)
const isBuilding = () => buildingOnce || opts('build')
const hasBuilt = () => hasRunCurrentBuild && opts('hasRunInitialBuild')
const hasFinished = () => hasBuilt() && opts('hasRunInitialInstall')
const relative = file => path.relative(opts('appDir'), file.path)
const time = _ => typeof _ == 'number' ? ` ${_}ms` : ''
const out = {
  badFile: (file, err) => console.log(` ◆ ${relative(file)}`.red),
  goodFile: (file, ms) => console.log(
    // name
    ` ✓ ${relative(file)}`.bold
    // time
    + `${file.startTime ? time((Date.now() - file.startTime) || 1) : ''}`.dim
  )
}

gulp.task('build', buildScripts)

export function watchForBuild() {
  return gulp.watch(SCRIPTS_GLOB, ['build'])
}

// TODO bad practice
let fileImports = {}

const $p = {
  flint: {
    pre: () => compiler('pre'),
    post: () => compiler('post')
  },

  // for parsing single file
  flintFile: () => babel({
    breakConfig: true, // avoid reading .babelrc
    jsxPragma: 'view.el',
    stage: 1,
    blacklist: ['es6.tailCall', 'strict'],
    retainLines: OPTS.pretty ? false : true,
    comments: true,
    optional: ['regenerator', 'runtime'],
    plugins: [flintTransform.file({
      log,
      basePath: OPTS.dir,
      production: isBuilding(),
      selectorPrefix: opts('config').selectorPrefix || '#_flintapp ',
      writeStyle: writeStyle.write,
      onMeta,
      onImports(file, imports) {
        fileImports[file] = imports
      }
    })],
    extra: {
      production: process.env.production
    }
  })
}

// gulp doesnt send unlink events for files in deleted folders, so we do our own
function watchDeletes() {
  chokidar.watch('.', {ignored: /[\/\\]\./}).on('unlink', handleDelete)

  async function handleDelete(file) {
    try {
      // ignore if in node_modules
      if (file.indexOf('.flint') === 0)
        return

      log(LOG, 'unlink', file)
      if (/jsf?/.test(path.extname(file))) {
        await rm(p(opts('outDir'), file))
        cache.remove(file)
      }
    }
    catch(e) {
      handleError(e)
    }
  }
}

export async function init({ once = false } = {}) {
  try {
    OPTS = opts()

    writeStyle.init()

    buildingOnce = once

    // if manually running a once
    if (once) {
      hasRunCurrentBuild = false
    }

    if (!isBuilding()) {
      watchDeletes()
      superStream.init()
    }

    const inFiles = await glob(SCRIPTS_GLOB)
    const _outFiles = await readdir(OPTS.outDir)
    const outFiles = _outFiles
      .map(file => file.path)
      .filter(path => path.slice(-4) !== '.map')

    // cleanup out dir since last run
    const deleted = _.difference(outFiles, inFiles)
    const deletedPaths = deleted.map(f => p(opts('outDir'), f))
    await* deletedPaths.map(f => rm(f))
    log(LOG, 'deleted', deletedPaths)

    buildScripts({ inFiles, outFiles })
  }
  catch(e) {
    handleError(e)
  }
}

// used for build
export function bundleApp() {
  const buildDir = p(opts('buildDir'), '_')
  const appFile = p(buildDir, `${OPTS.saneName}.js`)
  const deps = opts('deps')

  const inFiles = [
    deps.internalsOut,
    deps.externalsOut,
    appFile
  ]

  const isMinifying = !opts('nomin')
  if (isMinifying) console.log(`  Minifying...`.dim)

  return new Promise((resolve, reject) => {
    gulp.src(inFiles)
      // sourcemap
      .pipe($.sourcemaps.init())
      // wrap app in closure
      .pipe($.if(file => {
          return file.path == appFile
        }, babel({
          whitelist: [],
          retainLines: true,
          comments: true,
          plugins: [flintTransform.app({ name: opts('saneName') })],
          extra: { production: process.env.production },
          compact: true
        })
      ))

      // uglify
      .pipe($.if(isMinifying, $.uglify()))
      .pipe($.sourcemaps.write('.'))
      .pipe(gulp.dest(buildDir))
      .on('end', resolve)
      .on('error', reject)
  })
}

// userStream is optional for programmatic usage
export function buildScripts({ inFiles, outFiles, userStream }) {
  const outDest = () => isBuilding() ? p(OPTS.buildDir, '_') : OPTS.outDir || '.'
  let curFile, lastError
  let lastSavedTimestamp = {}

  // track inFiles files to determine when it's loaded
  let loaded = 0
  let total = inFiles && inFiles.length || 0

  // gulp src stream
  const gulpSrcStream = gulp.src(SCRIPTS_GLOB)
    .pipe($.if(!isBuilding(), $.watch(SCRIPTS_GLOB, { readDelay: 1 })))
    // ignore unlinks in pipeline
    .pipe($.if(file => file.event == 'unlink', $.ignore.exclude(true)))

  // either user or gulp stream
  const dirStream = dirAddStream(opts('appDir'))
  const sourceStream = userStream || gulpSrcStream
  const stream = isBuilding() ? sourceStream : merge(sourceStream, dirStream, superStream.stream)

  return stream
    .pipe($.if(buildCheck, $.ignore.exclude(true)))
    .pipe(pipefn(resetLastFile))
    .pipe($.plumber(catchError))
    .pipe(pipefn(setLastFile))
    .pipe($p.flint.pre())
    .pipe($.sourcemaps.init())
    .pipe($p.flintFile())
    .pipe(pipefn(updateCache)) // right after babel
    .pipe($p.flint.post())
    .pipe($.if(!userStream, $.rename({ extname: '.js' })))
    // is internal
    .pipe($.if(file => file.isInternal,
      multipipe(
        pipefn(out.goodFile),
        pipefn(removeNewlyInternal),
        pipefn(markFileSuccess), // before writing to preserve path
        gulp.dest(p(OPTS.depsDir, 'internal')),
        $.ignore.exclude(true)
      )
    ))
    // not sourcemap
    .pipe($.if(file => !isSourceMap(file),
      multipipe(
        pipefn(out.goodFile),
        pipefn(markFileSuccess)
      )
    ))
    .pipe($.if(isBuilding, $.concat(`${OPTS.saneName}.js`)))
    .pipe($.sourcemaps.write('.'))
    .pipe($.if(checkWriteable, gulp.dest(outDest)))
    .pipe(pipefn(afterWrite))
    .pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn()).pipe(pipefn())

  function markDone(file) {
    // mark built
    loaded += 1
    log(LOG, 'markDone', loaded, total, file.path)

    // check if done
    if (loaded == total) {
      // add some delay to allow building last file TODO improve
      setTimeout(buildDone, 100)
    }
  }

  // only do on first run
  function buildCheck(file) {
    // BUGFIX gulp sends deleted files through here, this filters them
    if (!file.contents)
      return true

    // already done with first build
    if (hasBuilt())
      return false

    // hide behind cached flag for now
    if (!opts('cached')) {
      finish()
      return false
    }

    log(LOG, 'buildCheck', file.path)

    function finish() {
      log(LOG, 'buildCheck finish')
      cache.restorePrevious(file.path)

      markDone(file)
    }

    if (isBuilding()) {
      finish()
      return false
    }

    const outFile = path.join(OPTS.outDir, path.relative(OPTS.appDir, file.path))
    const prevFile = cache.getPrevious(file.path)

    // if exported file, mark done and skip
    if (prevFile && prevFile.isInternal) {
      finish()
      return false
    }

    let outMTime, srcMTime

    try {
      srcMTime = fs.statSync(file.path).mtime
    }
    catch(e) {
      log(LOG, 'buildCheck', 'src file removed')
      return false
    }

    try {
      outMTime = fs.statSync(outFile).mtime
    }
    catch(e) {
      log(LOG, 'buildCheck', 'out file removed')
      markDone(file)
      return false
    }

    const goodBuild = +outMTime > +srcMTime

    if (!goodBuild)
      return false

    const cached = cache.getPrevious(file.path)

    if (!cached)
      return false

    const goodCache = cached.added > srcMTime

    if (!goodCache)
      return false

    finish()
    return true
  }

  function resetLastFile(file) {
    fileImports[file] = false
    lastError = false
    curFile = file
    file.startTime = Date.now()
    file.message = { startTime: file.startTime }
  }

  function catchError(error) {
    log(LOG, 'catchError', error)
    lastError = true
    out.badFile(curFile)

    error.timestamp = Date.now()

    // dont output massive stacks
    if (error.plugin == 'gulp-babel')
      error.stack = ''

    logError(error, curFile)

    cache.addError(error.fileName || '', error)
    bridge.message('compile:error', { error }, 'error')
  }

  function setLastFile(file) {
    if (isBuilding()) return
    let name = file.path.replace(OPTS.appDir, '')
    if (name.charAt(0) != '/') name = '/' + name
    log(LOG, 'setLastFile', 'path', file.path, 'name', name)

    // add to message
    file.message = {
      ...file.message,
      name: name,
      path: file.path,
      compiledAt: file.startTime
    }

    file.src = file.contents.toString()

    curFile = file
  }

  // update cache: meta/src/imports
  function updateCache(file) {
    //  babel externals, set imports for willInstall detection
    let babelExternals = findBabelRuntimeRequires(file.contents.toString())
    let imports = fileImports[file.path]
    let all = [].concat(babelExternals, imports)
    cache.setFileImports(file.path, all)

    // meta
    let meta = cache.getFileMeta(file.path)
    if (opts('hasRunInitialBuild'))
      bridge.message('file:meta', { meta })

    // outside changed detection
    sendOutsideChanged(meta, file)
  }

  // detects if a file has changed not inside views for hot reloads correctness
  function sendOutsideChanged(meta, file) {
    let changed = false

    const viewLocs = Object.keys(meta).map(view => meta[view].location)

    if (viewLocs.length) {
      // slice out all code not in views
      const outerSlice = (ls, start, end) => ls.slice(0, start).concat(ls.slice(end))
      const outsideSrc = viewLocs.reduce((src, loc) => outerSlice(src, loc.start.line - 1, loc.end.line), file.src.split("\n")).join('')
      const cacheFile = cache.getFile(file.path)
      const prevOutsideSrc = cacheFile.outsideSrc
      cacheFile.outsideSrc = outsideSrc // update
      changed = prevOutsideSrc !== outsideSrc
    }

    if (opts('hasRunInitialBuild'))
      bridge.message('file:outsideChange', { name: cache.relative(file.path), changed })
  }

  function isSourceMap(file) {
    return path.extname(file.path) === '.map'
  }

  function checkWriteable(file) {
    if (isBuilding()) {
      builder.copy.styles()
    }

    if (userStream || lastError)
      return false

    if (isBuilding())
      return true

    const isNew = (
      !lastSavedTimestamp[file.path] ||
      file.startTime > lastSavedTimestamp[file.path]
    )

    log(LOG, 'isNew', isNew)
    if (isNew) {
      lastSavedTimestamp[file.path] = file.startTime
      return true
    }

    return false
  }

  function afterWrite(file) {
    if (isBuilding() && OPTS.watch) {
      builder.build()
      return
    }

    // avoid during initial build
    if (!hasFinished()) return

    // avoid ?? todo: figure out why this is necessary
    if (!cache.get(file.path)) return

    // avoid if error
    if (lastError) return

    // avoid if installing
    if (bundler.isInstalling() || file.willInstall) return

    // ADD
    bridge.message('script:add', file.message)
  }

  function markFileSuccess(file) {
    if (file.isSourceMap) return

    log(LOG, 'markFileSuccess', file.path)

    // update cache error / state
    cache.update(file.path)

    // write cache state to disk
    serializeCache()

    // message browser of compile success
    bridge.message('compile:success', file.message, 'error')

    // check if other errors left still in queue
    const error = cache.getLastError()
    if (!error) return
    log(LOG, 'cache last error', error)
    bridge.message('compile:error', { error }, 'error')
  }

  // ok so we start a file
  // its built into .flint/out
  // we then add an export
  // now we need to remove it from .flint/out
  function removeNewlyInternal(file) {
    // resolve path from .flint/.internal/deps/internals/xyz.js back to xyz.js
    const filePath = path.relative(p(opts('deps').dir, 'internal'), file.path)
    // then resolve path to .flint/.internal/out/xyz.js
    const outPath = p(opts('outDir'), filePath)
    log(LOG, 'remove newly internal', outPath)
    rm(outPath)
  }
}

export function buildWhileRunning() {
  return new Promise((res, rej) => {
    gulp.src(['.flint/.internal/out/**/*.js'])
      .pipe($.plumber(err => {
        logError(err)
        rej(err)
      }))
      .pipe($.concat(`${OPTS.saneName}.js`))
      .pipe(gulp.dest(p(OPTS.buildDir, '_')))
      .pipe(pipefn(res))
  });
}

let waitingForFirstBuild = []
function afterBuild() {
  return new Promise((res, rej) => {
    if (hasFinished()) return res()
    else waitingForFirstBuild.push(res)
  })
}

function buildDone() {
  opts.set('hasRunInitialBuild', true)
  hasRunCurrentBuild = true
  buildingOnce = false
  waitingForFirstBuild.forEach(res => res())
}


function pipefn(fn) {
  return through.obj(function(file, enc, next) {
    let result = fn && fn(file)

    if (typeof result == 'string') {
      file.contents = new Buffer(result)
      next(null, file)
      return
    }

    next(null, file)
  })
}

export default { init, buildScripts, bundleApp, afterBuild, watchForBuild }