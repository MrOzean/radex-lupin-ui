import assert from "node:assert/strict";
import test from "node:test";
import {
  assessFlicker,
  assessIlluminance,
  DEFAULT_LIGHTING_PROFILE_ID,
  LIGHTING_PROFILES,
  lightingProfileById,
} from "../src/lib/lighting.ts";

test("lighting profiles have unique IDs and valid limits", () => {
  const ids = LIGHTING_PROFILES.map((profile) => profile.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const profile of LIGHTING_PROFILES) {
    assert.ok(profile.minimumLux > 0);
    assert.ok(profile.greenMaximumLux >= profile.minimumLux);
    assert.ok(profile.flickerLimitPercent > 0);
  }
});

test("illuminance assessment uses the selected workplace minimum", () => {
  const office = lightingProfileById("office");
  assert.equal(assessIlluminance(299.9, office).tone, "warning");
  assert.equal(assessIlluminance(300, office).tone, "good");
  assert.equal(assessIlluminance(2000, office).tone, "good");
  assert.equal(assessIlluminance(2001, office).tone, "warning");
});

test("flicker assessment follows the selected normative limit", () => {
  const computer = lightingProfileById("computer-work");
  const highAccuracy = lightingProfileById("high-accuracy");
  const mediumAccuracy = lightingProfileById("medium-accuracy");

  assert.equal(assessFlicker(4, computer).tone, "good");
  assert.equal(assessFlicker(5, computer).tone, "warning");
  assert.equal(assessFlicker(5.1, computer).tone, "danger");
  assert.equal(assessFlicker(12, highAccuracy).tone, "good");
  assert.equal(assessFlicker(15.1, highAccuracy).tone, "danger");
  assert.equal(assessFlicker(18, mediumAccuracy).tone, "warning");
  assert.equal(assessFlicker(20, mediumAccuracy).tone, "warning");
});

test("unknown profile falls back to the general scale", () => {
  assert.equal(lightingProfileById("missing").id, DEFAULT_LIGHTING_PROFILE_ID);
});
