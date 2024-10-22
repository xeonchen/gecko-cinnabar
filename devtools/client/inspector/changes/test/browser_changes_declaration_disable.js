/* vim: set ts=2 et sw=2 tw=80: */
/* Any copyright is dedicated to the Public Domain.
 http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Test that toggling a CSS declaration in the Rule view is tracked.

const TEST_URI = `
  <style type='text/css'>
    div {
      color: red;
    }
  </style>
  <div></div>
`;

add_task(async function() {
  await addTab("data:text/html;charset=utf-8," + encodeURIComponent(TEST_URI));
  const { inspector, view: ruleView } = await openRuleView();
  const { document: doc, store } = selectChangesView(inspector);
  const panel = doc.querySelector("#sidebar-panel-changes");

  await selectNode("div", inspector);
  const rule = getRuleViewRuleEditor(ruleView, 1).rule;
  const prop = rule.textProps[0];

  let onTrackChange = waitUntilAction(store, "TRACK_CHANGE");
  info("Disable the first declaration");
  await togglePropStatus(ruleView, prop);
  info("Wait for change to be tracked");
  await onTrackChange;

  let removedDeclarations = panel.querySelectorAll(".diff-remove");
  is(removedDeclarations.length, 1, "Only one declaration was tracked as removed");

  onTrackChange = waitUntilAction(store, "TRACK_CHANGE");
  info("Re-enable the first declaration");
  await togglePropStatus(ruleView, prop);
  info("Wait for change to be tracked");
  await onTrackChange;

  const addedDeclarations = panel.querySelectorAll(".diff-add");
  removedDeclarations = panel.querySelectorAll(".diff-remove");
  is(addedDeclarations.length, 0, "No declarations were tracked as added");
  is(removedDeclarations.length, 0, "No declarations were tracked as removed");
});
