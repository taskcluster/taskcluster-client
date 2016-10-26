import createDebugger from 'debug';

export default createDebugger('taskcluster-client');
export const pulse = createDebugger('taskcluster-client:PulseListener');
