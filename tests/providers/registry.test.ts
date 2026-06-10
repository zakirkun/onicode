import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProvider } from "../../src/providers/registry.js";
import type { Logger } from "../../src/utils/logger.js";
import type { ProviderConfig } from "../../src/config/types.js";

// Mock Anthropic SDK to avoid real HTTP.
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(() => ({ messages: { stream: vi.fn() } })),
}));

// Mock OpenAI SDK.
vi.mock("openai", () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn(() => ({
      chat: { completions: { create: mockCreate } },
    })),
    __mockCreate: mockCreate,
  };
});

function createMockLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  };
  (logger.child as ReturnType<typeof vi.fn>).mockReturnValue(logger);
  return logger;
}

describe("createProvider", () => {
  let log: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    log = createMockLogger();
  });

  it("creates anthropic provider with valid config", () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    const config: ProviderConfig = { apiKeyEnv: "ANTHROPIC_API_KEY" };
    const provider = createProvider("anthropic", config, log);
    expect(provider.id).toBe("anthropic");
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("creates openai provider with valid config", () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    const config: ProviderConfig = { apiKeyEnv: "OPENAI_API_KEY" };
    const provider = createProvider("openai", config, log);
    expect(provider.id).toBe("openai");
    delete process.env.OPENAI_API_KEY;
  });

  it("creates openai provider with custom baseUrl", () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    const config: ProviderConfig = {
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.example.com",
    };
    const provider = createProvider("openai", config, log);
    expect(provider.id).toBe("openai");
    delete process.env.OPENAI_API_KEY;
  });

  it("creates ollama provider without apiKeyEnv", () => {
    const config: ProviderConfig = {
      baseUrl: "http://localhost:11434/v1",
    };
    const provider = createProvider("ollama", config, log);
    expect(provider.id).toBe("ollama");
  });

  it("creates ollama provider with apiKeyEnv if present", () => {
    process.env.OLLAMA_API_KEY = "some-key";
    const config: ProviderConfig = {
      apiKeyEnv: "OLLAMA_API_KEY",
      baseUrl: "http://localhost:11434/v1",
    };
    const provider = createProvider("ollama", config, log);
    expect(provider.id).toBe("ollama");
    delete process.env.OLLAMA_API_KEY;
  });

  it("throws when anthropic apiKeyEnv missing", () => {
    const config: ProviderConfig = {};
    expect(() => createProvider("anthropic", config, log)).toThrow(
      'Provider "anthropic" config is missing apiKeyEnv.',
    );
  });

  it("throws when anthropic env var not set", () => {
    const config: ProviderConfig = { apiKeyEnv: "MISSING_KEY" };
    expect(() => createProvider("anthropic", config, log)).toThrow(
      'Provider "anthropic" requires environment variable MISSING_KEY to be set.',
    );
  });

  it("throws when openai env var not set", () => {
    const config: ProviderConfig = { apiKeyEnv: "MISSING_KEY" };
    expect(() => createProvider("openai", config, log)).toThrow(
      'Provider "openai" requires environment variable MISSING_KEY to be set.',
    );
  });
});
