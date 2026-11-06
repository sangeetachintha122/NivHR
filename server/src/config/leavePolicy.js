// Configurable demo defaults; these values are not mandatory company policy.
export const LEAVE_ALLOCATIONS = Object.freeze({
  annual: 18,
  sick: 10,
  casual: 6,
});

export const LEAVE_TYPES = Object.freeze(Object.keys(LEAVE_ALLOCATIONS));
