# Caddy Deployment

This setup assumes Shlyapcord runs on the server through Docker Compose and exposes the app only on localhost port `3000`.

Public traffic:

```text
Internet -> Caddy :443 -> 127.0.0.1:3000 -> Docker proxy -> web/server
```

## 1. DNS

Point your domain to the server:

```text
A     your-domain.example     <server-ip>
AAAA  your-domain.example     <server-ipv6> optional
```

## 2. Docker Compose Binding

For production, bind the app proxy to localhost only:

```yaml
ports:
  - "127.0.0.1:3000:80"
```

This keeps Shlyapcord unreachable directly from the internet and exposes it only through Caddy.

## 3. Caddyfile

Copy `deploy/caddy/Caddyfile` to the server and replace:

```text
your-domain.example
```

with your real domain.

Minimal config:

```caddyfile
your-domain.example {
	reverse_proxy 127.0.0.1:3000
}
```

Caddy handles HTTPS certificates automatically and supports WebSocket proxying through `reverse_proxy`, so `/ws` works through the same domain.

## 4. Run

Start Shlyapcord:

```bash
docker compose up -d --build
```

Reload Caddy:

```bash
sudo caddy reload --config /etc/caddy/Caddyfile
```

Open:

```text
https://your-domain.example/invite/local-dev
```

## 5. Firewall

Open only:

- `80/tcp`
- `443/tcp`

Keep app ports like `3000` and `8080` closed externally.
