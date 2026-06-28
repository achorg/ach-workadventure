#!/usr/bin/env node

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

function getArg(name, fallback) {
    const idx = process.argv.indexOf(name);
    if (idx !== -1 && process.argv[idx + 1]) {
        return process.argv[idx + 1];
    }
    return fallback;
}

async function apiFetch(baseUrl, path, token, init = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
            authorization: token,
            "content-type": "application/json",
            ...(init.headers || {}),
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        return response.json();
    }
    return response.text();
}

async function main() {
    const baseUrl = getArg("--base-url", process.env.WA_BASE_URL || "https://play.apjan.co");
    const token = getArg("--token", process.env.ADMIN_API_TOKEN || "");
    const roomId = getArg("--room-id", process.env.WA_ROOM_ID || "");

    if (!token) {
        console.error("Missing token. Pass --token or set ADMIN_API_TOKEN.");
        process.exit(1);
    }

    if (!roomId) {
        console.error("Missing room id. Pass --room-id or set WA_ROOM_ID.");
        process.exit(1);
    }

    const encodedRoomId = encodeURIComponent(roomId);
    const usersResponse = await apiFetch(baseUrl, `/room/users?roomId=${encodedRoomId}`, token, { method: "GET" });

    const users = usersResponse.users || [];
    if (users.length === 0) {
        console.log("No connected users in this room.");
        return;
    }

    console.log(`Connected users in room: ${roomId}`);
    users.forEach((user, index) => {
        console.log(`${index + 1}. ${user.name} (${user.userUuid})`);
    });

    const rl = readline.createInterface({ input, output });
    const selected = await rl.question("Select user number to remove (or press Enter to cancel): ");

    if (!selected.trim()) {
        console.log("Cancelled.");
        rl.close();
        return;
    }

    const selectedIndex = Number.parseInt(selected, 10) - 1;
    if (Number.isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= users.length) {
        console.error("Invalid selection.");
        rl.close();
        process.exit(1);
    }

    const selectedUser = users[selectedIndex];
    const defaultMessage = `You have been disconnected by an administrator.`;
    const message = await rl.question(`Message for ${selectedUser.name} [${defaultMessage}]: `);
    rl.close();

    await apiFetch(baseUrl, "/room/kick-user", token, {
        method: "POST",
        body: JSON.stringify({
            roomId,
            userUuid: selectedUser.userUuid,
            message: message.trim() || defaultMessage,
        }),
    });

    console.log(`Removed user: ${selectedUser.name} (${selectedUser.userUuid})`);
}

main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
});
