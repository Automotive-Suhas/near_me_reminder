# NearMe Reminder — Phase 1 Changes

Implemented in this export:

1. **Alert active hours**
   - Every reminder has an active `FROM` and `TO` time in 24-hour format.
   - Supports overnight windows such as `22:00–06:00`.
   - A geofence entry outside the configured window does not consume the one-time reminder.
   - Existing reminders without these fields migrate to `00:00–23:59` automatically.

2. **Edit existing reminders**
   - Added an edit action to every reminder card.
   - Editing updates title, place, coordinates, radius, and active hours.
   - Saving an edited reminder reactivates it so it can trigger again.

3. **Place search**
   - Added a Search place action below the place name field.
   - Uses Expo Location geocoding and shows up to three address results.
   - Selecting a result fills the place name and coordinates automatically.

## Validation

The source files were checked for balanced syntax. A full TypeScript dependency/typecheck could not be run in this environment because the uploaded project does not include `node_modules` and package installation requires network access.

Recommended local validation after extracting the project:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
```
