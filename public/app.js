const messagesContainer = document.getElementById("messages");
const input = document.getElementById("messageInput");
const form = document.getElementById("messageForm");
const statusElement = document.getElementById("status");

// Имя пользователя
let username = localStorage.getItem("chat_username");

if (!username) {
    username = prompt("Как тебя зовут?");

    if (!username || !username.trim()) {
        username = "Guest";
    }

    username = username.trim().slice(0, 30);

    localStorage.setItem("chat_username", username);
}

let socket = null;
let reconnectDelay = 1000;

function connect() {

    statusElement.textContent = "Подключение...";

    // Автоматически выбираем ws или wss
    const protocol =
        location.protocol === "https:"
            ? "wss:"
            : "ws:";

    socket = new WebSocket(
        `${protocol}//${location.host}/ws`
    );

    socket.addEventListener("open", () => {

        console.log("Connected");

        statusElement.textContent =
            `В сети • ${username}`;

        reconnectDelay = 1000;
    });

    socket.addEventListener("message", (event) => {

        try {

            const data = JSON.parse(event.data);

            if (data.type === "history") {

                messagesContainer.innerHTML = "";

                data.messages.forEach(addMessage);

                scrollToBottom();
            }

            if (data.type === "message") {

                addMessage(data.message);

                scrollToBottom();
            }

        } catch (error) {
            console.error(error);
        }

    });

    socket.addEventListener("close", () => {

        statusElement.textContent =
            "Соединение потеряно. Переподключение...";

        setTimeout(() => {

            connect();

            reconnectDelay =
                Math.min(reconnectDelay * 2, 10000);

        }, reconnectDelay);

    });

    socket.addEventListener("error", () => {
        console.log("WebSocket error");
    });
}

function addMessage(message) {

    const element = document.createElement("div");

    element.className = "message";

    const usernameElement =
        document.createElement("div");

    usernameElement.className = "username";
    usernameElement.textContent = message.username;

    const textElement =
        document.createElement("div");

    textElement.className = "text";
    textElement.textContent = message.text;

    const timeElement =
        document.createElement("div");

    timeElement.className = "time";

    const date = new Date(message.time);

    timeElement.textContent =
        date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        });

    element.appendChild(usernameElement);
    element.appendChild(textElement);
    element.appendChild(timeElement);

    messagesContainer.appendChild(element);
}

function scrollToBottom() {

    messagesContainer.scrollTop =
        messagesContainer.scrollHeight;
}

form.addEventListener("submit", (event) => {

    event.preventDefault();

    const text = input.value.trim();

    if (!text) {
        return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        alert("Нет соединения с сервером");
        return;
    }

    socket.send(JSON.stringify({
        type: "message",
        username,
        text
    }));

    input.value = "";
    input.focus();
});

connect();