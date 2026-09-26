export class EventEmitter {
  constructor() {
    this.events = {};
  }

  on(event, listener) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(listener);
    return this;
  }

  once(event, listener) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    this.on(event, wrapper);
    return this;
  }

  off(event, listener) {
    if (!this.events[event]) return this;
    this.events[event] = this.events[event].filter((l) => l !== listener);
    return this;
  }

  emit(event, ...args) {
    if (!this.events[event]) return false;
    // BUG: Iterating over this.events[event] directly while it's modified by off() skips elements
    for (let i = 0; i < this.events[event].length; i++) {
      this.events[event][i](...args);
    }
    return true;
  }
}
