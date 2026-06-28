#!/bin/bash
echo "=== Docker Compose Status ==="
docker compose ps

echo -e "\n=== Checking Play Service ==="
docker compose exec -T play curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:3000 || echo "Play service not responding"

echo -e "\n=== Checking Traefik ==="
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost/ || echo "Traefik not responding"

echo -e "\n=== Recent Traefik Logs ==="
docker compose logs --tail=20 reverse-proxy

echo -e "\n=== Recent Play Logs ==="
docker compose logs --tail=20 play

echo -e "\n=== Port Bindings ==="
docker compose ps --format "table {{.Name}}\t{{.Ports}}"
