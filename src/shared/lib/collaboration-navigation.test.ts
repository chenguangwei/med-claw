import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCollaborationNavigationState,
  readCollaborationNavigationState,
} from './collaboration-navigation';

test('creates route state that requests a new collaboration session', () => {
  const state = createCollaborationNavigationState({ createNew: true });

  assert.deepEqual(readCollaborationNavigationState(state), {
    createNew: true,
  });
});

test('ignores unrelated route state', () => {
  assert.equal(readCollaborationNavigationState(null), null);
  assert.equal(readCollaborationNavigationState({}), null);
  assert.equal(
    readCollaborationNavigationState({
      collaborationSessionStart: 'create',
    }),
    null
  );
});
