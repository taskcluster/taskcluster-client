# Documentation

This documentation in this directory is automatically generated from the API entries
defined in [apis.json](../apis.json). Detailed documentation with description, payload,
and result format details is available on [docs.taskcluster.net](http://docs.taskcluster.net).

On the [documentation site](http://docs.taskcluster.net) entries often have a
_signature_; you'll find that it corresponds with the signatures below. Notice that all
the methods return a `Promise`. A method marked `Promise Result` a Promise that
resolves with the API result. A method marked with `Promise Nothing` will also return a
promise but has no resulting value from the API to resolve. Remember to `catch` any errors
that may be rejected from a Promise.

- [Auth](auth.md)
- [AuthEvents](authevents.md)
- [AwsProvisioner](awsprovisioner.md)
- [AwsProvisionerEvents](awsprovisionerevents.md)
- [Github](github.md)
- [GithubEvents](githubevents.md)
- [Hooks](hooks.md)
- [Index](index.md)
- [Login](login.md)
- [Notify](notify.md)
- [Pulse](pulse.md)
- [PurgeCache](purgecache.md)
- [PurgeCacheEvents](purgecacheevents.md)
- [Queue](queue.md)
- [QueueEvents](queueevents.md)
- [Scheduler](scheduler.md)
- [SchedulerEvents](schedulerevents.md)
- [Secrets](secrets.md)
- [TreeherderEvents](treeherderevents.md)
