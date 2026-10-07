/*
=====================================================
ELEMENTS
=====================================================
*/

const sidebar =
    document.getElementById(
        "sidebar"
    );

const sidebarOverlay =
    document.getElementById(
        "sidebarOverlay"
    );

const openSidebarButton =
    document.getElementById(
        "openSidebar"
    );

const searchInput =
    document.getElementById(
        "searchInput"
    );

const userList =
    document.getElementById(
        "userList"
    );

const profileAvatar =
    document.getElementById(
        "profileAvatar"
    );

const profileDisplayName =
    document.getElementById(
        "profileDisplayName"
    );

const profileUsername =
    document.getElementById(
        "profileUsername"
    );

const profileVerified =
    document.getElementById(
        "profileVerified"
    );

const settingsButton =
    document.getElementById(
        "settingsButton"
    );

const settingsBackdrop =
    document.getElementById(
        "settingsBackdrop"
    );

const closeSettings =
    document.getElementById(
        "closeSettings"
    );

const settingsAvatar =
    document.getElementById(
        "settingsAvatar"
    );

const avatarInput =
    document.getElementById(
        "avatarInput"
    );

const settingsProfileName =
    document.getElementById(
        "settingsProfileName"
    );

const settingsProfileUsername =
    document.getElementById(
        "settingsProfileUsername"
    );

const settingsVerified =
    document.getElementById(
        "settingsVerified"
    );

const displayNameInput =
    document.getElementById(
        "displayNameInput"
    );

const usernameInput =
    document.getElementById(
        "usernameInput"
    );

const lightThemeButton =
    document.getElementById(
        "lightThemeButton"
    );

const darkThemeButton =
    document.getElementById(
        "darkThemeButton"
    );

const glassToggle =
    document.getElementById(
        "glassToggle"
    );

const saveProfileButton =
    document.getElementById(
        "saveProfileButton"
    );

const settingsError =
    document.getElementById(
        "settingsError"
    );

const emptyScreen =
    document.getElementById(
        "emptyScreen"
    );

const findButton =
    document.getElementById(
        "findButton"
    );

const headerSearchButton =
    document.getElementById(
        "headerSearchButton"
    );

const headerAvatar =
    document.getElementById(
        "headerAvatar"
    );

const headerName =
    document.getElementById(
        "headerName"
    );

const statusElement =
    document.getElementById(
        "status"
    );

const messages =
    document.getElementById(
        "messages"
    );

const messageForm =
    document.getElementById(
        "messageForm"
    );

const messageInput =
    document.getElementById(
        "messageInput"
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
LOGIN
*/

const loginOverlay =
    document.getElementById(
        "loginOverlay"
    );

const loginDisplayName =
    document.getElementById(
        "loginDisplayName"
    );

const loginUsername =
    document.getElementById(
        "loginUsername"
    );

const loginButton =
    document.getElementById(
        "loginButton"
    );

const loginError =
    document.getElementById(
        "loginError"
    );


/*
=====================================================
DEVICE
=====================================================
*/

const isIOS =
    /iPad|iPhone|iPod/.test(
        navigator.userAgent
    ) ||
    (
        navigator.platform ===
            "MacIntel" &&
        navigator.maxTouchPoints > 1
    );


if (isIOS) {

    document.body.classList.add(
        "ios"
    );
}


/*
=====================================================
PROFILE
=====================================================
*/

function makeId() {

    if (
        window.crypto &&
        crypto.randomUUID
    ) {

        return crypto.randomUUID();
    }


    return (
        Date.now().toString(36) +
        Math.random()
            .toString(36)
            .slice(2)
    );
}


function getSavedProfile() {

    try {

        const value =
            localStorage.getItem(
                "my_chat_profile"
            );


        if (!value) {
            return null;
        }


        return JSON.parse(
            value
        );

    } catch {

        return null;
    }
}


function saveProfile(
    value
) {

    localStorage.setItem(
        "my_chat_profile",
        JSON.stringify(
            value
        )
    );
}


/*
Не создаём Guest.
Пустой профиль вызывает форму входа.
*/

let profile =
    getSavedProfile();


if (!profile) {

    profile = {

        id:
            makeId(),

        nickname:
            "",

        displayName:
            "",

        avatar:
            ""
    };


    saveProfile(
        profile
    );
}


/*
=====================================================
THEME
=====================================================
*/

const savedTheme =
    localStorage.getItem(
        "my_chat_theme"
    ) ||
    "light";


const savedGlass =
    localStorage.getItem(
        "my_chat_glass"
    );


function applyTheme(
    theme
) {

    document.body.classList.toggle(
        "dark",
        theme === "dark"
    );


    lightThemeButton.classList.toggle(
        "active",
        theme === "light"
    );


    darkThemeButton.classList.toggle(
        "active",
        theme === "dark"
    );


    localStorage.setItem(
        "my_chat_theme",
        theme
    );


    const meta =
        document.querySelector(
            'meta[name="theme-color"]'
        );


    if (meta) {

        meta.setAttribute(
            "content",
            theme === "dark"
                ? "#151a20"
                : "#edf4fb"
        );
    }
}


function applyGlass(
    enabled
) {

    document.body.classList.toggle(
        "no-glass",
        !enabled
    );


    glassToggle.checked =
        enabled;


    localStorage.setItem(
        "my_chat_glass",
        enabled
            ? "1"
            : "0"
    );
}


applyTheme(
    savedTheme
);


applyGlass(
    savedGlass === null
        ? true
        : savedGlass === "1"
);


/*
=====================================================
STATE
=====================================================
*/

let socket =
    null;

let reconnectDelay =
    1000;

let users =
    [];

let currentUser =
    null;

let typingTimer =
    null;

let remoteTypingTimer =
    null;

let typingSent =
    false;


/*
=====================================================
PROFILE UI
=====================================================
*/

function normalize(
    value
) {

    return String(
        value || ""
    )
        .trim()
        .toLowerCase();
}


function firstLetter(
    value
) {

    const text =
        String(
            value || "?"
        ).trim();


    return (
        text.charAt(0)
            .toUpperCase() ||
        "?"
    );
}


function setAvatarElement(
    element,
    avatar,
    fallback
) {

    element.innerHTML =
        "";


    if (avatar) {

        const img =
            document.createElement(
                "img"
            );


        img.src =
            avatar;


        img.alt =
            "";


        element.appendChild(
            img
        );

    } else {

        element.textContent =
            firstLetter(
                fallback
            );
    }
}


function updateProfileUI() {

    const verified =
        normalize(
            profile.nickname
        ) ===
        "z1ipperj";


    profileDisplayName.textContent =
        profile.displayName ||
        "Пользователь";


    profileUsername.textContent =
        profile.nickname
            ? "@" + profile.nickname
            : "@username";


    profileVerified.classList.toggle(
        "hidden",
        !verified
    );


    settingsProfileName.textContent =
        profile.displayName ||
        "Пользователь";


    settingsProfileUsername.textContent =
        profile.nickname
            ? "@" + profile.nickname
            : "@username";


    settingsVerified.classList.toggle(
        "hidden",
        !verified
    );


    displayNameInput.value =
        profile.displayName || "";


    usernameInput.value =
        profile.nickname || "";


    setAvatarElement(
        profileAvatar,
        profile.avatar,
        profile.displayName ||
            profile.nickname
    );


    setAvatarElement(
        settingsAvatar,
        profile.avatar,
        profile.displayName ||
            profile.nickname
    );


    if (currentUser) {

        updateChatHeader();
    }
}


/*
=====================================================
LOGIN UI
=====================================================
*/

function showLogin() {

    loginOverlay.classList.remove(
        "hidden"
    );


    loginDisplayName.value =
        profile.displayName || "";


    loginUsername.value =
        profile.nickname || "";


    loginError.textContent =
        "";


    setTimeout(
        () => {

            if (
                !loginUsername.value
            ) {

                loginUsername.focus();

            } else {

                loginDisplayName.focus();
            }

        },
        50
    );
}


function hideLogin() {

    loginOverlay.classList.add(
        "hidden"
    );
}


/*
=====================================================
SEND LOGIN
=====================================================
*/

function sendLogin() {

    if (
        !profile.displayName ||
        !profile.nickname
    ) {

        showLogin();

        return;
    }


    if (
        !socket ||
        socket.readyState !==
            WebSocket.OPEN
    ) {

        return;
    }


    socket.send(
        JSON.stringify({

            type:
                "login",

            id:
                profile.id,

            nickname:
                profile.nickname,

            displayName:
                profile.displayName,

            avatar:
                profile.avatar
        })
    );
}


/*
=====================================================
CONNECT
=====================================================
*/

function connect() {

    statusElement.textContent =
        "подключение…";


    const protocol =
        location.protocol ===
        "https:"
            ? "wss:"
            : "ws:";


    socket =
        new WebSocket(
            `${protocol}//${location.host}/ws`
        );


    socket.addEventListener(
        "open",
        () => {

            reconnectDelay =
                1000;


            if (
                !profile.displayName ||
                !profile.nickname
            ) {

                showLogin();

                return;
            }


            sendLogin();
        }
    );


    socket.addEventListener(
        "message",
        handleSocketMessage
    );


    socket.addEventListener(
        "close",
        () => {

            if (
                currentUser &&
                !statusElement.classList.contains(
                    "typing-status"
                )
            ) {

                statusElement.textContent =
                    "соединение потеряно";
            }


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
SOCKET MESSAGE
=====================================================
*/

function handleSocketMessage(
    event
) {

    try {

        const data =
            JSON.parse(
                event.data
            );


        /*
        =============================================
        LOGIN OK
        =============================================
        */

        if (
            data.type ===
            "login_ok"
        ) {

            profile = {

                id:
                    data.profile.id,

                nickname:
                    data.profile.nickname,

                displayName:
                    data.profile.displayName,

                avatar:
                    data.profile.avatar || ""
            };


            saveProfile(
                profile
            );


            hideLogin();


            updateProfileUI();


            statusElement.textContent =
                currentUser
                    ? getCurrentUserStatus()
                    : "Выберите пользователя";


            renderUsers();


            return;
        }


        /*
        =============================================
        LOGIN ERROR
        =============================================
        */

        if (
            data.type ===
            "login_error"
        ) {

            loginError.textContent =
                data.error ||
                "Не удалось войти.";


            showLogin();


            return;
        }


        /*
        =============================================
        PROFILE OK
        =============================================
        */

        if (
            data.type ===
            "profile_ok"
        ) {

            profile = {

                id:
                    data.profile.id,

                nickname:
                    data.profile.nickname,

                displayName:
                    data.profile.displayName,

                avatar:
                    data.profile.avatar || ""
            };


            saveProfile(
                profile
            );


            updateProfileUI();


            settingsError.textContent =
                "Изменения сохранены.";


            renderUsers();


            return;
        }


        /*
        =============================================
        PROFILE ERROR
        =============================================
        */

        if (
            data.type ===
            "profile_error"
        ) {

            settingsError.textContent =
                data.error ||
                "Не удалось сохранить изменения.";


            return;
        }


        /*
        =============================================
        USERS
        =============================================
        */

        if (
            data.type ===
            "users"
        ) {

            users =
                data.users || [];


            /*
            Очень важно:
            если пользователь уже открыт,
            обновляем именно его объект.
            */

            if (currentUser) {

                const updated =
                    users.find(
                        user =>
                            user.id ===
                            currentUser.id
                    );


                if (updated) {

                    currentUser =
                        updated;
                }
            }


            renderUsers();


            /*
            Сразу обновляем header.
            */

            if (currentUser) {

                /*
                Не трогаем typing,
                если он активен.
                */

                if (
                    !statusElement.classList.contains(
                        "typing-status"
                    )
                ) {

                    updateChatHeader();
                }
            }


            return;
        }


        /*
        =============================================
        HISTORY
        =============================================
        */

        if (
            data.type ===
            "history"
        ) {

            if (
                !currentUser ||
                data.withId !==
                    currentUser.id
            ) {

                return;
            }


            messages.innerHTML =
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
        =============================================
        MESSAGE
        =============================================
        */

        if (
            data.type ===
            "message"
        ) {

            const message =
                data.message;


            /*
            Сообщение относится
            к открытому чату?
            */

            const relevant =
                currentUser &&
                (
                    message.fromId ===
                        currentUser.id ||

                    message.toId ===
                        currentUser.id
                );


            if (relevant) {

                addMessage(
                    message
                );


                scrollToBottom();
            }


            /*
            Если это наше сообщение,
            typing отключаем.
            */

            if (
                message.fromId ===
                profile.id
            ) {

                stopTyping();
            }


            return;
        }


        /*
        =============================================
        TYPING
        =============================================
        */

        if (
            data.type ===
            "typing"
        ) {

            if (
                !currentUser ||
                data.fromId !==
                    currentUser.id
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
                    "печатает";


                statusElement.classList.add(
                    "typing-status"
                );


                remoteTypingTimer =
                    setTimeout(
                        () => {

                            statusElement.classList.remove(
                                "typing-status"
                            );


                            updateChatHeader();

                        },
                        1800
                    );

            } else {

                statusElement.classList.remove(
                    "typing-status"
                );


                updateChatHeader();
            }


            return;
        }


    } catch (error) {

        console.error(
            "Socket data error:",
            error
        );
    }
}


/*
=====================================================
CURRENT STATUS
=====================================================
*/

function getCurrentUserStatus() {

    if (!currentUser) {

        return "Выберите пользователя";
    }


    return currentUser.online
        ? "в сети"
        : "не в сети";
}


/*
=====================================================
HEADER
=====================================================
*/

function updateChatHeader() {

    if (!currentUser) {

        headerName.textContent =
            "Личные сообщения";


        statusElement.textContent =
            "Выберите пользователя";


        statusElement.classList.remove(
            "typing-status"
        );


        setAvatarElement(
            headerAvatar,
            "",
            "?"
        );


        return;
    }


    /*
    Имя
    */

    headerName.textContent =
        currentUser.displayName +
        (
            currentUser.verified
                ? "  ✓"
                : ""
        );


    /*
    Статус
    */

    if (
        !statusElement.classList.contains(
            "typing-status"
        )
    ) {

        statusElement.textContent =
            getCurrentUserStatus();
    }


    /*
    Аватар
    */

    setAvatarElement(
        headerAvatar,
        currentUser.avatar,
        currentUser.displayName
    );
}


/*
=====================================================
USERS
=====================================================
*/

function renderUsers() {

    const query =
        searchInput.value
            .trim()
            .replace(
                /^@/,
                ""
            )
            .toLowerCase();


    const filtered =
        users

            /*
            Себя не показываем.
            */

            .filter(
                user =>
                    user.id !==
                    profile.id
            )

            /*
            Поиск по имени И username.
            */

            .filter(
                user => {

                    if (!query) {
                        return true;
                    }


                    return (

                        normalize(
                            user.nickname
                        ).includes(
                            query
                        ) ||


                        normalize(
                            user.displayName
                        ).includes(
                            query
                        )

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


        empty.textContent =
            query
                ? "Пользователь не найден."
                : "Пока никого нет.";


        userList.appendChild(
            empty
        );


        return;
    }


    for (
        const user
        of filtered
    ) {

        createUserItem(
            user
        );
    }
}


/*
=====================================================
CREATE USER
=====================================================
*/

function createUserItem(
    user
) {

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
        currentUser.id ===
            user.id
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


    setAvatarElement(
        avatar,
        user.avatar,
        user.displayName
    );


    if (
        user.online
    ) {

        const dot =
            document.createElement(
                "span"
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


    /*
    NAME
    */

    const nameLine =
        document.createElement(
            "div"
        );


    nameLine.className =
        "user-name-line";


    const name =
        document.createElement(
            "div"
        );


    name.className =
        "user-name";


    name.textContent =
        user.displayName;


    nameLine.appendChild(
        name
    );


    /*
    VERIFIED
    */

    if (
        user.verified
    ) {

        const badge =
            document.createElement(
                "span"
            );


        badge.className =
            "verified-badge";


        badge.textContent =
            "✓";


        nameLine.appendChild(
            badge
        );
    }


    /*
    USERNAME
    */

    const nickname =
        document.createElement(
            "div"
        );


    nickname.className =
        "user-username";


    nickname.textContent =
        "@" +
        user.nickname;


    /*
    STATUS
    */

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
        nameLine
    );


    info.appendChild(
        nickname
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


    /*
    OPEN CHAT
    */

    button.addEventListener(
        "click",
        () => {

            openChat(
                user
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

function openChat(
    user
) {

    currentUser =
        user;


    emptyScreen.classList.add(
        "hidden"
    );


    messages.classList.remove(
        "hidden"
    );


    messageForm.classList.remove(
        "hidden"
    );


    messages.innerHTML =
        "";


    clearTimeout(
        remoteTypingTimer
    );


    statusElement.classList.remove(
        "typing-status"
    );


    updateChatHeader();


    /*
    Запрашиваем историю.
    */

    if (
        socket &&
        socket.readyState ===
            WebSocket.OPEN
    ) {

        socket.send(
            JSON.stringify({

                type:
                    "history",

                withId:
                    user.id
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

function addMessage(
    message
) {

    const mine =
        message.fromId ===
        profile.id;


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


        if (
            message.verified
        ) {

            const badge =
                document.createElement(
                    "span"
                );


            badge.className =
                "message-author-badge";


            badge.textContent =
                "✓";


            author.appendChild(
                badge
            );
        }


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


    messages.appendChild(
        row
    );
}


/*
=====================================================
SEND MESSAGE
=====================================================
*/

messageForm.addEventListener(
    "submit",
    event => {

        event.preventDefault();


        const text =
            messageInput.value
                .trim();


        if (
            !text ||
            !currentUser
        ) {
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

                toId:
                    currentUser.id,

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

        if (
            !currentUser ||
            !socket ||
            socket.readyState !==
                WebSocket.OPEN
        ) {

            return;
        }


        if (!typingSent) {

            socket.send(
                JSON.stringify({

                    type:
                        "typing",

                    toId:
                        currentUser.id,

                    isTyping:
                        true
                })
            );


            typingSent =
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


    if (!typingSent) {
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

                toId:
                    currentUser.id,

                isTyping:
                    false
            })
        );
    }


    typingSent =
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


sidebarOverlay.addEventListener(
    "click",
    closeSidebar
);


/*
=====================================================
FIND
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
            200
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
            200
        );
    }
);


/*
=====================================================
SETTINGS
=====================================================
*/

function openSettings() {

    settingsError.textContent =
        "";


    updateProfileUI();


    settingsBackdrop.classList.remove(
        "hidden"
    );
}


function closeSettingsModal() {

    settingsBackdrop.classList.add(
        "hidden"
    );


    settingsError.textContent =
        "";
}


settingsButton.addEventListener(
    "click",
    openSettings
);


closeSettings.addEventListener(
    "click",
    closeSettingsModal
);


settingsBackdrop.addEventListener(
    "click",
    event => {

        if (
            event.target ===
            settingsBackdrop
        ) {

            closeSettingsModal();
        }
    }
);


/*
=====================================================
THEME
=====================================================
*/

lightThemeButton.addEventListener(
    "click",
    () => {

        applyTheme(
            "light"
        );
    }
);


darkThemeButton.addEventListener(
    "click",
    () => {

        applyTheme(
            "dark"
        );
    }
);


/*
=====================================================
GLASS
=====================================================
*/

glassToggle.addEventListener(
    "change",
    () => {

        applyGlass(
            glassToggle.checked
        );
    }
);


/*
=====================================================
AVATAR
=====================================================
*/

avatarInput.addEventListener(
    "change",
    async () => {

        const file =
            avatarInput.files &&
            avatarInput.files[0];


        if (!file) {
            return;
        }


        if (
            !file.type.startsWith(
                "image/"
            )
        ) {

            settingsError.textContent =
                "Выберите изображение.";

            return;
        }


        try {

            const avatar =
                await resizeImage(
                    file
                );


            profile.avatar =
                avatar;


            setAvatarElement(
                settingsAvatar,
                avatar,
                profile.displayName
            );


            settingsError.textContent =
                "Фото выбрано. Нажмите «Сохранить изменения».";

        } catch {

            settingsError.textContent =
                "Не удалось обработать изображение.";
        }
    }
);


/*
=====================================================
IMAGE RESIZE
=====================================================
*/

function resizeImage(
    file
) {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            const reader =
                new FileReader();


            reader.onload =
                () => {

                    const image =
                        new Image();


                    image.onload =
                        () => {

                            const max =
                                384;


                            let width =
                                image.width;

                            let height =
                                image.height;


                            if (
                                width >
                                height
                            ) {

                                if (
                                    width >
                                    max
                                ) {

                                    height =
                                        Math.round(
                                            height *
                                            max /
                                            width
                                        );

                                    width =
                                        max;
                                }

                            } else {

                                if (
                                    height >
                                    max
                                ) {

                                    width =
                                        Math.round(
                                            width *
                                            max /
                                            height
                                        );

                                    height =
                                        max;
                                }
                            }


                            const canvas =
                                document.createElement(
                                    "canvas"
                                );


                            canvas.width =
                                width;

                            canvas.height =
                                height;


                            const ctx =
                                canvas.getContext(
                                    "2d"
                                );


                            ctx.drawImage(
                                image,
                                0,
                                0,
                                width,
                                height
                            );


                            resolve(
                                canvas.toDataURL(
                                    "image/webp",
                                    0.78
                                )
                            );
                        };


                    image.onerror =
                        reject;


                    image.src =
                        reader.result;
                };


            reader.onerror =
                reject;


            reader.readAsDataURL(
                file
            );
        }
    );
}


/*
=====================================================
SAVE PROFILE
=====================================================
*/

saveProfileButton.addEventListener(
    "click",
    () => {

        settingsError.textContent =
            "";


        const displayName =
            displayNameInput.value
                .trim()
                .slice(0, 40);


        const nickname =
            usernameInput.value
                .trim()
                .replace(
                    /^@/,
                    ""
                )
                .slice(0, 24);


        if (!displayName) {

            settingsError.textContent =
                "Введите имя.";

            return;
        }


        if (
            nickname.length < 2
        ) {

            settingsError.textContent =
                "Введите username.";

            return;
        }


        if (
            !/^[\p{L}\p{N}_.-]+$/u.test(
                nickname
            )
        ) {

            settingsError.textContent =
                "В username разрешены буквы, цифры, _, - и .";

            return;
        }


        if (
            !socket ||
            socket.readyState !==
                WebSocket.OPEN
        ) {

            settingsError.textContent =
                "Нет соединения с сервером.";

            return;
        }


        socket.send(
            JSON.stringify({

                type:
                    "update_profile",

                nickname:
                    nickname,

                displayName:
                    displayName,

                avatar:
                    profile.avatar || ""
            })
        );
    }
);


/*
=====================================================
LOGIN
=====================================================
*/

loginButton.addEventListener(
    "click",
    () => {

        loginError.textContent =
            "";


        const displayName =
            loginDisplayName.value
                .trim()
                .slice(0, 40);


        const nickname =
            loginUsername.value
                .trim()
                .replace(
                    /^@/,
                    ""
                )
                .slice(0, 24);


        if (!displayName) {

            loginError.textContent =
                "Введите имя.";

            loginDisplayName.focus();

            return;
        }


        if (
            nickname.length < 2
        ) {

            loginError.textContent =
                "Введите username.";

            loginUsername.focus();

            return;
        }


        if (
            !/^[\p{L}\p{N}_.-]+$/u.test(
                nickname
            )
        ) {

            loginError.textContent =
                "Username содержит недопустимые символы.";

            loginUsername.focus();

            return;
        }


        profile.displayName =
            displayName;


        profile.nickname =
            nickname;


        saveProfile(
            profile
        );


        if (
            socket &&
            socket.readyState ===
                WebSocket.OPEN
        ) {

            sendLogin();

        } else {

            loginError.textContent =
                "Нет соединения с сервером.";
        }
    }
);


/*
=====================================================
LOGIN ENTER
=====================================================
*/

loginDisplayName.addEventListener(
    "keydown",
    event => {

        if (
            event.key ===
            "Enter"
        ) {

            loginUsername.focus();
        }
    }
);


loginUsername.addEventListener(
    "keydown",
    event => {

        if (
            event.key ===
            "Enter"
        ) {

            loginButton.click();
        }
    }
);


/*
=====================================================
EMOJI
=====================================================
*/

emojiButton.addEventListener(
    "click",
    event => {

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
    event => {

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
    event => {

        if (
            event.key ===
            "Escape"
        ) {

            closeSidebar();

            closeSettingsModal();

            emojiPanel.classList.remove(
                "open"
            );
        }
    }
);


/*
=====================================================
SWIPE SIDEBAR
=====================================================
*/

let touchStartX =
    0;

let touchStartY =
    0;


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


        const dx =
            touch.clientX -
            touchStartX;


        const dy =
            touch.clientY -
            touchStartY;


        const horizontal =
            Math.abs(dx) >
            Math.abs(dy);


        if (
            horizontal &&
            touchStartX < 35 &&
            dx > 70
        ) {

            openSidebar();
        }


        if (
            horizontal &&
            sidebar.classList.contains(
                "open"
            ) &&
            dx < -70
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

            messages.scrollTop =
                messages.scrollHeight;
        }
    );
}


/*
=====================================================
START
=====================================================
*/

updateProfileUI();

connect();
