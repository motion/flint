import hashsum from 'hash-sum'
import ee from 'event-emitter'
import resolveStyles from 'flint-radium/lib/resolve-styles'
import React from 'react'
import ReactDOM from 'react-dom'
import raf from 'raf'
import clone from 'clone'
import Bluebird, { Promise } from 'bluebird'

import 'reapp-object-assign'
import './shim/root'
import './shim/flintMap'
import './shim/on'
import './shim/partial'
import './lib/bluebirdErrorHandle'
import range from './lib/range'
import router from './lib/router'
import assignToGlobal from './lib/assignToGlobal'
import safeRun from './lib/safeRun'
import reportError from './lib/reportError'
import arrayDiff from './lib/arrayDiff'
import createElement from './tag/createElement'
import ErrorDefinedTwice from './views/ErrorDefinedTwice'
import NotFound from './views/NotFound'
import Main from './views/Main'

Promise.longStackTraces()

// GLOBALS
root._history = history // for imported modules to use
root._bluebird = Bluebird // for imported modules to use
root.Promise = Promise // for modules to use
root.on = on
root.module = {}
root.fetchJSON = (...args) => fetch(...args).then(res => res.json())

const uuid = () => Math.floor(Math.random() * 1000000)
const runEvents = (queue, name) =>
  queue && queue[name] && queue[name].length && queue[name].forEach(e => e())

export default function run(browserNode, userOpts, afterRenderCb) {
  const opts = Object.assign({
    namespace: {},
    entry: 'Main'
  }, userOpts)

  // error handling
  const prevOnError = root.onerror
  const flintOnError = (...args) => {
    prevOnError && prevOnError(...args)
    reportError(...args)
  }
  root.onerror = flintOnError

  const Internal = root._Flint = {
    viewCache: {}, // map of views in various files
    viewsInFile: {}, // current build up of running hot insertion
    currentHotFile: null, // current file that is running
    getCache: {}, // stores { path: { name: val } } for use in view.get()
    getCacheInit: {}, // stores the vars after a view is first run
    propsHashes: {}
  }

  let isRendering = 0
  let firstRender = true
  let mainHash
  let lastWorkingView = {}
  let preloaders = [] // async functions needed before loading app

  const emitter = ee({})

  function phash(_props) {
    const props = Object.keys(_props).reduce((acc, key) => {
      const prop = _props[key]

      if (React.isValidElement(prop)) {
        // TODO: traverse children
        acc[key] = prop.key
      }
      else {
        acc[key] = prop
      }

      return acc
    }, {})

    return hashsum(props)
  }

  let Flint = {
    router,
    range,

    views: {},
    removeView(key) { delete Flint.views[key] },

    render() {
      if (preloaders.length)
        Promise.all(preloaders.map(loader => loader())).then(run)
      else
        run()

      function run() {
        isRendering++

        // prevent too many re-render tries on react errors
        if (isRendering > 1) return

        firstRender = false
        const MainComponent = Flint.views.Main.component || lastWorkingView.Main

        if (!browserNode) {
          Flint.renderedToString = React.renderToString(<MainComponent />)
          afterRenderCb && afterRenderCb(Flint.renderedToString)
        }
        else {
          if (window.__isDevingDevTools)
            browserNode = '_flintdevtools'

          ReactDOM.render(<MainComponent />, document.getElementById(browserNode))
        }

        emitter.emit('afterRender')
        isRendering = 0
      }
    },

    // internal events
    on(name, cb) { emitter.on(name, cb) },

    // for use in jsx
    debug: () => { debugger },

    file(file, run) {
      // prevent infinite loop of re-renders on errors
      isRendering = 0

      Internal.viewsInFile[file] = []
      Internal.currentHotFile = file

      // run view, get exports
      let fileExports = {}
      run(fileExports)
      Flint.setExports(fileExports)

      const cached = Internal.viewCache[file] || []
      const _views = Internal.viewsInFile[file]

      // remove Internal.viewsInFile that werent made
      const removed = arrayDiff(cached, _views)
      removed.map(Flint.removeView)

      Internal.currentHotFile = null
      Internal.viewCache[file] = Internal.viewsInFile[file]

      // avoid tons of renders on start
      if (firstRender) return

      setTimeout(Flint.render)
    },

    deleteFile(name) {
      const weirdName = `/${name}`
      Internal.viewsInFile[weirdName].map(Flint.removeView)
      delete Internal.viewsInFile[weirdName]
      delete Internal.viewCache[weirdName]
      Flint.render()
    },

    makeReactComponent(name, view, options = {}) {
      const el = createElement(name)

      let component = React.createClass({
        displayName: name,
        name,
        Flint,
        el,

        childContextTypes: {
          path: React.PropTypes.string
        },

        contextTypes: {
          path: React.PropTypes.string
        },

        getChildContext() {
          // no need for paths/cache in production
          if (process.env.production) return {}
          return { path: this.getPath() }
        },

        // TODO: shouldComponentUpdate based on hot load for perf
        shouldComponentUpdate() {
          return !this.isPaused
        },

        shouldUpdate() {
          return (
            this.didMount && !this.isUpdating &&
            !this.isPaused && !this.firstRender
          )
        },

        set(name, val) {
          if (!process.env.production) {
            const path = this.getPath()
            Internal.getCache[path] = Internal.getCache[path] || {}
            Internal.getCache[path][name] = val
            console.log('set', name, val)
          }

          if (this.shouldUpdate())
            this.forceUpdate()
        },

        get(name, val) {
          // dont cache in prod / undefined
          if (process.env.production)
            return val

          const path = this.getPath()

          // setup caches
          if (!Internal.getCache[path])
            Internal.getCache[path] = {}
          if (!Internal.getCacheInit[path])
            Internal.getCacheInit[path] = {}

          const isComparable = typeof val == 'number' || typeof val == 'string'
          const lastInitialValue = Internal.getCacheInit[path][name]

          let originalValue, restore

          // if edited
          if (options.changed) {
            // initial value undefined
            if (typeof Internal.getCacheInit[path][name] != 'undefined') {

              // only hot update changed variables
              if (isComparable && lastInitialValue === val) {
                restore = true
                originalValue = Internal.getCache[path][name]
              }
            }

            Internal.getCacheInit[path][name] = val
          }

          // update
          if (!isComparable)
            Internal.getCache[path][name] = val
          else {
            if (options.unchanged && val !== lastInitialValue)
              return lastInitialValue
          }

          // change a variable in file scope thats passed into view, view should update init
          // if (options.unchanged && Internal.getCacheInit[path][name] != val) {
          //   Internal.getCacheInit[path][name] = val
          //   return val
          // }

          console.log(name, val, 'cache', Internal.getCache[path][name], 'init', Internal.getCacheInit[path][name])

          // if ending init, live inject old value for hotloading, or return actual value
          return restore ? originalValue : val
        },

        // LIFECYCLES

        getInitialState() {
          this.setPath()

          let u = void 0
          this.firstRender = true
          this.styles = { _static: {} }
          this.events = { mount: u, unmount: u, update: u, props: u }

          this.viewOn = (scope, name, cb) => {
            // check if they defined their own scope
            if (name && typeof name == 'string')
              return on(scope, name, cb)
            else
              return on(this, scope, name)
          }

          // cache Flint view render() (defined below)
          const flintRender = this.render

          this.renders = []

          // setter to capture view render
          this.render = renderFn => {
            this.renders.push(renderFn)
          }

          // call view
          view.call(this, this, this.viewOn, this.styles)

          // reset original render
          this.render = flintRender

          // ensure something renders
          if (!this.renders.length)
            this.renders.push(() => this.el([name.toLowerCase(), 0], { yield: true }))

          return null
        },

        getPath() {
          return `${this.path}-${this.props.__key || ''}`
        },

        setPath() {
          if (process.env.production)
            return

          let propsHash

          // get the props hash, but lets cache it so its not a ton of work
          if (options.changed === true) {
            propsHash = phash(this.props)
            Internal.propsHashes[this.context.path] = propsHash
            options.changed = 2
          }
          else if (!propsHash) {
            propsHash = Internal.propsHashes[this.context.path]

            if (!propsHash) {
              propsHash = phash(this.props)
              Internal.propsHashes[this.context.path] = propsHash
            }
          }

          this.path = (this.context.path || '') + ',' + name + '.' + propsHash
        },

        componentWillReceiveProps(nextProps) {
          this.props = nextProps
          runEvents(this.events, 'props')
        },

        componentDidMount() {
          this.didMount = true
          runEvents(this.events, 'mount')

          // set last working view for this hash
          if (!process.env.production) {
            if (!lastWorkingView[name] || options.changed || options.new) {
              lastWorkingView[name] = component
            }
          }
        },

        componentWillUnmount() {
          // fixes unmount errors #60
          if (!process.env.production) {
            this.render()
          }

          this.didMount = false
          runEvents(this.events, 'unmount')
        },

        componentWillMount() {
          // componentWillUpdate only runs after first render
          runEvents(this.events, 'update')
          runEvents(this.events, 'props')
        },

        componentWillUpdate() {
          this.isUpdating = true
          runEvents(this.events, 'update')
        },

        componentDidUpdate() {
          this.isUpdating = false
        },

        // FLINT HELPERS

        // helpers for controlling re-renders
        pause() { this.isPaused = true },
        resume() { this.isPaused = false },
        update() { this.forceUpdate() },

        // helpers for context
        childContext(obj) {
          if (!obj) return

          Object.keys(obj).forEach(key => {
            this.constructor.childContextTypes[key] =
              React.PropTypes[typeof obj[key]]
          })

          this.getChildContext = () => obj
        },

        render() {
          this.firstRender = false

          const singleTopEl = this.renders.length == 1
          let tags
          let wrap = true

          if (singleTopEl) {
            tags = [this.renders[0].call(this)]

            // if child tag name == view name, no wrapper
            if (tags[0].type == name.toLowerCase())
              wrap = false
          }
          else {
            tags = this.renders.map(r => r.call(this))
          }

          let els = !wrap ? tags[0] : this.el(`view.${name}`,
            // props
            {
              style: Object.assign(
                {},
                this.props.style,
                this.styles.$ && this.styles.$(),
                this.styles._static && this.styles._static.$
              )
            },
            ...tags
          )

          const styled = els && resolveStyles(this, els)
          return styled
        }
      })

      return component
    },

    getView(name, parentName) {
      let result

      // View.SubView
      const subName = `${parentName}.${name}`
      if (Flint.views[subName]) {
        result = Flint.views[subName].component
      }
      // regular view
      else if (Flint.views[name]) {
        result = Flint.views[name].component
      }
      else {
        result = NotFound(name)
      }

      return result
    },

    /*
      hash is the build systems hash of the view contents
        used for detecting changed views
    */
    view(name, body) {
      const comp = Flint.makeReactComponent.partial(name, body)

      if (process.env.production)
        setView(name, comp())

      const hash = hashsum(body)

      Internal.viewsInFile[Internal.currentHotFile].push(name)

      function makeView(hash, component) {
        return { hash, component }
      }

      function setView(name, component) {
        Flint.views[name] = makeView(hash, component)
        if (firstRender) return
      }

      // if new
      if (Flint.views[name] == undefined) {
        setView(name, comp({ hash, changed: true }))
        return
      }

      // not new
      // if defined twice during first run
      if (firstRender) {
        console.error('Defined a view twice!', name, hash)
        Flint.views[name] = ErrorDefinedTwice(name)
        return
      }

      // if unchanged
      if (Flint.views[name].hash == hash) {
        setView(name, comp({ hash, unchanged: true }))
        return
      }

      setView(name, comp({ hash, changed: true }))

      // check errors and restore last good view
      root.onerror = (...args) => {
        Flint.views[name] = makeView(hash, lastWorkingView[name])
        flintOnError(...args)
        setTimeout(Flint.render)
      }

      // then check for no errors and reset onerror
      emitter.on('afterRender', () => {
        root.onerror = flintOnError
      })

      Flint.render()

      // this resets tool errors
      window.onViewLoaded()
    },

    routeMatch(path) {
      router.add(path)
      return router.isActive(path)
    },

    routeParams(path) {
      return router.params(path)
    },

    // export globals
    setExports(_exports) {
      if (!_exports) return
      Object.freeze(_exports)
      const names = Object.keys(_exports)

      if (names.length) {
        names.forEach(name => {
          if (name === 'default') {
            Object.keys(_exports.default).forEach(key => {
              assignToGlobal(key, _exports.default[key])
            })
          }

          assignToGlobal(name, _exports[name])
        })
      }
    }
  };

  router.init(Flint.render)

  // shim root view
  opts.namespace.view = {
    update: () => {},
    el: createElement('_'),
    Flint
  }
  opts.namespace.Flint = Flint

  // prevent overwriting
  Object.freeze(Flint)

  return Flint
}