/**
 * PROD-3 / B13 — guards on the PBAC persistence layer.
 *
 * The behavioural claim (a role changed on one instance reaches the others) is
 * verified against two running servers and one database; no single-process
 * test can make it, so it is not attempted here. See the PROD-3 section of
 * PRODUCTION-READINESS.md for that evidence.
 *
 * What is testable here is the shape of the code, which is what the original
 * defect was: a JSON file on one instance's disk holding the authorization
 * model reads perfectly well and is wrong only in the presence of a second
 * instance.
 */

import { readFileSync } from "fs";
import { join } from "path";

const src = (p: string) => readFileSync(join(__dirname, p), "utf8");

/** Strip comments, so prose about what was removed does not trip the guards. */
const code = (p: string) =>
  src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the PBAC model is not stored on local disk", () => {
  it("the engine neither reads nor writes pbac-store.json", () => {
    const engine = code("../pbac-engine.ts");
    expect(engine).not.toMatch(/pbac-store\.json/);
    expect(engine).not.toMatch(/storeFilePath/);
    expect(engine).not.toMatch(/saveToDisk|loadFromDisk/);
  });

  it("the engine does not import the filesystem at all", () => {
    // `fs` and `path` were imported solely to persist the authorization model.
    // Their absence is the simplest check that it is no longer file-backed.
    const engine = code("../pbac-engine.ts");
    expect(engine).not.toMatch(/from ['"]fs['"]/);
    expect(engine).not.toMatch(/from ['"]path['"]/);
  });

  it("persistence goes through the shared store", () => {
    const engine = code("../pbac-engine.ts");
    expect(engine).toMatch(/from ['"]\.\/pbac-store['"]/);
    // Every mutation path has to persist and then re-stamp the version, or the
    // writing instance would keep serving the model it just superseded.
    expect(engine).toMatch(/afterMutation/);
  });
});

describe("cross-instance consistency mechanism", () => {
  it("writes are per entity, not whole-model", () => {
    // A whole-model write from one instance would undo a role another instance
    // had just created — the same class of bug in a new location.
    const store = code("../pbac-store.ts");
    expect(store).toMatch(/upsertRole\(/);
    expect(store).toMatch(/deleteRole\(/);
    expect(store).toMatch(/addAssignments\(/);
    expect(store).toMatch(/removeAssignments\(/);
  });

  it("every mutation bumps the shared version", () => {
    const store = code("../pbac-store.ts");
    // The version is what tells other instances to reload. A mutation that
    // skipped it would propagate to the database and to nobody's memory.
    const mutators = store.match(/async (upsertRole|upsertRoles|deleteRole|addAssignments|removeAssignments|replaceUserAssignments)\b/g) || [];
    expect(mutators.length).toBe(6);
    const bumps = store.match(/bumpVersion\(/g) || [];
    // One definition, one call per mutator.
    expect(bumps.length).toBeGreaterThanOrEqual(mutators.length);
  });

  it("the version is incremented by the database, not read-modify-written", () => {
    // `increment` is applied server-side, so two instances bumping at once
    // cannot lose one another's bump.
    expect(code("../pbac-store.ts")).toMatch(/version:\s*\{\s*increment:\s*1\s*\}/);
  });

  it("capability cache keys carry the model version", () => {
    // This is what makes a permission change evict derived answers without an
    // explicit sweep: old keys simply become unreachable.
    expect(code("../pbac-engine.ts")).toMatch(/cacheKey = `\$\{orgId\}:v\$\{modelVersion\}/);
  });

  it("the derived cache is consulted only after the version check", () => {
    // Order matters. Checking the cache first would return a stale answer
    // without the version ever being consulted, so a revoked permission would
    // survive for the full TTL on every repeat call.
    const engine = code("../pbac-engine.ts");
    const loadAt = engine.indexOf("await this.ensureOrgLoaded(orgId);\n    const modelVersion");
    const cacheAt = engine.indexOf("this.capabilityCache.get(cacheKey)");
    expect(loadAt).toBeGreaterThan(-1);
    expect(cacheAt).toBeGreaterThan(loadAt);
  });
});

describe("admin cache refresh reaches other instances", () => {
  it("invalidation bumps the shared version rather than only clearing locally", () => {
    // `invalidateUserCache` clears one process. The admin panel's refresh used
    // to call only that, so it purged whichever instance served the click and
    // reported a full system purge.
    expect(code("../pbac-engine.ts")).toMatch(/invalidateOrgAcrossInstances/);
    expect(code("../cache-manager.ts")).toMatch(/invalidateOrgAcrossInstances/);
  });
});
