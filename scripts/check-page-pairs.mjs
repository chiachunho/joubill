// Warns when a change edits one copy of a Mini App / Web App page pair and not the other
// (issue #57). Advisory only: it exits 0 whatever it finds, because some one-sided edits
// are intentional. It fails only when git itself fails.
//
// Usage: node scripts/check-page-pairs.mjs [base-ref]   (default: origin/dev)
// The changes are diffed from the merge-base of base-ref and HEAD to the working tree,
// so uncommitted edits and new untracked pages count as well.
//
// Inputs (environment): PR_NUMBER, GITHUB_TOKEN, GITHUB_REPOSITORY. When PR_NUMBER is set,
// one comment is posted or updated in place on that pull request, and an all-clear
// replaces an earlier warning. Set DRY_RUN=1 to print the comment instead.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  COMMENT_MARKER,
  describeProblem,
  findUnpairedChanges,
  renderComment,
} from "./page-pairs.mjs";

const API = "https://api.github.com";
const BOT_LOGIN = "github-actions[bot]";

const env = process.env;

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
}

function changedFiles(base) {
  const mergeBase = git("merge-base", base, "HEAD")[0];
  // git diff never lists untracked files, so a new page that was not staged needs its own query.
  const tracked = git("diff", "--name-status", "--no-renames", mergeBase).map((line) => {
    const [status, path] = line.split("\t");
    return { status, path };
  });
  const untracked = git("ls-files", "--others", "--exclude-standard").map((path) => ({
    status: "A",
    path,
  }));
  return [...tracked, ...untracked];
}

async function gh(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// Writes the comment only when there is something to say, or when an earlier warning
// comment exists and needs replacing with the all-clear.
async function postOrUpdate(token, repo, number, body, hasProblems) {
  // Page through every comment: the marker comment can sit past the first 100.
  let existing;
  for (let page = 1; !existing; page += 1) {
    const comments = await gh(
      token,
      "GET",
      `/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`,
    );
    existing = comments.find(
      (c) => c.user?.login === BOT_LOGIN && c.body?.includes(COMMENT_MARKER),
    );
    if (comments.length < 100) break;
  }
  if (existing) {
    await gh(token, "PATCH", `/repos/${repo}/issues/comments/${existing.id}`, { body });
    console.log(`Updated the page-pair comment on #${number}.`);
  } else if (hasProblems) {
    await gh(token, "POST", `/repos/${repo}/issues/${number}/comments`, { body });
    console.log(`Posted the page-pair comment on #${number}.`);
  }
}

async function main() {
  const base = process.argv[2] ?? "origin/dev";
  const problems = findUnpairedChanges(changedFiles(base), existsSync);

  // Annotations attach to the file in the PR's Files view; plain lines are for local runs.
  const inActions = env.GITHUB_ACTIONS === "true";
  for (const problem of problems) {
    const text = describeProblem(problem);
    console.log(inActions ? `::warning file=${problem.path}::${text}` : `warning: ${text}`);
  }
  if (problems.length === 0) console.log("No page changed on one side only.");

  const body = renderComment(problems);
  if (env.DRY_RUN === "1") {
    console.log(body);
    return;
  }
  if (!env.PR_NUMBER) return;

  try {
    await postOrUpdate(
      env.GITHUB_TOKEN,
      env.GITHUB_REPOSITORY,
      Number(env.PR_NUMBER),
      body,
      problems.length > 0,
    );
  } catch (err) {
    // A fork pull request gets a read-only token, and a failed comment must not fail the check.
    console.log(`::warning::Could not update the page-pair comment: ${err.message}`);
  }
}

await main();
