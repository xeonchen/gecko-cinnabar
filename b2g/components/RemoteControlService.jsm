/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * RemoteControlService.jsm is the entry point of remote control function.
 * The service initializes a TLS socket server which receives events from user.
 *
 *               RemoteControlService <-- Gecko Preference
 *
 *     user -->  nsITLSSocketServer --> script (gecko)
 *
 * Events from user are in JSON format. After they are parsed into control command,
 * these events are passed to script (js), run in sandbox,
 * and dispatch corresponding events to Gecko.
 *
 * Here is related component location:
 * gecko/b2g/components/RemoteControlService.jsm
 * gecko/b2g/chrome/content/remote_command.js
 *
 * For more details, please visit: https://wiki.mozilla.org/Firefox_OS/Remote_Control
 */

"use strict";

this.EXPORTED_SYMBOLS = ["RemoteControlService"];

const { classes: Cc, interfaces: Ci, results: Cr, utils: Cu, Constructor: CC } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "certService", "@mozilla.org/security/local-cert-service;1",
                                   "nsILocalCertService");

XPCOMUtils.defineLazyModuleGetter(this, "SystemAppProxy", "resource://gre/modules/SystemAppProxy.jsm");

const ScriptableInputStream = CC("@mozilla.org/scriptableinputstream;1",
                                 "nsIScriptableInputStream", "init");

// static functions
function debug(aStr) {
  dump("RemoteControlService: " + aStr + "\n");
}

const DEBUG = false;

const MAX_CLIENT_CONNECTIONS = 5; // Allow max 5 clients to use remote control TV
const REMOTECONTROL_PREF_MDNS_SERVICE_TYPE = "_remotecontrol._tcp";
const REMOTECONTROL_PREF_MDNS_SERVICE_NAME = "dom.presentation.device.name";
const REMOTECONTROL_PREF_COMMANDJS_PATH = "chrome://b2g/content/remote_command.js";
const REMOTE_CONTROL_EVENT = "mozChromeRemoteControlEvent";

const SERVER_STATUS = {
  STOPPED: 0,
  STARTED: 1
};

let nextConnectionId = 0; // Used for tracking existing connections
let commandJSSandbox = null; // Sandbox runs remote_command.js

this.RemoteControlService = {
  // Remote Control status
  _serverStatus: SERVER_STATUS.STOPPED,

  // TLS socket server
  _port: -1, // The port on which this service listens
  _serverSocket: null, // The server socket associated with this
  _connections: new Map(), // Hash of all open connections, indexed by connection Id
  _mDNSRegistrationHandle: null, // For cancel mDNS registration

  // remote_command.js
  exportFunctions: {}, // Functions export to remote_command.js
  _sharedState: {}, // Shared state storage between connections
  _isCursorMode: false, // Store SystemApp isCursorMode

  // PUBLIC API
  // Start TLS socket server.
  // Return a promise for start() resolves/reject to
  start: function() {
    if (this._serverStatus == SERVER_STATUS.STARTED) {
      return Promise.reject("AlreadyStarted");
    }

    let promise = new Promise((aResolve, aReject) => {
      this._doStart(aResolve, aReject);
    });
    return promise;
  },

  // Stop TLS socket server, remove registered observer
  // Cancel mDNS registration
  // Return false if server not started, stop failed.
  stop: function() {
    if (this._serverStatus == SERVER_STATUS.STOPPED) {
      return false;
    }

    if (!this._serverSocket) {
      return false;
    }

    DEBUG && debug("Stop listening on port " + this._serverSocket.port);

    SystemAppProxy.removeEventListener("mozContentEvent", this);
    Services.obs.removeObserver(this, "xpcom-shutdown");

    if (this._mDNSRegistrationHandle) {
      this._mDNSRegistrationHandle.Cancel(Cr.NS_OK);
      this._mDNSRegistrationHandle = null;
    }

    commandJSSandbox = null;
    this._port = -1;
    this._serverSocket.close();
    this._serverSocket = null;
    this._serverStatus = SERVER_STATUS.STOPPED;

    return true;
  },

  // Observers and Listeners
  // nsIObserver
  observe: function(aSubject, aTopic, aData) {
    switch (aTopic) {
      case "xpcom-shutdown": {
        // Stop service when xpcom-shutdown
        this.stop();
        break;
      }
    }
  },

  // SystemAppProxy event listener
  handleEvent: function(evt) {
    if (evt.type !== "mozContentEvent") {
      return;
    }

    let detail = evt.detail;
    if (!detail) {
      return;
    }

    switch (detail.type) {
      case "control-mode-changed":
        // Use mozContentEvent to receive control mode of current app from System App
        // remote_command.js use "getIsCursorMode" to determine what kind event should dispatch to app
        this._isCursorMode = detail.detail.cursor;
        break;
   }
  },

  // nsIServerSocketListener
  onSocketAccepted: function(aSocket, aTrans) {
    DEBUG && debug("onSocketAccepted(aSocket=" + aSocket + ", aTrans=" + aTrans + ")");
    DEBUG && debug("New connection on " + aTrans.host + ":" + aTrans.port);

    const SEGMENT_SIZE = 8192;
    const SEGMENT_COUNT = 1024;

    try {
      var input = aTrans.openInputStream(0, SEGMENT_SIZE, SEGMENT_COUNT)
                       .QueryInterface(Ci.nsIAsyncInputStream);
      var output = aTrans.openOutputStream(0, 0, 0);
    } catch (e) {
      DEBUG && debug("Error opening transport streams: " + e);
      aTrans.close(Cr.NS_BINDING_ABORTED);
      return;
    }

    let connectionId = ++nextConnectionId;

    try {
      // Create a connection for each user connection
      // EventHandler implements nsIInputStreamCallback for incoming message from user
      var conn = new Connection(input, output, this, connectionId);
      let handler = new EventHandler(conn);

      input.asyncWait(conn, 0, 0, Services.tm.mainThread);
    } catch (e) {
      DEBUG && debug("Error in initial connection: " + e);
      trans.close(Cr.NS_BINDING_ABORTED);
      return;
    }

    this._connections.set(connectionId, conn);
    DEBUG && debug("Start connection " + connectionId);
  },

  // Close all connection when socket closed
  onStopListening: function(aSocket, aStatus) {
    DEBUG && debug("Shut down server on port " + aSocket.port);

    this._connections.forEach(function(aConnection){
      aConnection.close();
    });
  },

  // PRIVATE FUNCTIONS
  _doStart: function(aResolve, aReject) {
    DEBUG && debug("doStart");

    if (this._serverSocket) {
      aReject("SocketAlreadyInit");
      return;
    }

    let self = this;

    // Monitor xpcom-shutdown to stop service and clean up
    Services.obs.addObserver(this, "xpcom-shutdown", false);

    // Listen control mode change from gaia, request when service starts
    SystemAppProxy.addEventListener("mozContentEvent", this);
    SystemAppProxy._sendCustomEvent(REMOTE_CONTROL_EVENT, {action: "request-control-mode"});

    // Internal functions export to remote_command.js
    this.exportFunctions = {
      "getSharedState": this._getSharedState,
      "setSharedState": this._setSharedState,
      "getIsCursorMode": this._getIsCursorMode,
    }

    // Start TLSSocketServer with self-signed certification
    // If there is no module use PSM before, handleCert result is SEC_ERROR_NO_MODULE (0x805A1FC0).
    // Get PSM here ensure certService.getOrCreateCert works properly.
    Cc["@mozilla.org/psm;1"].getService(Ci.nsISupports);
    certService.getOrCreateCert("RemoteControlService", {
      handleCert: function(cert, result) {
        if(result) {
          aReject("getOrCreateCert " + result);
          return;
        } else {
          try {
            // Try to get random port
            let ios = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
            let socket;
            for (let i = 100; i; i--) {
              let temp = Cc["@mozilla.org/network/tls-server-socket;1"].createInstance(Ci.nsITLSServerSocket);
              temp.init(self._port, false, MAX_CLIENT_CONNECTIONS);
              temp.serverCert = cert;

              let allowed = ios.allowPort(temp.port, "tls");
              if (!allowed) {
                DEBUG && debug("Warning: obtained TLSServerSocket listens on a blocked port: " + temp.port);
              }

              if (!allowed && self._port == -1) {
                DEBUG && debug("Throw away TLSServerSocket with bad port.");
                temp.close();
                continue;
              }

              socket = temp;
              break;
            }

            if (!socket) {
              throw new Error("No socket server available. Are there no available ports?");
            }

            DEBUG && debug("Listen on port " + socket.port + ", " + MAX_CLIENT_CONNECTIONS + " pending connections");

            socket.serverCert = cert;
            // Set session cache and tickets to false here.
            // Cache disconnects fennect addon when addon sends message
            // Tickets crashes b2g when fennec addon connects
            socket.setSessionCache(false);
            socket.setSessionTickets(false);
            socket.setRequestClientCertificate(Ci.nsITLSServerSocket.REQUEST_NEVER);

            socket.asyncListen(self);
            self._port = socket.port;
            self._serverSocket = socket;
          } catch (e) {
            DEBUG && debug("Could not start server on port " + self._port + ": " + e);
            aReject("Start TLSSocketServer fail");
            return;
          }

          // Register mDNS remote control service with this._port
          if (("@mozilla.org/toolkit/components/mdnsresponder/dns-sd;1" in Cc)) {
            let serviceInfo = Cc["@mozilla.org/toolkit/components/mdnsresponder/dns-info;1"]
                                .createInstance(Ci.nsIDNSServiceInfo);
            serviceInfo.serviceType = REMOTECONTROL_PREF_MDNS_SERVICE_TYPE;
            serviceInfo.serviceName = Services.prefs.getCharPref(REMOTECONTROL_PREF_MDNS_SERVICE_NAME);
            serviceInfo.port = self._port;

            let mdns = Cc["@mozilla.org/toolkit/components/mdnsresponder/dns-sd;1"]
                         .getService(Ci.nsIDNSServiceDiscovery);
            self._mDNSRegistrationHandle = mdns.registerService(serviceInfo, null);
          }

          aResolve();
          self._serverStatus = SERVER_STATUS.STARTED;
        }
      }
    });
  },

  // Notifies this server that the given connection has been closed.
  _connectionClosed: function(aConnectionId) {
    DEBUG && debug("Close connection " + aConnectionId);
    this._connections.delete(aConnectionId);
  },

  // Get the value corresponding to a given key for remote_command.js state preservation
  _getSharedState: function(aKey) {
    if (aKey in RemoteControlService._sharedState) {
      return RemoteControlService._sharedState[aKey];
    }
    return "";
  },

  // Set the value corresponding to a given key for remote_command.js state preservation
  _setSharedState: function(aKey, aValue) {
    if (typeof aValue !== "string") {
      throw new Error("non-string value passed");
    }
    RemoteControlService._sharedState[aKey] = aValue;
  },

  _getIsCursorMode: function() {
    return RemoteControlService._isCursorMode;
  },
};

function streamClosed(aException) {
  return aException === Cr.NS_BASE_STREAM_CLOSED ||
         (typeof aException === "object" && aException.result === Cr.NS_BASE_STREAM_CLOSED);
}

// Represents a connection to the server
function Connection(aInput, aOutput, aServer, aConnectionId) {
  DEBUG && debug("Open a new connection " + aConnectionId);

  // Server associated with this connection
  this.server = aServer;

  // Id of this connection
  this.connectionId = aConnectionId;

  this.eventHandler = null;

  // Input and output UTF-8 stream
  this._input = Cc["@mozilla.org/intl/converter-input-stream;1"]
                  .createInstance(Ci.nsIConverterInputStream);
  this._input.init(aInput, "UTF-8", 0,
                   Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

  this._output = Cc["@mozilla.org/intl/converter-output-stream;1"]
                   .createInstance(Ci.nsIConverterOutputStream);
  this._output.init(aOutput, "UTF-8", 0, 0x0000);

  // This allows a connection to disambiguate between a peer initiating a
  // close and the socket being forced closed on shutdown.
  this._closed = false;
}
Connection.prototype = {
  // Closes this connection's input/output streams
  close: function() {
    if (this._closed) {
      return;
    }

    DEBUG && debug("Close connection " + this.connectionId);

    this._input.close();
    this._output.close();
    this._closed = true;

    this.server._connectionClosed(this.connectionId);
  },

  // nsIInputStreamCallback
  onInputStreamReady: function(aInput) {
    DEBUG && debug("onInputStreamReady(aInput=" + aInput + ") on thread " +
                   Services.tm.currentThread + " (main is " +
                   Services.tm.mainThread + ")");

    try {
      let available = 0, numChars = 0, fullMessage = "";

      // Read and concat messages from input stream buffer
      do {
        let partialMessage = {};

        available = aInput.available();
        numChars = this._input.readString(available, partialMessage);

        fullMessage += partialMessage.value;
      } while(numChars < available);

      if (fullMessage.length > 0) { // While readString contains something
        // Handle incoming JSON string
        let sanitizedMessage = this._sanitizeMessage(fullMessage);

        if (sanitizedMessage.length > 0) {
          try {
            // Parse JSON string to event objects
            let events = JSON.parse(sanitizedMessage);

            events.forEach((event) => {
              if (this.eventHandler !== null) {
                this.eventHandler.handleEvent(event);
              }
            });
          } catch (e) {
            DEBUG && debug ("Parse event error, drop this message, error: " + e);
          }
        }
      }
    } catch (e) {
      if (streamClosed(e)) {
        DEBUG && debug("WARNING: unexpected error when reading from socket; will " +
                       "be treated as if the input stream had been closed");
        DEBUG && debug("WARNING: actual error was: " + e);
      }

      // Input has been closed, but we're still expecting to read more data.
      // available() will throw in this case, destroy the connection.
      DEBUG && debug("onInputStreamReady called on a closed input, destroying connection, error: " + e);
      this.close();
      return;
    }

    // Wait next message
    aInput.asyncWait(this, 0, 0, Services.tm.currentThread);
  },

  _sanitizeMessage: function(aMessage) {
    // If message doesn't start with "{", discard the part before first found "}{"
    if(!aMessage.startsWith("{")) {
      if (aMessage.indexOf("}{") >= 0) {
        aMessage = aMessage.slice(aMessage.indexOf("}{")+1);
      } else {
        // If "}{" not found, discard partial JSON string and return empty string
        return "";
      }
    }

    // If message doesn't end with "}", discard the part after last found "}{"
    if(!aMessage.endsWith("}")) {
      if (aMessage.lastIndexOf("}{") >= 0) {
        aMessage = aMessage.slice(0, aMessage.lastIndexOf("}{")+1);
      } else {
        // If "}{" not found, discard partial JSON string and return empty string
        return "";
      }
    }

    // Add "[]" to handle concatenated message
    return '[' + aMessage.replace(/}{/g, '},{') + ']';
  },
};

// Load remote_command.js to commandJSSandbox when receives command event
// Release sandbox in RemoteControlService.stop()
function getCommandJSSandbox(aImportFunctions) {
  if (commandJSSandbox == null) {
    try {
      let channel = Services.io.newChannel2(REMOTECONTROL_PREF_COMMANDJS_PATH, null, null,
                                            null, Services.scriptSecurityManager.getSystemPrincipal(),
                                            null, Ci.nsILoadInfo.SEC_NORMAL, Ci.nsIContentPolicy.TYPE_OTHER);
      var fis = channel.open();
      let sis = new ScriptableInputStream(fis);
      commandJSSandbox = Cu.Sandbox(Cc["@mozilla.org/systemprincipal;1"].createInstance(Ci.nsIPrincipal));

      // Import function registered from external
      for(let functionName in aImportFunctions) {
        commandJSSandbox.importFunction(aImportFunctions[functionName], functionName);
      }

      try {
        // Evaluate remote_command.js in sandbox
        Cu.evalInSandbox(sis.read(fis.available()), commandJSSandbox, "latest");
      } catch (e) {
        DEBUG && debug("Syntax error in remote_command.js at " + channel.URI.path + ": " + e);
      }
    } catch(e) {
      DEBUG && debug("Error initializing sandbox: " + e);
    } finally {
      fis.close();
    }
  }

  return commandJSSandbox;
}

// Parse and dispatch incoming events from client
function EventHandler(aConnection) {
  this._connection = aConnection;

  aConnection.eventHandler = this;
}
EventHandler.prototype = {
  // PUBLIC FUNCTIONS
  handleEvent: function(aEvent) {
    // TODO: Implement JPAKE pairing (Bug 1207996)
    switch (aEvent.type) {
      // Implement control command dispatch
      case "command":
        this._handleCommandEvent(aEvent);
        break;
      default:
        break;
    }
  },

  // Pass and run command event in sandbox
  _handleCommandEvent: function(aEvent) {
    try {
      let sandbox = getCommandJSSandbox(this._connection.server.exportFunctions);
      sandbox.handleEvent(aEvent);
    } catch (e) {
      DEBUG && debug("Error running remote_command.js :" + e);
    }
  },
};
