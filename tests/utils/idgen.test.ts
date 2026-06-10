import { describe, it, expect } from "vitest";
import {
  newSessionId,
  newAgentId,
  newToolCallId,
  newEventId,
} from "../../src/utils/idgen.js";

describe("newSessionId", () => {
  it("returns a string", () => {
    const id = newSessionId();
    expect(typeof id).toBe("string");
  });

  it("has 'ses_' prefix", () => {
    const id = newSessionId();
    expect(id.startsWith("ses_")).toBe(true);
  });

  it("has 12-character body after prefix", () => {
    const id = newSessionId();
    const body = id.slice(4); // after "ses_"
    expect(body.length).toBe(12);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newSessionId()));
    expect(ids.size).toBe(100);
  });

  it("body uses only unambiguous alphabet", () => {
    const id = newSessionId();
    const body = id.slice(4);
    // Should not contain: 0, O, 1, I, l, i, o
    expect(body).not.toMatch(/[0O1Ilio]/);
  });
});

describe("newAgentId", () => {
  it("returns a string", () => {
    const id = newAgentId();
    expect(typeof id).toBe("string");
  });

  it("has 'agt_' prefix", () => {
    const id = newAgentId();
    expect(id.startsWith("agt_")).toBe(true);
  });

  it("has 12-character body after prefix", () => {
    const id = newAgentId();
    const body = id.slice(4);
    expect(body.length).toBe(12);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newAgentId()));
    expect(ids.size).toBe(100);
  });
});

describe("newToolCallId", () => {
  it("returns a string", () => {
    const id = newToolCallId();
    expect(typeof id).toBe("string");
  });

  it("has 'tc_' prefix", () => {
    const id = newToolCallId();
    expect(id.startsWith("tc_")).toBe(true);
  });

  it("has 12-character body after prefix", () => {
    const id = newToolCallId();
    const body = id.slice(3);
    expect(body.length).toBe(12);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newToolCallId()));
    expect(ids.size).toBe(100);
  });
});

describe("newEventId", () => {
  it("returns a string", () => {
    const id = newEventId();
    expect(typeof id).toBe("string");
  });

  it("has 'evt_' prefix", () => {
    const id = newEventId();
    expect(id.startsWith("evt_")).toBe(true);
  });

  it("has 12-character body after prefix", () => {
    const id = newEventId();
    const body = id.slice(4);
    expect(body.length).toBe(12);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newEventId()));
    expect(ids.size).toBe(100);
  });
});
