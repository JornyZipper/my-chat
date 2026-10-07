/*
=====================================================
ELEMENTS
=====================================================
*/

const sidebar =
    document.getElementById("sidebar");

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

const headerSearchButton =
    document.getElementById(
        "headerSearchButton"
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
PROFILE STORAGE
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


function getProfile() {

    try {

        const saved =
            localStorage.getItem(
                "my_chat_profile"
            );


        if (!saved) {
            return null;
        }


        return JSON.parse(
            saved
        );

    } catch {

        return null;
    }
}


function saveProfile(profile) {

    localStorage.setItem(
        "my_chat_profile",
        JSON.stringify(
            profile
        )
    );
}


let profile =
    getProfile();


/*
=====================================================
INITIAL PROFILE
=====================================================
*/

if (!profile) {

    const nickname =
        prompt(
            "Придумай свой @username\n\nНапример: Z1pperJ"
        );


    let safeNickname =
        String(
            nickname ||
            "User" +
                Math.floor(
                    Math.random() *
                    9999
                )
        )
            .trim()
            .replace(
                /[^a-zA-Zа-яА-ЯёЁ0-9_.-]/g,
                ""
            )
            .slice(0, 24);


    if (
        safeNickname.length < 2
    ) {

        safeNickname =
            "User" +
            Math.floor(
                Math.random() *
                9999
            );
    }


    profile = {

        id:
            makeId(),

        nickname:
            safeNickname,

        displayName:
            safeNickname,

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


function applyTheme(theme) {

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


    /*
    Меняем mobile browser
    theme-color.
    */

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


function applyGlass(enabled) {

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
UI PROFILE
=====================================================
*/

function isVerified() {

    return (
        normalize(
            profile.nickname
        ) ===
        "z1ipperj"
    );
}


function normalize(value) {

    return String(
        value || ""
    )
        .trim()
        .toLowerCase();
}


function firstLetter(value) {

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
        isVerified();


    profileDisplayName.textContent =
        profile.displayName;


    profileUsername.textContent =
        "@" +
        profile.nickname;


    setAvatarElement(
        profileAvatar,
        profile.avatar,
        profile.displayName
    );


    profileVerified.classList.toggle(
        "hidden",
        !verified
    );


    settingsProfileName.textContent =
        profile.displayName;


    settingsProfileUsername.textContent =
        "@" +
        profile.nickname;


    settingsVerified.classList.toggle(
        "hidden",
        !verified
    );


    displayNameInput.value =
        profile.displayName;


    usernameInput.value =
        profile.nickname;


    setAvatarElement(
        settingsAvatar,
        profile.avatar,
        profile.displayName
    );


    /*
    Если открыт собственный профиль
    */

    if (
        !currentUser
    ) {
        return;
    }
}


/*
=====================================================
WEBSOCKET
=====================================================
*/

let socket = null;

let reconnectDelay =
    1000;

let users = [];

let currentUser = null;

let typingTimer = null;

let remoteTypingTimer = null;

let typingSent = false;


/*
=====================================================
CONNECT
=====================================================
*/

function connect() {

    statusElement.textContent =
        currentUser
            ? "подключение..."
            : "подключение...";


    const protocol =
        location.protocol === "https:"
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
    );


    socket.addEventListener(
        "message",
        handleSocketMessage
    );


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
SOCKET DATA
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
        LOGIN
        =============================================
        */

        if (
            data.type ===
            "login_ok"
        ) {

            profile =
                normalizeProfile(
                    data.profile
                );


            saveProfile(
                profile
            );


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

            settingsError.textContent =
                data.error ||
                "Ошибка входа.";

            openSettings();

            return;
        }


        /*
        =============================================
        PROFILE
        =============================================
        */

        if (
            data.type ===
            "profile_ok"
        ) {

            profile =
                normalizeProfile(
                    data.profile
                );


            saveProfile(
                profile
            );


            updateProfileUI();


            settingsError.textContent =
                "Изменения сохранены.";


            renderUsers();


            if (currentUser) {

                const found =
                    users.find(
                        user =>
                            user.id ===
                            currentUser.id
                    );


                if (found) {

                    currentUser =
                        found;

                    updateChatHeader();
                }
            }


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
                "Не удалось сохранить профиль.";

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


            renderUsers();


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
            Если это наше сообщение —
            выключаем typing.
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
                    "печатает…";


                remoteTypingTimer =
                    setTimeout(
                        () => {

                            updateChatHeader();

                        },
                        1800
                    );

            } else {

                updateChatHeader();
            }


            return;
        }


    } catch (error) {

        console.error(
            error
        );
    }
}


/*
=====================================================
PROFILE NORMALIZE
=====================================================
*/

function normalizeProfile(
    incoming
) {

    return {

        id:
            incoming.id ||
            profile.id,

        nickname:
            incoming.nickname ||
            profile.nickname,

        displayName:
            incoming.displayName ||
            incoming.nickname ||
            profile.displayName,

        avatar:
            incoming.avatar ||
            "",

        verified:
            Boolean(
                incoming.verified
            )
    };
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
            .toLowerCase();


    const filtered =
        users
            .filter(
                user =>
                    user.id !==
                    profile.id
            )
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
        filtered.length === 0
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
CREATE USER ITEM
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


    const nameLine =
        document.createElement(
            "div"
        );


    nameLine.className =
        "user-name-line";


    const displayName =
        document.createElement(
            "div"
        );


    displayName.className =
        "user-name";


    displayName.textContent =
        user.displayName;


    nameLine.appendChild(
        displayName
    );


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


    const nickname =
        document.createElement(
            "div"
        );


    nickname.className =
        "user-username";


    nickname.textContent =
        "@" +
        user.nickname;


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


    updateChatHeader();


    clearTimeout(
        remoteTypingTimer
    );


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
CHAT HEADER
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


function updateChatHeader() {

    if (!currentUser) {

        headerName.textContent =
            "Личные сообщения";

        statusElement.textContent =
            "Выберите пользователя";


        setAvatarElement(
            headerAvatar,
            "",
            "?"
        );


        return;
    }


    headerName.textContent =
        currentUser.displayName +
        (
            currentUser.verified
                ? "  ✓"
                : ""
        );


    statusElement.textContent =
        getCurrentUserStatus();


    setAvatarElement(
        headerAvatar,
        currentUser.avatar,
        currentUser.displayName
    );
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
SEND
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
    renderUsers
);


/*
=====================================================
MOBILE SIDEBAR
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
THEME BUTTONS
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
                "Нужен файл изображения.";

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
                "Фото выбрано. Нажми «Сохранить изменения».";

        } catch {

            settingsError.textContent =
                "Не удалось обработать изображение.";
        }
    }
);


/*
=====================================================
RESIZE IMAGE
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

                    const img =
                        new Image();


                    img.onload =
                        () => {

                            const max =
                                384;


                            let width =
                                img.width;

                            let height =
                                img.height;


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
                                img,
                                0,
                                0,
                                width,
                                height
                            );


                            /*
                            WebP поддерживается
                            современными браузерами.
                            */

                            resolve(
                                canvas.toDataURL(
                                    "image/webp",
                                    0.78
                                )
                            );
                        };


                    img.onerror =
                        reject;


                    img.src =
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


        if (
            nickname.length < 2
        ) {

            settingsError.textContent =
                "Username слишком короткий.";

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
            !displayName
        ) {

            settingsError.textContent =
                "Введите имя.";

            return;
        }


        /*
        Обновляем локально,
        но сервер подтверждает
        изменение username.
        */

        const newProfile = {

            ...profile,

            nickname:

                nickname,

            displayName:

                displayName,

            avatar:

                profile.avatar || ""
        };


        if (
            socket &&
            socket.readyState ===
                WebSocket.OPEN
        ) {

            socket.send(
                JSON.stringify({

                    type:
                        "update_profile",

                    nickname:
                        nickname,

                    displayName:
                        displayName,

                    avatar:
                        newProfile.avatar
                })
            );

        } else {

            settingsError.textContent =
                "Нет соединения с сервером.";

            return;
        }


        /*
        Локально тоже сохраняем.
        */

        profile =
            newProfile;


        saveProfile(
            profile
        );


        updateProfileUI();
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
SWIPE MENU
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
