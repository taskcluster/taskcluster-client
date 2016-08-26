import { EventEmitter } from 'events';
import PulseConnection from './pulseconnection';
import { pulse as debug } from './debug';
import assert from 'assert';
import slugid from 'slugid';

/**
 * Create new PulseListener
 *
 * options: {
 *   prefetch: // Max number of messages unacknowledged to hold
 *   queueName: // Queue name, defaults to exclusive auto-delete queue
 *   connection: // PulseConnection object (or credentials)
 *   credentials: {
 *     namespace: // Namespace to prefix queues/exchanges (optional)
 *                // defaults to `username` if given otherwise ""
 *     username: // Pulse username
 *     password: // Pulse password
 *     hostname: // Hostname to connect to using username/password
 *               // defaults to pulse.mozilla.org
 *     connectionString: // connectionString overwrites username/password and
 *                       // hostname (if given)
 *   }
 *   maxLength: // Maximum queue size, undefined for none
 * }
 *
 * You must provide `connection` either as an instance of `PulseConnection` or
 * as options given to `PulseConnection`. If options for `PulseConnection` is
 * given, then the connection will be closed along with the listener.
 */
export default class PulseListener extends EventEmitter {
  constructor(options) {
    assert(options, 'options are required');
    assert(options.connection || options.credentials, 'options.connection or credentials is required');

    super();
    this._bindings = [];
    this._options = {
      prefetch: 5,
      queueName: null,
      maxLength: null,
      ...options
    };

    this._connection = options.connection || null;

    // Ensure that we have connection object
    if (!(this._connection instanceof PulseConnection)) {
      this._connection = new PulseConnection(options.credentials);
      // If listener owner the connection, then connection errors are also listener errors
      this._connection.on('error', err => this.emit('error', err));
    }
  }

  bindToQueue({ exchange, routingKeyPattern }) {
    debug(`Binding ${this._queueName || 'exclusive queue'} to ${exchange} with pattern "${routingKeyPattern}"`);

    return this._channel.bindQueue(this._queueName, exchange, routingKeyPattern);
  }

  /**
   * Bind listener to exchange with routing key and optional routing key
   * reference used to parse routing keys.
   *
   * binding: {
 *   exchange: '...',  // Exchange to bind
 *   routingKeyPattern: '...',  // Routing key as string
 *   routingKeyReference: {...}   // Reference used to parse routing keys
 * }
   *
   * if `routingKeyReference` is provided for the exchange from which messages
   * arrive the listener will parse the routing key and make it available as a
   * dictionary on the message.
   *
   * **Note,** the arguments for this method is easily constructed using an
   * instance of `Client`, see `createClient`.
   */
  bind(binding) {
    assert(typeof binding.exchange === 'string', 'Cannot bind to unspecified exchange');
    assert(typeof binding.routingKeyPattern === 'string', 'Missing required routingKeyPattern');

    this._bindings.push(binding);

    return this._channel ?
      this.bindToQueue(binding) :
      Promise.resolve(null);
  }

  /** Connect, setup queue and binding to exchanges */
  async connect() {
    // Return channel if we have one
    if (this._channel) {
      return Promise.resolve(this._channel);
    }

    // Create AMQP connection and channel
    const { prefetch, queueName, maxLength } = this._options;
    const conn = await this._connection.connect();
    const channel = await conn.createConfirmChannel();

    channel.on('error', err => {
      // Prevent invalidation of the connection, by someone calling .close()
      // this way channel.close() won't be called when .close() is called.
      this._channel = null;
      debug('Channel error in PulseListener:', err.stack);
      this.emit('error', err);
    });

    // Find queue name and decide if this is an exclusive queue
    const exclusive = !queueName;

    this._conn = conn;
    this._queueName = `queue/${this._connection.namespace}/${queueName || 'exclusive'}/${slugid.v4()}`;
    await channel.prefetch(prefetch);

    const opts = {
      exclusive,
      durable: !exclusive,
      autoDelete: exclusive,
      maxLength
    };

    await channel.assertQueue(this._queueName, opts);
    this._channel = channel;
    await Promise.all(this._bindings.map((binding) => this.bindToQueue(binding)));

    return channel;
  }

  /** Pause consumption of messages */
  pause() {
    if (!this._channel) {
      debug('WARNING: Paused PulseListener instance was not connected yet');
      throw new Error('Cannot pause when not connected');
    }

    return this._channel.cancel(this._consumerTag);
  }

  /** Connect or resume consumption of message */
  async resume() {
    const channel = await this.connect();
    const result = await channel.consume(this._queueName, msg => this._handle(msg));

    this._consumerTag = result.consumerTag;
  }

  async _handle(msg) {
    const cc = msg.properties &&
      msg.properties.headers &&
      Array.isArray(msg.properties.headers.CC) &&
      msg.properties.headers.CC;

    // Construct message
    const message = {
      payload: JSON.parse(msg.content.toString('utf8')),
      exchange: msg.fields.exchange,
      routingKey: msg.fields.routingKey,
      redelivered: msg.fields.redelivered,
      routes: !cc ? [] : cc
        .filter(route => /^route\.(.*)$/.test(route))
        .map(route => /^route\.(.*)$/.exec(route)[1])
    };
    const routingKeyReference = this._bindings
      .reduce((acc, binding) => binding.exchange === message.exchange && binding.routingKeyReference ?
        binding.routingKeyReference :
        null
      );

    // If we have a routing key reference we can parse the routing key
    if (routingKeyReference) {
      const routing = {};
      const keys = message.routingKey.split('.');

      try {
        let index = 0;

        // first handle non-multi keys from the beginning
        for (; index < routingKeyReference.length; index++) {
          const ref = routingKeyReference[index];

          if (ref.multipleWords) {
            break;
          }

          routing[ref.name] = keys.shift();
        }

        // If we reached a multi key
        if (index < routingKeyReference.length) {
          // then handle non-multi keys from the end
          let routingIndex = routingKeyReference.length - 1;

          for (; routingIndex > index; routingIndex--) {
            const ref = routingKeyReference[routingIndex];

            if (ref.multipleWords) {
              break;
            }

            routing[ref.name] = keys.pop();
          }

          // Check that we only have one multiWord routing key
          assert(index === routingIndex, 'Sanity check: index !== routingIndex should never happen');
          routing[routingKeyReference[index].name] = keys.join('.');
        }

        // Provide parsed routing key
        message.routing = routing;
      } catch (err) {
        // Ideally we should rethrow the exception. But since it's not quite
        // possible to promise that `routing` (the parsed routing key) is
        // available... As you can subscribe without providing a routing
        // key reference.
        // In short people can assume this is present in most cases, and if they
        // assume this we get the error at a level where they can handle it.
        debug('Failed to parse routingKey: %s for %s with error: %s, as JSON: %j',
          message.routingKey, message.exchange, err, err, err.stack)
      }
    }

    const promises = this
      .listeners('message')
      .map(handler => Promise.resolve().then(() => handler.call(this, message)));

    Promise
      .all(promises)
      .then(() => this._channel.ack(msg))
      .catch(err => {
        debug('Failed to process message %j from %s with error: %s, as JSON: %j',
          message, message.exchange, err, err, err.stack);

        if (message.redelivered) {
          debug('Nack (without requeueing) message %j from %s', message, message.exchange);
          return this._channel.nack(msg, false, false);
        } else {
          return this._channel.nack(msg, false, true);
        }
      })
      .catch(err => {
        debug('CRITICAL: Failed to nack message');
        this.emit('error', err);
      });
  }

  /**
   * Deletes the underlying queue and closes the listener
   *
   * Use this if you want to delete a named queue, unnamed queues created with
   * this listener will be automatically deleted, when the listener is closed.
   */
  async deleteQueue() {
    const channel = await this.connect();

    await channel.deleteQueue(this._queueName);
    await this.close();
  }

  /** Close the PulseListener */
  close() {
    const connection = this._connection;

    // If we were given connection by option, we shouldn't close it
    if (connection === this._options.connection) {
      const channel = this._channel;

      if (channel) {
        this._channel = null;
        return Promise.resolve();
      }
    }

    // If not external connection close it
    this._conn = null;
    this._channel = null;

    return connection.close();
  }
}
