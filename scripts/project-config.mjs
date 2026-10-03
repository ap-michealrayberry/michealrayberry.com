import config from '../project-config-v2.json' with { type: 'json' };
import assert from 'node:assert/strict';

assert.equal(config.schemaVersion, 1);
assert.equal(config.edition, 2);
for (const date of [config.startDate, config.testStartDate, config.supervision.startDate]) {
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10), date);
}
assert.ok(config.testStartDate < config.startDate);
assert.ok(config.startWeightLb > config.goalWeightLb && config.goalWeightLb > 0);
assert.ok(Number.isInteger(config.completionDays) && config.completionDays > 0);
assert.equal(config.milestonesLb.at(-1), config.goalWeightLb);
assert.ok(config.milestonesLb.every((n, i, a) => n > 0 && (!i || n < a[i - 1])));
assert.equal(new URL(config.siteOrigin).origin, config.siteOrigin);
Object.freeze(config.supervision.nights);
Object.freeze(config.supervision);
Object.freeze(config.milestonesLb);
Object.freeze(config.correctionMinutes);
export const PROJECT = Object.freeze(config);
