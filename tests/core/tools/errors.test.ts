import { describe, it, expect } from "vitest";
import {
  ToolError,
  ToolNotFoundError,
  ToolValidationError,
  ToolPermissionError,
  ToolExecutionError,
  ToolAbortedError,
  toErrorPayload,
} from "../../../src/core/tools/errors.js";

describe("ToolNotFoundError", () => {
  it("has correct name and message", () => {
    const err = new ToolNotFoundError("Read");
    expect(err.name).toBe("ToolNotFoundError");
    expect(err.message).toBe("Tool not found: Read");
  });

  it("has kind 'execution'", () => {
    const err = new ToolNotFoundError("Foo");
    expect(err.kind).toBe("execution");
  });

  it("has undefined details by default", () => {
    const err = new ToolNotFoundError("Foo");
    expect(err.details).toBeUndefined();
  });
});

describe("ToolValidationError", () => {
  it("has correct name and message", () => {
    const err = new ToolValidationError("Invalid input");
    expect(err.name).toBe("ToolValidationError");
    expect(err.message).toBe("Invalid input");
  });

  it("has kind 'validation'", () => {
    const err = new ToolValidationError("bad");
    expect(err.kind).toBe("validation");
  });

  it("preserves details when provided", () => {
    const details = { issues: ["missing field"] };
    const err = new ToolValidationError("Invalid input", details);
    expect(err.details).toBe(details);
  });

  it("has undefined details when not provided", () => {
    const err = new ToolValidationError("bad");
    expect(err.details).toBeUndefined();
  });
});

describe("ToolPermissionError", () => {
  it("has correct name and message", () => {
    const err = new ToolPermissionError("Write denied");
    expect(err.name).toBe("ToolPermissionError");
    expect(err.message).toBe("Write denied");
  });

  it("has kind 'permission'", () => {
    const err = new ToolPermissionError("denied");
    expect(err.kind).toBe("permission");
  });

  it("has undefined details by default", () => {
    const err = new ToolPermissionError("denied");
    expect(err.details).toBeUndefined();
  });
});

describe("ToolExecutionError", () => {
  it("has correct name and message", () => {
    const err = new ToolExecutionError("Process exited with code 1");
    expect(err.name).toBe("ToolExecutionError");
    expect(err.message).toBe("Process exited with code 1");
  });

  it("has kind 'execution'", () => {
    const err = new ToolExecutionError("fail");
    expect(err.kind).toBe("execution");
  });

  it("preserves details when provided", () => {
    const details = { exitCode: 1, stderr: "error" };
    const err = new ToolExecutionError("fail", details);
    expect(err.details).toBe(details);
  });

  it("has undefined details when not provided", () => {
    const err = new ToolExecutionError("fail");
    expect(err.details).toBeUndefined();
  });
});

describe("ToolAbortedError", () => {
  it("has correct name and default message", () => {
    const err = new ToolAbortedError();
    expect(err.name).toBe("ToolAbortedError");
    expect(err.message).toBe("Tool execution aborted");
  });

  it("has correct name and custom message", () => {
    const err = new ToolAbortedError("Cancelled by user");
    expect(err.name).toBe("ToolAbortedError");
    expect(err.message).toBe("Cancelled by user");
  });

  it("has kind 'aborted'", () => {
    const err = new ToolAbortedError();
    expect(err.kind).toBe("aborted");
  });

  it("has undefined details by default", () => {
    const err = new ToolAbortedError();
    expect(err.details).toBeUndefined();
  });
});

describe("instanceof checks", () => {
  it("all subclasses are instanceof ToolError", () => {
    const errors = [
      new ToolNotFoundError("Read"),
      new ToolValidationError("bad"),
      new ToolPermissionError("denied"),
      new ToolExecutionError("fail"),
      new ToolAbortedError(),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(ToolError);
    }
  });

  it("all subclasses are instanceof Error", () => {
    const errors = [
      new ToolNotFoundError("Read"),
      new ToolValidationError("bad"),
      new ToolPermissionError("denied"),
      new ToolExecutionError("fail"),
      new ToolAbortedError(),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("ToolError is not instanceof any specific subclass", () => {
    // ToolError is abstract, but we can verify subclasses are distinct
    const notFound = new ToolNotFoundError("Read");
    expect(notFound).not.toBeInstanceOf(ToolValidationError);
    expect(notFound).not.toBeInstanceOf(ToolPermissionError);
    expect(notFound).not.toBeInstanceOf(ToolExecutionError);
    expect(notFound).not.toBeInstanceOf(ToolAbortedError);
  });

  it("each subclass is only instanceof itself and base classes", () => {
    const validation = new ToolValidationError("bad");
    expect(validation).toBeInstanceOf(ToolValidationError);
    expect(validation).not.toBeInstanceOf(ToolNotFoundError);
    expect(validation).not.toBeInstanceOf(ToolPermissionError);
    expect(validation).not.toBeInstanceOf(ToolExecutionError);
    expect(validation).not.toBeInstanceOf(ToolAbortedError);
  });
});

describe("toErrorPayload", () => {
  it("converts ToolNotFoundError with kind 'execution'", () => {
    const payload = toErrorPayload(new ToolNotFoundError("Read"));
    expect(payload).toEqual({
      kind: "execution",
      message: "Tool not found: Read",
    });
  });

  it("converts ToolValidationError with kind 'validation' and details", () => {
    const details = { issues: ["missing field"] };
    const payload = toErrorPayload(new ToolValidationError("Invalid", details));
    expect(payload).toEqual({
      kind: "validation",
      message: "Invalid",
      details,
    });
  });

  it("converts ToolPermissionError with kind 'permission'", () => {
    const payload = toErrorPayload(new ToolPermissionError("denied"));
    expect(payload).toEqual({
      kind: "permission",
      message: "denied",
    });
  });

  it("converts ToolExecutionError with kind 'execution' and details", () => {
    const details = { exitCode: 1 };
    const payload = toErrorPayload(new ToolExecutionError("fail", details));
    expect(payload).toEqual({
      kind: "execution",
      message: "fail",
      details,
    });
  });

  it("converts ToolAbortedError with kind 'aborted'", () => {
    const payload = toErrorPayload(new ToolAbortedError());
    expect(payload).toEqual({
      kind: "aborted",
      message: "Tool execution aborted",
    });
  });

  it("omits details field when details is undefined", () => {
    const payload = toErrorPayload(new ToolValidationError("bad"));
    expect(payload).toEqual({
      kind: "validation",
      message: "bad",
    });
    expect("details" in payload).toBe(false);
  });

  it("converts generic Error to execution payload", () => {
    const payload = toErrorPayload(new Error("Something broke"));
    expect(payload).toEqual({
      kind: "execution",
      message: "Something broke",
    });
  });

  it("converts non-Error values to execution payload with String()", () => {
    expect(toErrorPayload("string error")).toEqual({
      kind: "execution",
      message: "string error",
    });
    expect(toErrorPayload(42)).toEqual({
      kind: "execution",
      message: "42",
    });
    expect(toErrorPayload(null)).toEqual({
      kind: "execution",
      message: "null",
    });
    expect(toErrorPayload(undefined)).toEqual({
      kind: "execution",
      message: "undefined",
    });
  });
});
