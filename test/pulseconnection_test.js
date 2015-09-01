suite('PulseListener', function() {
  var taskcluster     = require('../');
  var Promise         = require('promise');
  var assert          = require('assert');
  var mockEvents      = require('./mockevents');
  var slugid          = require('slugid');
  var debug           = require('debug')('test:listener');
  var base            = require('taskcluster-base');
  var _               = require('lodash');
  var TcpProxyServer  = require('./tcpproxyserver');
  var assume          = require('assume');

  const PROXY_PORT = 61321;

  this.timeout(60 * 1000);

  // Load configuration
  var cfg = base.config({
    defaults:     {},
    profile:      {},
    envs: [
      'pulse_username',
      'pulse_password'
    ],
    filename:     'taskcluster-client'
  });

  if(!cfg.get('pulse:password')) {
    console.log("Skipping PulseListener tests due to missing config");
    return;
  }

  let proxy = new TcpProxyServer(5672, 'pulse.mozilla.org');
  setup(() => {
    proxy.connectionCount = 0;
    return proxy.listen(PROXY_PORT);
  });

  teardown(() => {
    return proxy.close();
  });

  // Pulse credentials
  var credentials = {
    username:   cfg.get('pulse:username'),
    password:   cfg.get('pulse:password')
  };

  test('Create PulseConnection', function() {
    var connection = new taskcluster.PulseConnection(credentials);
    return connection.connect().then(function() {
      return connection.close();
    });
  });

  test('Create PulseConnection (invalid hostname)', function() {
    var connection = new taskcluster.PulseConnection(_.defaults({
      hostname: 'pulse-nowhere'
    }, credentials));
    return connection.connect().then(function() {
      return connection.close();
    }).then(function() {
      assert(false, "Expected an error");
    }, function(err) {
      assert(err.code === 'ENOTFOUND');
    });
  });

  test('Create PulseConnection (invalid port)', function() {
    var connection = new taskcluster.PulseConnection(_.defaults({
      hostname: 'localhost:60723'
    }, credentials));
    return connection.connect().then(function() {
      return connection.close();
    }).then(function() {
      assert(false, "Expected an error");
    }, function(err) {
      assert(err.code === 'ECONNREFUSED');
    });
  });

  test('Create PulseConnection (valid hostname)', function() {
    var connection = new taskcluster.PulseConnection(_.defaults({
      hostname: 'pulse.mozilla.org',
      protocol: 'amqp',
      port:     5672
    }, credentials));
    return connection.connect().then(function() {
      return connection.close();
    });
  });

  test('Create PulseConnection w. TcpTestProxy', async () => {
    var connection = new taskcluster.PulseConnection(_.defaults({
      hostname: 'localhost',
      protocol: 'amqp',
      port:     PROXY_PORT
    }, credentials));

    await connection.connect();
    await connection.close();
  });

  test('Reconnect PulseConnection', async () => {
    var connection = new taskcluster.PulseConnection(_.defaults({
      hostname: 'localhost',
      protocol: 'amqp',
      port:     PROXY_PORT
    }, credentials));

    await connection.connect();

    // Close proxy in a while then restart it 800ms laters
    base.testing.sleep(200).then(async () => {
      await proxy.close();
      await base.testing.sleep(1000);
      await proxy.listen(PROXY_PORT);
    });

    await new Promise((accept, reject) => {
      connection.once('reconnect', accept);
      connection.once('error', reject);
    });

    await connection.close();

    // Only two because we weren't listening so not counting...
    assert(proxy.connectionCount === 2, "Expected two connections");
  });

  test('Reconnect PulseConnection (rejected connections)', async () => {
    var connection = new taskcluster.PulseConnection(_.defaults({
      hostname: 'localhost',
      protocol: 'amqp',
      port:     PROXY_PORT
    }, credentials));

    await connection.connect();

    // Close proxy in a while then restart it 800ms laters
    base.testing.sleep(200).then(async () => {
      proxy.deactivate();
      await base.testing.sleep(2000);
      proxy.activate();
    });

    await new Promise((accept, reject) => {
      connection.once('reconnect', accept);
      connection.once('error', reject);
    });

    await connection.close();

    assert(proxy.connectionCount > 2, "Expected more than two reconnects");
  });

  test('Reconnect PulseConnection (max reconnects: 2)', async () => {
    var connection = new taskcluster.PulseConnection(_.defaults({
      hostname: 'localhost',
      protocol: 'amqp',
      port:     PROXY_PORT,
      retries:  2
    }, credentials));

    await connection.connect();

    assume(proxy.connectionCount).equals(1);

    // Close proxy after 200 ms
    base.testing.sleep(200).then(() => proxy.deactivate());

    await new Promise(accept => connection.once('error', accept));

    await connection.close();

    assume(proxy.connectionCount).equals(3);
  });

  test('Reconnect PulseConnection (max reconnects: 0)', async () => {
    var connection = new taskcluster.PulseConnection(_.defaults({
      hostname: 'localhost',
      protocol: 'amqp',
      port:     PROXY_PORT,
      retries:  0
    }, credentials));

    await connection.connect();

    assume(proxy.connectionCount).equals(1);

    // Close proxy after 200 ms
    base.testing.sleep(200).then(() => proxy.deactivate());

    await new Promise(accept => connection.once('error', accept));

    await connection.close();

    assume(proxy.connectionCount).equals(1);
  });

  test('Retry PulseConnection (max retries: 2)', async () => {
    var connection = new taskcluster.PulseConnection(_.defaults({
      hostname: 'localhost',
      protocol: 'amqp',
      port:     PROXY_PORT,
      retries:  2
    }, credentials));

    await proxy.deactivate();

    await connection.connect().then(() => {
      assert(false, "Should get connection");
    }, err => {
      assert(err, "Expected error");
    });

    await connection.close();

    assume(proxy.connectionCount).equals(3);
  });
});
