const messagesContainer =
    document.getElementById("messages");

const input =
    document.getElementById("messageInput");

const form =
    document.getElementById("messageForm");

const statusElement =
    document.getElementById("status");

const chatPreview =
    document.getElementById("chatPreview");

const lastTime =
    document.getElementById("lastTime");

const sidebar =
    document.getElementById("sidebar");

const sidebarOverlay =
    document.getElementById("sidebarOverlay");

const openSidebarButton =
    document.getElementById("openSidebar");

const closeSidebarButton =
    document.getElementById("closeSidebar");

const emojiButton =
    document.getElementById("emojiButton");

const emojiPanel =
    document.getElementById("emojiPanel");

const searchInput =
    document.getElementById("searchInput");

const chatItem =
    document.getElementById("chatItem");


/* =====================================================
   USERNAME
===================================================== */

let username =
    localStorage.getItem("chat_username");

if (!username) {

    username =
        prompt("Как тебя зовут?");

    if (
        !username ||
        !username.trim()
    ) {
        username = "Guest";
    }

    username =
        username
            .trim()
            .slice(0, 30);

    localStorage.setItem(
        "chat_username",
        username
    );
}


/* =====================================================
   SOCKET
===================================================== */

let socket = null;

let reconnectDelay = 1000;


/* =====================================================
   CONNECT
===================================================== */

function connect() {

    statusElement.textContent =
        "подключение...";


    const protocol =
        location.protocol === "https:"
            ? "wss:"
            : "ws:";


    const socketUrl =
        `${protocol}//${location.host}/ws`;


    socket =
        new WebSocket(socketUrl);


    /* CONNECTED */

    socket.addEventListener(
        "open",
        () => {

            console.log(
                "WebSocket connected"
            );

            statusElement.textContent =
                "в сети";

            reconnectDelay = 1000;
        }
    );


    /* MESSAGE */

    socket.addEventListener(
        "message",
        (event) => {

            try {

                const data =
                    JSON.parse(
                        event.data
                    );


                /* HISTORY */

                if (
                    data.type ===
                    "history"
                ) {

                    messagesContainer.innerHTML =
                        "";


                    data.messages.forEach(
                        (message) => {
                            addMessage(
                                message
                            );
                        }
                    );


                    const last =
                        data.messages[
                            data.messages.length - 1
                        ];


                    updateChatPreview(
                        last
                    );


                    scrollToBottom();
                }


                /* NEW MESSAGE */

                if (
                    data.type ===
                    "message"
                ) {

                    addMessage(
                        data.message
                    );


                    updateChatPreview(
                        data.message
                    );


                    scrollToBottom();
                }

            } catch (error) {

                console.error(
                    "Message parsing error:",
                    error
                );
            }
        }
    );


    /* CLOSED */

    socket.addEventListener(
        "close",
        () => {

            statusElement.textContent =
                "переподключение...";


            setTimeout(
                () => {

                    connect();


                    reconnectDelay =
                        Math.min(
                            reconnectDelay * 2,
                            10000
                        );

                },
                reconnectDelay
            );
        }
    );


    /* ERROR */

    socket.addEventListener(
        "error",
        () => {

            console.log(
                "WebSocket error"
            );

            statusElement.textContent =
                "ошибка соединения";
        }
    );
}


/* =====================================================
   ADD MESSAGE
===================================================== */

function addMessage(message) {

    const row =
        document.createElement(
            "div"
        );


    const mine =
        message.username ===
        username;


    if (mine) {

        row.className =
            "message-row outgoing";

    } else {

        row.className =
            "message-row incoming";
    }


    const bubble =
        document.createElement(
            "div"
        );


    if (mine) {

        bubble.className =
            "message outgoing";

    } else {

        bubble.className =
            "message incoming";
    }


    /* USERNAME */

    if (!mine) {

        const author =
            document.createElement(
                "div"
            );


        author.className =
            "message-author";


        author.textContent =
            String(
                message.username || "Guest"
            );


        bubble.appendChild(
            author
        );
    }


    /* TEXT */

    const text =
        document.createElement(
            "span"
        );


    text.className =
        "message-text";


    text.textContent =
        String(
            message.text || ""
        );


    bubble.appendChild(
        text
    );


    /* TIME */

    const meta =
        document.createElement(
            "span"
        );


    meta.className =
        "message-meta";


    const date =
        new Date(
            message.time
        );


    const time =
        date.toLocaleTimeString(
            [],
            {
                hour: "2-digit",
                minute: "2-digit"
            }
        );


    meta.textContent =
        time;


    bubble.appendChild(
        meta
    );


    row.appendChild(
        bubble
    );


    messagesContainer.appendChild(
        row
    );
}


/* =====================================================
   CHAT PREVIEW
===================================================== */

function updateChatPreview(message) {

    if (!message) {

        chatPreview.textContent =
            "Пока сообщений нет";

        lastTime.textContent =
            "";

        return;
    }


    chatPreview.textContent =
        `${message.username}: ${message.text}`;


    const date =
        new Date(
            message.time
        );


    lastTime.textContent =
        date.toLocaleTimeString(
            [],
            {
                hour: "2-digit",
                minute: "2-digit"
            }
        );
}


/* =====================================================
   SEND MESSAGE
===================================================== */

form.addEventListener(
    "submit",
    (event) => {

        event.preventDefault();


        const text =
            input.value.trim();


        if (!text) {
            return;
        }


        if (
            !socket ||
            socket.readyState !==
                WebSocket.OPEN
        ) {

            alert(
                "Нет соединения с сервером."
            );

            return;
        }


        socket.send(
            JSON.stringify({
                type: "message",

                username:
                    username,

                text:
                    text
            })
        );


        input.value =
            "";


        input.focus();
    }
);


/* =====================================================
   ENTER
===================================================== */

input.addEventListener(
    "keydown",
    (event) => {

        if (
            event.key === "Enter" &&
            !event.shiftKey
        ) {

            event.preventDefault();

            form.requestSubmit();
        }
    }
);


/* =====================================================
   EMOJI
===================================================== */

emojiButton.addEventListener(
    "click",
    (event) => {

        event.stopPropagation();

        emojiPanel.classList.toggle(
            "open"
        );
    }
);


document
    .querySelectorAll(
        ".emoji-panel button"
    )
    .forEach(
        (button) => {

            button.addEventListener(
                "click",
                () => {

                    input.value +=
                        button.textContent;

                    input.focus();

                    emojiPanel.classList.remove(
                        "open"
                    );
                }
            );
        }
    );


document.addEventListener(
    "click",
    (event) => {

        if (
            !emojiPanel.contains(
                event.target
            ) &&
            event.target !==
                emojiButton
        ) {

            emojiPanel.classList.remove(
                "open"
            );
        }
    }
);


/* =====================================================
   MOBILE SIDEBAR
===================================================== */

function openSidebar() {

    sidebar.classList.add(
        "open"
    );

    sidebarOverlay.classList.add(
        "visible"
    );
}


function closeSidebar() {

    sidebar.classList.remove(
        "open"
    );

    sidebarOverlay.classList.remove(
        "visible"
    );
}


openSidebarButton.addEventListener(
    "click",
    openSidebar
);


closeSidebarButton.addEventListener(
    "click",
    closeSidebar
);


sidebarOverlay.addEventListener(
    "click",
    closeSidebar
);


chatItem.addEventListener(
    "click",
    () => {

        closeSidebar();

        input.focus();
    }
);


/* =====================================================
   SEARCH
===================================================== */

searchInput.addEventListener(
    "input",
    () => {

        const value =
            searchInput.value
                .trim()
                .toLowerCase();


        if (!value) {

            chatItem.style.display =
                "flex";

            return;
        }


        const found =
            "общий чат".includes(
                value
            );


        chatItem.style.display =
            found
                ? "flex"
                : "none";
    }
);


/* =====================================================
   ESC
===================================================== */

document.addEventListener(
    "keydown",
    (event) => {

        if (
            event.key === "Escape"
        ) {

            closeSidebar();

            emojiPanel.classList.remove(
                "open"
            );
        }
    }
);


/* =====================================================
   SCROLL
===================================================== */

function scrollToBottom() {

    requestAnimationFrame(
        () => {

            messagesContainer.scrollTop =
                messagesContainer.scrollHeight;
        }
    );
}


/* =====================================================
   START
===================================================== */

connect();
