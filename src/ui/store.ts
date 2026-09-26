/**
 * Tiny external stores for the React UI.
 *
 * The game loop is not React — it runs at 60fps on a fixed-step simulation and
 * must never be throttled by a render. So the engine pushes state into these
 * stores and React subscribes with `useSyncExternalStore`. HUD state lives in
 * its own store so a charge bar ticking at 60fps never re-renders a menu.
 */

export type Listener = () => void;

export class Store<T> {
  private state: T;
  private listeners = new Set<Listener>();

  constructor(initial: T) {
    this.state = initial;
    this.get = this.get.bind(this);
    this.subscribe = this.subscribe.bind(this);
  }

  get(): T {
    return this.state;
  }

  /** Replace state and notify. Pass a partial patch for objects. */
  set(patch: Partial<T> | ((prev: T) => T)): void {
    const next =
      typeof patch === 'function'
        ? (patch as (prev: T) => T)(this.state)
        : { ...this.state, ...patch };
    if (next === this.state) return;
    this.state = next;
    for (const l of this.listeners) l();
  }

  /** Notify without changing the object identity (for mutable sub-objects). */
  bump(): void {
    for (const l of this.listeners) l();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
