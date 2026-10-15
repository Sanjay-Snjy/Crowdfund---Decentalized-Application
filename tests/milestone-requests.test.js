/**
 * Milestone evidence requests: eligibility (the contract's own guards), the
 * fulfilment rule, and the storage lifecycle.
 *
 * Run with:  node --test tests/milestone-requests.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { CHAIN_ID, cleanup, useTempDatabase } from "./helpers.js";

const tempDir = useTempDatabase("crowdfund-milestone-requests");

const { initDb, milestoneRequests } = await import("../lib/db/index.js");
const { evidenceRequestEligibility, fulfillmentsFor, toAdminRequest, toPublicRequest } =
  await import("../lib/milestone/requests.js");

await initDb();

const CONTRACT = "0x43cfa879c2dbc2c87353af41d0043b35fa24f484";

/** The state shape `getCampaignFundingState` returns, trimmed to what matters here. */
function stateWith(overrides = {}) {
  const base = {
    campaignId: 7,
    funded: true,
    deadlinePassed: true,
    currentMilestoneIndex: 0,
    recovery: { enabled: false },
    milestones: [
      { index: 0, title: "Milestone 1", percentage: 30, evidenceSubmitted: false, fundsReleased: false },
      { index: 1, title: "Milestone 2", percentage: 30, evidenceSubmitted: false, fundsReleased: false },
      { index: 2, title: "Milestone 3", percentage: 40, evidenceSubmitted: false, fundsReleased: false },
    ],
  };
  return { ...base, ...overrides };
}

function requestRow(overrides = {}) {
  return {
    id: 1,
    campaignId: 7,
    milestoneIndex: 0,
    note: null,
    requestedBy: "wallet:0x1111111111111111111111111111111111111111",
    status: "pending",
    createdAt: 1000,
    fulfilledAt: null,
    fulfilledCid: null,
    ...overrides,
  };
}

test("the next milestone can be requested for evidence", () => {
  const result = evidenceRequestEligibility(stateWith(), 0);
  assert.equal(result.ok, true);
  assert.equal(result.label, "Milestone 1");
});

test("a milestone the creator cannot act on is refused, with a reason", () => {
  const cases = [
    [{ deadlinePassed: false }, "funding deadline"],
    [{ funded: false }, "not reached its target"],
    [{ recovery: { enabled: true } }, "donor recovery"],
  ];

  for (const [override, expected] of cases) {
    const result = evidenceRequestEligibility(stateWith(override), 0);
    assert.equal(result.ok, false, JSON.stringify(override));
    assert.match(result.reason, new RegExp(expected, "i"));
  }
});

test("evidence already submitted, or funds released, cannot be requested again", () => {
  const submitted = stateWith();
  submitted.milestones[0].evidenceSubmitted = true;
  assert.match(evidenceRequestEligibility(submitted, 0).reason, /already has evidence/i);

  const released = stateWith();
  released.milestones[0].fundsReleased = true;
  assert.match(evidenceRequestEligibility(released, 0).reason, /already released/i);
});

test("milestones release in order — a later one is not requestable yet", () => {
  const result = evidenceRequestEligibility(stateWith(), 2);
  assert.equal(result.ok, false);
  assert.match(result.reason, /unlocks only after milestone 1/i);
});

test("an unknown milestone and an unreadable chain are both refused", () => {
  assert.match(evidenceRequestEligibility(stateWith(), 9).reason, /unknown milestone/i);
  assert.match(evidenceRequestEligibility(stateWith(), -1).reason, /unknown milestone/i);
  assert.match(evidenceRequestEligibility(null, 0).reason, /could not be read/i);
});

test("a request closes exactly when its milestone has on-chain evidence", () => {
  const open = [requestRow({ id: 1 }), requestRow({ id: 2, milestoneIndex: 1 })];

  assert.deepEqual(fulfillmentsFor(open, stateWith()), [], "nothing to close while no evidence exists");

  const withEvidence = stateWith();
  withEvidence.milestones[1].evidenceSubmitted = true;
  withEvidence.milestones[1].evidenceCID = "bafy-one";
  withEvidence.milestones[1].evidenceSubmittedAt = 1700;

  assert.deepEqual(fulfillmentsFor(open, withEvidence), [{ id: 2, cid: "bafy-one", at: 1700 }]);
  assert.deepEqual(fulfillmentsFor(open, null), [], "an unreadable chain must not close anything");
  assert.deepEqual(
    fulfillmentsFor([requestRow({ status: "fulfilled" })], withEvidence),
    [],
    "an already-closed request is never rewritten"
  );
});

test("requests are stored, re-requested in place, and closed once", async () => {
  const created = await milestoneRequests.createRequest({
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    campaignId: 7,
    milestoneIndex: 0,
    note: "Please upload the borehole survey",
    requestedBy: "clerk:user_admin",
  });

  assert.equal(created.status, "pending");
  assert.equal(created.refreshed, false);
  assert.equal(created.note, "Please upload the borehole survey");

  // A second ask for the same milestone refreshes the open request instead of
  // stacking a duplicate the creator would have to read twice.
  const refreshed = await milestoneRequests.createRequest({
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    campaignId: 7,
    milestoneIndex: 0,
    note: "Second, firmer note",
    requestedBy: "wallet:0x2222222222222222222222222222222222222222",
  });
  assert.equal(refreshed.refreshed, true);
  assert.equal(refreshed.id, created.id);

  const listed = await milestoneRequests.listRequests({
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    campaignId: 7,
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].note, "Second, firmer note");
  assert.equal(
    listed[0].requestedBy,
    "wallet:0x2222222222222222222222222222222222222222",
    "the latest operator owns the open request"
  );

  // A different milestone is a separate request.
  await milestoneRequests.createRequest({
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    campaignId: 7,
    milestoneIndex: 1,
    requestedBy: "clerk:user_admin",
  });
  assert.equal(
    (await milestoneRequests.listRequests({ chainId: CHAIN_ID, contractAddress: CONTRACT, campaignId: 7 })).length,
    2
  );

  const fulfilled = await milestoneRequests.markFulfilled(listed[0].id, { cid: "bafy-two", at: 2000 });
  assert.equal(fulfilled.status, "fulfilled");
  assert.equal(fulfilled.fulfilledCid, "bafy-two");
  assert.equal(fulfilled.fulfilledAt, 2000);

  // Closing again is a no-op: the first completion time is the recorded one.
  const again = await milestoneRequests.markFulfilled(listed[0].id, { cid: "bafy-later", at: 3000 });
  assert.equal(again.fulfilledAt, 2000);
  assert.equal(again.fulfilledCid, "bafy-two");

  // A fulfilled request does not block a new ask for the same milestone.
  const afterFulfilment = await milestoneRequests.createRequest({
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    campaignId: 7,
    milestoneIndex: 0,
    requestedBy: "clerk:user_admin",
  });
  assert.equal(afterFulfilment.refreshed, false);
  assert.notEqual(afterFulfilment.id, created.id);
});

test("the public shape hides the operator, the admin shape keeps it", () => {
  const row = requestRow({ note: "note for the creator" });

  const publicRequest = toPublicRequest(row);
  assert.equal("requestedBy" in publicRequest, false);
  assert.equal("id" in publicRequest, false);
  assert.equal(publicRequest.note, "note for the creator");
  assert.equal(publicRequest.milestoneIndex, 0);

  const adminRequest = toAdminRequest(row);
  assert.equal(adminRequest.requestedBy, row.requestedBy);
  assert.equal(adminRequest.note, "note for the creator");
});

test.after(() => cleanup(tempDir));
