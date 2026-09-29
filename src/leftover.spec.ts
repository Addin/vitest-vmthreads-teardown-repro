import { expect, it } from 'vitest'

function spinForever(): void {
  for (;;) {
    // holds the worker thread; never yields, so the worker never answers `stop`
  }
}

it('leaves work behind in the worker', () => {
  expect(1 + 1).toBe(2)
  setTimeout(spinForever, 0)
})
