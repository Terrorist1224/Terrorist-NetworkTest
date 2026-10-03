import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const workspace = process.cwd()
const longRun = process.argv.includes('--long')
const output = resolve(workspace, '.tmp', 'smoke')
mkdirSync(output, { recursive: true })
const server = createServer((_request, response) => {
  response.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': 2 * 1024 * 1024
  })
  const chunk = Buffer.alloc(64 * 1024, 3)
  let sent = 0
  const interval = setInterval(() => {
    if (response.destroyed) {
      clearInterval(interval)
      return
    }
    response.write(chunk)
    sent++
    if (sent === 32) {
      clearInterval(interval)
      response.end()
    }
  }, 200)
  response.on('close', () => clearInterval(interval))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const port = server.address().port
const electron = spawn(
  resolve(workspace, 'node_modules/electron/dist/electron.exe'),
  ['--remote-debugging-port=9223', '.'],
  {
    cwd: workspace,
    env: { ...process.env, NETWORKTEST_DATA_DIR: '.tmp/smoke/user-data' },
    stdio: 'ignore'
  }
)

async function waitFor(fn, timeout = 10000) {
  const started = Date.now()
  while (true) {
    try {
      const result = await fn()
      if (result) return result
    } catch {
      /* app still starting */
    }
    if (Date.now() - started > timeout) throw new Error('Timed out waiting for Electron')
    await new Promise((done) => setTimeout(done, 100))
  }
}

async function targets() {
  const response = await fetch('http://127.0.0.1:9223/json/list')
  return response.json()
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolveOpen, reject) => {
    socket.onopen = resolveOpen
    socket.onerror = reject
  })
  let nextId = 0
  const pending = new Map()
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data)
    if (!data.id || !pending.has(data.id)) return
    const { resolve: done, reject } = pending.get(data.id)
    pending.delete(data.id)
    data.error ? reject(new Error(data.error.message)) : done(data.result)
  }
  return {
    call(method, params = {}) {
      return new Promise((done, reject) => {
        const id = ++nextId
        pending.set(id, { resolve: done, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close: () => socket.close()
  }
}

async function evaluate(client, expression) {
  const result = await client.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

try {
  const mainTarget = await waitFor(async () =>
    (await targets()).find(
      (target) => target.type === 'page' && !target.url.startsWith('devtools://')
    )
  )
  const main = await connect(mainTarget)
  assert.equal(await evaluate(main, 'typeof window.networkTest'), 'object')
  const initial = await evaluate(
    main,
    'window.networkTest.snapshot().then(s => ({running:s.running,channels:s.channels.length}))'
  )
  assert.equal(initial.running, false)
  assert.ok(initial.channels >= 2)
  const mainPng = await main.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(output, 'main.png'), Buffer.from(mainPng.data, 'base64'))

  const channelId = await evaluate(
    main,
    `window.networkTest.addChannel('本地集成测试','http://127.0.0.1:${port}/blob').then(s => s.channels.at(-1).id)`
  )
  await evaluate(
    main,
    `window.networkTest.start({channelId:'${channelId}',threadCount:2,maxDurationSec:${longRun ? 30 : 10},maxBytes:${longRun ? 1024 ** 3 : 1048576}})`
  )
  const final = await waitFor(
    async () => {
      const state = await evaluate(
        main,
        'window.networkTest.snapshot().then(s => ({running:s.running,reason:s.record?.stopReason,bytes:s.record?.totalBytes,samples:s.record?.samples.length}))'
      )
      return state.running ? null : state
    },
    longRun ? 35000 : 10000
  )
  assert.equal(final.reason, longRun ? 'time-limit' : 'traffic-limit')
  assert.ok(final.bytes >= 1048576)
  assert.ok(final.samples >= 1)
  const history = await evaluate(
    main,
    'window.networkTest.history().then(items => items.map(item => item.stopReason))'
  )
  assert.ok(history.includes(final.reason))
  await waitFor(
    async () => await evaluate(main, "document.querySelectorAll('.nav-item').length === 2")
  )
  await evaluate(main, "document.querySelectorAll('.nav-item')[1].click(); true")
  await waitFor(
    async () =>
      await evaluate(
        main,
        "document.querySelector('.history-item')?.textContent.includes('本地') || document.querySelector('.history-item') !== null"
      )
  )
  const historyPng = await main.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(output, 'history.png'), Buffer.from(historyPng.data, 'base64'))
  await evaluate(main, 'setTimeout(() => window.networkTest.closeMain(), 50); true')
  await waitFor(
    async () =>
      !(await targets()).some(
        (target) => target.type === 'page' && !target.url.startsWith('devtools://')
      )
  )
  let processAlive = true
  try {
    process.kill(electron.pid, 0)
  } catch {
    processAlive = false
  }
  assert.ok(processAlive, 'closing the main window should leave the tray process running')
  console.log(
    JSON.stringify({
      result: 'passed',
      final,
      screenshots: ['main.png', 'history.png'].map((name) => resolve(output, name)),
      trayResidentAfterClose: processAlive
    })
  )
  main.close()
} finally {
  server.close()
  if (electron.pid)
    spawnSync('taskkill', ['/PID', String(electron.pid), '/T', '/F'], { stdio: 'ignore' })
}
