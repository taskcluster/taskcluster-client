import {EventEmitter} from 'events';
import amqplib from 'amqplib';
import {pulse as debug} from './debug';
import assert from 'assert';
import {parse} from 'url';

/**
 * Build Pulse ConnectionString, from options on the form:
 * {
 *   username: // Pulse username (optional, if connectionString)
 *   password: // Pulse password (optional, if connectionString)
 *   hostname: // Hostname to use (defaults to pulse.mozilla.org)
 * }
 */
const buildPulseConnectionString = ({username, password, hostname = 'pulse.mozilla.org'}) => {
  assert(username, 'options.username is required');
  assert(password, 'options.password is required');

  return `amqps://${username}:${password}@${hostname}:5671`;
};

/** Connect to AMQP server while retrying connection establishment */
const connect = (connectionString, retries) => {
  return amqplib
    .connect(connectionString, {
      noDelay: true,
      timeout: 30 * 1000,
    })
    .catch(err => {
      if (retries > 0) {
        return connect(connectionString, retries - 1);
      }

      throw err;
    });
};

/**
 * Create PulseConnection from `options` on the form:
 * {
 *   namespace: // Namespace to prefix queues/exchanges (optional)
 *              // defaults to `username` if given otherwise ""
 *   username: // Username to connect with (and namespace if not given)
 *   password: // Password to connect with
 *   hostname: // Hostname to connect to using username/password
 *             // defaults to pulse.mozilla.org
 *   connectionString: // connectionString cannot be used with username,
 *                     // password and/or hostname.
 * }
 */
export default class PulseConnection extends EventEmitter {
  constructor(opts) {
    super();
    assert(typeof opts === 'object', 'options is required');

    if (opts.connectionString) {
      assert(!opts.username, `Can't take "username" along with "connectionString"`);
      assert(!opts.password, `Can't take "password" along with "connectionString"`);
      assert(!opts.hostname, `Can't take "hostname" along with "connectionString"`);
    }

    this._connectionString = opts.connectionString || buildPulseConnectionString(opts);
    // If namespace was not explicitly set infer it from connection string
    this.namespace = opts.username || parse(this._connectionString).auth.split(':')[0];
    this._conn = null;
    this._connecting = false;
  }

  /** Returns a promise for a connection */
  connect() {
    // Connection if we have one
    if (this._conn) {
      return Promise.resolve(this._conn);
    }

    // If currently connecting, give a promise for this result
    const promise = new Promise((resolve, reject) => {
      this.once('connection', (err, conn) => err ? reject(err) : resolve(conn));
    });

    // Connect if we're not already doing this
    if (!this._connecting) {
      this._connecting = true;

      connect(this._connectionString, 7)
        .then(conn => {
          // Save reference to the connection
          this._conn = conn;

          // Setup error handling
          conn.on('error', err => {
            debug(`Connection error in Connection: ${err}`, err.stack);
            this.emit('error', err);
          });

          // We're no longer connecting, emit event notifying anybody waiting
          this._connecting = false;
          this.emit('connection', null, conn);
        })
        .catch(err => this.emit('connection', err));
    }

    return promise;
  }

  /** Close the connection */
  close() {
    const conn = this._conn;

    if (conn) {
      this._conn = null;
      return conn.close();
    }

    return Promise.resolve();
  }
}
