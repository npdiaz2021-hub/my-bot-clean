# TimmySudo Bot

Twitch bot and web admin UI with separate folders:

- `app/` - startup file that connects the bot, website, and shared storage.
- `bot/` - Twitch chat behavior.
- `data/` - `commands.json` and `roles.json`.
- `deploy/` - extra hosting/deploy config files.
- `scripts/` - helper and smoke-test scripts.
- `website/` - Express API, dashboard pages, and website error codes.
- `shared/` - command and role storage used by both sides.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set environment variables in `.env`.
3. Run the website:
   ```bash
   npm start
   ```

The dashboard runs on `PORT` / `WEB_PORT`. By default, `npm start` runs only the website/dashboard. The bot and website share `data/commands.json`, so edits from chat and edits from the dashboard stay together.

To run the Twitch bot without starting the website/dashboard:

```bash
npm run bot
```

You can also set `WEBSITE_ENABLED=false` before `npm start` for the same bot-only mode. If you ever want one process to run both the website and bot together, set `TWITCH_BOT_ENABLED=true` and provide the Twitch credentials.

## Cloudflare Tunnel Setup (for public access)

To expose your local app via Cloudflare:

1. **Install cloudflared**:
   - Download from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/tunnel-guide/

2. **Login**:
   ```bash
   cloudflared tunnel login
   ```

3. **Create tunnel**:
   ```bash
   cloudflared tunnel create my-bot-tunnel
   ```
   - Note the tunnel ID.

4. **Update `cloudflared.yaml`**:
   - Replace `<tunnel-id>` with your tunnel ID.

5. **Configure in Cloudflare dashboard**:
   - Zero Trust → Networks → Tunnels → Add public hostname
   - Subdomain: `my-bot-clean`, Domain: `npdiaz2021.workers.dev`
   - Service: `http://localhost:61234`

6. **Run tunnel** (keep running):
   ```powershell
   & 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel run my-bot-tunnel
   ```
   If `cloudflared` is not on PATH, run it using the full installed path.

7. **Start app**:
   ```bash
   npm start
   ```

Access at: https://my-bot-clean.npdiaz2021.workers.dev

## Notes

- Render uses the root `render.yaml`; keep that file at the repo root.
- The Render blueprint has two services: the website service runs `npm start`, and the always-on bot worker runs `npm run bot`.
- Add `TWITCH_USERNAME`, `TWITCH_OAUTH`, and `TWITCH_CHANNEL` as secret environment variables on the Render worker so it can stay in chat.
- The bot does not use website error codes. It logs plain status messages and stays quiet for normal chat misses like unknown commands or cooldowns.
- Website/API errors still return `{ error, code, contact }` for the dashboard.
- `npm start` is website-only unless `TWITCH_BOT_ENABLED=true`.
- Run `npm run bot` or set `WEBSITE_ENABLED=false` when you want the Twitch bot online without the website being live.
- Website and bot restarts use separate lock files, so restarting one does not kill the other.
- Website dashboard edits and the separate hosted bot worker need shared storage to sync live across services; until a database is added, commit command changes to `data/commands.json` and redeploy/reload the worker.
- Do not commit `.env` to GitHub.
- Use Cloudflare or another host to expose the web admin UI publicly.

## Twitch Bot Controls

Managers are the broadcaster, moderators, and trusted users. Manager chat commands:

- `#6help` - show bot controls.
- `#6ping` - confirm the bot is awake.
- `#6reload` - reload `data/commands.json` and `data/roles.json`.
- `#6add !command response` - add a command.
- `#6edit !command response` - edit a command response.
- `#6del !command` - delete a command.
- `#6enable !command` / `#6disable !command` - turn a command on or off.
- `#6cooldown !command seconds` - set command cooldown.
- `#6level !command everyone|subscriber|vip|moderator|trusted|broadcaster` - set who can use it.
- `#6alias !command !alias1 !alias2` - replace aliases.
- `#6info !command` - show command settings.
- `#6list` - show a short command list.

Command response variables:

- `$(user)` / `$(sender)` - person who used the command.
- `$(channel)` - channel name.
- `$(time)` - current Central time.
- `$(args)` - everything typed after the command.
- `$(1)`, `$(2)`, etc. - individual command arguments.
- `$(target)` / `$(touser)` - first argument, or the sender if none was provided.
- `$(count)` - command use counter.
- `$(random:one|two|three)` - random choice.
