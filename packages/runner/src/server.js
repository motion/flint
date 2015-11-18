// runs server in seperate process
// trying to prevent server death when in Focus mode
// which does heavy requesting

import cp from 'child_process'
import runner from './index'
import opts from './opts'
import internal from './internal'

export function run() {
  return new Promise((res, rej) => {
    let child = cp.fork(__dirname + '/serverProcess', '', {
      // for express to run quickly
      env: { NODE_ENV: 'production' }
    })

    runner.setChild(child)

    child.send(JSON.stringify(opts.get()))

    child.once('message', message => {
      let { port, host } = JSON.parse(message)

      opts.set('port', port)
      opts.set('host', host)

      internal.setServerState()

      res()
    })

    // send opts after first build complete
    let sendOpts = setInterval(() => {
      if (opts.get('hasRunInitialBuild')) {
        child.send(JSON.stringify(opts.get()))
        clearInterval(sendOpts)
      }
    }, 150)
  })
}

export function url() {
  const host = opts.get('host')
  const port = opts.get('port')
  return host + (port && port !== 80 ? ':' + port : '')
}

export default { run, url }