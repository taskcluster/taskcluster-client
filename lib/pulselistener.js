var events    = require('events');
var util      = require('util');
var amqplib   = require('amqplib');
var Promise   = require('promise');
var debug     = require('debug')('taskcluster-client:PulseListener');
var _         = require('lodash');
var assert    = require('assert');
var slugid    = require('slugid');
var URL       = require('url');

/**
 * Build Pulse ConnectionString, from options on the form:
 * {
 *   username:          // Pulse username (optional, if connectionString)
 *   password:          // Pulse password (optional, if connectionString)
 *   hostname:          // Hostname to use
 *   port:              // Port to use
 *   protocol:          // Protocol to use amqp or amqps
 * }
 */
var buildPulseConnectionString = function(options) {
  assert(options.username, "options.username password is required");
  assert(options.password, "options.password is required");

  // Construct connection string
  return [
    options.protocol + '://',
    options.username,
    ':',
    options.password,
    '@',
    options.hostname,
    ':',
    options.port
  ].join('');
};


/**
 * Create PulseConnection from `options` on the form:
 * {
 *   namespace:           // Namespace to prefix queues/exchanges (optional)
 *                        // defaults to `username` if given otherwise ""
 *   username:            // Username to connect with (namespace if not given)
 *   password:            // Password to connect with
 *   hostname:            // Hostname to connect to using username/password
 *                        // defaults to pulse.mozilla.org
 *   protocol:            // 'amqp' or 'amqps', defaults to 'amqps'
 *   port:                // Port to connect to, defaults to 5671 if 'amqps',
 *                        // otherwise it defaults to 5672
 *   connectionString:    // connectionString cannot be used with username,
 *                        // password and/or hostname.
 *   reconnect:           // Whether or not to reconnect on errors
 *   delayFactor:         // Multiplier for: delay = 2 ^ retry * delayFactor
 *   randomizationFactor: // rf in: delay = delay * random([1 - rf; 1 + rf])
 *   maxDelay:            // Maximum retry delay
 *   retryResetTime:      // Time to wait before resetting retry count
 *   retries:             // Maximum number of retries
 * }
 *
 * Note, when starting to reconnect the `reconnect` event is emitted and users
 * of the connection managed by this object should stop using their connection
 * and channel objects, and instead call `connect()` and reconfigure themselves
 * or they should emit and error at their on level if they can't restart.
 */
var PulseConnection = function(options) {
  assert(typeof(options) === 'object', "options is required");
  if (options.connectionString) {
    assert(!options.hostname, "Both `hostname` and `connectionString` given");
    assert(!options.protocol, "Both `protocol` and `connectionString` given");
    assert(!options.port,     "Both `port` and `connectionString` given");
    assert(!options.username, "Both `username` and `connectionString` given");
    assert(!options.password, "Both `password` and `connectionString` given");
  }

  options = _.defaults({}, options, {
    namespace:            options.username || '',
    hostname:             'pulse.mozilla.org',
    protocol:             'amqps',
    port:                 options.protocol === 'amqp' ? 5672 : 5671,
    reconnect:            true,
    delayFactor:          250,
    randomizationFactor:  0.25,
    maxDelay:             30 * 60 * 1000,
    retryResetTime:       5 * 60 * 1000,
    retries:              5
  });

  if (!options.connectionString) {
    options.connectionString = buildPulseConnectionString(options);
  }

  // If namespace was not explicitly set infer it from connection string...
  if (!options.namespace) {
    var parsed = URL.parse(options.connectionString);
    options.namespace = parsed.auth.split(':')[0];
  }

  this.namespace = options.namespace;

  // Private properties
  this._conn              = null;       // Connection object if connected
  this._connecting        = null;       // Promise for the connection object
  this._options           = options;    // Options
  this._lastReconnect     = Date.now(); // Time since last reconnect attempt
  this._reconnectAttempts = 0;          // Reconnection attempts
};

// Inherit from events.EventEmitter
util.inherits(PulseConnection, events.EventEmitter);

/** Returns a promise for a connection */
PulseConnection.prototype.connect = function() {
  var that = this;

  // Connect if we're not already doing this
  if (!this._connecting) {
    // Function to attempt connection
    var connect = function() {
      return new Promise(function(accept) {
        var attempts = that._reconnectAttempts;
        if (attempts > 0) {
          // Construct the usual delay and retry after sleeping
          var delay = Math.pow(2, attempts) * that._options.delayFactor;
          var rf = that._options.randomizationFactor;
          delay = delay * (Math.random() * 2 * rf + 1 - rf);
          delay = Math.min(delay, that._options.maxDelay);
          return setTimeout(accept, delay);
        }
        return accept();
      }).then(function() {
        that._lastReconnect = Date.now();
        return amqplib.connect(that._options.connectionString);
      }).then(function(conn) {
        // Save reference to the connection
        that._conn = conn;

        // Setup error handling
        conn.on('error', that._onError.bind(that));

        // Return connection
        return conn;
      }, function(err) {
        // Retry connection if we're not out of time
        that._rethrowOrRetry(err);
        return connect();
      });
    };
    // Attempt connection
    this._connecting = connect().catch(function(err) {
      that._connecting = null;
      that.emit('error', err);
      throw err;
    });
  }

  // Return promise for a connection
  return this._connecting;
};

/** Handle errors from AMQP connection */
PulseConnection.prototype._onError = function(err) {
  try {
    this._conn = null;
    this._connecting = null;
    if (!this._options.reconnect) {
      throw err;
    }
    this._rethrowOrRetry(err);
  } catch (err) {
    debug("Connection error in Connection: %s", err, err.stack);
    return this.emit('error', err);
  }
  return this.emit('reconnect', this.connect());
};

/** Rethrow the error or let us retry the operation */
PulseConnection.prototype._rethrowOrRetry = function(err) {
  var timeSinceReconnect = Date.now() - this._lastReconnect;
  if (timeSinceReconnect > this._options.retryResetTime) {
    this._reconnectAttempts = -1;
  }

  // Update internal state
  this._lastReconnect = Date.now();
  this._reconnectAttempts += 1;

  // throw error to prevent retry
  if (this._reconnectAttempts > this._options.retries) {
    throw err;
  }
  debug("Ignoring error and trying again, retry = %s, err: %s",
        this._reconnectAttempts, err);
};

/** Close the connection */
PulseConnection.prototype.close = function() {
  var conn = this._conn;
  this._connecting = null;
  if (conn) {
    this._conn = null;
    try {
      return conn.close();
    } catch (err) {
      // Ignore error from conn that is already closed
    }
  }
  return Promise.resolve(undefined);
};


// Export PulseConnection
exports.PulseConnection = PulseConnection;

/**
 * Create new PulseListener
 *
 * options: {
 *   prefetch:            // Max number of messages unacknowledged to hold
 *   queueName:           // Queue name, defaults to exclusive auto-delete queue
 *   connection:          // PulseConnection object (or credentials)
 *   credentials: {
 *     namespace:         // Namespace to prefix queues/exchanges (optional)
 *                        // defaults to `username` if given otherwise ""
 *     username:          // Pulse username
 *     password:          // Pulse password
 *     hostname:          // Hostname to connect to using username/password
 *                        // defaults to pulse.mozilla.org
 *     connectionString:  // connectionString overwrites username/password and
 *                        // hostname (if given)
 *   }
 *   maxLength:           // Maximum queue size, undefined for none
 *   reconnect:           // Whether or not to automatically reconnect if
 *                        // connection is dropped. By default it'll reconnect
 *                        // if the queue is named. Otherwise, you must specify
 *                        // reconnect: true
 * }
 *
 * You must provide `connection` either as an instance of `PulseConnection` or
 * as options given to `PulseConnection`. If options for `PulseConnection` is
 * given, then the connection will be closed along with the listener.
 */
var PulseListener = function(options) {
  var that = this;
  assert(options,             "options are required");
  assert(options.connection ||
         options.credentials, "options.connection or credentials is required");
  this._bindings = [];
  options = _.defaults({}, options, {
    prefetch:               5,
    queueName:              undefined,
    maxLength:              undefined,
    reconnect:              options.queueName ? true : false
  });

  // Ensure that we have connection object
  this._connection = options.connection || null;
  if (!(this._connection instanceof PulseConnection)) {
    this._connection = new PulseConnection(options.credentials);
    // If listener owner the connection, then connection errors are also
    // listener errors
    this._connection.on('error', function(err) {
      that.emit('error', err);
    });
  }

  // Setup reconnect handler,
  if (options.reconnect) {
    this._connection.on('reconnect', function() {
      if (that._channel) {
        that._channel.__invalidated = true;
        that._channel = null;
        done = that._consumerTag ? that.resume() : that.connect();
        that._consumerTag = null;
        done.catch(function(err) {
          that.emit('error', err);
        });
      }
    });
  } else {
    // If reconnect is disabled we'll throw an error and be done with it
    this._connection.on('reconnect', function() {
      that.emit('error', new Error("Connection dropped, and PulseListener " +
                                   "not configured to reconnect"));
    });
  }

  // Construct queue name
  this._queueName = [
    'queue',                      // Required by pulse security model
    this._connection.namespace,   // Required by pulse security model
    options.queueName || 'exclusive/' + slugid.v4()
  ].join('/');

  // Private properties
  this._channel     = null;                     // AMQP channel object
  this._options     = options;                  // Options
  this._exclusive   = !this._options.queueName; // Is queue exclusive
  that._consumerTag = null;                     // Consumer tag, when consuming
};

// Inherit from events.EventEmitter
util.inherits(PulseListener, events.EventEmitter);

/**
 * Bind listener to exchange with routing key and optional routing key
 * reference used to parse routing keys.
 *
 * binding: {
 *   exchange:              '...',  // Exchange to bind
 *   routingKeyPattern:     '...',  // Routing key as string
 *   routingKeyReference:   {...}   // Reference used to parse routing keys
 * }
 *
 * if `routingKeyReference` is provided for the exchange from which messages
 * arrive the listener will parse the routing key and make it available as a
 * dictionary on the message.
 *
 * **Note,** the arguments for this method is easily constructed using an
 * instance of `Client`, see `createClient`.
 */
PulseListener.prototype.bind = function(binding) {
  assert(typeof(binding.exchange) === 'string',
         "Can't bind to unspecified exchange!");
  assert(typeof(binding.routingKeyPattern) === 'string',
         "routingKeyPattern is required!");
  this._bindings.push(binding);
  if(this._channel) {
    debug("Binding %s to %s with pattern '%s'",
          this._queueName || 'exclusive queue',
          binding.exchange, binding.routingKeyPattern);
    return this._channel.bindQueue(
      this._queueName,
      binding.exchange,
      binding.routingKeyPattern
    );
  } else {
    return Promise.resolve(null);
  }
};

/** Connect, setup queue and binding to exchanges */
PulseListener.prototype.connect = function() {
  var that = this;

  // Return channel if we have one
  if (this._channel) {
    return Promise.resolve(this._channel);
  }

  // Create AMQP connection and channel
  var channel = null;
  return this._connection.connect().then(function(conn) {
    return conn.createConfirmChannel();
  }).then(function(channel_) {
    channel = channel_;
    channel.on('error', function(err) {
      // Prevent invalidation of the connection, by someone calling .close()
      // this way channel.close() won't be called when .close() is called.
      that._channel = null;
      debug("Channel error in PulseListener: ", err.stack);
      that.emit('error', err);
    });
    return channel.prefetch(that._options.prefetch);
  }).then(function() {
    // Create queue
    var opts = {
      exclusive:  that._exclusive,
      durable:    !that._exclusive,
      autoDelete: that._exclusive,
    };
    // Set max length if provided
    if (that._options.maxLength) {
      opts.maxLength = that._options.maxLength;
    }
    return channel.assertQueue(that._queueName, opts);
  }).then(function() {
    // Create bindings
    that._channel = channel;
    return Promise.all(that._bindings.map(function(binding) {
      debug("Binding %s to %s with pattern %s",
            that._queueName || 'exclusive queue',
            binding.exchange, binding.routingKeyPattern);
      return channel.bindQueue(
        that._queueName,
        binding.exchange,
        binding.routingKeyPattern
      );
    }));
  }).then(function() {
    // Return channel object, add property indicating that it's still valid:
    channel.__invalidated = false;
    return channel;
  });
};

/** Pause consumption of messages */
PulseListener.prototype.pause = function() {
  if (!this._channel) {
    return debug("WARNING: Paused PulseListener instance wasn't connected yet");
  }
  if (!this._consumerTag) {
    return debug("WARNING: Paused PulseListener instance wasn't consuming yet");
  }
  var consumerTag = this._consumerTag;
  this._consumerTag = null;
  return this._channel.cancel(consumerTag);
};

/** Connect or resume consumption of message */
PulseListener.prototype.resume = function() {
  var that = this;
  return this.connect().then(function(channel) {
    return channel.consume(that._queueName, function(msg) {
      that._handle(msg, channel);
    }).then(function(result) {
      that._consumerTag = result.consumerTag;
    });
  });
};

/** Handle message */
PulseListener.prototype._handle = function(msg, channel) {
  var that = this;
  // Construct message
  var message = {
    payload:      JSON.parse(msg.content.toString('utf8')),
    exchange:     msg.fields.exchange,
    routingKey:   msg.fields.routingKey,
    redelivered:  msg.fields.redelivered,
    routes:       []
  };

  // Find CC'ed routes
  if (msg.properties && msg.properties.headers &&
      msg.properties.headers.CC instanceof Array) {
    message.routes = msg.properties.headers.CC.filter(function(route) {
      // Only return the CC'ed routes that starts with "route."
      return /^route\.(.*)$/.test(route);
    }).map(function(route) {
      // Remove the "route."
      return /^route\.(.*)$/.exec(route)[1];
    });
  }

  // Find routing key reference, if any is available to us
  var routingKeyReference = null;
  this._bindings.forEach(function(binding) {
    if(binding.exchange === message.exchange && binding.routingKeyReference) {
      routingKeyReference = binding.routingKeyReference;
    }
  });

  // If we have a routing key reference we can parse the routing key
  if (routingKeyReference) {
    try {
      var routing = {};
      var keys = message.routingKey.split('.');
      // first handle non-multi keys from the beginning
      for(var i = 0; i < routingKeyReference.length; i++) {
        var ref = routingKeyReference[i];
        if (ref.multipleWords) {
          break;
        }
        routing[ref.name] = keys.shift();
      }
      // If we reached a multi key
      if (i < routingKeyReference.length) {
        // then handle non-multi keys from the end
        for(var j = routingKeyReference.length - 1; j > i; j--) {
          var ref = routingKeyReference[j];
          if (ref.multipleWords) {
            break;
          }
          routing[ref.name] = keys.pop();
        }
        // Check that we only have one multiWord routing key
        assert(i == j, "i != j really shouldn't be the case");
        routing[routingKeyReference[i].name] = keys.join('.');
      }

      // Provide parsed routing key
      message.routing = routing;
    } catch(err) {
      // Ideally we should rethrow the exception. But since it's not quite
      // possible to promise that `routing` (the parsed routing key) is
      // available... As you can subscribe without providing a routing
      // key reference.
      // In short people can assume this is present in most cases, and if they
      // assume this we get the error at a level where they can handle it.
      debug("Failed to parse routingKey: %s for %s with err: %s, as JSON: %j",
            message.routingKey, message.exchange, err, err, err.stack);
    }
  }

  // Process handlers
  Promise.all(this.listeners('message').map(function(handler) {
    return Promise.resolve(null).then(function() {
      return handler.call(that, message);
    });
  })).then(function() {
    return channel.ack(msg);
  }).then(null, function(err) {
    debug("Failed to process message %j from %s with error: %s, as JSON: %j",
          message, message.exchange, err, err, err.stack);
    if (channel.__invalidated) {
      // This is just to minimize the amount if panic, if we get a reconnect
      // while processing a message. If nack causes a disconnect I suspect all
      // the reconnect event will occur first, but who knows.
      return debug("Can't nack message as channel is __invalidated");
    }
    if (message.redelivered) {
      debug("Nack (without requeueing) message %j from %s",
            message, message.exchange);
      return channel.nack(msg, false, false);
    } else {
      // Nack and requeue
      return channel.nack(msg, false, true);
    }
  }).then(null, function(err) {
    debug("CRITICAL: Failed to nack message");
    that.emit('error', err);
  });
};

/**
 * Deletes the underlying queue and closes the listener
 *
 * Use this if you want to delete a named queue, unnamed queues created with
 * this listener will be automatically deleted, when the listener is closed.
 */
PulseListener.prototype.deleteQueue = function() {
  var that = this;
  return this.connect().then(function(channel) {
    return channel.deleteQueue(that._queueName).then(function() {
      return that.close();
    });
  });
};

/** Close the PulseListener */
PulseListener.prototype.close = function() {
  var connection = this._connection;

  // If we were given connection by option, we shouldn't close it
  if (connection === this._options.connection) {
    var channel = this._channel;
    if (channel) {
      this._channel = null;
      this._consumerTag = null;
      return channel.close();
    }
    return Promise.resolve(undefined);
  }

  // If not external connection close it
  this._channel = null;
  this._consumerTag = null;
  return connection.close();
};

// Export PulseListener
exports.PulseListener = PulseListener;
