import Client from './client';
import getOptions from './options';

const createRequestMethod = (ReferenceClient, entry) => {
  ReferenceClient.prototype[entry.name] = function(...args) {
    return this._request(entry, ...args);
  };

  // Add reference for buildUrl and buildSignedUrl
  ReferenceClient.prototype[entry.name].entryReference = entry;
};

const createTopicMethod = (ReferenceClient, entry) => {
  ReferenceClient.prototype[entry.name] = function(...args) {
    return this._topic(entry, ...args);
  };
};

/**
 * Create a client class from a JSON reference, and an optional `name`, which is
 * mostly intended for debugging, error messages and stats.
 *
 * Returns a Client class which can be initialized with following options:
 * options:
 * {
 *   // TaskCluster credentials, if not provided fallback to defaults from
 *   // environment variables, if defaults are not explicitly set with
 *   // taskcluster.config({...}).
 *   // To create a client without authentication (and not using defaults)
 *   // use `credentials: {}`
 *   credentials: {
 *     clientId:    '...', // ClientId
 *     accessToken: '...', // AccessToken for clientId
 *     certificate: {...}  // Certificate, if temporary credentials
 *   },
 *   // Limit the set of scopes requests with this client may make.
 *   // Note, that your clientId must have a superset of the these scopes.
 *   authorizedScopes:  ['scope1', 'scope2', ...]
 *   baseUrl:         'http://.../v1'   // baseUrl for API requests
 *   exchangePrefix:  'queue/v1/'       // exchangePrefix prefix
 *   retries:         5,                // Maximum number of retries
 *   monitor:         await Monitor()   // From taskcluster-lib-monitor
 * }
 *
 * `baseUrl` and `exchangePrefix` defaults to values from reference.
 */
export default ({ baseUrl = '', exchangePrefix = '', entries = [] }, name = 'Unknown') => {
  const ReferenceClient = class extends Client {
    constructor(opts) {
      super({ baseUrl, exchangePrefix, ...getOptions(), ...opts });
    }
  };

  // For each function entry create a method on the Client class
  entries
    .forEach(entry => {
      if (entry.type === 'function') {
        createRequestMethod(ReferenceClient, entry);
      } else if (entry.type === 'topic-exchange') {
        createTopicMethod(ReferenceClient, entry);
      }
    });

  return ReferenceClient;
};
