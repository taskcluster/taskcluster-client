# Login API

##

The Login service serves as the interface between external authentication
systems and TaskCluster credentials.  It acts as the server side of
https://tools.taskcluster.net.  If you are working on federating logins
with TaskCluster, this is probably *not* the service you are looking for.
Instead, use the federated login support in the tools site.

The API methods described here issue temporary credentials based on
an assertion.  The assertion identifies the user, usually with an
email-like string.  This string is then passed through a series of
authorizers, each of which may supply scopes to be included in the
credentials. Finally, the service generates temporary credentials based
on those scopes.

The generated credentials include scopes to create new, permanent clients
with names based on the user's identifier.  These credentials are
periodically scanned for scopes that the user does not posess, and disabled
if such scopes are discovered.  Thus users can create long-lived credentials
that are only usable until the user's access level is reduced.

## Login Client

```js
// Create Login client instance with default baseUrl:
// https://login.taskcluster.net/v1

const login = new taskcluster.Login(options);
```

## Methods in Login Client

```js
// login.credentialsFromPersonaAssertion :: payload -> Promise Result
login.credentialsFromPersonaAssertion(payload)

```

```js
// login.ping :: () -> Promise Nothing
login.ping()

```

