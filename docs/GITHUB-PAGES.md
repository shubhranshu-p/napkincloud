# Publish the demo with GitHub Pages

The public website can live at `https://YOUR-USERNAME.github.io/napkincloud/`. This is the expected URL format, not an already-published link. GitHub provides the actual URL after deployment. No custom domain is needed.

## Upload the prepared project

1. Create a **public** GitHub repository named `napkincloud` with default branch `main`.
2. Add the **contents** of the final project folder to the repository root, including `.github/workflows/`. Do not upload the outer ZIP as the only repository file. A Git client preserves hidden folders more reliably than a browser upload.
3. In the repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**.
4. Open **Actions → Deploy GitHub Pages → Run workflow**. Later pushes to `main` deploy automatically.
5. When both jobs finish, open the URL in the `github-pages` environment. Put that URL in your repository's **About → Website** and your hackathon submission. Test it in an incognito window.

The workflow checks the code, runs the tests, builds `pages/`, and publishes only that static output. The browser uses relative asset/module paths, so project URLs and custom domains both work.

## Required Meta backend

The Pages frontend uses the full backend for every API request. There is no automatic local comparison or manual-extraction fallback. Selecting a scenario does not run tests or generation; both require explicit actions.

GitHub Pages is static hosting: it cannot keep a server-side Meta key or execute the secret-backed API. Putting an API key in a GitHub Actions secret does not turn Pages into a backend. Never embed it in a static build.

The included Worker backend can be hosted separately, while the judges' website stays at the GitHub Pages link:

1. Deploy the backend as described in [DEPLOYMENT.md](DEPLOYMENT.md). Keep `MODEL_API_KEY` only in that host's runtime secret manager.
2. Set backend environment variable `PUBLIC_APP_ORIGIN` to your exact Pages **origin**, such as `https://YOUR-USERNAME.github.io` (no repository path or trailing slash).
3. In the GitHub repository, open **Settings → Secrets and variables → Actions → Variables**. Add a repository **variable**, `META_BACKEND_URL`, containing only the backend's HTTPS origin, without a trailing slash. This URL is public configuration, never a key.
4. Run the Pages workflow again. The frontend uses the backend for connection status, image interpretation, Meta repair, and illustration. Simulation and evidence export also use the backend.
5. Verify an explicit upload and Generate action against the live backend. If it is disconnected, show the connection error and fix the backend; no substitute local result is generated. A backend URL alone does not prove model access.

No hosted backend, public repository, or Pages publication has been created by this prepared release. Keep the backend online and funded throughout judging if the AI features are part of the submission.

Sources: [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [creating a Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).
