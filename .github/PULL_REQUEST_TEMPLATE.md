## What and why

<!-- One or two sentences. Link the issue or the phase in the plan. -->

## How it was verified

<!-- Commands run, OS tested on, screenshots for UI changes. -->

## Checklist

- [ ] `npm run check` passes locally
- [ ] Title and commits follow Conventional Commits
- [ ] No new dependency, or the reason for one is in the description
- [ ] No credential, cookie, token, or full URL can reach a log line
- [ ] Any new network endpoint is listed in `SECURITY.md`
- [ ] Any new IPC channel is in `src/shared/ipc-channels.ts` and validates its payload
- [ ] Docs (`README.md`, `context.md`, ADRs) updated if behaviour changed
