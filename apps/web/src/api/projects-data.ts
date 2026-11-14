import {
  isDirectoriesResponse, isOpenedRoot, isProjectsResponse, isRemovedRoot,
  type DirectoriesResponse, type OpenedRoot, type ProjectsResponse, type RemovedRoot,
} from "@zero/contracts"

import { deleteJSON, failureReason, fetchJSON, postJSON } from "./http.ts"
import { within } from "../features/projects/project-picker.ts"
import { lastProject, type WorkspaceMemory } from "../workspace/workspace-memory.ts"

export function fetchProjects(signal?: AbortSignal): Promise<ProjectsResponse> {
  return fetchJSON("/api/projects", { signal }, isProjectsResponse, (failure) => `Couldn't list projects: ${failureReason(failure)}.`)
}

// Server reasons for folders are full sentences.
export function fetchDirectories(path: string, signal?: AbortSignal): Promise<DirectoriesResponse> {
  return fetchJSON(`/api/directories?${new URLSearchParams({ path }).toString()}`, { signal }, isDirectoriesResponse,
    (failure) => failure.kind === "rejected" ? failure.error : "Could not read that folder.")
}

// openRoot asks the server to serve a folder on its host (decision 0146);
// its refusals are full sentences.
export function openRoot(path: string, signal?: AbortSignal): Promise<OpenedRoot> {
  return postJSON("/api/roots", { path }, { signal }, isOpenedRoot,
    (failure) => failure.kind === "rejected" ? failure.error : `Couldn't open the folder: ${failureReason(failure)}.`)
}

// removeRoot asks the server to stop serving a root (decision 0146).
export function removeRoot(root: string, signal?: AbortSignal): Promise<RemovedRoot> {
  return deleteJSON(`/api/roots?${new URLSearchParams({ path: root }).toString()}`, { signal }, isRemovedRoot,
    (failure) => failure.kind === "rejected" ? failure.error : `Couldn't stop serving the folder: ${failureReason(failure)}.`)
}

export interface Landing {
  project: string
  // listed is false for a folder discovery does not vouch for; check it exists.
  listed: boolean
  // pick opens the picker: nothing is remembered, there is a choice, and
  // Welcome, which lists the projects, is off (decision 0052).
  pick: boolean
  // fallback is the first served root, opened when project is gone.
  fallback: string
}

// defaultProject is the first served root, always listed as a project.
export function defaultProject(projects: ProjectsResponse): string {
  return projects.roots[0]?.path ?? ""
}

// landingProject picks the project for a URL without one: the last project
// remembered for this session, or the first root.
export function landingProject(projects: ProjectsResponse, memory: WorkspaceMemory, welcome: boolean): Landing {
  const fallback = defaultProject(projects)
  const last = lastProject(memory, projects.sessionKey)
  if (!last) {
    const choices = projects.projects.filter((project) => project.available).length
    return { project: fallback, listed: true, pick: !welcome && choices > 1, fallback }
  }
  const listed = projects.projects.some((project) => project.available && project.id === last)
  // A folder no served root holds any more (its root stopped being served)
  // falls back at once.
  if (!listed && !projects.roots.some((root) => within(last, root.path))) return { project: fallback, listed: true, pick: false, fallback }
  return { project: last, listed, pick: false, fallback }
}

let landingPick = false

// requestLandingPick asks the next mounted picker to open once.
export function requestLandingPick() {
  landingPick = true
}

export function takeLandingPick(): boolean {
  const pick = landingPick
  landingPick = false
  return pick
}
