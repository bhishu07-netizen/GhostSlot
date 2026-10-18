import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOn, parseDob, hashPassword, verifyPassword, signPayload, verifyPayload, passwordProblem } from "../security.js";

const at = (iso) => new Date(iso);

test("age is calendar-exact on the birthday boundary (IST)", () => {
  const now = at("2026-10-17T09:00:00Z"); // 14:30 IST, 17 Oct
  assert.equal(ageOn("2008-10-17", now), 18); // 18th birthday today
  assert.equal(ageOn("2008-10-18", now), 17); // birthday tomorrow
  assert.equal(ageOn("2000-01-01", now), 26);
});

test("uses India's date, not UTC", () => {
  const now = at("2026-10-16T19:00:00Z"); // 00:30 IST on 17 Oct, still 16 Oct in UTC
  assert.equal(ageOn("2008-10-17", now), 18);
});

test("29 Feb birthdays turn 18 on 1 March in non-leap years", () => {
  assert.equal(ageOn("2008-02-29", at("2026-02-28T12:00:00Z")), 17);
  assert.equal(ageOn("2008-02-29", at("2026-03-01T12:00:00Z")), 18);
});

test("rejects impossible and malformed dates, flags future ones", () => {
  assert.equal(parseDob("2005-02-30"), null);
  assert.equal(parseDob("2005-13-01"), null);
  assert.equal(parseDob("05/01/2005"), null);
  assert.equal(parseDob(""), null);
  assert.equal(ageOn("2030-01-01", at("2026-10-17T09:00:00Z")), -1);
});

test("password hashing: verifies the right password only, salts every hash", async () => {
  const h1 = await hashPassword("Str0ng-pass-99");
  const h2 = await hashPassword("Str0ng-pass-99");
  assert.match(h1, /^scrypt\$65536\$8\$2\$/);
  assert.notEqual(h1, h2);
  assert.equal(await verifyPassword("Str0ng-pass-99", h1), true);
  assert.equal(await verifyPassword("str0ng-pass-99", h1), false);
  assert.equal(await verifyPassword("anything", "garbage"), false);
});

test("signed tokens: tampering or expiry makes them invalid", () => {
  const tok = signPayload({ kind: "age", adult: true, exp: Date.now() + 60000 });
  assert.equal(verifyPayload(tok).adult, true);
  const [body, sig] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ kind: "age", adult: true, exp: Date.now() + 9e9 })).toString("base64url");
  assert.equal(verifyPayload(`${forged}.${sig}`), null);
  assert.equal(verifyPayload(`${body}.${sig.slice(0, -2)}xx`), null);
  assert.equal(verifyPayload(signPayload({ kind: "age", exp: Date.now() - 1 })), null);
});

test("password policy", () => {
  assert.ok(passwordProblem("short"));
  assert.ok(passwordProblem("password123"));
  assert.ok(passwordProblem("my23BCS10432pw", { roll: "23BCS10432" }));
  assert.ok(passwordProblem("aaaaaaaaaa"));
  assert.equal(passwordProblem("Str0ng-pass-99", { roll: "24BCS11111", name: "Riya Sharma" }), null);
});
