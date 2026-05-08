# My Bot Clean

Simple Twitch bot with a web admin UI.

## Getting started

1. Install dependencies
   ```bash
   npm install
   ```
2. Set environment variables in `.env`
3. Run the app
   ```bash
   npm start
   ```

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

Access at: https://my-bot-clean.npdiaz2021.workers.dev

## Notes

- The admin UI runs on `PORT` / `WEB_PORT`.
- Do not commit `.env` to GitHub.
- Use Cloudflare or another host to expose the web admin UI publicly.
