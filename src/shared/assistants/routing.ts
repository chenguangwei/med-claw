export const SALES_DEMO_CAPABILITY_ID = 'sales-demo';

export type CapabilitySelectionSource =
  | 'capability-chip'
  | 'assistant-selection';

export function shouldActivateSalesDemo(
  capabilityId: string | null | undefined,
  source: CapabilitySelectionSource
): boolean {
  return (
    source === 'capability-chip' && capabilityId === SALES_DEMO_CAPABILITY_ID
  );
}
