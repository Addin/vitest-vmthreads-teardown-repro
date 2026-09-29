# vitest #11371 - vmThreads teardown never force-terminates a stuck worker

Minimal reproduction for <https://github.com/vitest-dev/vitest/issues/11371>.

Two spec files, no Angular, no 214 file suite, no CPU or memory pressure. Every run.

```bash
npm install
npm run repro        # vitest 4.1.11
npm run repro:5      # vitest 5.0.2
npm run repro:both   # both
```

Both scripts run the same two scenarios and exit `0` only when both reproduce.

## Scenario 1 - a worker that never stops keeps the whole process alive

`src/leftover.spec.ts` passes, then leaves a task behind in its worker thread.
`src/plain.spec.ts` is an ordinary passing file.

`vitest run` never finishes and never exits. The watchdog in `scripts/repro.mjs`
reports how long the process stayed alive and what finally released it.

## Scenario 2 - the teardown timeout only logs

`--teardownTimeout 1` is the smallest value the pool accepts, and a single
healthy spec file is enough to reach the branch in `Pool.schedule()`:

```js
const id = setTimeout(() => this.logger.error(
  `[vitest-pool]: Timeout terminating ${task.worker} worker for test files ${formatFiles(task)}.`
), this.options.teardownTimeout)
this.exitPromises.push(runner.stop({ force: resolver.isRejected })
  .then(() => clearTimeout(id))
  .catch(...))
```

The worker is healthy, the run passes, the process exits `0` - and the timeout
line is printed anyway. Nothing is terminated, because nothing needs to be.
The timeout is a log statement, not a deadline.

That is the whole defect: `teardownTimeout` elapsing changes nothing. When it
elapses for real, the worker is still only stopped by
`PoolRunner.stop()`, which gives up at its own hard coded `STOP_TIMEOUT` of
60s - and it gives up *before* calling `this.worker.stop()`, so the thread is
never terminated and `Pool.close()` keeps awaiting an `exitPromises` entry that
never settles. Force terminating on `teardownTimeout`, or rejecting the stop
promise, is what keeps the process alive.
