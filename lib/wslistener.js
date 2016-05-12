var EventEmitter  = require('events').EventEmitter;
var taskcluster   = require('taskcluster-client');
var ws            = require('websocket');
var debug         = require('debug')('taskcluster-client:wslistener');
var _             = require('lodash');
var assert        = require('assert');
var urljoin       = require('url-join');
var slugid        = require('slugid');

const READYSTATE = {
  CONNECTING: 0,
  OPEN:       1,
  CLOSING:    2,
  CLOSED:     3
};

/*
  options : {
    baseUrl:  ....
  }
*/

class WSListener extends EventEmitter {

  constructor (options) {

    if(WSListener.WebSocket === null){
      throw new Error("Must provide a websocket implementation");
    }

    super();

    this.options = _.defaults({}, options, {
      baseUrl:      'https://events.taskcluster.net/v1'
    });

    this._bindings = [];
    this._pendingPromises = {};

    this.onMessage = this.onMessage.bind(this);
    this.onError = this.onError.bind(this);
    this.onClose = this.onClose.bind(this);

  }

  connect () {

    var that = this;

    let socketUrl = urljoin(this.options.baseUrl,'listen');
    this.socket = new WSListener.WebSocket(socketUrl);

    let opened = new Promise((resolve, reject) => {
      that.socket.onopen = resolve;
      that.socket.onerror = reject;
      that.socket.onclose = reject;
    });

    this.socket.onmessage = this.onMessage;
    this.socket.onerror = this.onError;
    this.socket.onclose = this.onClose;

    let bound = opened.then(() => {
      return Promise.all(that._bindings.map(binding => {
        return that._send('bind',binding);
      }));
    });

    let ready = new Promise((resolve, reject) => {
      var ready_accept, ready_reject;
      ready_accept = function() {
        that.removeListener('ready', ready_accept);
        that.removeListener('error', ready_reject);
        that.removeListener('close', ready_reject);
        accept();
      }
      ready_reject = function(err) {
        that.removeListener('ready', ready_accept);
        that.removeListener('error', ready_reject);
        that.removeListener('close', ready_reject);
        reject(err);
      }
      that.on('ready', ready_accept);
      that.on('error', ready_reject);
      that.on('close', ready_reject);
    });

    return bound.then(() => {
      return ready;
    });
  }

  _send (method, options) {
    let that = this;
    if(this.socket && this.socket.readyState == READYSTATE.OPEN){
      return new Promise((resolve, reject) => {
        let reqId = slugid.nice();
        /*
          Add a promise so that it can be resolved later
        */
        that._pendingPromises[reqId] = {
          resolve,
          reject
        }

        that.socket.send(JSON.stringify({
          method,
          id: reqId,
          options
        }));
      });
    }else{
      throw new Error("Can't send message if socket is not open");
    }
  }

  onMessage (e) {

    let message;

    try{
      message = JSON.parse(e.data);
    }catch(error){
      debug("Failed to parse message from server: %s, error: %s", e.data, err);
      return this.emit('error', err);
    }
    if (typeof(message.id) !== 'string') {
      debug("message: %j has no string id!", message);
      return this.emit('error', new Error("Message has no id"));
    }

    /*
    Get the promise with the same requestId
    */
    let promise;
    if(this._pendingPromises[message.id]){
      promise = this._pendingPromises[message.id];

      if(message.event === 'error'){
        return promise.reject(message.payload);
      }

      promise.resolve(message.payload);
    }

    // Handle ready events
    if (message.event === 'ready') {
      return this.emit('ready');
    }

    // Handle bound events
    if (message.event === 'bound') {
      return this.emit('bound', message.payload);
    }

    // Handle message events
    if (message.event === 'message') {
      return this.emit('message', message.payload);
    }

    // Handle error events
    if (message.event === 'error') {
      return this.emit('error', message.payload);
    }

    debug("message: %j is of unknown event type: %s", message, message.event);
    return this.emit('error', new Error("Unknown event type from server"));

  }

  onError () {
    debug("WebSocket error");
    this.emit('error', "WebSocket error");
  }

  onClose () {
    this.emit('close');
  }

  bind (binding) {
    this._bindings.push(binding);

    if (this.socket && this.socket.readyState === READYSTATE.OPEN) {
      return this._send('bind', binding);
    }
    return Promise.resolve(undefined);
  }

  //Experimental -- unfinished
  unbind (binding) {
    _.remove(this._bindings, b => b === binding);
    /*
    send unbind message to server
    if(this.socket && this.socket.readyState === READYSTATE.OPEN){
      return this.send('unbind',binding);
    }
    */
    return Promise.resolve(undefined);
  }

  close () {
    var that = this;
    // Close connection of not already closed
    if (this.socket && this.socket.readyState !== readyState.CLOSED) {
      var closed = new Promise(function(accept) {
        that.once('close', accept);
      });
      this.socket.close();
      return closed;
    }
    return Promise.resolve(undefined);
  }

  resume () {
    return this.connect();
  }

  pause () {
    return this.close();
  }

}

WSListener.WebSocket = null;

module.exports = WSListener;
