import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RETRY_SH = fileURLToPath(new URL("../retry.sh", import.meta.url));

/** Runs `retry <attempts> <command that fails the first <failures> times>` and reports how it went. */
function run(attempts, failures) {
  const dir = mkdtempSync(join(tmpdir(), "retry-"));
  const counter = join(dir, "count");
  writeFileSync(counter, "0");
  // The command counts its own calls and fails until it has been called more than `failures` times.
  const flaky = `n=$(( $(cat ${counter}) + 1 )); echo $n > ${counter}; [ $n -gt ${failures} ]`;
  const result = spawnSync("sh", ["-c", `. ${RETRY_SH}; retry ${attempts} sh -c '${flaky}'`], {
    env: { ...process.env, RETRY_DELAY_UNIT: "0" },
    encoding: "utf8",
  });
  return {
    status: result.status,
    calls: Number(readFileSync(counter, "utf8")),
    stderr: result.stderr,
  };
}

describe("retry", () => {
  it("returns at once when the command succeeds", () => {
    const r = run(3, 0);
    expect(r.status).toBe(0);
    expect(r.calls).toBe(1);
  });

  it("tries again after a failure and succeeds", () => {
    const r = run(3, 2);
    expect(r.status).toBe(0);
    expect(r.calls).toBe(3);
    expect(r.stderr).toContain("attempt 1 of 3");
    expect(r.stderr).toContain("attempt 2 of 3");
  });

  it("gives up after the last attempt and reports the failure", () => {
    const r = run(3, 99);
    expect(r.status).toBe(1);
    expect(r.calls).toBe(3);
  });
});
