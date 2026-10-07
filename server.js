const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;


/*
=====================================================
STORAGE
=====================================================
*/

// Все пользователи, которые заходили на сервер
const users = new Map();

// nickname -> userId
const nicknames = new Map();

// userId -> { ws, profile }
const onlineUsers = new Map();

// conversation key -> messages[]
const conversations = new Map();


/*
=====================================================
HELPERS
=====================================================
*/

function normalize(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}


function send(ws, data) {
    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(
            JSON.stringify(data)
        );
    }
}


function validNickname(value) {
    const nickname =
        String(value || "").trim();

    if (
        nickname.length < 2 ||
        nickname.length > 24
    ) {
        return false;
    }

    // Буквы, цифры, _, -, .
    return /^[\p{L}\p{N}_.-]+$/u.test(
        nickname
    );
}


function cleanNickname(value) {
    return String(value || "")
        .trim()
        .slice(0, 24);
}


function cleanDisplayName(value) {
    const name =
        String(value || "")
            .trim()
            .slice(0, 40);

    return name || "";
}


function cleanAvatar(value) {
    const avatar =
        String(value || "");

    if (!avatar) {
        return "";
    }

    if (
        !avatar.startsWith(
            "data:image/"
        )
    ) {
        return "";
    }

    // Около 500 KB
    if (
        avatar.length > 500000
    ) {
        return "";
    }

    return avatar;
}


function isVerified(nickname) {
    return (
        normalize(nickname) ===
        "z1ipperj"
    );
}


function conversationKey(
    firstId,
    secondId
) {
    return [
        String(firstId),
        String(secondId)
    ]
        .sort()
        .join(":");
}


function profileForClient(
    profile
) {
    if (!profile) {
        return null;
    }

    return {
        id:
            profile.id,

        nickname:
            profile.nickname,

        displayName:
            profile.displayName,

        avatar:
            profile.avatar || "",

        verified:
            Boolean(
                profile.verified
            ),

        online:
            onlineUsers.has(
                profile.id
            )
    };
}


function getAllUsers() {
    const result = [];

    for (
        const profile
        of users.values()
    ) {
        result.push(
            profileForClient(
                profile
            )
        );
    }

    result.sort(
        (a, b) => {

            // Сначала онлайн
            if (
                a.online !==
                b.online
            ) {
                return a.online
                    ? -1
                    : 1;
            }

            // Потом по имени
            return a.displayName
                .localeCompare(
                    b.displayName
                );
        }
    );

    return result;
}


function broadcastUsers() {

    const list =
        getAllUsers();

    for (
        const item
        of onlineUsers.values()
    ) {
        send(
            item.ws,
            {
                type:
                    "users",

                users:
                    list
            }
        );
    }
}


/*
=====================================================
STATIC WEBSITE
=====================================================
*/

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


/*
=====================================================
WEBSOCKET
=====================================================
*/

const wss =
    new WebSocket.Server({
        server,
        path: "/ws"
    });


wss.on(
    "connection",
    (ws) => {

        ws.userId =
            null;

        ws.nickname =
            null;

        /*
        Heartbeat
        */

        ws.isAlive =
            true;


        ws.on(
            "pong",
            () => {

                ws.isAlive =
                    true;
            }
        );


        /*
        =============================================
        MESSAGE
        =============================================
        */

        ws.on(
            "message",
            (raw) => {

                try {

                    const data =
                        JSON.parse(
                            raw.toString()
                        );


                    /*
                    =================================
                    LOGIN
                    =================================
                    */

                    if (
                        data.type ===
                        "login"
                    ) {

                        const id =
                            String(
                                data.id || ""
                            ).trim();


                        const nickname =
                            cleanNickname(
                                data.nickname
                            );


                        const displayName =
                            cleanDisplayName(
                                data.displayName
                            );


                        const avatar =
                            cleanAvatar(
                                data.avatar
                            );


                        /*
                        Нельзя войти пустым
                        */

                        if (!id) {

                            send(
                                ws,
                                {
                                    type:
                                        "login_error",

                                    error:
                                        "Не удалось определить профиль."
                                }
                            );

                            return;
                        }


                        if (
                            !displayName
                        ) {

                            send(
                                ws,
                                {
                                    type:
                                        "login_error",

                                    error:
                                        "Введите имя."
                                }
                            );

                            return;
                        }


                        if (
                            !validNickname(
                                nickname
                            )
                        ) {

                            send(
                                ws,
                                {
                                    type:
                                        "login_error",

                                    error:
                                        "Username должен содержать от 2 до 24 символов."
                                }
                            );

                            return;
                        }


                        const nicknameKey =
                            normalize(
                                nickname
                            );


                        /*
                        Username должен быть уникальным
                        */

                        const existingId =
                            nicknames.get(
                                nicknameKey
                            );


                        if (
                            existingId &&
                            existingId !== id
                        ) {

                            send(
                                ws,
                                {
                                    type:
                                        "login_error",

                                    error:
                                        "Этот username уже занят."
                                }
                            );

                            return;
                        }


                        /*
                        Если пользователь уже
                        вошёл с другого устройства,
                        закрываем старое соединение.
                        */

                        const previous =
                            onlineUsers.get(
                                id
                            );


                        if (
                            previous &&
                            previous.ws !== ws
                        ) {

                            try {
                                previous.ws.close();
                            } catch {}

                            onlineUsers.delete(
                                id
                            );
                        }


                        /*
                        Получаем существующий профиль
                        */

                        let profile =
                            users.get(
                                id
                            );


                        if (!profile) {

                            profile = {

                                id,

                                nickname,

                                displayName,

                                avatar,

                                verified:
                                    isVerified(
                                        nickname
                                    )
                            };

                        } else {

                            /*
                            Удаляем старый username
                            */

                            const oldKey =
                                normalize(
                                    profile.nickname
                                );


                            if (
                                nicknames.get(
                                    oldKey
                                ) === id
                            ) {

                                nicknames.delete(
                                    oldKey
                                );
                            }


                            profile.nickname =
                                nickname;

                            profile.displayName =
                                displayName;

                            profile.avatar =
                                avatar;

                            profile.verified =
                                isVerified(
                                    nickname
                                );
                        }


                        users.set(
                            id,
                            profile
                        );


                        nicknames.set(
                            nicknameKey,
                            id
                        );


                        ws.userId =
                            id;

                        ws.nickname =
                            nickname;


                        onlineUsers.set(
                            id,
                            {
                                ws,
                                profile
                            }
                        );


                        /*
                        Ответ самому пользователю
                        */

                        send(
                            ws,
                            {
                                type:
                                    "login_ok",

                                profile:
                                    profileForClient(
                                        profile
                                    )
                            }
                        );


                        /*
                        Всем отправляем новый список
                        */

                        broadcastUsers();


                        console.log(
                            `${nickname} is online`
                        );


                        return;
                    }


                    /*
                    =================================
                    AUTH CHECK
                    =================================
                    */

                    if (!ws.userId) {

                        send(
                            ws,
                            {
                                type:
                                    "error",

                                error:
                                    "Сначала нужно войти."
                            }
                        );

                        return;
                    }


                    /*
                    =================================
                    UPDATE PROFILE
                    =================================
                    */

                    if (
                        data.type ===
                        "update_profile"
                    ) {

                        const profile =
                            users.get(
                                ws.userId
                            );


                        if (!profile) {
                            return;
                        }


                        const newNickname =
                            cleanNickname(
                                data.nickname
                            );


                        const newDisplayName =
                            cleanDisplayName(
                                data.displayName
                            );


                        const newAvatar =
                            cleanAvatar(
                                data.avatar
                            );


                        if (
                            !newDisplayName
                        ) {

                            send(
                                ws,
                                {
                                    type:
                                        "profile_error",

                                    error:
                                        "Имя не может быть пустым."
                                }
                            );

                            return;
                        }


                        if (
                            !validNickname(
                                newNickname
                            )
                        ) {

                            send(
                                ws,
                                {
                                    type:
                                        "profile_error",

                                    error:
                                        "Неверный username."
                                }
                            );

                            return;
                        }


                        const newKey =
                            normalize(
                                newNickname
                            );


                        const existingId =
                            nicknames.get(
                                newKey
                            );


                        if (
                            existingId &&
                            existingId !==
                                ws.userId
                        ) {

                            send(
                                ws,
                                {
                                    type:
                                        "profile_error",

                                    error:
                                        "Этот username уже занят."
                                }
                            );

                            return;
                        }


                        const oldKey =
                            normalize(
                                profile.nickname
                            );


                        if (
                            nicknames.get(
                                oldKey
                            ) === ws.userId
                        ) {

                            nicknames.delete(
                                oldKey
                            );
                        }


                        profile.nickname =
                            newNickname;

                        profile.displayName =
                            newDisplayName;

                        profile.avatar =
                            newAvatar;

                        profile.verified =
                            isVerified(
                                newNickname
                            );


                        users.set(
                            ws.userId,
                            profile
                        );


                        nicknames.set(
                            newKey,
                            ws.userId
                        );


                        ws.nickname =
                            newNickname;


                        const online =
                            onlineUsers.get(
                                ws.userId
                            );


                        if (online) {

                            online.profile =
                                profile;
                        }


                        send(
                            ws,
                            {
                                type:
                                    "profile_ok",

                                profile:
                                    profileForClient(
                                        profile
                                    )
                            }
                        );


                        /*
                        Мгновенно обновляем
                        всех онлайн-пользователей.
                        */

                        broadcastUsers();


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

                        const targetId =
                            String(
                                data.withId || ""
                            ).trim();


                        if (!targetId) {
                            return;
                        }


                        const target =
                            users.get(
                                targetId
                            );


                        if (!target) {
                            return;
                        }


                        const key =
                            conversationKey(
                                ws.userId,
                                targetId
                            );


                        send(
                            ws,
                            {
                                type:
                                    "history",

                                withId:
                                    targetId,

                                messages:
                                    conversations.get(
                                        key
                                    ) || []
                            }
                        );


                        return;
                    }


                    /*
                    =================================
                    SEND MESSAGE
                    =================================
                    */

                    if (
                        data.type ===
                        "message"
                    ) {

                        const targetId =
                            String(
                                data.toId || ""
                            ).trim();


                        const text =
                            String(
                                data.text || ""
                            )
                                .trim()
                                .slice(
                                    0,
                                    4000
                                );


                        if (
                            !targetId ||
                            !text
                        ) {
                            return;
                        }


                        const sender =
                            users.get(
                                ws.userId
                            );


                        const recipient =
                            users.get(
                                targetId
                            );


                        if (
                            !sender ||
                            !recipient
                        ) {
                            return;
                        }


                        const message = {

                            id:
                                `${Date.now()}-${Math.random()}`,

                            fromId:
                                sender.id,

                            toId:
                                recipient.id,

                            from:
                                sender.nickname,

                            fromDisplayName:
                                sender.displayName,

                            fromAvatar:
                                sender.avatar || "",

                            verified:
                                Boolean(
                                    sender.verified
                                ),

                            text,

                            time:
                                new Date()
                                    .toISOString()
                        };


                        const key =
                            conversationKey(
                                sender.id,
                                recipient.id
                            );


                        if (
                            !conversations.has(
                                key
                            )
                        ) {

                            conversations.set(
                                key,
                                []
                            );
                        }


                        const conversation =
                            conversations.get(
                                key
                            );


                        conversation.push(
                            message
                        );


                        /*
                        Максимум 500 сообщений
                        */

                        if (
                            conversation.length >
                            500
                        ) {

                            conversation.shift();
                        }


                        /*
                        Отправляем получателю
                        */

                        const target =
                            onlineUsers.get(
                                recipient.id
                            );


                        if (target) {

                            send(
                                target.ws,
                                {
                                    type:
                                        "message",

                                    message
                                }
                            );
                        }


                        /*
                        Отправляем отправителю
                        */

                        send(
                            ws,
                            {
                                type:
                                    "message",

                                message
                            }
                        );


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

                        const targetId =
                            String(
                                data.toId || ""
                            ).trim();


                        const target =
                            onlineUsers.get(
                                targetId
                            );


                        if (!target) {
                            return;
                        }


                        send(
                            target.ws,
                            {
                                type:
                                    "typing",

                                fromId:
                                    ws.userId,

                                fromNickname:
                                    ws.nickname,

                                isTyping:
                                    Boolean(
                                        data.isTyping
                                    )
                            }
                        );


                        return;
                    }


                } catch (error) {

                    console.error(
                        "Socket error:",
                        error
                    );
                }
            }
        );


        /*
        =============================================
        DISCONNECT
        =============================================
        */

        ws.on(
            "close",
            () => {

                if (!ws.userId) {
                    return;
                }


                const current =
                    onlineUsers.get(
                        ws.userId
                    );


                /*
                Старое соединение
                не должно отключать
                новое соединение.
                */

                if (
                    current &&
                    current.ws === ws
                ) {

                    onlineUsers.delete(
                        ws.userId
                    );


                    /*
                    Сразу обновляем
                    статус у всех.
                    */

                    broadcastUsers();


                    console.log(
                        `${ws.nickname} is offline`
                    );
                }
            }
        );
    }
);


/*
=====================================================
HEARTBEAT
=====================================================
*/

const heartbeat =
    setInterval(
        () => {

            for (
                const ws
                of wss.clients
            ) {

                if (
                    ws.isAlive === false
                ) {

                    try {
                        ws.terminate();
                    } catch {}

                    continue;
                }


                ws.isAlive =
                    false;


                try {

                    ws.ping();

                } catch {}
            }

        },
        15000
    );


wss.on(
    "close",
    () => {

        clearInterval(
            heartbeat
        );
    }
);


/*
=====================================================
STATUS API
=====================================================
*/

app.get(
    "/api/status",
    (req, res) => {

        res.json({

            online:
                true,

            users:
                users.size,

            onlineUsers:
                onlineUsers.size,

            conversations:
                conversations.size
        });
    }
);


/*
=====================================================
START
=====================================================
*/

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `My Chat running on port ${PORT}`
        );
    }
);
