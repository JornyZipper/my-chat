const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;

// Статические файлы сайта
app.use(express.static(path.join(__dirname, "public")));

// WebSocket сервер
const wss = new WebSocket.Server({
    server,
    path: "/ws"
});

// Пока просто храним сообщения в памяти
const messages = [];

wss.on("connection", (ws) => {
    console.log("Новый пользователь подключился");

    // Отправляем историю сообщений новому пользователю
    ws.send(JSON.stringify({
        type: "history",
        messages
    }));

    ws.on("message", (data) => {
        try {
            const message = JSON.parse(data.toString());

            if (message.type !== "message") {
                return;
            }

            const username = String(message.username || "Unknown")
                .trim()
                .slice(0, 30);

            const text = String(message.text || "")
                .trim()
                .slice(0, 1000);

            if (!text) {
                return;
            }

            const newMessage = {
                id: Date.now() + Math.random(),
                username,
                text,
                time: new Date().toISOString()
            };

            messages.push(newMessage);

            // Оставляем последние 100 сообщений
            if (messages.length > 100) {
                messages.shift();
            }

            // Отправляем сообщение всем подключенным
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: "message",
                        message: newMessage
                    }));
                }
            });

        } catch (error) {
            console.error("Ошибка:", error);
        }
    });

    ws.on("close", () => {
        console.log("Пользователь отключился");
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
    console.log(`Chat server started on port ${PORT}`);
});