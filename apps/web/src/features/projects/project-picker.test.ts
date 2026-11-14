import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  browseOffered,
  browseRows,
  browseStart,
  browseTarget,
  canDrill,
  currentGroup,
  hostParentInput,
  matchScore,
  offersOpenFolder,
  parentInput,
  projectSections,
  selectableRows,
  splitBrowseInput,
  splitHostInput,
  visibleWarnings,
  type PickerSection,
} from "./project-picker.ts"
import { isProjectsResponse, type ProjectsResponse } from "@zero/contracts"

async function projects(): Promise<ProjectsResponse> {
  const value: unknown = JSON.parse(await readFile(new URL("../../../../../testdata/api/default/projects.json", import.meta.url), "utf8"))
  assert.ok(isProjectsResponse(value))
  return value
}

const workspace = "/home/user/markdown"
const zero = `${workspace}/zero/main`

function summary(sections: readonly PickerSection[]) {
  return sections.map((section) => [section.title, section.rows.map((row) => {
    if (row.kind !== "project") return row.kind
    const extras = [
      row.repository && `in ${row.repository}`,
      row.branch && `@${row.branch}`,
      row.worktrees > 1 && `${row.worktrees} worktrees`,
      row.current && "*",
      row.disabled && `(${row.note})`,
    ].filter(Boolean)
    return [row.name, ...extras].join(" ")
  })])
}

test("projects list each root's folder and repositories, a repository with worktrees as one row", async () => {
  assert.deepEqual(summary(projectSections(await projects(), [], `${workspace}/zero/wt-feat-project-picker`, "")), [
    ["markdown", ["markdown", "notes @main", "zero @main 3 worktrees *"]],
    ["personal", ["personal", "blog @draft"]],
    ["", ["browse"]],
  ])
})

test("a repository row opens its last-used worktree", async () => {
  const response = await projects()
  const remembered = [`${workspace}/notes`, "/tmp/zero-hotfix", zero]
  const row = projectSections(response, remembered, "", "")[0]?.rows[2]
  assert.ok(row?.kind === "project")
  assert.equal(row.id, "/tmp/zero-hotfix")
  assert.equal(row.branch, "hotfix")
  assert.ok(canDrill(row))
  const fresh = projectSections(response, [], "", "")[0]?.rows[2]
  assert.equal(fresh?.kind === "project" && fresh.id, zero)
})

test("a repository's worktree list shows branches, main first", async () => {
  const response = await projects()
  assert.deepEqual(summary(projectSections(response, [], zero, "", zero)), [
    ["zero worktrees", ["main @main *", "feat-project-picker @feat-project-picker", "hotfix @hotfix"]],
  ])
  assert.deepEqual(summary(projectSections(response, [], zero, "hot", zero)), [["zero worktrees", ["hotfix @hotfix"]]])
  assert.deepEqual(projectSections(response, [], zero, "zzz", zero), [])
  assert.equal(currentGroup(response, "/tmp/zero-hotfix"), zero)
  assert.equal(currentGroup(response, `${workspace}/notes`), "")
})

test("unavailable worktrees are listed but not selectable", async () => {
  const response = await projects()
  const hotfix = response.projects.find((project) => project.path === "/tmp/zero-hotfix")
  assert.ok(hotfix)
  const unavailable: ProjectsResponse = {
    ...response,
    projects: response.projects.map((project) => project === hotfix ? { ...project, id: "", root: "", available: false } : project),
  }
  const sections = projectSections(unavailable, [], "", "", zero)
  assert.deepEqual(summary(sections)[0]?.[1], ["main @main", "feat-project-picker @feat-project-picker", "hotfix @hotfix (Outside served folders)"])
  assert.equal(selectableRows(sections).length, 2)
})

test("opened folders list remembered folders in the roots that discovery does not", async () => {
  const opened = `${workspace}/docs/2026`
  const sections = projectSections(await projects(), [`${workspace}/notes`, opened, "/elsewhere/old", workspace], opened, "")
  assert.deepEqual(summary(sections)[2], ["Opened folders", ["2026 *"]])
})

test("a query ranks matches flat, including each worktree by branch", async () => {
  assert.deepEqual(summary(projectSections(await projects(), [`${workspace}/notes/wt`], "", "feat")), [
    ["Projects", ["feat-project-picker in zero @feat-project-picker"]],
    ["", ["browse"]],
  ])
  assert.deepEqual(summary(projectSections(await projects(), [`${workspace}/notes/wt`], "", "wt")), [
    ["Projects", ["feat-project-picker in zero @feat-project-picker"]],
    ["Opened folders", ["wt"]],
    ["", ["browse"]],
  ])
  assert.deepEqual(summary(projectSections(await projects(), [], "", "zzz")), [["", ["browse"]]])
})

test("matchScore prefers names over paths and requires characters in order", () => {
  assert.equal(matchScore("zer", "zero", "work/zero"), 0)
  assert.equal(matchScore("ero", "zero", "work/zero"), 1)
  assert.equal(matchScore("work", "zero", "work/zero"), 2)
  assert.equal(matchScore("wkz", "zero", "work/zero"), 3)
  assert.equal(matchScore("zkw", "zero", "work/zero"), null)
  assert.equal(matchScore("  ", "a", "a"), 0)
})

test("browse input splits into a folder within the roots and a partial name", () => {
  const roots = ["/w", "/home/p"]
  assert.deepEqual(splitBrowseInput("", roots), { folder: "", partial: "" })
  assert.deepEqual(splitBrowseInput("wo", roots), { folder: "", partial: "wo" })
  assert.deepEqual(splitBrowseInput("/home/", roots), { folder: "", partial: "/home/" })
  assert.deepEqual(splitBrowseInput("/w/", roots), { folder: "/w", partial: "" })
  assert.deepEqual(splitBrowseInput("/w/work/ap", roots), { folder: "/w/work", partial: "ap" })
  assert.deepEqual(splitBrowseInput("/wx/a", roots), { folder: "", partial: "/wx/a" })
  assert.equal(parentInput("/w/work/api/", roots), "/w/work/")
  assert.equal(parentInput("/w/work/", roots), "/w/")
  assert.equal(parentInput("/w/", roots), "")
  assert.equal(parentInput("", roots), "")
  assert.equal(browseStart(["/w"]), "/w/")
  assert.equal(browseStart(roots), "")
})

test("browse rows open the folder first, then matching children; repositories open whole", () => {
  const directories = [
    { name: ".github", path: "/w/work/.github", isProject: false },
    { name: "api", path: "/w/work/api", isProject: true },
    { name: "apps", path: "/w/work/apps", isProject: false },
    { name: "web", path: "/w/work/web", isProject: true },
  ]
  const sections = browseRows("/w/work", "ap", directories)
  assert.deepEqual(sections.map((section) => section.rows.map((row) => row.kind === "directory" ? row.path : row.kind)), [
    ["open"],
    ["/w/work/api", "/w/work/apps"],
  ])
  assert.equal(browseRows("/w/work", "zz", directories).length, 1)
  const rows = selectableRows(sections)
  assert.equal(browseTarget(rows, rows[1])?.path, "/w/work/apps")
  assert.equal(browseTarget(rows, rows[2])?.path, "/w/work/apps")
})

test("the root list offers no folder to open", () => {
  const sections = browseRows("", "", [{ name: "w", path: "/w", isProject: false }, { name: "repo", path: "/repo", isProject: true }])
  assert.deepEqual(sections.map((section) => [section.title, section.rows.map((row) => row.kind)]), [["Served folders", ["directory", "directory"]]])
})

test("with no served folder, a server that manages roots offers Open folder…", async () => {
  const response = await projects()
  const empty: ProjectsResponse = { ...response, roots: [], projects: [], warnings: [] }
  assert.equal(offersOpenFolder({ ...response, manageRoots: true }), false)
  assert.equal(offersOpenFolder({ ...empty, manageRoots: true }), true)
  assert.equal(offersOpenFolder(empty), false)
})

test("Open folder… is offered only where it can go", async () => {
  const response = await projects()
  const repo = { path: "/w/repo", name: "repo", isRepo: true }
  const onlyRepos: ProjectsResponse = { ...response, roots: [repo], projects: [] }
  assert.equal(browseOffered(response), true)
  assert.equal(browseOffered(onlyRepos), false)
  assert.equal(browseOffered({ ...onlyRepos, manageRoots: true }), true)
  const kinds = (value: ProjectsResponse) => projectSections(value, [], "", "").flatMap((section) => section.rows.map((row) => row.kind))
  assert.equal(kinds(onlyRepos).includes("browse"), false)
  assert.equal(kinds({ ...onlyRepos, manageRoots: true }).includes("browse"), true)
})

test("an unreadable root is listed, explained, and stoppable", async () => {
  const response = await projects()
  const blocked = { path: "/Users/dee/Downloads/archive", name: "archive", isRepo: false, problem: "macOS blocked zero from reading /Users/dee/Downloads/archive.", problemCode: "privacyBlocked" }
  const value: ProjectsResponse = {
    ...response,
    manageRoots: true,
    roots: [...response.roots, blocked],
    warnings: ["/Users/dee/Downloads/archive: open /Users/dee/Downloads/archive: operation not permitted", "/elsewhere: denied"],
  }
  const sections = projectSections(value, [], "", "")
  const archive = sections.find((section) => section.title === "archive")?.rows[0]
  assert.ok(archive?.kind === "project")
  assert.deepEqual([archive.disabled, archive.note, archive.problem, archive.servedRoot], [true, "Blocked by macOS", blocked.problem, blocked.path])
  assert.equal(selectableRows(sections).includes(archive), false)
  assert.deepEqual(visibleWarnings(value), ["/elsewhere: denied"])
  const markdown = sections.find((section) => section.title === "markdown")?.rows[0]
  assert.ok(markdown?.kind === "project")
  assert.equal(markdown.servedRoot, workspace)
  const notes = sections.find((section) => section.title === "markdown")?.rows[1]
  assert.ok(notes?.kind === "project")
  assert.equal(notes.servedRoot, "")
})

test("host browsing reads any absolute path and hides dot folders until typed", () => {
  assert.deepEqual(splitHostInput("/home/dee/wor"), { folder: "/home/dee", partial: "wor" })
  assert.deepEqual(splitHostInput("/"), { folder: "/", partial: "" })
  assert.deepEqual(splitHostInput("home"), { folder: "", partial: "home" })
  assert.equal(hostParentInput("/home/dee/"), "/home/")
  assert.equal(hostParentInput("/home/"), "/")
  assert.equal(hostParentInput("/"), "/")
  const directories = [
    { name: ".config", path: "/home/dee/.config", isProject: false },
    { name: "Downloads", path: "/home/dee/Downloads", isProject: false, problem: "macOS blocked zero.", problemCode: "privacyBlocked" },
    { name: "code", path: "/home/dee/code", isProject: false },
  ]
  const names = (partial: string) => browseRows("/home/dee", partial, directories, true)
    .flatMap((section) => section.rows.flatMap((row) => row.kind === "directory" ? [row.name] : []))
  assert.deepEqual(names(""), ["Downloads", "code"])
  assert.deepEqual(names("."), [".config"])
  const downloads = browseRows("/home/dee", "down", directories, true).flatMap((section) => section.rows).find((row) => row.kind === "directory")
  assert.ok(downloads?.kind === "directory")
  assert.deepEqual([downloads.note, downloads.problem], ["Blocked by macOS", "macOS blocked zero."])
  // Under the served roots, dot folders stay listed.
  assert.equal(browseRows("/home/dee", "", directories).flatMap((section) => section.rows).length, 4)
})
