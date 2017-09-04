"use strict";

const URL = BASE_URL + "autocomplete_basic.html";
const PRIVACY_PREF_URL = "about:preferences#privacy";

async function expectWarningText(browser, expectedText) {
  const {autoCompletePopup: {richlistbox: itemsBox}} = browser;
  const warningBox = itemsBox.querySelector(".autocomplete-richlistitem:last-child")._warningTextBox;

  await BrowserTestUtils.waitForCondition(() => {
    return warningBox.textContent == expectedText;
  }, `Waiting for expected warning text: ${expectedText}, Got ${warningBox.textContent}`);
  ok(true, `Got expected warning text: ${expectedText}`);
}

add_task(async function setup_storage() {
  await saveAddress(TEST_ADDRESS_2);
  await saveAddress(TEST_ADDRESS_3);
  await saveAddress(TEST_ADDRESS_4);
  await saveAddress(TEST_ADDRESS_5);
});

add_task(async function test_click_on_footer() {
  await BrowserTestUtils.withNewTab({gBrowser, url: URL}, async function(browser) {
    const {autoCompletePopup: {richlistbox: itemsBox}} = browser;

    dump("[xeon] before openPopupOn\n");
    await openPopupOn(browser, "#organization");
    dump("[xeon] after openPopupOn\n");
    // Click on the footer
    dump("[xeon] before itemsBox.querySelector\n");
    const optionButton = itemsBox.querySelector(".autocomplete-richlistitem:last-child")._optionButton;
    dump("[xeon] after itemsBox.querySelector\n");
    dump("[xeon] before BrowserTestUtils.waitForNewTab\n");
    const prefTabPromise = BrowserTestUtils.waitForNewTab(gBrowser, PRIVACY_PREF_URL);
    dump("[xeon] after BrowserTestUtils.waitForNewTab\n");
    dump("[xeon] before EventUtils.synthesizeMouseAtCenter\n");
    await EventUtils.synthesizeMouseAtCenter(optionButton, {});
    dump("[xeon] after EventUtils.synthesizeMouseAtCenter\n");
    dump("[xeon] before BrowserTestUtils.removeTab\n");
    await BrowserTestUtils.removeTab(await prefTabPromise);
    dump("[xeon] after BrowserTestUtils.removeTab\n");
    dump("[xeon] before ok\n");
    ok(true, "Tab: preferences#privacy was successfully opened by clicking on the footer");
    dump("[xeon] after ok\n");
    dump("[xeon] before closePopup\n");
    await closePopup(browser);
    dump("[xeon] after closePopup\n");
  });
});

add_task(async function test_press_enter_on_footer() {
  await BrowserTestUtils.withNewTab({gBrowser, url: URL}, async function(browser) {
    const {autoCompletePopup: {richlistbox: itemsBox}} = browser;

    await openPopupOn(browser, "#organization");
    // Navigate to the footer and press enter.
    const listItemElems = itemsBox.querySelectorAll(".autocomplete-richlistitem");
    const prefTabPromise = BrowserTestUtils.waitForNewTab(gBrowser, PRIVACY_PREF_URL);
    for (let i = 0; i < listItemElems.length; i++) {
      await BrowserTestUtils.synthesizeKey("VK_DOWN", {}, browser);
    }
    await BrowserTestUtils.synthesizeKey("VK_RETURN", {}, browser);
    await BrowserTestUtils.removeTab(await prefTabPromise);
    ok(true, "Tab: preferences#privacy was successfully opened by pressing enter on the footer");

    await closePopup(browser);
  });
});

add_task(async function test_phishing_warning_single_category() {
  await BrowserTestUtils.withNewTab({gBrowser, url: URL}, async function(browser) {
    const {autoCompletePopup: {richlistbox: itemsBox}} = browser;

    await openPopupOn(browser, "#tel");
    const warningBox = itemsBox.querySelector(".autocomplete-richlistitem:last-child")._warningTextBox;
    ok(warningBox, "Got phishing warning box");

    await expectWarningText(browser, "Autofills phone");

    await closePopup(browser);
  });
});

add_task(async function test_phishing_warning_complex_categories() {
  await BrowserTestUtils.withNewTab({gBrowser, url: URL}, async function(browser) {
    await openPopupOn(browser, "#street-address");

    await expectWarningText(browser, "Also autofills company, email");
    await BrowserTestUtils.synthesizeKey("VK_DOWN", {}, browser);
    await expectWarningText(browser, "Autofills address");
    await BrowserTestUtils.synthesizeKey("VK_DOWN", {}, browser);
    await BrowserTestUtils.synthesizeKey("VK_DOWN", {}, browser);
    await expectWarningText(browser, "Also autofills company, email");
    await BrowserTestUtils.synthesizeKey("VK_DOWN", {}, browser);
    await expectWarningText(browser, "Also autofills company, email");

    await closePopup(browser);
  });
});
