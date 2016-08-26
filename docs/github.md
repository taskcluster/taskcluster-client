# TaskCluster GitHub API Documentation

##

The github service, typically available at
`github.taskcluster.net`, is responsible for publishing pulse
messages in response to GitHub events.

This document describes the API end-point for consuming GitHub
web hooks

## Github Client

```js
// Create Github client instance with default baseUrl:
// https://github.taskcluster.net/v1

const github = new taskcluster.Github(options);
```

## Methods in Github Client

```js
// github.githubWebHookConsumer :: () -> Promise Nothing
github.githubWebHookConsumer()

```

```js
// github.ping :: () -> Promise Nothing
github.ping()

```

