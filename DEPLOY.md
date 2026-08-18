# Deploying the Vercel clone

This folder is the hosted clone. The original `sat-prep-app` folder remains the local application.

## 1. Import the cloned database into Turso

Install and sign in to the Turso CLI:

```sh
brew install tursodatabase/tap/turso
turso auth signup
```

From this folder, import the database snapshot:

```sh
turso db create sat-prep-vercel --from-file ./data/satprep.db
```

Get the two values Vercel needs:

```sh
turso db show --url sat-prep-vercel
turso db tokens create sat-prep-vercel
```

Keep the token private. Do not put it in GitHub or a frontend JavaScript file.

## 2. Push this clone to GitHub

Create a separate private repository for this folder. The `.gitignore` intentionally prevents local database files and credentials from being committed.

## 3. Configure Vercel

Create a Vercel project from the clone's repository and use these settings:

- Framework preset: `Other`
- Root directory: the folder containing this file and `package.json`
- Build command: leave empty
- Output directory: `public`

Add these environment variables for Production, Preview, and Development:

```text
TURSO_DATABASE_URL=<value from turso db show --url>
TURSO_AUTH_TOKEN=<value from turso db tokens create>
```

Redeploy after adding the variables.

## 4. Verify the migration

Open the deployed app and confirm that the dashboard loads. The imported snapshot should initially report:

- 1,753 Math questions in the main pool
- 1,688 English questions in the main pool
- 97 saved modules

Create one short module, answer a question, refresh the page, and verify that the answer remains. This confirms Vercel is writing to Turso rather than temporary function storage.

## Notes

- Questions cache automatically when opened.
- The local bulk-cache background job is disabled on Vercel because serverless functions do not continue running reliably after sending a response.
- Keep the original local database and an occasional Turso export as independent backups.
