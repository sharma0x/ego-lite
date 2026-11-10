import { invalidArgument } from "../errors.mjs";

// Native bindings validate synchronously and throw TypeError with
// EGO_INVALID_ARGUMENT; these guards keep that contract in one place.

export function expectArity(method, args, min, max = min) {
  if (args.length < min || args.length > max) {
    throw invalidArgument(
      `${method} expects ${min === max ? min : `${min}-${max}`} argument(s), got ${args.length}`,
    );
  }
}

export function expectNumber(method, label, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidArgument(`${method} ${label} must be a number`);
  }
}

export function expectString(method, label, value, { nonEmpty = false } = {}) {
  if (typeof value !== "string" || (nonEmpty && value.length === 0)) {
    throw invalidArgument(
      `${method} ${label} must be a${nonEmpty ? " non-empty" : ""} string`,
    );
  }
}

export function expectOptionalString(method, label, value) {
  if (value !== undefined) expectString(method, label, value);
}
