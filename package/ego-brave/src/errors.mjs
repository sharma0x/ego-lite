// Error shapes defined by docs/native-bindings-api.md, so the harness handles
// adapter failures exactly like Ego Lite's native ones.

export const ErrorCode = Object.freeze({
  BROWSER_UNAVAILABLE: "EGO_BROWSER_UNAVAILABLE",
  CDP_CHANNEL_UNAVAILABLE: "EGO_CDP_CHANNEL_UNAVAILABLE",
  CDP_SEND_FAILED: "EGO_CDP_SEND_FAILED",
  INVALID_ARGUMENT: "EGO_INVALID_ARGUMENT",
  OPERATION_FAILED: "EGO_OPERATION_FAILED",
  PROFILE_NOT_FOUND: "EGO_PROFILE_NOT_FOUND",
  SNAPSHOT_FAILED: "EGO_SNAPSHOT_FAILED",
  TASK_SPACE_NOT_FOUND: "EGO_TASK_SPACE_NOT_FOUND",
  TASK_SPACE_NOT_SELECTED: "EGO_TASK_SPACE_NOT_SELECTED",
  TASK_SPACE_USER_IN_CONTROL: "EGO_TASK_SPACE_USER_IN_CONTROL",
  WEB_CONTENTS_UNAVAILABLE: "EGO_WEB_CONTENTS_UNAVAILABLE",
});

/** Argument validation failures throw synchronously, as the native bindings do. */
export function invalidArgument(message) {
  return codedTypeError(ErrorCode.INVALID_ARGUMENT, message);
}

export function codedTypeError(errorCode, message) {
  const error = new TypeError(message);
  error.error_code = errorCode;
  return error;
}

/** Most task-scoped calls resolve to an error object instead of rejecting. */
export function errorResult(errorCode, message) {
  return { error: message, error_code: errorCode };
}

/** ego.snapshot() rejects with an Error carrying error_code. */
export function codedError(errorCode, message) {
  const error = new Error(message);
  error.error_code = errorCode;
  return error;
}

export function isErrorResult(value) {
  return Boolean(value && typeof value === "object" && "error_code" in value);
}
