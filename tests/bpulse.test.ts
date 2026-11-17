import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeBpulse } from "../src/lib/bpulse.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, FIXTURES)));
}

test("decodeBpulse reads samples and metadata from original RadexLight files", async () => {
  const data = await decodeBpulse(load("backlight_pwm_no_filter.bpulse"));
  assert.equal(data.samples.length, 6000);
  assert.equal(data.sampleRate, 6000);
  assert.equal(data.deviceType, 60002);
  assert.equal(data.device, "2017-05-15 1592");
  assert.equal(data.order, 1592);
  assert.equal(data.productionDate, "2017-05-15");
  assert.equal(data.firmware, "1.3");
  assert.equal(data.comment, "");
  const min = Math.min(...data.samples);
  const max = Math.max(...data.samples);
  assert.ok(Math.abs(min - 5.094) < 0.01);
  assert.ok(Math.abs(max - 288.44) < 0.05);
});

test("decodeBpulse extracts UTF-8 comments from newer files", async () => {
  const benq = await decodeBpulse(load("benq_gw2270h_backlight.bpulse"));
  assert.match(benq.comment, /Benq GW2270H/);
  assert.equal(benq.device, "2022-09-01 6970");
  assert.equal(benq.firmware, "1.6");
});

test("decodeBpulse rejects non-bpulse input", async () => {
  await assert.rejects(() => decodeBpulse(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24])), /сигнатур/);
  const wrong = new Uint8Array(64);
  wrong.set(new Uint8Array([0x62, 0xea]), 0); // wrong magic, short file
  await assert.rejects(() => decodeBpulse(wrong), /сигнатур|коротк/);
});
