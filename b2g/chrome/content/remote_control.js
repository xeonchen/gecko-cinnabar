/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- /
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

Cu.import("resource://gre/modules/Services.jsm");

const kPrefPresentationDiscoverable = "dom.presentation.discoverable";

(function setupRemoteControlSettings() {
  // To keep RemoteContorlService in the scope to prevent import again
  var remoteControlScope = {};

  function importRemoteControlService() {
    if (!("RemoteControlService" in remoteControlScope)) {
      Cu.import("resource://gre/modules/RemoteControlService.jsm", remoteControlScope);
    }
  }

  function setupRemoteControl() {
    if (Services.prefs.getBoolPref(kPrefPresentationDiscoverable)) {
      importRemoteControlService();
      remoteControlScope.RemoteControlService.start();
    } else {
      remoteControlScope.RemoteControlService.stop();
    }
  }

  Services.prefs.addObserver(kPrefPresentationDiscoverable, setupRemoteControl, false);

  var networkStatusMonitor = {
    // nsIObserver
    observe: function(subject, topic, data) {
      switch (topic) {
        case "network-active-changed": {
          if (!subject) {
            // Stop service when there is no active network
            remoteControlScope.RemoteControlService.stop();
            break;
          }

          // Start service when active network change with new IP address
          // Other case will be handled by "network:offline-status-changed"
          if (!Services.io.offline && Services.prefs.getBoolPref(kPrefPresentationDiscoverable)) {
            importRemoteControlService();
            remoteControlScope.RemoteControlService.start();
          }
          break;
        }
        case "network:offline-status-changed": {
          if (data == "offline") {
            // Stop service when network status change to offline
            remoteControlScope.RemoteControlService.stop();
          } else if (Services.prefs.getBoolPref(kPrefPresentationDiscoverable)) {
            // Resume service when network status change to online
            importRemoteControlService();
            remoteControlScope.RemoteControlService.start();
          }
          break;
        }
        default:
          break;
      }
    }
  };

  if (Ci.nsINetworkManager) {
    Services.obs.addObserver(networkStatusMonitor, "network-active-changed", false);
    Services.obs.addObserver(networkStatusMonitor, "network:offline-status-changed", false);
  }

  setupRemoteControl();
})();
