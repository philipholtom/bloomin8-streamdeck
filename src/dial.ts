/**
 * Shared bits for actions placed on a Stream Deck + dial.
 */

/** Steps through `options` by `ticks` (either direction), wrapping round. */
export function step<T>(options: T[], current: T, ticks: number): T {
    if (options.length === 0) return current;
    const index = Math.max(0, options.indexOf(current));
    return options[(((index + ticks) % options.length) + options.length) % options.length];
}

/**
 * Calls `save` once the dial has stopped turning for a moment, so a fast spin
 * doesn't write the settings on every tick.
 */
export function debouncer(delayMs = 600): (id: string, save: () => void) => void {
    const timers = new Map<string, NodeJS.Timeout>();
    return (id, save) => {
        clearTimeout(timers.get(id));
        timers.set(
            id,
            setTimeout(() => {
                timers.delete(id);
                save();
            }, delayMs),
        );
    };
}
