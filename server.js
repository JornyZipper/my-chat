const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;


/*
=====================================================
DATA
=====================================================
*/

// id -> profile
const users = new Map();

// nickname -> id
const nicknames = new Map();

// id -> websocket
const onlineUsers = new Map();

// conversationId -> messages
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
        String(value || "")
            .trim();


    if (
        nickname.length < 2 ||
        nickname.length > 24
    ) {
        return false;
    }


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

    return name || "Пользователь";
}


function cleanAvatar(value) {

    const avatar =
        String(value || "");


    /*
    Разрешаем только data:image/*
    */

    if (
        !avatar.startsWith(
            "data:image/"
        )
    ) {
        return "";
    }


    /*
    Ограничение размера примерно 500 KB.
    */

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
    profile,
    online = false
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
            Boolean(online)
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
                profile,
                onlineUsers.has(
                    profile.id
                )
            )
        );
    }


    result.sort(
        (a, b) => {

            if (
                a.online !==
                b.online
            ) {
                return a.online
                    ? -1
                    : 1;
            }


            return (
                a.nickname.localeCompare(
                    b.nickname
                )
            );
        }
    );


    return result;
}


function broadcastUsers() {

    const list =
        getAllUsers();


    for (
        const ws
        of onlineUsers.values()
    ) {

        send(
            ws,
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
STATIC
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

        ws.userId = null;


        console.log(
            "New websocket connection"
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
                                        "Ник должен содержать от 2 до 24 символов."
                                }
                            );

                            return;
                        }


                        const nicknameKey =
                            normalize(
                                nickname
                            );


                        const existingId =
                            nicknames.get(
                                nicknameKey
                            );


                        /*
                        Ник уже занят другим пользователем.
                        */

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
                                        "Этот ник уже занят."
                                }
                            );

                            return;
                        }


                        /*
                        Если этот пользователь
                        уже онлайн — отключаем
                        старое соединение.
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
                        Получаем старый профиль.
                        */

                        let profile =
                            users.get(id);


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
                            Убираем старый ник
                            из индекса.
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


                        send(
                            ws,
                            {
                                type:
                                    "login_ok",

                                profile:
                                    profileForClient(
                                        profile,
                                        true
                                    )
                            }
                        );


                        send(
                            ws,
                            {
                                type:
                                    "users",

                                users:
                                    getAllUsers()
                            }
                        );


                        broadcastUsers();


                        console.log(
                            `${nickname} connected`
                        );


                        return;
                    }


                    /*
                    =================================
                    AUTH REQUIRED
                    =================================
                    */

                    if (!ws.userId) {

                        send(
                            ws,
                            {
                                type:
                                    "error",

                                error:
                                    "Сначала войдите в профиль."
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
                                        "Неверный ник."
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
                                        "Этот ник уже занят."
                                }
                            );

                            return;
                        }


                        /*
                        Старый nickname index
                        */

                        const oldKey =
                            normalize(
                                profile.nickname
                            );


                        if (
                            nicknames.get(
                                oldKey
                            ) ===
                            ws.userId
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


                        const online =
                            onlineUsers.get(
                                ws.userId
                            );


                        if (online) {

                            online.profile =
                                profile;
                        }


                        ws.nickname =
                            newNickname;


                        send(
                            ws,
                            {
                                type:
                                    "profile_ok",

                                profile:
                                    profileForClient(
                                        profile,
                                        true
                                    )
                            }
                        );


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


                        const key =
                            conversationKey(
                                ws.userId,
                                targetId
                            );


                        const history =
                            conversations.get(
                                key
                            ) || [];


                        send(
                            ws,
                            {
                                type:
                                    "history",

                                withId:
                                    targetId,

                                messages:
                                    history
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


                        if (
                            conversation.length >
                            500
                        ) {

                            conversation.shift();
                        }


                        /*
                        Получатель
                        */

                        const recipientOnline =
                            onlineUsers.get(
                                recipient.id
                            );


                        if (
                            recipientOnline
                        ) {

                            send(
                                recipientOnline.ws,
                                {
                                    type:
                                        "message",

                                    message
                                }
                            );
                        }


                        /*
                        Отправитель
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


                        if (!targetId) {
                            return;
                        }


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
                        "WebSocket error:",
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


                if (
                    current &&
                    current.ws === ws
                ) {

                    onlineUsers.delete(
                        ws.userId
                    );


                    broadcastUsers();
                }


                console.log(
                    `${ws.nickname || "User"} disconnected`
                );
            }
        );
    }
);


/*
=====================================================
STATUS
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
            `My Chat v2 running on port ${PORT}`
        );
    }
);
