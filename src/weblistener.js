import { EventEmitter } from 'events';
import createDebugger from 'debug';
import urlJoin from 'url-join';
import slugid from 'slugid';
import { isServer } from './utils';

const debug = createDebugger('taskcluster-client:weblistener');
const READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 4
};

/**
 * Create new WebListener
 *
 * options: {
 *   baseUrl: undefined // defaults to: https://events.taskcluster.net/v1
 * }
 */
export default class WebListener extends EventEmitter {
  /**
   * The location that loads this module needs to provide a sock.js module.
   * Otherwise, we can't use the listener in both node.js and web-browser.
   */
  static SockJS = null;

  constructor(options) {
    if (!WebListener.SockJS) {
      console.log('You must provide a SockJS implementation for WebListener!');
      throw new Error('SockJS implementation not provided');
    }

    super();
    this.options = {
      baseUrl: 'https://events.taskcluster.net/v1',
      ...options
    };
    // Hold list of bindings and promises that are waiting to be resolved
    this._bindings = [];
    this._pendingPromises = [];

    this.onMessage = ::this.onMessage;
    this.onError = ::this.onError;
    this.onClose = ::this.onClose;
  }

  /** Connect and bind all declared bindings */
  async connect() {
    const socketUrl = urlJoin(this.options.baseUrl, 'listen');

    // Open websocket
    this.socket = new WebListener.SockJS(socketUrl);

    /// Add handlers for messages, errors and closure
    this.socket.addEventListener('message', this.onMessage);
    this.socket.addEventListener('error', this.onError);
    this.socket.addEventListener('close', this.onClose);

    await new Promise((resolve, reject) => {
      this.socket.addEventListener('error', reject);
      this.socket.addEventListener('close', reject);
      this.socket.addEventListener('open', () => {
        // Remove event handler for error and close
        this.socket.removeEventListener('error', reject);
        this.socket.removeEventListener('close', reject);
        resolve();
      });
    });

    const awaitingBindings = Promise.all(this._bindings.map(binding => this._send('bind', binding)));
    const isReady = new Promise((resolve, reject) => {
      const resolver = () => {
        this.removeListener('ready', resolver);
        this.removeListener('error', rejector);
        this.removeListener('close', rejector);
        resolve();
      };
      const rejector = (err) => {
        this.removeListener('ready', resolver);
        this.removeListener('error', rejector);
        this.removeListener('close', rejector);
        reject(err);
      };

      this.on('ready', resolver);
      this.on('error', rejector);
      this.on('close', rejector);
    });

    // When all bindings have been bound, we're just waiting for 'ready'
    return awaitingBindings.then(() => isReady);
  }

  /** Send raw message over socket */
  _send(method, options) {
    if (!this.socket || this.socket.readyState !== READY_STATE.OPEN) {
      throw new Error('Cannot send message if socket is not OPEN');
    }

    // Create request id
    const id = slugid.v4();

    // Send message, if socket is open
    return new Promise((resolve, reject) => {
      this._pendingPromises.push({ id, resolve, reject });
      this.socket.send(JSON.stringify({ method, id, options }));
    });
  }

  /** Handle message from websocket */
  onMessage(e) {
    let message;

    try {
      // Attempt to parse the message
      message = JSON.parse(e.data);
    } catch (err) {
      debug('Failed to parse message from server: %s, error: %s', e.data, err);
      return this.emit('error', err);
    }

    // Check that id is a string
    if (typeof message.id !== 'string') {
      debug('message: %j has no string id!', message);
      return this.emit('error', new Error('Message has no id'));
    }

    this._pendingPromises = this._pendingPromises
      .filter(promise => {
        // Only keep promises that are still pending,
        // filter out the ones we are handling right now
        if (promise.id !== message.id) {
          return promise;
        }

        if (message.event === 'error') {
          promise.reject(message.payload);
        } else {
          promise.resolve(message.payload)
        }

        // These promises are no longer pending, they are handled.
        // Filter them out.
        return false;
      });

    switch (message.event) {
      case 'ready':
      case 'bound':
      case 'message':
      case 'error':
        return this.emit(message.event, message.payload || null);
      default:
        debug('message: %j is of unknown event type: %s', message, message.event);
        this.emit('error', new Error('Unknown event type from server'));
    }
  }

  /** Handle websocket error */
  onError() {
    debug('WebSocket error');
    this.emit('error', new Error('WebSocket Error'));
  }

  /** Handle closure of websocket */
  onClose() {
    this.emit('close');
  }

  /** Bind to an exchange */
  bind(binding) {
    // Store the binding so we can connect, if not already there
    this._bindings.push(binding);

    // If already open send the bind request
    return this.socket && this.socket.readyState === READY_STATE.OPEN ?
      this._send('bind', binding) :
      Promise.resolve();
  }

  /** Close connection and stop listening */
  close() {
    if (!this.socket || this.socket.readyState === READY_STATE.CLOSED) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      this.once('close', resolve);
      this.socket.close();
    });
  }

  /**
   * Start listening,
   *
   * Just calls connect(), added for compatibility with AMQPListener.
   */
  resume() {
    return this.connect();
  }

  /**
   * Stop listening,
   *
   * Just calls close(), added for compatibility with AMQPListener.
   */
  pause() {
    return this.close();
  }
};

if (typeof IS_BROWSER !== 'undefined' && !IS_BROWSER) {
  Object.defineProperty(WebListener, 'SockJS', {
    enumerable: true,
    get() {
      // Load it on demand to keep things working under new node version where support might be spotty
      return require('sockjs-client');
    }
  })
} else {
  WebListener.SockJS = require('sockjs-client');
}
