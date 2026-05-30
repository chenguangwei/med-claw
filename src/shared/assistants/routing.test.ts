import assert from 'node:assert/strict';
import test from 'node:test';

import { SALES_DEMO_CAPABILITY_ID, shouldActivateSalesDemo } from './routing';

test('only the explicit sales demo capability chip activates mock demo mode', () => {
  assert.equal(
    shouldActivateSalesDemo(SALES_DEMO_CAPABILITY_ID, 'capability-chip'),
    true
  );
});

test('selecting a real assistant profile never activates mock demo mode', () => {
  assert.equal(shouldActivateSalesDemo('sales', 'assistant-selection'), false);
  assert.equal(
    shouldActivateSalesDemo(SALES_DEMO_CAPABILITY_ID, 'assistant-selection'),
    false
  );
});
