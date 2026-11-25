# Deploying

Merging to `main` runs the tests, then `.github/workflows/deploy.yml`:

1. **build:** builds the image on GitHub's runners and pushes it to
   `ghcr.io/chorsnell/moonreader-dashboard`, tagged `:latest` and `:<commit sha>`.
2. **deploy:** joins Tailscale and connects over SSH with this app's own key. The key can only run
   `scripts/deploy/host-deploy.sh`, which pulls that exact build, checks that the image comes from
   this repository, and runs `docker compose up -d` in the app's folder.

Nothing is shared with other projects: no shared workflows, and no deploy key used by anything
else. Until the key below is set up, the image is still built and the rollout is skipped with a
notice on the run.

## One-time host setup

On the host (`docker-host`), as an admin:

```sh
# a user that can run docker and owns nothing else
sudo useradd --create-home --shell /bin/bash reading-dashboard
sudo usermod -aG docker reading-dashboard

# the deploy script, next to the app's docker-compose.yml and .env
sudo cp scripts/deploy/host-deploy.sh /path/to/reading-dashboard/host-deploy.sh
sudo chmod 755 /path/to/reading-dashboard/host-deploy.sh
```

The app folder's `.env` needs `IMAGE=ghcr.io/chorsnell/moonreader-dashboard:latest`, so a plain
`docker compose up -d` there runs the published image. The deploy user must be able to read the
folder and run `docker compose` in it.

Make a key pair used only for this, anywhere:

```sh
ssh-keygen -t ed25519 -N '' -C reading-dashboard-deploy -f reading-dashboard-deploy
```

Add the public half to `~reading-dashboard/.ssh/authorized_keys` on the host, locked to the script.
If the script isn't in the app folder, prefix the command with `APP_DIR=/path/to/reading-dashboard`:

```
command="/path/to/reading-dashboard/host-deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA… reading-dashboard-deploy
```

Give the private half to GitHub, then delete both local copies:

```sh
gh secret set READING_DASHBOARD_DEPLOY_KEY < reading-dashboard-deploy
rm reading-dashboard-deploy reading-dashboard-deploy.pub
```

If the host or user isn't `reading-dashboard@docker-host`, set it:
`gh variable set DEPLOY_TARGET --body user@host`.

## Deploying by hand

- **From the Actions tab:** run **deploy**, which builds and rolls out the current `main`.
- **On the host:** in the app folder, run `docker compose pull && docker compose up -d`.
- **Rolling back:** on the host, `SSH_ORIGINAL_COMMAND="deploy <older sha>" ./host-deploy.sh`.
