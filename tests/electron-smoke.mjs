import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const workspace = process.cwd()
const longRun = process.argv.includes('--long')
const packagedRun = process.argv.includes('--packaged')
const output = packagedRun
  ? resolve(workspace, '.tmp', `packaged-smoke-${process.pid}-${Date.now()}`)
  : resolve(workspace, '.tmp', 'smoke')
const userDataDirectory = resolve(output, `user-data-${process.pid}-${Date.now()}`)
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
const executable = packagedRun
  ? resolve(workspace, 'release/win-unpacked/TerroristNetWorkTest.exe')
  : resolve(workspace, 'node_modules/electron/dist/electron.exe')
const electron = spawn(
  executable,
  packagedRun ? ['--remote-debugging-port=9223'] : ['--remote-debugging-port=9223', '.'],
  {
    cwd: packagedRun ? resolve(workspace, 'release/win-unpacked') : workspace,
    env: {
      ...process.env,
      ...(packagedRun
        ? { NETWORKTEST_APP_DATA_DIR: userDataDirectory }
        : { NETWORKTEST_DATA_DIR: userDataDirectory })
    },
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
  assert.ok(initial.channels >= 1)
  assert.equal(await evaluate(main, "typeof window.networkTest.channelHealth === 'function'"), true)
  const initialHealth = await evaluate(
    main,
    'window.networkTest.channelHealth().then(health => Object.values(health).map(item => item.status))'
  )
  assert.equal(initialHealth.length, initial.channels)
  assert.ok(
    initialHealth.every((status) => ['checking', 'fast', 'slow', 'unavailable'].includes(status))
  )
  await waitFor(async () => await evaluate(main, "document.getElementById('channel') !== null"))
  await evaluate(main, "document.getElementById('channel').click(); true")
  const channelRows = await waitFor(async () => {
    const rows = await evaluate(
      main,
      'Array.from(document.querySelectorAll(\'[role=\\"listbox\\"] [role=\\"option\\"]\')).filter(row => row.querySelector(\'.speed-select__health\')).map(row => row.textContent.trim())'
    )
    return rows.length ? rows : null
  })
  assert.ok(channelRows.some((row) => row.includes('自动（最低延迟）')))
  assert.ok(channelRows.every((row) => !/Cloudflare|Cachefly|Steam|全球通道/i.test(row)))
  for (const row of channelRows.filter((item) => !item.includes('自动（最低延迟）'))) {
    const latency = row.match(/(\d+) ms/)
    assert.ok(latency, `manual node should show an eligible latency: ${row}`)
    assert.ok(Number(latency[1]) <= 300, `manual node exceeds 300 ms: ${row}`)
  }
  const chartCount = await evaluate(
    main,
    "document.querySelectorAll('.live-charts .speed-chart').length"
  )
  assert.equal(chartCount, 2)
  const chartPositions = await evaluate(
    main,
    "Array.from(document.querySelectorAll('.live-charts .chart-card')).map(card => { const rect = card.getBoundingClientRect(); return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom} })"
  )
  assert.ok(chartPositions[1].left >= chartPositions[0].right)
  const chartUnits = await evaluate(
    main,
    "Array.from(document.querySelectorAll('.chart-title .chart-unit')).map(unit => unit.textContent.trim())"
  )
  assert.deepEqual(chartUnits, ['MB/s', 'MB/s'])
  await evaluate(main, "document.getElementById('channel').click(); true")
  await evaluate(main, "document.getElementById('test-mode').click(); true")
  const modes = await evaluate(
    main,
    'Array.from(document.querySelectorAll(\'[role="listbox"][aria-label="测速规则"] [role="option"] .speed-select__option-label\')).map(row => row.textContent.trim())'
  )
  assert.deepEqual(modes, ['下行', '上行', '并行'])
  await evaluate(
    main,
    'Array.from(document.querySelectorAll(\'[role="listbox"][aria-label="测速规则"] [role="option"]\')).find(row => row.textContent.includes(\'并行\')).click(); true'
  )
  await waitFor(
    async () =>
      await evaluate(
        main,
        "window.networkTest.snapshot().then(s => s.settings.mode === 'parallel')"
      )
  )
  const parallelMetrics = await evaluate(
    main,
    "Array.from(document.querySelectorAll('.metric-label')).map(item => item.textContent.trim())"
  )
  assert.deepEqual(parallelMetrics, [
    '下行速度',
    '下行带宽',
    '下行流量',
    '上行速度',
    '上行带宽',
    '上行流量',
    '合计速度',
    '合计带宽',
    '合计流量'
  ])
  const parallelPng = await main.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(output, 'parallel.png'), Buffer.from(parallelPng.data, 'base64'))
  await evaluate(main, "document.getElementById('test-mode').click(); true")
  await evaluate(
    main,
    'Array.from(document.querySelectorAll(\'[role="listbox"][aria-label="测速规则"] [role="option"]\')).find(row => row.textContent.includes(\'上行\')).click(); true'
  )
  await waitFor(
    async () =>
      await evaluate(main, "window.networkTest.snapshot().then(s => s.settings.mode === 'upload')")
  )
  await evaluate(main, "document.getElementById('channel').click(); true")
  const uploadChannels = await evaluate(
    main,
    'Array.from(document.querySelectorAll(\'[role="listbox"][aria-label="测速通道"] [role="option"]\')).map(row => row.textContent.trim())'
  )
  assert.ok(uploadChannels.some((label) => label.includes('自动（最低延迟）')))
  assert.ok(uploadChannels.every((label) => !/Cloudflare|Cachefly|Steam|全球通道/i.test(label)))
  await evaluate(main, "document.getElementById('channel').click(); true")
  await evaluate(main, "document.getElementById('test-mode').click(); true")
  await evaluate(
    main,
    'Array.from(document.querySelectorAll(\'[role="listbox"][aria-label="测速规则"] [role="option"]\')).find(row => row.textContent.trim() === \'下行\').click(); true'
  )
  await waitFor(
    async () =>
      await evaluate(
        main,
        "window.networkTest.snapshot().then(s => s.settings.mode === 'download')"
      )
  )
  const compactPage = await evaluate(
    main,
    "({scrollHeight:document.querySelector('.content').scrollHeight,clientHeight:document.querySelector('.content').clientHeight})"
  )
  assert.ok(
    compactPage.scrollHeight <= compactPage.clientHeight,
    `live page should fit without a scrollbar: ${JSON.stringify(compactPage)}`
  )
  assert.doesNotMatch(
    await evaluate(main, "document.querySelector('.hero-row')?.innerText ?? ''"),
    /上次上行速度|上次下行速度/
  )
  assert.doesNotMatch(
    await evaluate(main, "document.querySelector('.progress-caption')?.innerText ?? ''"),
    /下行.*上行/
  )
  await evaluate(
    main,
    "Array.from(document.querySelectorAll('.bottom-tools button')).find(button => button.textContent.includes('添加自定义通道'))?.click(); true"
  )
  const expandedPage = await evaluate(
    main,
    "({scrollHeight:document.querySelector('.content').scrollHeight,clientHeight:document.querySelector('.content').clientHeight})"
  )
  assert.ok(
    expandedPage.scrollHeight <= expandedPage.clientHeight,
    `expanded live page should fit without a scrollbar: ${JSON.stringify(expandedPage)}`
  )
  await evaluate(
    main,
    "Array.from(document.querySelectorAll('.bottom-tools button')).find(button => button.textContent.includes('收起自定义通道'))?.click(); true"
  )
  const mainPng = await main.call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(output, 'main.png'), Buffer.from(mainPng.data, 'base64'))
  await evaluate(main, "document.getElementById('channel').click(); true")

  const channelId = await evaluate(
    main,
    `window.networkTest.addChannel('本地集成测试','http://127.0.0.1:${port}/blob').then(s => s.channels.at(-1).id)`
  )
  await evaluate(
    main,
    `window.networkTest.start({mode:'download',channelId:'${channelId}',channelSelection:'manual',threadCount:2,maxDurationSec:${longRun ? 30 : 10},maxBytes:${longRun ? 1024 ** 3 : 1048576}})`
  )
  const lockedChannel = await evaluate(
    main,
    'window.networkTest.setChannelSelection("auto").then(s => ({running:s.running,channelId:s.settings.channelId,selection:s.settings.channelSelection}))'
  )
  assert.deepEqual(lockedChannel, { running: true, channelId, selection: 'auto' })
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
  const historyCharts = await evaluate(
    main,
    "Array.from(document.querySelectorAll('.detail-chart .speed-chart-wrap')).map(chart => { const rect = chart.getBoundingClientRect(); return {left:rect.left,right:rect.right} })"
  )
  assert.equal(historyCharts.length, 2)
  assert.ok(historyCharts[1].left >= historyCharts[0].right)
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
      screenshots: ['main.png', 'parallel.png', 'history.png'].map((name) => resolve(output, name)),
      trayResidentAfterClose: processAlive
    })
  )
  main.close()
} finally {
  server.close()
  if (electron.pid)
    spawnSync('taskkill', ['/PID', String(electron.pid), '/T', '/F'], { stdio: 'ignore' })
  if (packagedRun) {
    await new Promise((done) => setTimeout(done, 1000))
    try {
      rmSync(output, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    } catch (error) {
      console.error(`Could not clean packaged smoke files at ${output}:`, error)
    }
  }
}
