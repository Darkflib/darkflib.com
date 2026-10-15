interface Timed {
  t: number
}

/** Binary min-heap on `t`: the event queue. */
export class Heap<T extends Timed> {
  #a: T[] = []

  get size(): number {
    return this.#a.length
  }

  peek(): T | undefined {
    return this.#a[0]
  }

  push(e: T): void {
    const a = this.#a
    a.push(e)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].t <= a[i].t) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }

  pop(): T | undefined {
    const a = this.#a
    const top = a[0]
    const last = a.pop()
    if (a.length && last !== undefined) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l].t < a[m].t) m = l
        if (r < a.length && a[r].t < a[m].t) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

/** Array-backed deque, so FIFO shift stays O(1) when the queue is tens of thousands deep. */
export class Deque<T> {
  #items: (T | undefined)[] = []
  #head = 0

  get length(): number {
    return this.#items.length - this.#head
  }

  push(x: T): void {
    this.#items.push(x)
  }

  get(i: number): T {
    return this.#items[this.#head + i] as T
  }

  shift(): T | undefined {
    if (!this.length) return undefined
    const x = this.#items[this.#head]
    this.#items[this.#head++] = undefined
    if (this.#head > 1024 && this.#head * 2 > this.#items.length) {
      this.#items = this.#items.slice(this.#head)
      this.#head = 0
    }
    return x
  }

  pop(): T | undefined {
    if (!this.length) return undefined
    return this.#items.pop()
  }
}
