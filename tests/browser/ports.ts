import { requestedPort } from "../../scripts/browser-process.ts"

// The runner passes the ports of already-bound listeners to every worker.
// Zero lets `playwright test --list` collect tests without starting servers.
const apiPort = requestedPort(process.env.ZERO_BROWSER_API_PORT, "ZERO_BROWSER_API_PORT")
const gitPort = requestedPort(process.env.ZERO_BROWSER_GIT_PORT, "ZERO_BROWSER_GIT_PORT")
export const webPort = requestedPort(process.env.ZERO_BROWSER_WEB_PORT, "ZERO_BROWSER_WEB_PORT")

export const apiOrigin = `http://127.0.0.1:${apiPort}`
export const gitApiOrigin = `http://127.0.0.1:${gitPort}`
