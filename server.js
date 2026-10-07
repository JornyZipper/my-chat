const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;

const messages = [];

app.use(express.static(path.join(__dirname, "public")));

const wss = new WebSocket.Server({
    server,
    path: "/ws"
});

wss.on("connection", (ws) => {
    console.log("User connected");

    // Отправляем историю новому пользователю
    ws.send(JSON.stringify({
        type: "history",
        messages: messages
    }));

    ws.on("message", (data) => {
        try {
            const message = JSON.parse(data.toString());

            if (message.type !== "message") {
                return;
            }

            let username = String(
                message.username || "Guest"
            )
                .trim()
                .slice(0, 30);

            let text = String(
                message.text || ""
            )
                .trim()
                .slice(0, 1000);

            if (!username) {
                username = "Guest";
            }

            if (!text) {
                return;
            }

            const newMessage = {
                id: Date.now() + Math.random(),
                username: username,
                text: text,
                time: new Date().toISOString()
            };

            messages.push(newMessage);

            // Максимум 100 сообщений
            if (messages.length > 100) {
                messages.shift();
            }

            // Отправляем всем
            for (const client of wss.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: "message",
                        message: newMessage
                    }));
                }
            }

        } catch (error) {
            console.error(
                "Message error:",
                error
            );
        }
    });

    ws.on("close", () => {
        console.log("User disconnected");
    });
});

// Проверка сервера
app.get("/api/status", (req, res) => {
    res.json({
        online: true,
        users: wss.clients.size,
        messages: messages.length
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Server running on port ${PORT}`
    );
});
