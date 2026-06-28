#!/usr/bin/env bash
set -euo pipefail

MODE=""
ROOM_ID=""
USER_UUID=""
MESSAGE="Disconnected by administrator"
CONTAINER="workadventure-play-1"
WAIT_MS="1500"

usage() {
  cat <<'USAGE'
Emergency WA admin helper using existing production image internals.

Usage:
  contrib/tools/wa-emergency-admin.sh list --room-id <room-url> [--container <container>] [--wait-ms <ms>]
  contrib/tools/wa-emergency-admin.sh kick --room-id <room-url> --user-uuid <uuid> [--message <text>] [--container <container>]

Examples:
  contrib/tools/wa-emergency-admin.sh list --room-id 'https://workadventure.ach.org/_/global/achorg.github.io/ach2026-map/ach2026-map.json'
  contrib/tools/wa-emergency-admin.sh kick --room-id 'https://workadventure.ach.org/_/global/achorg.github.io/ach2026-map/ach2026-map.json' --user-uuid 'd78fa108-ae4e-4fc3-a190-adc4195f8246'
USAGE
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

MODE="$1"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --room-id)
      ROOM_ID="$2"
      shift 2
      ;;
    --user-uuid)
      USER_UUID="$2"
      shift 2
      ;;
    --message)
      MESSAGE="$2"
      shift 2
      ;;
    --container)
      CONTAINER="$2"
      shift 2
      ;;
    --wait-ms)
      WAIT_MS="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$MODE" != "list" && "$MODE" != "kick" ]]; then
  echo "Mode must be 'list' or 'kick'" >&2
  usage
  exit 1
fi

if [[ -z "$ROOM_ID" ]]; then
  echo "--room-id is required" >&2
  exit 1
fi

if [[ "$MODE" == "kick" && -z "$USER_UUID" ]]; then
  echo "--user-uuid is required in kick mode" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Container '$CONTAINER' is not running" >&2
  exit 1
fi

if [[ "$MODE" == "list" ]]; then
  docker exec -e ROOM_ID="$ROOM_ID" -e WAIT_MS="$WAIT_MS" "$CONTAINER" sh -lc 'cat > /tmp/wa-emergency-admin.ts <<"TS"
import { apiClientRepository } from "/usr/src/play/src/pusher/services/ApiClientRepository.ts";
import { GRPC_MAX_MESSAGE_SIZE } from "/usr/src/play/src/pusher/enums/EnvironmentVariable.ts";

async function main() {
  const roomId = process.env.ROOM_ID;
  const waitMs = Number(process.env.WAIT_MS ?? "1500");
  if (!roomId) throw new Error("Missing ROOM_ID");

  const client = await apiClientRepository.getClient(roomId, GRPC_MAX_MESSAGE_SIZE);
  const stream = client.adminRoom();
  const users = new Map<string, { uuid: string; name: string; ipAddress: string }>();

  stream.on("data", (message: any) => {
    const m = message?.message;
    if (!m) return;

    if (m.$case === "userJoinedRoom") {
      const u = m.userJoinedRoom;
      users.set(u.uuid, { uuid: u.uuid, name: u.name, ipAddress: u.ipAddress });
    } else if (m.$case === "userLeftRoom") {
      users.delete(m.userLeftRoom.uuid);
    }
  });

  stream.on("error", (err: any) => {
    console.error("adminRoom stream error:", err?.message ?? err);
  });

  stream.write({ message: { $case: "subscribeToRoom", subscribeToRoom: roomId } });

  setTimeout(() => {
    const list = Array.from(users.values());
    console.log(JSON.stringify({ roomId, count: list.length, users: list }, null, 2));
    stream.end();
    process.exit(0);
  }, waitMs);
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
TS
cd /usr/src/play && npx tsx /tmp/wa-emergency-admin.ts'
  exit 0
fi

docker exec -e ROOM_ID="$ROOM_ID" -e USER_UUID="$USER_UUID" -e MESSAGE="$MESSAGE" "$CONTAINER" sh -lc 'cat > /tmp/wa-emergency-admin.ts <<"TS"
import { apiClientRepository } from "/usr/src/play/src/pusher/services/ApiClientRepository.ts";
import { GRPC_MAX_MESSAGE_SIZE } from "/usr/src/play/src/pusher/enums/EnvironmentVariable.ts";

async function main() {
  const roomId = process.env.ROOM_ID;
  const userUuid = process.env.USER_UUID;
  const message = process.env.MESSAGE ?? "Disconnected by administrator";
  if (!roomId) throw new Error("Missing ROOM_ID");
  if (!userUuid) throw new Error("Missing USER_UUID");

  const client = await apiClientRepository.getClient(roomId, GRPC_MAX_MESSAGE_SIZE);

  await new Promise<void>((resolve, reject) => {
    client.ban(
      {
        roomId,
        recipientUuid: userUuid,
        message,
        type: "banned",
      },
      (error: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      }
    );
  });

  console.log(JSON.stringify({ roomId, userUuid, status: "kicked" }, null, 2));
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
TS
cd /usr/src/play && npx tsx /tmp/wa-emergency-admin.ts'
