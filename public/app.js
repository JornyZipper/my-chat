const messagesContainer =
    document.getElementById("messages");

const emptyScreen =
    document.getElementById("emptyScreen");

const messageForm =
    document.getElementById("messageForm");

const messageInput =
    document.getElementById("messageInput");

const statusElement =
    document.getElementById("status");

const headerName =
    document.getElementById("headerName");

const headerAvatar =
    document.getElementById("headerAvatar");

const profileName =
    document.getElementById("profileName");

const profileAvatar =
    document.getElementById("profileAvatar");

const userList =
    document.getElementById("userList");

const searchInput =
    document.getElementById("searchInput");

const sidebar =
    document.getElementById("sidebar");

const sidebarOverlay =
    document.getElementById("sidebarOverlay");

const openSidebarButton =
    document.getElementById("openSidebar");

const closeSidebarButton =
    document.getElementById("closeSidebar");

const findButton =
    document.getElementById("findButton");

const headerSearchButton =
    document.getElementById(
        "headerSearchButton"
    );

const emojiButton =
    document.getElementById(
        "emojiButton"
    );

const emojiPanel =
    document.getElementById(
        "emojiPanel"
    );


/*
=====================================================
STATE
=====================================================
*/

let socket = null;

let reconnectDelay = 1000;

let username = null;

let users = [];

let currentUser = null;

let typingTimer = null;

let remoteTypingTimer = null;

let sentTypingState = false;


/*
=====================================================
GET USERNAME
=====================================================
*/

function getSavedUsername() {

    return localStorage.getItem(
        "chat_username"
    );
}


function saveUsername(name) {

    localStorage.setItem(
        "chat_username",
        name
    );
}


function askUsername() {

    let value =
        prompt(
            "Придумай ник\n\nОт 2 до 24 символов.\nМожно использовать буквы, цифры, _, -, ."
        );


    if (!value) {

        value =
            "Guest" +
            Math.floor(
                Math.random() * 9999
            );
    }


    value =
        value
            .trim()
            .slice(0, 24);


    if (value.length < 2) {

        value =
            "Guest" +
            Math.floor(
                Math.random() * 9999
            );
    }


    return value;
}


username =
    getSavedUsername();


if (!username) {

    username =
        askUsername();

    saveUsername(
        username
    );
}


profileName.textContent =
    "@" + username;

profileAvatar.textContent =
    username
        .charAt(0)
        .toUpperCase();


/*
=====================================================
SOCKET CONNECT
=====================================================
*/

function connect() {

    statusElement.textContent =
        "подключение...";


    const protocol =
        location.protocol === "https:"
            ? "wss:"
            : "ws:";


    socket =
        new WebSocket(
            `${protocol}//${location.host}/ws`
        );


    /*
    =============================================
    OPEN
    =============================================
    */

    socket.addEventListener(
        "open",
        () => {

            reconnectDelay =
                1000;


            socket.send(
                JSON.stringify({
                    type:
                        "login",

                    nickname:
                        username
                })
            );
        }
    );


    /*
    =============================================
    MESSAGE
    =============================================
    */

    socket.addEventListener(
        "message",
        (event) => {

            try {

                const data =
                    JSON.parse(
                        event.data
                    );


                /*
                =================================
                LOGIN OK
                =================================
                */

                if (
                    data.type ===
                    "login_ok"
                ) {

                    username =
                        data.nickname;

                    saveUsername(
                        username
                    );


                    profileName.textContent =
                        "@" + username;

                    profileAvatar.textContent =
                        username
                            .charAt(0)
                            .toUpperCase();


                    statusElement.textContent =
                        currentUser
                            ? getUserStatus(
                                currentUser
                            )
                            : "Найдите человека по нику";


                    renderUsers();

                    return;
                }


                /*
                =================================
                LOGIN ERROR
                =================================
                */

                if (
                    data.type ===
                    "login_error"
                ) {

                    const newName =
                        askUsername();


                    username =
                        newName;


                    saveUsername(
                        username
                    );


                    profileName.textContent =
                        "@" + username;

                    profileAvatar.textContent =
                        username
                            .charAt(0)
                            .toUpperCase();


                    if (
                        socket.readyState ===
                        WebSocket.OPEN
                    ) {

                        socket.send(
                            JSON.stringify({
                                type:
                                    "login",

                                nickname:
                                    username
                            })
                        );
                    }

                    return;
                }


                /*
                =================================
                USERS
                =================================
                */

                if (
                    data.type ===
                    "users"
                ) {

                    users =
                        data.users;

                    renderUsers();

                    updateCurrentUserStatus();

                    return;
                }


                /*
                =================================
                HISTORY
                =================================
                */

                if (
                    data.type ===
                    "history"
                ) {

                    if (
                        normalize(
                            data.with
                        ) !==
                        normalize(
                            currentUser
                        )
                    ) {
                        return;
                    }


                    messagesContainer.innerHTML =
                        "";


                    for (
                        const message
                        of data.messages
                    ) {

                        addMessage(
                            message
                        );
                    }


                    scrollToBottom();

                    return;
                }


                /*
                =================================
                NEW MESSAGE
                =================================
                */

                if (
                    data.type ===
                    "message"
                ) {

                    const message =
                        data.message;


                    const relatedToCurrentChat =
                        currentUser &&
                        (
                            normalize(
                                message.from
                            ) ===
                            normalize(
                                currentUser
                            ) ||

                            normalize(
                                message.to
                            ) ===
                            normalize(
                                currentUser
                            )
                        );


                    if (
                        relatedToCurrentChat
                    ) {

                        addMessage(
                            message
                        );

                        scrollToBottom();
                    }


                    /*
                    Принудительно выключаем
                    typing после отправки.
                    */

                    if (
                        normalize(
                            message.from
                        ) ===
                        normalize(
                            username
                        )
                    ) {

                        stopTyping();
                    }


                    return;
                }


                /*
                =================================
                TYPING
                =================================
                */

                if (
                    data.type ===
                    "typing"
                ) {

                    const from =
                        data.from;


                    if (
                        !currentUser
                    ) {
                        return;
                    }


                    if (
                        normalize(from) !==
                        normalize(currentUser)
                    ) {
                        return;
                    }


                    clearTimeout(
                        remoteTypingTimer
                    );


                    if (
                        data.isTyping
                    ) {

                        statusElement.textContent =
                            "печатает…";


                        remoteTypingTimer =
                            setTimeout(
                                () => {

                                    updateCurrentUserStatus();

                                },
                                1800
                            );

                    } else {

                        updateCurrentUserStatus();
                    }


                    return;
                }

            } catch (error) {

                console.error(
                    "Data error:",
                    error
                );
            }
        }
    );


    /*
    =============================================
    CLOSE
    =============================================
    */

    socket.addEventListener(
        "close",
        () => {

            statusElement.textContent =
                "соединение потеряно";


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


    /*
    =============================================
    ERROR
    =============================================
    */

    socket.addEventListener(
        "error",
        () => {

            statusElement.textContent =
                "ошибка соединения";
        }
    );
}


/*
=====================================================
NORMALIZE
=====================================================
*/

function normalize(value) {

    return String(
        value || ""
    )
        .trim()
        .toLowerCase();
}


/*
=====================================================
USER STATUS
=====================================================
*/

function getUserStatus(nickname) {

    const user =
        users.find(
            item =>
                normalize(item.nickname) ===
                normalize(nickname)
        );


    if (!user) {

        return "не в сети";
    }


    return user.online
        ? "в сети"
        : "не в сети";
}


function updateCurrentUserStatus() {

    if (!currentUser) {

        statusElement.textContent =
            "Найдите человека по нику";

        return;
    }


    statusElement.textContent =
        getUserStatus(
            currentUser
        );
}


/*
=====================================================
RENDER USERS
=====================================================
*/

function renderUsers() {

    if (!username) {
        return;
    }


    const search =
        searchInput.value
            .trim()
            .toLowerCase();


    const filtered =
        users
            .filter(
                user =>
                    normalize(
                        user.nickname
                    ) !==
                    normalize(
                        username
                    )
            )
            .filter(
                user =>
                    !search ||
                    user.nickname
                        .toLowerCase()
                        .includes(search)
            )
            .sort(
                (a, b) => {

                    if (
                        a.online !==
                        b.online
                    ) {

                        return a.online
                            ? -1
                            : 1;
                    }


                    return a.nickname
                        .localeCompare(
                            b.nickname
                        );
                }
            );


    userList.innerHTML =
        "";


    if (
        filtered.length ===
        0
    ) {

        const empty =
            document.createElement(
                "div"
            );


        empty.className =
            "empty-users";


        if (search) {

            empty.textContent =
                "Пользователь с таким ником не найден.";

        } else {

            empty.textContent =
                "Здесь появятся пользователи.";
        }


        userList.appendChild(
            empty
        );


        return;
    }


    for (
        const user
        of filtered
    ) {

        createUserElement(
            user
        );
    }
}


/*
=====================================================
CREATE USER ELEMENT
=====================================================
*/

function createUserElement(user) {

    const button =
        document.createElement(
            "button"
        );


    button.type =
        "button";


    button.className =
        "user-item";


    if (
        currentUser &&
        normalize(
            currentUser
        ) ===
        normalize(
            user.nickname
        )
    ) {

        button.classList.add(
            "active"
        );
    }


    /*
    AVATAR
    */

    const avatar =
        document.createElement(
            "div"
        );


    avatar.className =
        "user-avatar";


    avatar.textContent =
        user.nickname
            .charAt(0)
            .toUpperCase();


    if (user.online) {

        const dot =
            document.createElement(
                "div"
            );


        dot.className =
            "online-dot";


        avatar.appendChild(
            dot
        );
    }


    /*
    INFO
    */

    const info =
        document.createElement(
            "div"
        );


    info.className =
        "user-info";


    const name =
        document.createElement(
            "div"
        );


    name.className =
        "user-name";


    name.textContent =
        "@" + user.nickname;


    const status =
        document.createElement(
            "div"
        );


    status.className =
        "user-status";


    status.textContent =
        user.online
            ? "В сети"
            : "Не в сети";


    info.appendChild(
        name
    );

    info.appendChild(
        status
    );


    button.appendChild(
        avatar
    );

    button.appendChild(
        info
    );


    button.addEventListener(
        "click",
        () => {

            openChat(
                user.nickname
            );
        }
    );


    userList.appendChild(
        button
    );
}


/*
=====================================================
OPEN CHAT
=====================================================
*/

function openChat(nickname) {

    currentUser =
        nickname;


    headerName.textContent =
        "@" + nickname;


    headerAvatar.textContent =
        nickname
            .charAt(0)
            .toUpperCase();


    emptyScreen.classList.add(
        "hidden"
    );


    messagesContainer.classList.remove(
        "hidden"
    );


    messageForm.classList.remove(
        "hidden"
    );


    updateCurrentUserStatus();


    messagesContainer.innerHTML =
        "";


    if (
        socket &&
        socket.readyState ===
        WebSocket.OPEN
    ) {

        socket.send(
            JSON.stringify({
                type:
                    "history",

                with:
                    nickname
            })
        );
    }


    closeSidebar();


    setTimeout(
        () => {

            messageInput.focus();

        },
        100
    );


    renderUsers();
}


/*
=====================================================
ADD MESSAGE
=====================================================
*/

function addMessage(message) {

    const mine =
        normalize(
            message.from
        ) ===
        normalize(
            username
        );


    const row =
        document.createElement(
            "div"
        );


    row.className =
        mine
            ? "message-row outgoing"
            : "message-row incoming";


    const bubble =
        document.createElement(
            "div"
        );


    bubble.className =
        mine
            ? "message outgoing"
            : "message incoming";


    /*
    AUTHOR
    */

    if (!mine) {

        const author =
            document.createElement(
                "div"
            );


        author.className =
            "message-author";


        author.textContent =
            "@" +
            message.from;


        bubble.appendChild(
            author
        );
    }


    /*
    TEXT
    */

    const text =
        document.createElement(
            "span"
        );


    text.className =
        "message-text";


    text.textContent =
        message.text;


    /*
    TIME
    */

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


    meta.textContent =
        date.toLocaleTimeString(
            [],
            {
                hour:
                    "2-digit",

                minute:
                    "2-digit"
            }
        );


    bubble.appendChild(
        text
    );

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


/*
=====================================================
SEND
=====================================================
*/

messageForm.addEventListener(
    "submit",
    (event) => {

        event.preventDefault();


        const text =
            messageInput.value
                .trim();


        if (!text) {
            return;
        }


        if (!currentUser) {
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
                type:
                    "message",

                to:
                    currentUser,

                text:
                    text
            })
        );


        messageInput.value =
            "";


        stopTyping();


        messageInput.focus();
    }
);


/*
=====================================================
TYPING
=====================================================
*/

messageInput.addEventListener(
    "input",
    () => {

        if (!currentUser) {
            return;
        }


        if (
            !socket ||
            socket.readyState !==
            WebSocket.OPEN
        ) {
            return;
        }


        if (!sentTypingState) {

            socket.send(
                JSON.stringify({
                    type:
                        "typing",

                    to:
                        currentUser,

                    isTyping:
                        true
                })
            );


            sentTypingState =
                true;
        }


        clearTimeout(
            typingTimer
        );


        typingTimer =
            setTimeout(
                () => {

                    stopTyping();

                },
                1200
            );
    }
);


function stopTyping() {

    clearTimeout(
        typingTimer
    );


    if (
        !sentTypingState
    ) {
        return;
    }


    if (
        socket &&
        socket.readyState ===
        WebSocket.OPEN &&
        currentUser
    ) {

        socket.send(
            JSON.stringify({
                type:
                    "typing",

                to:
                    currentUser,

                isTyping:
                    false
            })
        );
    }


    sentTypingState =
        false;
}


messageInput.addEventListener(
    "blur",
    stopTyping
);


/*
=====================================================
SEARCH
=====================================================
*/

searchInput.addEventListener(
    "input",
    () => {

        renderUsers();
    }
);


/*
=====================================================
FIND BUTTON
=====================================================
*/

findButton.addEventListener(
    "click",
    () => {

        openSidebar();

        setTimeout(
            () => {

                searchInput.focus();

            },
            250
        );
    }
);


headerSearchButton.addEventListener(
    "click",
    () => {

        openSidebar();

        setTimeout(
            () => {

                searchInput.focus();

            },
            250
        );
    }
);


/*
=====================================================
SIDEBAR
=====================================================
*/

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


/*
=====================================================
EMOJI
=====================================================
*/

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
        button => {

            button.addEventListener(
                "click",
                () => {

                    messageInput.value +=
                        button.textContent;

                    messageInput.focus();

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


/*
=====================================================
ESC
=====================================================
*/

document.addEventListener(
    "keydown",
    (event) => {

        if (
            event.key ===
            "Escape"
        ) {

            closeSidebar();

            emojiPanel.classList.remove(
                "open"
            );
        }
    }
);


/*
=====================================================
SWIPE
=====================================================
*/

let touchStartX = 0;
let touchStartY = 0;


document.addEventListener(
    "touchstart",
    event => {

        const touch =
            event.touches[0];


        touchStartX =
            touch.clientX;

        touchStartY =
            touch.clientY;
    },
    {
        passive:
            true
    }
);


document.addEventListener(
    "touchend",
    event => {

        const touch =
            event.changedTouches[0];


        const deltaX =
            touch.clientX -
            touchStartX;


        const deltaY =
            touch.clientY -
            touchStartY;


        const horizontal =
            Math.abs(deltaX) >
            Math.abs(deltaY);


        if (
            horizontal &&
            touchStartX < 35 &&
            deltaX > 70
        ) {

            openSidebar();
        }


        if (
            horizontal &&
            sidebar.classList.contains(
                "open"
            ) &&
            deltaX < -70
        ) {

            closeSidebar();
        }
    },
    {
        passive:
            true
    }
);


/*
=====================================================
SCROLL
=====================================================
*/

function scrollToBottom() {

    requestAnimationFrame(
        () => {

            messagesContainer.scrollTop =
                messagesContainer.scrollHeight;
        }
    );
}


/*
=====================================================
INITIAL MOBILE
=====================================================
*/

if (
    window.innerWidth <= 700
) {

    setTimeout(
        () => {

            openSidebar();

        },
        200
    );
}


/*
=====================================================
START
=====================================================
*/

connect();
