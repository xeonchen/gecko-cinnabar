/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
ChromeUtils.import("resource://gre/modules/Services.jsm");
ChromeUtils.import("resource://gre/modules/PrivateBrowsingUtils.jsm");

XPCOMUtils.defineLazyGetter(window, "gChromeWin", () =>
  window.docShell.rootTreeItem.domWindow
    .QueryInterface(Ci.nsIDOMChromeWindow));

document.addEventListener("DOMContentLoaded", function() {
    let BrowserApp = window.gChromeWin.BrowserApp;

    if (!PrivateBrowsingUtils.isContentWindowPrivate(window)) {
      document.body.setAttribute("class", "normal");
      document.getElementById("newPrivateTabLink").addEventListener("click", function() {
        BrowserApp.addTab("about:privatebrowsing", { selected: true, parentId: BrowserApp.selectedTab.id, isPrivate: true });
      });
    }
  });
