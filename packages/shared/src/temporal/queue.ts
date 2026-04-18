/**
 * Default Temporal task queue name. Both the API (which starts workflows)
 * and the worker (which polls them) must agree — keep the literal here.
 */
export const DEFAULT_TEMPORAL_TASK_QUEUE = 'conduit-workflows';
