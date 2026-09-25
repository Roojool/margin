import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { parseAriaSnapshot, observePage } from "../src/observer.js";

const sampleAriaSnapshot = `
- document:
  - main:
    - paragraph: Field Supply / local test fixture
    - heading "A place for your next idea." [level=1]
    - article:
      - heading "Field notebook" [level=2]
      - paragraph: Uncoated paper. Thread binding. Made to be used.
      - paragraph: ₹240 / notebook
      - button "Add to basket"
    - status "Basket": 0 notebooks · ₹0
    - button "Place order" [disabled]
    - status "Order": No order yet
`;

test("parseAriaSnapshot extracts role, accessible name, semantic scope, state, and local refs", () => {
  const obs = parseAriaSnapshot(sampleAriaSnapshot, {
    url: "http://127.0.0.1:4173/fixture",
    title: "Field Supply — test fixture",
  });

  assert.equal(obs.title, "Field Supply — test fixture");
  assert.equal(obs.path, "/fixture");
  assert.equal(obs.controls.length, 6);

  // Check heading 1
  assert.deepEqual(obs.controls[0], {
    ref: "c1",
    role: "heading",
    name: "A place for your next idea.",
    scope: "main",
    state: { level: 1 },
  });

  // Check heading 2 inside article
  assert.deepEqual(obs.controls[1], {
    ref: "c2",
    role: "heading",
    name: "Field notebook",
    scope: "main > article",
    state: { level: 2 },
  });

  // Check button inside article
  assert.deepEqual(obs.controls[2], {
    ref: "c3",
    role: "button",
    name: "Add to basket",
    scope: "main > article",
    state: {},
  });

  // Check status under main
  assert.deepEqual(obs.controls[3], {
    ref: "c4",
    role: "status",
    name: "Basket",
    scope: "main",
    state: { value: "0 notebooks · ₹0" },
  });

  // Check disabled button
  assert.deepEqual(obs.controls[4], {
    ref: "c5",
    role: "button",
    name: "Place order",
    scope: "main",
    state: { disabled: true },
  });

  // Check order status
  assert.deepEqual(obs.controls[5], {
    ref: "c6",
    role: "status",
    name: "Order",
    scope: "main",
    state: { value: "No order yet" },
  });

  // Check compact text formatting
  assert.ok(obs.compactText.includes('Page: Field Supply — test fixture (/fixture)'));
  assert.ok(obs.compactText.includes('[c3] button "Add to basket" (scope: main > article)'));
  assert.ok(obs.compactText.includes('[c5] button "Place order" [disabled] (scope: main)'));
  assert.ok(obs.compactText.includes('[c4] status "Basket": "0 notebooks · ₹0" (scope: main)'));
});

test("parseAriaSnapshot keeps body paragraphs out of actionable controls for compactness", () => {
  const obs = parseAriaSnapshot(sampleAriaSnapshot);
  // Paragraphs should not be registered as actionable controls
  assert.ok(!obs.controls.some((c) => c.role === "paragraph"));
  assert.ok(!obs.compactText.includes("Uncoated paper"));
});

test("observePage extracts semantic observation from live Playwright Chromium page", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(`
      <!doctype html>
      <title>Test Page</title>
      <main>
        <button id="btn1">Submit Application</button>
        <div role="status" aria-label="Result">Success</div>
      </main>
    `);
    const obs = await observePage(page);
    assert.equal(obs.title, "Test Page");
    assert.equal(obs.controls.length, 2);
    assert.equal(obs.controls[0]?.name, "Submit Application");
    assert.equal(obs.controls[0]?.role, "button");
    assert.equal(obs.controls[1]?.name, "Result");
    assert.equal(obs.controls[1]?.role, "status");
    assert.equal(obs.controls[1]?.state.value, "Success");
  } finally {
    await browser.close();
  }
});

test("quoted accessible names and values retain their exact text", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<nav><button aria-label='Say "hello"'>x</button></nav><main><label>Name <input value="A: B" /></label></main>`);
    const obs = await observePage(page);
    assert.deepEqual(obs.controls.map(({ role, name, scope, state }) => ({ role, name, scope, state })), [
      { role: "button", name: 'Say "hello"', scope: "navigation", state: { value: "x" } },
      { role: "textbox", name: "Name", scope: "main", state: { value: "A: B" } },
    ]);
  } finally {
    await browser.close();
  }
});
