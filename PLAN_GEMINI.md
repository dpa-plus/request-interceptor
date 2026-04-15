# Request Interceptor UX + Workflow Plan

## Summary
- First product focus is navigation reliability: real links, browser-native new-tab behavior, and list state that survives back/refresh.
- Second product focus is “related requests” grouping, using a conservative smart heuristic (header/time/target matching) with no Prisma schema change yet.
- Third focus is cleanup work: server-side search/filtering, live-update behavior, and backend AI filter bugs.

## Implementation Changes
- Establish workflow: feature branches, regular commits.
- Navigation: Replace clickable table rows with real `<a>` links.
- State: Persist list state in the URL (search text, type filter, method filter, view mode). 
- Live Updates: Change refresh behavior so new results merge smoothly rather than replacing the page.
- Grouping: Implement fallback heuristic (same method + same target host + same path + close timestamp window). Surface via toggles and related request panels.
- Backend: Move filtering logic to `/api/logs` so pagination and search work across the entire database, not just loaded rows.

## Testing & Review
- Verify native new tab capabilities.
- Live behaviors do not reset filters.
- Grouping behaves according to the heuristic. 
