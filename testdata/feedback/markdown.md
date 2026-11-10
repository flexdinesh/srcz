# Feedback fb-3k2q8m
Branch feature/greeting · /home/user/markdown · 2 threads awaiting you

Reply: zero feedback reply fb-3k2q8m <thread> -m "<what you did>" [--resolve | --wontfix]

## Thread 1 · open · code/main.go:7
```go
	fmt.Println("hello from zero") // go-search-token
```
**user** · 2026-11-10 09:12 UTC
Keep the greeting in a constant so the CLI and tests share it.

## Thread 2 · resolved · code/app.js:4-5 (moved from 2-3)
```js
const root = document.querySelector("#app")
root.textContent = "hello"
```
**user** · 2026-11-10 09:14 UTC
Guard against a missing `#app` element.

**agent (claude)** · 2026-11-10 09:30 UTC · resolved
Added an early return when the element is missing.

## Thread 3 · open · config/zero.toml:4 (old side) · outdated, code no longer present
```toml
depth = 3
```
**user** · 2026-11-10 09:16 UTC
Why did the default depth change?

## Thread 4 · won't fix · guides/getting-started.md (file)
**user** · 2026-11-10 09:18 UTC
Split this guide into install and first run.

**agent** · 2026-11-10 09:31 UTC · won't fix
Out of scope for this branch; the guide is rewritten in the docs redesign.
