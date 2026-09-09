import { describe, expect, it } from "vitest";

import {
  parseBusinessRegistry,
  parseConfiguration,
  parseModuleApi,
  parseModuleInterface,
  parseRuntimeConfiguration,
  type Relation,
} from "../../../src/core/codespec-workflow/current-spec-yaml.js";
import { getCurrentModuleArtifactPaths } from "../../../src/core/codespec-workflow/current-spec-paths.js";

describe("current specification YAML contracts", () => {
  it("exposes the plan contract aliases for relations and runtime configuration", () => {
    const relation: Relation = {
      id: "REL-CHG-20260907-001-01",
      kind: "http",
      fromModule: "MOD-001",
      toModule: "MOD-002",
      path: "/api/users",
      method: "POST",
      input: "request",
      output: "response",
      errors: "invalid request",
      requirements: ["MOD-002-REQ-001"],
      scenarios: ["MOD-002-REQ-001-SCN-001"],
    };
    expect(parseModuleInterface({ version: 1, module: "MOD-001", relations: [relation] }).relations[0]).toEqual(relation);
    expect(parseRuntimeConfiguration({ version: 1, profiles: [] })).toEqual(parseConfiguration({ version: 1, profiles: [] }));
  });
  it("uses the three canonical artifact paths for a current module", () => {
    expect(getCurrentModuleArtifactPaths("/workspace/codespec/specs", "MOD-002")).toEqual({
      directory: "/workspace/codespec/specs/MOD-002",
      spec: "/workspace/codespec/specs/MOD-002/spec.md",
      interface: "/workspace/codespec/specs/MOD-002/interface.yaml",
      api: "/workspace/codespec/specs/MOD-002/api.yaml",
    });
  });

  it("parses an HTTP relation when the current module is an endpoint", () => {
    const parsed = parseModuleInterface({
      version: 1,
      module: "MOD-002",
      relations: [
        {
          id: "REL-CHG-20260907-001-01",
          kind: "http",
          fromModule: "MOD-001",
          toModule: "MOD-002",
          path: "/api/users",
          method: "POST",
          input: "新用户资料",
          output: "已创建的用户",
          errors: "用户名已存在",
          requirements: ["MOD-002-REQ-001"],
          scenarios: ["MOD-002-REQ-001-SCN-001"],
        },
      ],
    });

    expect(parsed.relations[0]).toMatchObject({
      kind: "http",
      path: "/api/users",
      method: "POST",
    });
  });

  it("keeps HTTP and event relation fields mutually exclusive", () => {
    const parsed = parseModuleInterface({
      version: 1,
      module: "MOD-002",
      relations: [
        {
          id: "REL-CHG-20260907-001-02",
          kind: "event",
          fromModule: "MOD-002",
          toModule: "MOD-003",
          event: "user.created",
          triggeredBy: [{ path: "/api/users", method: "POST" }],
          input: "用户生命周期事件",
          output: "通知结果",
          errors: "通知失败时记录重试状态",
          requirements: ["MOD-002-REQ-001"],
          scenarios: ["MOD-002-REQ-001-SCN-001"],
        },
      ],
    });

    expect(parsed.relations[0]).toMatchObject({
      kind: "event",
      event: "user.created",
    });
    expect(() => parseModuleInterface({
      ...parsed,
      relations: [{ ...parsed.relations[0], path: "/api/users" }],
    })).toThrow(/unrecognized key/i);
  });

  it("rejects relations that do not include the current module", () => {
    expect(() => parseModuleInterface({
      version: 1,
      module: "MOD-003",
      relations: [{
        id: "REL-CHG-20260907-001-01",
        kind: "http",
        fromModule: "MOD-001",
        toModule: "MOD-002",
        path: "/api/users",
        method: "POST",
        input: "新用户资料",
        output: "已创建的用户",
        errors: "用户名已存在",
        requirements: ["MOD-002-REQ-001"],
        scenarios: ["MOD-002-REQ-001-SCN-001"],
      }],
    })).toThrow(/current module/i);
  });

  it("requires API routes to be canonical and unique", () => {
    expect(parseModuleApi({
      version: 1,
      module: "MOD-002",
      routes: [{
        path: "/api/users",
        inputModules: ["MOD-001"],
        outputModules: ["MOD-003"],
      }],
    }).routes).toHaveLength(1);

    expect(() => parseModuleApi({
      version: 1,
      module: "MOD-002",
      routes: [{ path: "/api/users/", inputModules: [], outputModules: [] }],
    })).toThrow(/canonical/i);
  });

  it("parses the generated business registry and a non-sensitive configuration snapshot", () => {
    expect(parseBusinessRegistry({
      version: 1,
      modules: [{
        id: "MOD-002",
        name: "用户管理",
        status: "ACTIVE",
        inputs: ["用户管理请求"],
        outputs: ["用户资料"],
        relatedModules: ["MOD-001", "MOD-003"],
      }],
    }).modules[0]?.name).toBe("用户管理");

    expect(parseConfiguration({
      version: 1,
      profiles: [{
        id: "test",
        services: [{
          id: "user-service",
          hostAlias: "user-service-test",
          endpoint: "https://users.test.example",
          routeBindings: [{ module: "MOD-002", path: "/api/users" }],
          source: {
            kind: "repo-file",
            file: ".env.test",
            format: "dotenv",
            key: "USER_SERVICE_BASE_URL",
          },
        }],
      }],
    }).profiles[0]?.services[0]?.hostAlias).toBe("user-service-test");
  });

  it("requires configuration services to use exactly one safe endpoint representation", () => {
    expect(() => parseConfiguration({
      version: 1,
      profiles: [{
        id: "test",
        services: [{
          id: "user-service",
          hostAlias: "user-service-test",
          endpoint: "https://users.test.example",
          endpointFingerprint: "sha256:61d2bd9a5a6406a66ccde3f39720a75e58ed3dc339b9f3f81bca9f53bc9558ec",
          routeBindings: [{ module: "MOD-002", path: "/api/users" }],
          source: {
            kind: "repo-file",
            file: ".env.test",
            format: "dotenv",
            key: "USER_SERVICE_BASE_URL",
          },
        }],
      }],
    })).toThrow(/exactly one/i);
  });

  it("rejects duplicate relation IDs and unknown relation properties", () => {
    const relation = {
      id: "REL-CHG-20260907-001-03",
      kind: "http" as const,
      fromModule: "MOD-001",
      toModule: "MOD-002",
      path: "/api/users",
      method: "POST",
      input: "用户管理请求",
      output: "用户资料",
      errors: "参数不合法时不创建用户",
      requirements: ["MOD-002-REQ-001"],
      scenarios: ["MOD-002-REQ-001-SCN-001"],
    };
    expect(() => parseModuleInterface({ version: 1, module: "MOD-002", relations: [relation, relation] }))
      .toThrow(/duplicate relation ID/i);
    expect(() => parseModuleInterface({
      version: 1,
      module: "MOD-002",
      relations: [{ ...relation, unexpected: true }],
    })).toThrow(/unrecognized key/i);
  });

  it("rejects unsafe configuration paths and duplicate profile/service keys", () => {
    const service = {
      id: "user-service",
      hostAlias: "user-service-test",
      endpointFingerprint: "sha256:61d2bd9a5a6406a66ccde3f39720a75e58ed3dc339b9f3f81bca9f53bc9558ec",
      routeBindings: [{ module: "MOD-002", path: "/api/users" }],
      source: { kind: "repo-file" as const, file: ".env.test", format: "dotenv" as const, key: "USER_SERVICE_BASE_URL" },
    };
    expect(() => parseConfiguration({
      version: 1,
      profiles: [{ id: "test", services: [service, service] }],
    })).toThrow(/unique/i);
    expect(() => parseConfiguration({
      version: 1,
      profiles: [{ id: "test", services: [{ ...service, source: { ...service.source, file: "../.env" } }] }],
    })).toThrow(/repository-relative/i);
  });
});
