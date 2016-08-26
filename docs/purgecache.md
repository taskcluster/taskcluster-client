# Purge Cache API Documentation

##

The purge-cache service, typically available at
`purge-cache.taskcluster.net`, is responsible for publishing a pulse
message for workers, so they can purge cache upon request.

This document describes the API end-point for publishing the pulse
message. This is mainly intended to be used by tools.

## PurgeCache Client

```js
// Create PurgeCache client instance with default baseUrl:
// https://purge-cache.taskcluster.net/v1

const purgeCache = new taskcluster.PurgeCache(options);
```

## Methods in PurgeCache Client

```js
// purgeCache.purgeCache :: (provisionerId -> workerType -> payload) -> Promise Nothing
purgeCache.purgeCache(provisionerId, workerType, payload)

```

```js
// purgeCache.ping :: () -> Promise Nothing
purgeCache.ping()

```

