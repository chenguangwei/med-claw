export interface CollaborationSessionStartOptions {
  createNew?: boolean;
}

export interface CollaborationNavigationState {
  collaborationSessionStart?: CollaborationSessionStartOptions;
}

export function createCollaborationNavigationState(
  options: CollaborationSessionStartOptions
): CollaborationNavigationState {
  return {
    collaborationSessionStart: {
      createNew: options.createNew === true,
    },
  };
}

export function readCollaborationNavigationState(
  state: unknown
): CollaborationSessionStartOptions | null {
  if (!state || typeof state !== 'object') return null;

  const value = (state as CollaborationNavigationState)
    .collaborationSessionStart;
  if (!value || typeof value !== 'object') return null;

  return {
    createNew: value.createNew === true,
  };
}
