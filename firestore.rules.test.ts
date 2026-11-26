import fs from 'node:fs';
import assert from 'node:assert/strict';

/**
 * Static and structural verification suite for the "Dirty Dozen" invariants
 * against firestore.rules and firebase-blueprint.json.
 */
const rules = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
const blueprint = JSON.parse(
  fs.readFileSync(new URL('./firebase-blueprint.json', import.meta.url), 'utf8')
);

const requiredCollections = [
  '/admins/{userId}',
  '/users/{userId}',
  '/subjects/{subjectId}',
  '/studySessions/{sessionId}',
  '/habits/{habitId}',
  '/batches/{batchId}',
  '/batches/{batchId}/lectures/{lectureId}',
  '/purchases/{purchaseId}',
];

for (const path of requiredCollections) {
  assert.ok(blueprint.firestore[path], `Blueprint missing path ${path}`);
}

// Verify Eight Pillars primitives & guards in firestore.rules
assert.ok(rules.includes("rules_version = '2';"), 'Missing rules_version 2');
assert.ok(rules.includes('match /{document=**} {\n      allow read, write: if false;\n    }'), 'Missing global deny net');
assert.ok(rules.includes('email_verified == true'), 'Missing email_verified check');
assert.ok(rules.includes('isValidId('), 'Missing Path Variable Hardening');
assert.ok(rules.includes('hasOnly('), 'Missing strict hasOnly field allowlists');
assert.ok(rules.includes('request.time'), 'Missing server timestamp enforcement');
assert.ok(rules.includes('hasActivePurchase(batchId)'), 'Missing batch purchase gate on lectures');

console.log('All security rule structural invariants passed.');
