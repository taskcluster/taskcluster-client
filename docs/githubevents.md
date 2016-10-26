# TaskCluster-Github Exchanges

##

The github service, typically available at
`github.taskcluster.net`, is responsible for publishing a pulse
message for supported github events.

This document describes the exchange offered by the taskcluster
github service



## GithubEvents Client

```js
// Create GithubEvents client instance with default exchangePrefix:
// exchange/taskcluster-github/v1/

const githubEvents = new taskcluster.GithubEvents(options);
```

## Exchanges in GithubEvents Client

```js
// githubEvents.pullRequest :: routingKeyPattern -> Promise BindingInfo
githubEvents.pullRequest(routingKeyPattern)
```

```js
// githubEvents.push :: routingKeyPattern -> Promise BindingInfo
githubEvents.push(routingKeyPattern)
```