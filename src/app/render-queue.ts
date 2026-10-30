// Work for the worker, one job at a time, most urgent first: what is on screen before its neighbours,
// neighbours before thumbnails, thumbnails before reading the text in the background.
// A job nobody waits for any more is dropped.
import { useEffect, useEffectEvent, useRef } from "react";
import { call } from "./engine";

export const Priority = { visible: 0, nearby: 1, thumbnail: 2, text: 3 } as const;

type Job = {
	priority: number;
	order: number;
	cancelled: boolean;
	run: () => Promise<unknown>;
	done: (result: unknown) => void;
	/** Frees a result that arrives for a cancelled job (a page image). */
	dispose?: (result: unknown) => void;
};

export type Ticket = { cancel: () => void; setPriority: (priority: number) => void };

const queue: Job[] = [];
let busy = false;
let lastOrder = 0;

function pump() {
	if (busy) return;
	const live = queue.filter((job) => !job.cancelled);
	queue.length = 0;
	queue.push(...live);
	if (queue.length === 0) return;
	queue.sort((a, b) => a.priority - b.priority || a.order - b.order);
	const job = queue.shift()!;
	busy = true;
	job
		.run()
		.then(
			(result) => (job.cancelled ? job.dispose?.(result) : job.done(result)),
			(error: Error) => job.cancelled || job.done(error),
		)
		.finally(() => {
			busy = false;
			pump();
		});
}

/** Queues `run`; `done` gets its result or the Error it failed with, unless the ticket was cancelled first. */
export function enqueue<T>(priority: number, run: () => Promise<T>, done: (result: T | Error) => void, dispose?: (result: T) => void): Ticket {
	const job: Job = {
		priority,
		order: ++lastOrder,
		cancelled: false,
		run,
		done: done as (result: unknown) => void,
		dispose: dispose as ((result: unknown) => void) | undefined,
	};
	queue.push(job);
	pump();
	return {
		cancel: () => void (job.cancelled = true),
		setPriority: (p) => void (job.priority = p),
	};
}

/**
 * Renders a page whenever source, page or scale change; `onResult` receives the bitmap (and owns it) or the
 * error. A render still waiting when the component goes away or the scale changes is cancelled.
 */
export function usePageRender(
	sourceId: string,
	pageIndex: number,
	scale: number,
	priority: number,
	onResult: (result: ImageBitmap | Error) => void,
) {
	const ticket = useRef<Ticket | null>(null);
	const deliver = useEffectEvent(onResult);

	useEffect(() => {
		const current = enqueue(
			priority,
			() => call("renderPage", sourceId, pageIndex, scale),
			(result) => deliver(result),
			(bitmap) => bitmap.close(),
		);
		ticket.current = current;
		return current.cancel;
		// Not on priority: a priority change alone must not restart the render; the effect below updates it in place.
	}, [sourceId, pageIndex, scale]);

	useEffect(() => {
		ticket.current?.setPriority(priority);
	}, [priority]);
}
