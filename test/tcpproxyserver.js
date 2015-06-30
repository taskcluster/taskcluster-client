var net = require('net');
var debug = require('debug')('TcpProxyServer');
var Promise = require('promise');

class TcpProxyServer {
  constructor(targetPort, targetHost) {
    this.connections = [];
    this.targetPort = targetPort;
    this.targetHost = targetHost;
    this.active = false;
    this.connectionCount = 0;

    // Create server and handle connections
    this.server = net.createServer();
    this.server.on('connection', this.onConnection.bind(this));
  }


  async listen(port) {
    // Start listening
    await new Promise((accept, reject) => {
      this.server.listen(port);
      this.server.once('listening', () => {
        accept();
        this.server.removeListener('error', reject);
      })
      // don't care to remove listener for 'listening' as we already have a bug
      this.server.once('error', reject);
    });
    this.activate();

    debug("Listening on port: %s forwarding to %s:%s",
          this.server.address().port, this.targetHost, this.targetPort);

    return this.server;
  }

  close() {
    this.deactivate();

    return new Promise(accept => this.server.close(accept));
  }

  activate() {
    this.active = true;
  }

  deactivate() {
    this.active = false;
    // close all the things
    this.connections.forEach(function(connection) {
      // will close and cleanup destination sockets too.
      connection.source.end();
    });
    this.connections = [];
  }

  async onConnection(source) {
    this.connectionCount += 1;
    if (!this.active) {
      debug("Rejecting connection from: %j (not active)", source.address());
      source.end();
    }
    debug("Inbound connection from: %j", source.address());

    // Start opening the proxy connection.
    let target = net.connect(
      this.targetPort,
      this.targetHost
    );

    // Track connections held
    let connection = {
      source,
      target,
      endPending:   false,
      opened:       false
    };
    this.connections.push(connection);

    // Merge connections
    source.pipe(target);
    target.pipe(source);


    // Close connection and socket
    var closeConnection = (socket) => {
      if (connection) {
        var idx = this.connections.indexOf(connection);
        if (idx !== -1) {
          this.connections.splice(idx, 1);
        }
        connection = null;
      }
      // Set it to null if its not null already!
      socket.end();
    };

    // When source has ended
    var sourceEnd = () => {
      // if we are already opened immediately send the FIN
      if (connection.opened) {
        return closeConnection(target);
      }

      // otherwise wait until we are open to send the fin.
      connection.endPending = true;
    }

    // Wait for connection
    destination.once('connect', () => {
      debug('opened proxy connection to destination', destination.address());
      if (connection.endPending) {
        return closeConnection(target);
      }
      // "opened" indicates both source and dest are writable.
      connection.opened = true;
    });

    // Send FIN to source if destination is closed.
    destination.once('end', () => {
      // Don't trigger end on source and target at once.
      source.removeListener('end', sourceEnd);
      closeConnection(source);
    });

    // Wait for source end
    source.once('end', sourceEnd);
  }
}

// Export TcpProxyServer
module.exports = TcpProxyServer;