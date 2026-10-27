# Run Veilnivo locally

The application can run on this computer with its real Fastify/Socket.IO backend and a local PostgreSQL database. Both listeners bind to 127.0.0.1. This is a local deployment; it is not an internet-facing production service.

## On this computer

Open `http://127.0.0.1:3001` after starting the app. This is the app URL; a ZIP file contains source code and does not open a running website. Use **Create identity** to create your own account. There are no seeded production users and no shared default login.

Double-click `Start-Veilnivo.cmd`, or run `pnpm local` from the application directory. The launcher builds the same-origin frontend, starts the application's own database cluster, applies committed migrations, and starts the combined app/API. Keep its terminal open. Stop with `Stop-Veilnivo.cmd`, `pnpm local:stop`, or Ctrl+C in that terminal. Check it with `pnpm local:status`.

The local configuration in `.local/config.json` identifies the verified PostgreSQL binaries prepared on this computer. This ignored, machine-specific configuration is excluded from the source ZIP.

## On another computer

1. Extract `Veilnivo-source.zip` completely. Open a terminal in its `veilnivo` folder, which contains `package.json`. Do not run the launchers from inside the ZIP viewer.
2. Install Node.js 22+ and pnpm 11.25.0 (the version declared in `package.json`). With Node.js installed, `npm install --global pnpm@11.25.0` installs the required package manager. Reopen the terminal if Node.js or pnpm is not found.
3. Run `pnpm install --frozen-lockfile` in that folder. This installs the app's dependencies and generates the Prisma client. The ZIP deliberately excludes installed dependencies, so this step needs internet access.
4. Install PostgreSQL or obtain its official portable binaries. Set `PG_BIN` to the directory containing `initdb`, `pg_ctl`, and `postgres`, or put that directory on PATH. The source ZIP does not include PostgreSQL executables or another computer's database credentials.
5. Run `pnpm local`, or double-click `Start-Veilnivo.cmd` on Windows after setting up the above prerequisites. The first run builds the frontend and creates a separate application-owned PostgreSQL cluster. It does not register a Windows service or change an existing PostgreSQL installation. Wait for the printed URL before opening the browser.

Example in PowerShell, after installing PostgreSQL (replace the path with your installation):

```powershell
$env:PG_BIN = 'C:\Program Files\PostgreSQL\17\bin'
pnpm install --frozen-lockfile
pnpm local
```

The launcher checks prerequisites before building and reports a missing dependency or PostgreSQL binary with setup instructions. Keep the launcher terminal open while using the app.

Optional settings: `LOCAL_PORT` defaults to 3001 and `LOCAL_PG_PORT` to 54329. Both remain loopback-only. If a port is already occupied, stop the old app instance or select a different port deliberately.

## Download the source ZIP

When the prepared source ZIP is present, the local runner prints `http://127.0.0.1:3001/downloads/Veilnivo-source.zip`. Open that URL in a browser while the local app runs to download the file. A Windows filesystem link in a chat may open the file viewer instead of downloading it; the HTTP URL is a direct ZIP download.

On this computer, the archive is kept at the workspace root and copied to `outputs/`. On another computer, keep the ZIP beside the extracted `veilnivo` folder, or set `SOURCE_ARCHIVE_PATH` to the absolute path of the ZIP before starting. This optional download is enabled only by the loopback local launcher; it is separate from account data and never includes `.local/`, populated environment files, installed dependencies, or database binaries. If the archive is absent, the app still runs and the download route is unavailable.

## Data and secrets

Accounts, encrypted server history, local database credentials, and the stable JWT secret are retained under `.local/`. Local passwords and keys are not placed in public frontend settings. Never publish or commit this directory. Stopping the app preserves its data. Deleting `.local/postgres` destroys this local database; changing or losing `.local/credentials.json` can prevent reopening the existing database.

Browser-local encryption caches remain tied to the exact origin you use. Use 127.0.0.1 consistently rather than switching between localhost, another port, or a public address. Local preview/demo identities are not automatically migrated into server accounts.

## Before public hosting

Use the HTTPS Docker/Render path in [DEPLOYMENT.md](DEPLOYMENT.md). The loopback launcher uses local HTTP and development cookie settings deliberately; do not expose it using a tunnel or change its listener to a public interface. AI requires separate provider configuration; the local launcher keeps external AI disabled. See [VERIFICATION.md](VERIFICATION.md) for completed checks and [SECURITY.md](SECURITY.md) for protocol limits.
