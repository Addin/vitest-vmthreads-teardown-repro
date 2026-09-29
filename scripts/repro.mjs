import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const VERSIONS = { vitest4: '4.1.11', vitest5: '5.0.2' }
const WATCHDOG_MS = 15_000
const SIGTERM_GRACE_MS = 5_000
const TIMEOUT_LOG = 'Timeout terminating'

const header = (text) => `\n=== ${text} ===\n`
const elapsed = (from) => `${((Date.now() - from) / 1000).toFixed(1)}s`

function spawnVitest(alias, extraArgs) {
  const entry = resolve(root, 'node_modules', alias, 'vitest.mjs')
  const child = spawn(process.execPath, [entry, 'run', ...extraArgs], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = []
  const pipe = (stream, sink) => {
    stream.on('data', (chunk) => {
      output.push(chunk)
      sink.write(chunk)
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  return {
    child,
    output: () => Buffer.concat(output).toString('utf8'),
    exited: new Promise((resolveExit) => {
      child.once('exit', (code, signal) => resolveExit({ code, signal }))
    }),
  }
}

async function scenarioStuckWorker(alias) {
  process.stdout.write(header(`vitest ${VERSIONS[alias]} - worker that never stops (pool=vmThreads)`))
  const startedAt = Date.now()
  const run = spawnVitest(alias, [])
  const withinBudget = await Promise.race([run.exited, sleep(WATCHDOG_MS).then(() => 'alive')])

  if (withinBudget !== 'alive') {
    process.stdout.write(`\nNOT REPRODUCED: vitest exited on its own after ${elapsed(startedAt)}\n`)
    return false
  }

  process.stdout.write(`\nREPRODUCED: vitest is still alive after ${WATCHDOG_MS / 1000}s of a 2 file run\n`)
  run.child.kill('SIGTERM')
  const afterSigterm = await Promise.race([run.exited, sleep(SIGTERM_GRACE_MS).then(() => 'alive')])
  if (afterSigterm === 'alive') {
    process.stdout.write('  SIGTERM was ignored by the wedged process\n')
    run.child.kill('SIGKILL')
    await run.exited
    process.stdout.write('  SIGKILL was the only thing that released it\n')
  } else {
    process.stdout.write(`  SIGTERM released it after ${elapsed(startedAt)}, and it never finished on its own\n`)
  }
  return true
}

async function scenarioTeardownTimeoutOnlyLogs(alias) {
  process.stdout.write(header(`vitest ${VERSIONS[alias]} - teardown timeout has no teeth (--teardownTimeout 1)`))
  const run = spawnVitest(alias, ['--teardownTimeout', '1', 'src/plain.spec.ts'])
  const result = await run.exited
  const logged = run.output().includes(TIMEOUT_LOG)

  process.stdout.write(`\n  log line emitted ....... ${logged ? 'yes' : 'no'}\n`)
  process.stdout.write(`  process still exited .... ${result.code === 0 ? 'yes' : `no (code ${result.code})`}\n`)
  process.stdout.write(
    logged
      ? '  -> the worker was healthy and the run finished; the timeout only logged and terminated nothing\n'
      : '  -> the timeout path was not reached\n',
  )
  return logged
}

const alias = process.argv[2]
if (!VERSIONS[alias]) {
  process.stderr.write(`usage: node scripts/repro.mjs <${Object.keys(VERSIONS).join('|')}>\n`)
  process.exit(2)
}

const stuck = await scenarioStuckWorker(alias)
const onlyLogs = await scenarioTeardownTimeoutOnlyLogs(alias)
process.stdout.write(
  `\n${alias}: stuck worker reproduced: ${stuck ? 'yes' : 'no'} | teardown timeout only logs: ${onlyLogs ? 'yes' : 'no'}\n`,
)
process.exit(stuck && onlyLogs ? 0 : 1)
