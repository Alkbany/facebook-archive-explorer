/**
 * Tracks the newest asynchronous view request.
 * Older responses can be ignored after a newer request begins or the view changes.
 */
export interface RequestGate {
  begin(): number;
  invalidate(): void;
  isCurrent(requestId: number): boolean;
}

export function createRequestGate(): RequestGate {
  let currentRequestId = 0;

  return {
    begin: () => {
      currentRequestId += 1;
      return currentRequestId;
    },
    invalidate: () => {
      currentRequestId += 1;
    },
    isCurrent: (requestId) => requestId === currentRequestId
  };
}
