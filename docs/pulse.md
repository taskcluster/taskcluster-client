# Pulse Management Service

##

The taskcluster-pulse service, typically available at `pulse.taskcluster.net`
manages pulse credentials for taskcluster users.

A service to manage Pulse credentials for anything using
Taskcluster credentials. This allows us self-service and
greater control within the Taskcluster project.

## Pulse Client

```js
// Create Pulse client instance with default baseUrl:
// https://pulse.taskcluster.net/v1

const pulse = new taskcluster.Pulse(options);
```

## Methods in Pulse Client

```js
// pulse.ping :: () -> Promise Nothing
pulse.ping()

```

```js
// pulse.overview :: () -> Promise Result
pulse.overview()

```

```js
// pulse.namespace :: (namespace -> payload) -> Promise Nothing
pulse.namespace(namespace, payload)

```

