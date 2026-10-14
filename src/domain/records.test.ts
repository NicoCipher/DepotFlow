import assert from "node:assert/strict";
import { test } from "node:test";
import {
  recordDates, recordDate, recordFilter, recordKinds,
  recordMethods, recordPage, recordCursor, writeRecordCursor, recordStatus, recordTypeName, shiftRecordDay,
} from "./records.ts";

test("records filter only accepts known choices", () => {
  assert.equal(recordFilter("sale", recordKinds, "all"), "sale");
  assert.equal(recordFilter("unknown", recordKinds, "all"), "all");
  assert.equal(recordFilter("cash", recordMethods, "all"), "cash");
  assert.equal(recordFilter("all;drop table", recordMethods, "all"), "all");
});
test("record pages are clamped and cannot inject filters", () => {
  assert.equal(recordPage("3"), 3);
  assert.equal(recordPage("-1"), 1);
  assert.equal(recordPage("999999"), 33334);
  assert.equal(recordPage("1 OR TRUE"), 1);
});
test("cursor paging keeps exact event identity and rejects malformed tokens", () => {
  const key = {
    id: "20000000-0000-4000-8000-000000000961",
    day: "2026-10-14",
    created_at: "2026-10-14T13:00:00.000Z",
    kind: "sale" as const,
  };
  assert.deepEqual(recordCursor(writeRecordCursor(key)),key);
  assert.equal(recordCursor(JSON.stringify({...key,id:"not-uuid"})),null);
  assert.equal(recordCursor(JSON.stringify({...key,created_at:"not-time"})),null);
  assert.equal(recordCursor(JSON.stringify({...key,kind:"stock"})),null);
  assert.equal(recordCursor("INVALID"),null);
});
test("quick dates and custom dates are deterministic", () => {
  assert.deepEqual(recordDates("2026-10-14", "today"), {from:"2026-10-14",to:"2026-10-14",valid:true,error:null});
  assert.deepEqual(recordDates("2026-10-14", "7d"), {from:"2026-10-08",to:"2026-10-14",valid:true,error:null});
  assert.deepEqual(recordDates("2026-10-14", "all"), {from:"0001-01-01",to:"2026-10-14",valid:true,error:null});
  assert.deepEqual(recordDates("2026-10-14", "30d","2026-09-02","2026-10-03"), {from:"2026-09-02",to:"2026-10-03",valid:true,error:null});
  assert.equal(recordDates("2026-10-14","30d","2026-12-20","2026-10-03").valid, false);
  assert.equal(recordDates("2026-10-14","30d","2026-10-01",undefined).valid,false);
  assert.match(recordDates("2026-10-14","30d","2026-10-01",undefined).error ?? "",/start and end date/);
  assert.equal(shiftRecordDay("2026-03-01",-1),"2026-02-28");
  assert.equal(recordDate("2026-02-30"),null);
  assert.equal(recordDate("2026-02-28"),"2026-02-28");
});
test("never mistake unpaid sale or physical empties for payment", () => {
  assert.equal(recordStatus("sale","unpaid"),"Not paid yet");
  assert.equal(recordStatus("sale","partial"),"Partly paid");
  assert.equal(recordStatus("sale","paid"),"Paid in full");
  assert.equal(recordStatus("payment","received"),"Payment received");
  assert.equal(recordStatus("empties","recorded"),"Recorded");
  assert.equal(recordTypeName("opening"),"Opening balances");
  assert.equal(recordStatus("payment","voided"),"Voided");
});
