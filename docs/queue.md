# Queue API Documentation

##

The queue, typically available at `queue.taskcluster.net`, is responsible
for accepting tasks and track their state as they are executed by
workers. In order ensure they are eventually resolved.

This document describes the API end-points offered by the queue. These 
end-points targets the following audience:
 * Schedulers, who create tasks to be executed,
 * Workers, who execute tasks, and
 * Tools, that wants to inspect the state of a task.

## Queue Client

```js
// Create Queue client instance with default baseUrl:
// https://queue.taskcluster.net/v1

const queue = new taskcluster.Queue(options);
```

## Methods in Queue Client

```js
// queue.task :: taskId -> Promise Result
queue.task(taskId)

```

```js
// queue.status :: taskId -> Promise Result
queue.status(taskId)

```

```js
// queue.listTaskGroup :: (taskGroupId -> [options]) -> Promise Result
queue.listTaskGroup(taskGroupId)
queue.listTaskGroup(taskGroupId, options)
```

```js
// queue.listDependentTasks :: (taskId -> [options]) -> Promise Result
queue.listDependentTasks(taskId)
queue.listDependentTasks(taskId, options)
```

```js
// queue.createTask :: (taskId -> payload) -> Promise Result
queue.createTask(taskId, payload)

```

```js
// queue.defineTask :: (taskId -> payload) -> Promise Result
queue.defineTask(taskId, payload)

```

```js
// queue.scheduleTask :: taskId -> Promise Result
queue.scheduleTask(taskId)

```

```js
// queue.rerunTask :: taskId -> Promise Result
queue.rerunTask(taskId)

```

```js
// queue.cancelTask :: taskId -> Promise Result
queue.cancelTask(taskId)

```

```js
// queue.pollTaskUrls :: (provisionerId -> workerType) -> Promise Result
queue.pollTaskUrls(provisionerId, workerType)

```

```js
// queue.claimWork :: (provisionerId -> workerType -> payload) -> Promise Result
queue.claimWork(provisionerId, workerType, payload)

```

```js
// queue.claimTask :: (taskId -> runId -> payload) -> Promise Result
queue.claimTask(taskId, runId, payload)

```

```js
// queue.reclaimTask :: (taskId -> runId) -> Promise Result
queue.reclaimTask(taskId, runId)

```

```js
// queue.reportCompleted :: (taskId -> runId) -> Promise Result
queue.reportCompleted(taskId, runId)

```

```js
// queue.reportFailed :: (taskId -> runId) -> Promise Result
queue.reportFailed(taskId, runId)

```

```js
// queue.reportException :: (taskId -> runId -> payload) -> Promise Result
queue.reportException(taskId, runId, payload)

```

```js
// queue.createArtifact :: (taskId -> runId -> name -> payload) -> Promise Result
queue.createArtifact(taskId, runId, name, payload)

```

```js
// queue.getArtifact :: (taskId -> runId -> name) -> Promise Nothing
queue.getArtifact(taskId, runId, name)

```

```js
// queue.getLatestArtifact :: (taskId -> name) -> Promise Nothing
queue.getLatestArtifact(taskId, name)

```

```js
// queue.listArtifacts :: (taskId -> runId -> [options]) -> Promise Result
queue.listArtifacts(taskId, runId)
queue.listArtifacts(taskId, runId, options)
```

```js
// queue.listLatestArtifacts :: (taskId -> [options]) -> Promise Result
queue.listLatestArtifacts(taskId)
queue.listLatestArtifacts(taskId, options)
```

```js
// queue.pendingTasks :: (provisionerId -> workerType) -> Promise Result
queue.pendingTasks(provisionerId, workerType)

```

```js
// queue.ping :: () -> Promise Nothing
queue.ping()

```

