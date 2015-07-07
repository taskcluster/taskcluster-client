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

  // Pulse credentials
  var credentials = {
    username:   cfg.get('pulse:username'),
    password:   cfg.get('pulse:password')
  };

  var connectionString = [
    'amqps://',         // Ensure that we're using SSL
    cfg.get('pulse:username'),
    ':',
    cfg.get('pulse:password'),
    '@',
    'pulse.mozilla.org',
    ':',
    5671                // Port for SSL
  ].join('');

  var exchangePrefix = [
    'exchange',
    cfg.get('pulse:username'),
    'taskcluster-client',
    'test'
  ].join('/') + '/';

  mockEvents.configure({
    connectionString:       connectionString,
    exchangePrefix:         exchangePrefix
  });

  let proxy = new TcpProxyServer(5672, 'pulse.mozilla.org');
  let publisher = null;
  setup(async () => {
    proxy.connectionCount = 0;
    mockEvents.configure({
      connectionString:       connectionString,
      exchangePrefix:         exchangePrefix
    });
    publisher = await mockEvents.connect();
    await proxy.listen(61321);
  });
  teardown(async () => {
    await Promise.all([
      publisher.close(),
      proxy.close()
    ]);
    publisher = null;
  });
  var reference = mockEvents.reference();

  // Create client from reference
  var MockEventsClient = taskcluster.createClient(reference);
  var mockEventsClient = new MockEventsClient();

  // Test that client provides us with binding information
  test('binding info', () => {
    var info = mockEventsClient.testExchange({testId: 'test'});
    assert(info.exchange === exchangePrefix + 'test-exchange');
    assert(info.routingKeyPattern === 'my-constant.test.#.*.*');
  });

  // Test that binding info is generated with number as routing keys
  test('binding info with number', () => {
    var info = mockEventsClient.testExchange({testId: 0});
    assert(info.exchange === exchangePrefix + 'test-exchange');
    assert(info.routingKeyPattern === 'my-constant.0.#.*.*');
  });


  test('bind via connection string', async () => {
    var listener = new taskcluster.PulseListener({
      credentials: {connectionString}
    });

    await listener.resume();
    await listener.close();
  });

  // Bind and listen with listener
  test('bind and listen', async () => {
    // Create listener
    var listener = new taskcluster.PulseListener({
      credentials:          credentials
    });
    await listener.bind({
      exchange: exchangePrefix + 'test-exchange',
      routingKeyPattern: '#'
    });

    var result = new Promise(function(accept, reject) {
      listener.on('message', function(message) {
        assert(message.payload.text == "my message");
        setTimeout(function() {
          listener.close().then(accept, reject)
        }, 500);
      });
      listener.on('error', function(err) {
        reject(err);
      });
    });

    await listener.resume();
    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });

    await result;
  });

  // Bind and listen with listener (for CC)
  test('bind and listen (for CC)', async () => {
    // Create listener
    var listener = new taskcluster.PulseListener({
      credentials:          credentials
    });
    listener.bind({
      exchange: exchangePrefix + 'test-exchange',
      routingKeyPattern: 'route.test'
    });

    var result = new Promise(function(accept, reject) {
      listener.on('message', function(message) {
        assert(message.payload.text == "my message");
        setTimeout(function() {
          listener.close().then(accept, reject)
        }, 500);
      });
      listener.on('error', function(err) {
        reject(err);
      });
    });

    await listener.resume();
    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    }, ['route.test']);

    await result;
  });

  // Bind and listen with listener (for CC using client)
  test('bind and listen (for CC using client)', async () => {
    // Create listener
    var listener = new taskcluster.PulseListener({
      credentials:          credentials
    });
    listener.bind(mockEventsClient.testExchange('route.test'));

    var result = new Promise(function(accept, reject) {
      listener.on('message', function(message) {
        assert(message.payload.text == "my message");
        assert(message.routes[0] === 'test');
        setTimeout(function() {
          listener.close().then(accept, reject)
        }, 500);
      });
      listener.on('error', function(err) {
        reject(err);
      });
    });

    await listener.resume();
    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    }, ['route.test']);

    await result;
  });

  // Bind and listen with listener (manual routing key)
  test('bind and listen (manual constant routing key)', async () => {
    // Create listener
    var listener = new taskcluster.PulseListener({
      credentials:          credentials
    });
    listener.bind({
      exchange: exchangePrefix + 'test-exchange',
      routingKeyPattern: 'my-constant.#'
    });

    var result = new Promise(function(accept, reject) {
      listener.on('message', function(message) {
        assert(message.payload.text == "my message");
        setTimeout(function() {
          listener.close().then(accept, reject)
        }, 500);
      });
      listener.on('error', function(err) {
        reject(err);
      });
    });

    await listener.resume();
    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });

    await result;
  });

  // Bind and listen with listener and non-match routing
  test('bind and listen (without wrong routing key)', async () => {
    // Create listener
    var listener = new taskcluster.PulseListener({
      credentials:          credentials
    });
    listener.bind({
      exchange: exchangePrefix + 'test-exchange',
      routingKeyPattern: 'another.routing.key'
    });

    var result = new Promise(function(accept, reject) {
      listener.on('message', message => {
        reject(new Error("Didn't expect message"));
      });
      listener.on('error', reject);
      listener.connect().then(() => setTimeout(accept, 1500), reject);
    });

    await listener.resume();
    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    }, ['route.test']);

    await result;
    await listener.close();
  });


  // Test that routing key can be parsed if proper information is provided
  test('parse routing key', async () => {
    // Create listener
    var listener = new taskcluster.PulseListener({
      credentials:          credentials
    });
    listener.bind(mockEventsClient.testExchange({testId: 'test'}));

    var result = new Promise((accept, reject) => {
      listener.on('message', message => {
        assert(message.payload.text == "my message");
        assert(message.routing, "Failed to parse routing key");
        assert(message.routing.taskRoutingKey == 'hello.world');
        setTimeout(() => listener.close().then(accept, reject), 500);
      });
      listener.on('error', reject);
    });

    await listener.resume()
    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });

    await result;
  });

  // Naive test that creation work when providing a name for the queue
  test('named queue', async () => {
    // Create listener
    var listener = new taskcluster.PulseListener({
      queueName:            slugid.v4(),
      credentials:          credentials
    });
    await listener.bind(mockEventsClient.testExchange({testId: 'test'}));

    var result = new Promise((accept, reject) => {
      listener.on('message', message => {
        assert(message.payload.text == "my message");
        assert(message.routing, "Failed to parse routing key");
        assert(message.routing.taskRoutingKey == 'hello.world');
        setTimeout(() => listener.close().then(accept, reject), 500);
      });
      listener.on('error', reject);
    });

    await listener.resume();

    await base.testing.sleep(500);
    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });
    await result;
    await listener.deleteQueue();
  });

  test('deletion of named queue', async () => {
    // Create listener
    var listener = new taskcluster.PulseListener({
      queueName:            slugid.v4(),
      credentials:          credentials
    });

    await listener.deleteQueue();
  });

  // Test routing with multi key
  test('multi-word routing', async () => {
    // Create listener
    var listener = new taskcluster.PulseListener({
      credentials:          credentials
    });
    listener.bind(mockEventsClient.testExchange({taskRoutingKey: '*.world'}));

    var result = new Promise((accept, reject) => {
      listener.on('message', message => {
        assert(message.payload.text == "my message");
        assert(message.routing, "Failed to parse routing key");
        assert(message.routing.taskRoutingKey == 'hello.world');
        setTimeout(() => listener.close().then(accept, reject), 500);
      });
      listener.on('error', reject);
    });

    await listener.resume();
    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });

    await result;
  });

  // Test listener without multi-word
  test('parse without multi-words', async () => {
    // Create listener
    var listener = new taskcluster.PulseListener({
      credentials:          credentials
    });
    listener.bind(mockEventsClient.simpleTestExchange({testId: 'test'}));

    var result = new Promise((accept, reject) => {
      listener.once('message', message => {
        assert(message.payload.text == "my message");
        setTimeout(() => listener.close().then(accept, reject), 500);
      });
      listener.once('error', reject);
    });

    await listener.resume();
    await publisher.simpleTestExchange({
      text:           "my message"
    }, {
      testId:         'test'
    });

    await result;
  });

  // Test listener without any routing keys
  test('parse without any routing keys', async () => {
    // Create listener
    var listener = new taskcluster.PulseListener({
      credentials:          credentials
    });
    listener.bind(mockEventsClient.reallySimpleTestExchange());

    var result = new Promise((accept, reject) => {
      listener.once('message', message => {
        assert(message.payload.text == "my message");
        setTimeout(() => listener.close().then(accept, reject), 500);
      });
      listener.once('error', reject);
    });

    await listener.resume();
    await publisher.reallySimpleTestExchange({
      text:           "my message"
    });

    await result;
  });

  // Test listener.once
  test('bind and listen (using listener.once)', async () =>  {
    // Create listener
    var listener = new taskcluster.PulseListener({
      credentials:          credentials
    });
    listener.bind({
      exchange: exchangePrefix + 'test-exchange',
      routingKeyPattern: '#'
    });

    var result = new Promise((accept, reject) => {
      listener.once('message', message => {
        assert(message.payload.text == "my message");
        setTimeout(() => listener.close().then(accept, reject), 500);
      });
      listener.once('error', reject);
    });

    await listener.resume()
    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });

    await result;
  });

  // Test pause and resume
  test('pause/resume', async () =>  {
    // Create listener
    var listener = new taskcluster.PulseListener({
      queueName:            slugid.v4(),
      credentials:          credentials
    });
    listener.bind(mockEventsClient.testExchange({testId: 'test'}));

    var count = 0;
    var result = new Promise((accept, reject) => {
      listener.on('message', message => {
        assert(message.payload.text == "my message");
        count += 1;
        if (count == 4) {
          setTimeout(() => listener.close().then(accept, reject), 500);
        }
        assert(count <= 4, "Shouldn't get more than 4 messages");
      });
      listener.on('error', reject);
    });

    await listener.resume();
    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });

    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });
    await new Promise(accept => setTimeout(accept, 500));

    assert(count == 2, "Should have two messages now");
    await listener.pause();

    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });
    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });

    await new Promise(accept => setTimeout(accept, 500));
    assert(count == 2, "Should have two messages now");
    await listener.resume();

    await result;
    await listener.deleteQueue();
  });

  // Test pause and resume
  test('pause/resume with maxLength', async () => {
    // Create listener
    var listener = new taskcluster.PulseListener({
      queueName:            slugid.v4(),
      credentials:          credentials,
      maxLength:            3
    });
    listener.bind(mockEventsClient.testExchange({testId: 'test'}));

    var count = 0;
    var result = new Promise((accept, reject) => {
      listener.on('message', (message) => {
        count += 1;
        assert(count <= 3, "Shouldn't get more than 3 messages");
        if (message.payload.text == "end") {
          setTimeout(() => listener.close().then(accept, reject), 500);
        }
      });
      listener.on('error', reject);
    });

    await listener.resume();

    await listener.pause()
    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });

    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });
    await publisher.testExchange({
      text:           "my message"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });
    await  publisher.testExchange({
      text:           "end"
    }, {
      testId:         'test',
      taskRoutingKey: 'hello.world'
    });

    await new Promise(accept => setTimeout(accept, 500));
    await listener.resume();
    await result;
    assert(count == 3, "We should only have got 3 messages");

    await listener.deleteQueue();
  });


  test('connection w. two consumers', async () => {
    // Create connection object
    var connection = new taskcluster.PulseConnection(credentials);

    // Create listeners
    var listener1 = new taskcluster.PulseListener({
      connection:           connection
    });
    listener1.bind(mockEventsClient.testExchange({testId: 'test1'}));
    var listener2 = new taskcluster.PulseListener({
      connection:           connection
    });
    listener2.bind(mockEventsClient.testExchange({testId: 'test2'}));

    var result1 = new Promise((accept, reject) => {
      listener1.on('message', message => {
        debug("got message 1");
        assert(message.payload.text == "my message 1");
        setTimeout(() =>listener1.close().then(accept, reject), 500);
      });
      listener1.on('error', reject);
    });

    var result2 = new Promise((accept, reject) => {
      listener2.on('message', message => {
        debug("got message 2");
        assert(message.payload.text == "my message 2");
        setTimeout(() => listener2.close().then(accept, reject), 500);
      });
      listener2.on('error', reject);
    });

    await Promise.all([
      listener1.resume(),
      listener2.resume()
    ]);

    debug("Sending message 1");
    await publisher.testExchange({
      text:           "my message 1"
    }, {
      testId:         'test1',
      taskRoutingKey: 'hello.world'
    });
    // Wait for listener 1 to get message and close
    await result1;

    await publisher.testExchange({
      text:           "my message 2"
    }, {
      testId:         'test2',
      taskRoutingKey: 'hello.world'
    });
    await result2;

    await connection.close();
  });
});
