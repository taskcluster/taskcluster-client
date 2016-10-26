import {format, parse} from 'url';
import http from 'http';
import https from 'https';
import superagent from 'superagent';
import debug from './debug';
import assert from 'assert';
import hawk from 'hawk';
import querystring from 'querystring';
import cloneDeep from 'lodash.clonedeep';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const request = (url, options) => {
  const fetch = superagent(options.method, url);

  fetch.set(options.headers);
  fetch.timeout(options.timeout);

  if (fetch.agent && options.agent) {
    fetch.agent(options.agent);
  }

  if (options.body) {
    fetch.send(options.body);
  }

  return new Promise((resolve, reject) => {
    fetch.end((err, response) => {
      if (err || !response.ok) {
        reject(err);
      } else {
        resolve(response);
      }
    });
  });
};

/** Default options for our http/https global agents */
const AGENT_OPTIONS = {
  maxSockets: 50,
  maxFreeSockets: 0,
  keepAlive: false,
};

/**
 * Generally shared agents is optimal we are creating our own rather then
 * defaulting to the global node agents primarily so we can tweak this across
 * all our components if needed...
 */
export const DEFAULT_AGENTS = {
  http: new http.Agent(AGENT_OPTIONS),
  https: new https.Agent(AGENT_OPTIONS),
};

export default class Client {
  constructor(options) {
    this._options = options;

    // Shortcut for which default agent to use...
    const isHttps = this._options.baseUrl.startsWith('https');

    if (this._options.agent) {
      // We have explicit options for new agent create one...
      this._httpAgent = isHttps ?
        new https.Agent(this._options.agent) :
        new http.Agent(this._options.agent);
    } else {
      // Use default global agent(s)...
      this._httpAgent = isHttps ?
        DEFAULT_AGENTS.https :
        DEFAULT_AGENTS.http;
    }

    // Timeout for each _individual_ http request.
    this._timeout = this._options.timeout;

    const {credentials} = this._options;

    if (credentials && credentials.clientId && credentials.accessToken) {
      // Build ext for hawk requests
      const ext = {};

      if (credentials.certificate) {
        // If there is a certificate we have temporary credentials, and we
        // must provide the certificate
        if (typeof credentials.certificate === 'string') {
          // Parse as JSON if it's a string
          try {
            ext.certificate = JSON.parse(credentials.certificate);
          } catch (err) {
            debug('Failed to parse credentials.certificate, err: %s, JSON: %j', err, err);
            throw new Error('Failed to parse configured certificate as valid JSON');
          }
        } else {
          ext.certificate = credentials.certificate;
        }
      }

      // If set of authorized scopes is provided, we'll restrict the request
      // to only use these scopes
      if (Array.isArray(this._options.authorizedScopes)) {
        ext.authorizedScopes = this._options.authorizedScopes;
      }

      // If ext has any keys we base64 encode it and set ext on extra
      if (Object.keys(ext).length) {
        this._extData = new Buffer(JSON.stringify(ext)).toString('base64');
      }
    }
  }

  /** Make a request for a Client instance */
  async makeRequest(entry, url, payload, query) {
    const {randomizationFactor: rf, delayFactor, retries, maxDelay} = this._options;

    // Add query to url if present
    if (query) {
      query = querystring.stringify(query);

      if (query.length) {
        url += `?${query}`;
      }
    }

    // Construct request object
    const options = {
      method: entry.method,
      headers: {},
      // Set the http agent for this request, if supported in the current
      // environment (browser environment doesn't support http.Agent)
      agent: this._httpAgent,
      // Timeout for each individual request.
      timeout: this._timeout,
      // We manually manage the retry lifecycle
      retries: 0,
    };

    // Send payload if defined
    if (payload) {
      options.body = JSON.stringify(payload);
      options.headers['content-type'] = 'application/json';
    }

    const {credentials} = this._options;

    // Authenticate, if credentials are provided
    if (credentials && credentials.clientId && credentials.accessToken) {
      // Create hawk authentication header
      var header = hawk.client.header(url, entry.method, {
        credentials: {
          id: credentials.clientId,
          key: credentials.accessToken,
          algorithm: 'sha256',
        },
        ext: this._extData,
      });

      options.headers.Authorization = header.field;
    }

    const fetch = async (attempt) => {
      attempt++;

      try {
        const response = await request(url, options);

        // If request was successful, accept the result
        debug(`Success calling: ${entry.name}, (${attempt} retries)`);
        return response;
      } catch (err) {
        const willRetry = this.willRetry(err, attempt);

        if (willRetry) {
          if (err.response && err.response.body) {
            debug('Error calling: %s now retrying, info: %j', entry.name, err.response.body);
          } else {
            debug('Error calling: %s now retrying, info: %j', entry.name, err);
          }

          // We will retry, set long we should wait before retrying
          const delay = Math.min(
            Math.pow(2, attempt - 1) * delayFactor * (Math.random() * 2 * rf + 1 - rf),
            maxDelay
          );

          await sleep(delay);
          return fetch(attempt);
        } else if (err.response && err.response.body) {
          debug('Error calling: %s NOT retrying! info: %j', entry.name, err.response.body);
        } else {
          debug('Error calling: %s NOT retrying! info: %j', entry.name, err);
        }

        throw err;
      }
    };

    // Initialize the first request starting at 0 attempts
    return fetch(0);
  }

  willRetry(err, attempts) {
    const {retries} = this._options;
    const {response} = err;

    if (attempts > retries) {
      return false;
    }

    if (!response) {
      return true;
    }

    // If we got a response we read the error code from the response
    return response.statusCode >= 500 && response.statusCode < 600;
  }

  async _request(entry, ...args) {
    // Get number of arguments
    const entryArity = entry.args.length + (entry.input ? 1 : 0);
    // Get the query-string options taken
    const optionKeys = entry.query || [];
    const arity = args.length;

    // Validate number of arguments
    assert(arity === entryArity || optionKeys.length && arity === entryArity + 1,
      `Function \`${entry.name}\` expected ${entryArity} arguments but only received ${arity}`);

    const endpoint = this.buildEndpoint(entry, args);
    // Create url for the request
    const url = this._options.baseUrl + endpoint;
    // Add payload if one is given
    const payload = entry.input ? args[entryArity - 1] : null;
    // Find query string options if present
    const query = args[entryArity] || {};

    Object
      .keys(query)
      .forEach(key => assert(optionKeys.includes(key),
        `Function \`${entry.name}\` expected options ${optionKeys.join(', ')} but received ${key}`));

    const {monitor} = this._options;
    const start = monitor ? process.hrtime() : null;

    try {
      const response = await this.makeRequest(entry, url, payload, query);

      if (monitor) {
        const end = process.hrtime(start);

        monitor.measure([entry.name, 'success'], end[0] * 1000 + end[1] / 1000000);
        monitor.count([entry.name, 'success']);
      }

      if (!response.headers['content-type'].includes('application/json') || !response.body) {
        debug(`Empty response from server: call: ${entry.name}, method: ${entry.method}`);
      } else {
        return response.body;
      }
    } catch (err) {
      const code = err.response ? err.response.statusCode : err.code;

      if (monitor) {
        const end = process.hrtime(start);
        const state = code >= 500 ? 'server-error' : 'client-error';

        monitor.measure([entry.name, state], end[0] * 1000 + end[1] / 1000000);
        monitor.count([entry.name, state]);
      }

      if (!err.response) {
        throw err;
      }

      const {response} = err;
      const {body} = response;
      let message = body.message || 'Unknown Server Error';

      if (code === 401) {
        message = 'Authentication Error';
      } else if (response.statusCode === 500) {
        message = 'Internal Server Error';
      }

      const error = new Error(message);

      error.body = body;
      error.code = body.code || 'UnknownError';
      error.statusCode = code;

      throw error;
    }
  };

  // Create method for routing-key pattern construction
  _topic(entry, routingKeyPattern = {}) {
    let pattern = typeof routingKeyPattern === 'string' ?
      routingKeyPattern :
      entry.routingKey.map(key => {
        // Get value for key, routing key constant entries cannot be modified
        const value = key.constant || routingKeyPattern[key.name];

        if (typeof value === 'number') {
          return String(value);
        }

        if (typeof value === 'string') {
          assert(key.multipleWords || !value.includes('.'), `Routing key pattern "${value}" for \`${key.name}\` cannot
            contain dots as it does not hold multiple words`);

          return value;
        }

        // Check that we haven't got an invalid value
        assert(value === null || value === undefined,
          `Value "${value}" is not supported as routingKey pattern for ${key.name}`);

        // Return default pattern for entry not being matched
        return key.multipleWords ? '#' : '*';
      })
        .join('.');

    // Return values necessary to bind with EventHandler
    return {
      exchange: this._options.exchangePrefix + entry.exchange,
      routingKeyPattern: pattern,
      routingKeyReference: cloneDeep(entry.routingKey),
    };
  };

  buildEndpoint(entry, args) {
    return entry.route.replace(/<([^<>]+)>/g, (text, arg) => {
      const index = entry.args.indexOf(arg);

      // Preserve original
      if (index === -1) {
        return text;
      }

      const param = args[index];
      const type = typeof param;

      assert(type === 'string' || type === 'number',
        `URL parameter \`${arg}\` expected a string but was provided type ${type}`);

      return encodeURIComponent(param);
    });
  }

  buildUrl(method, ...args) {
    assert(method, 'buildUrl is missing required `method` argument');

    // Find the method
    const entry = method.entryReference;

    assert(entry && entry.type === 'function', 'Method in buildUrl must be an API method from the same object');

    // Get the query string options taken
    const optionKeys = entry.query || [];
    const supportsOptions = optionKeys.length !== 0;
    const arity = entry.args.length;

    debug(`Building URL for: ${entry.name}`);

    if (args.length !== arity && (!supportsOptions || args.length !== arity + 1)) {
      throw new Error(`Function \`${entry.name}.buildUrl\` expected ${arity + 1}
        argument(s) but received ${args.length + 1}`);
    }

    const endpoint = this.buildEndpoint(entry, args);
    let query = args[arity] || '';

    if (query) {
      Object
        .keys(query)
        .forEach(key => assert(optionKeys.includes(key),
          `Function \`${entry.name}\` expected options ${optionKeys.join(', ')} but received ${key}`));

      // Find query string options if present
      query = querystring.stringify(query);

      if (query.length) {
        query = `?${query}`;
      }
    }

    return this._options.baseUrl + endpoint + query;
  }

  buildSignedUrl(method, ...args) {
    assert(method, 'buildSignedUrl is missing required `method` argument');

    // Find reference entry
    const entry = method.entryReference;

    assert(entry.method.toLowerCase() === 'get', 'buildSignedUrl only works for GET requests');

    // Default to 15 minutes before expiration
    let expiration = 15 * 60;
    // Check if method supports query-string options
    const supportsOptions = (entry.query || []).length !== 0;
    // if longer than method + args, then we have options too
    const arity = entry.args.length + (supportsOptions ? 1 : 0);

    if (args.length > arity) {
      // Get request options
      const options = args.pop();

      if (options.expiration) {
        expiration = options.expiration;
      }

      assert(typeof expiration === 'number', 'options.expiration must be a number');
    }

    const url = this.buildUrl(method, ...args);
    const {credentials} = this._options;

    assert(credentials.clientId, 'buildSignedUrl missing required credentials');
    assert(credentials.accessToken, 'buildSignedUrl missing required credentials accessToken');

    const parts = parse(url);

    // Create bewit, getBewit() for Node, bewit() for browsers ._.
    const bewit = (hawk.client.getBewit || hawk.client.bewit)(url, {
      credentials: {
        id: credentials.clientId,
        key: credentials.accessToken,
        algorithm: 'sha256',
      },
      ttlSec: expiration,
      ext: this._extData,
    });

    parts.search = parts.search ?
      `${parts.search}&bewit=${bewit}` :
      `?bewit=${bewit}`;

    return format(parts);
  }
};
