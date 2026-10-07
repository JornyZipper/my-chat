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

// Сейчас данные живут в памяти сервера.
// Позже можно подключить PostgreSQL.

const onlineUsers = new Map();
// normalized nickname -> { nickname, ws }

const knownUsers = new Map();
// normalized nickname -> nickname

const conversations = new Map();
// "user1|user2" -> messages


/*
=====================================================
HELPERS
=====================================================
*/

function normalizeNickname(nickname) {
    return String(nickname || "")
        .trim()
        .toLowerCase();
}


function validNickname(nickname) {

    const value = String(nickname || "").trim();

    if (value.length < 2) {
        return false;
    }

    if (value.length > 24) {
        return false;
    }

    // Буквы любых языков, цифры, _, -, .
    return /^[\p{L}\p{N}_.-]+$/u.test(value);
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


function conversationKey(a, b) {

    const first =
        normalizeNickname(a);

    const second =
        normalizeNickname(b);

    return [
        first,
        second
    ]
        .sort()
        .join("|");
}


function broadcastUserList() {

    const users = [];

    for (const nickname of knownUsers.values()) {

        const key =
            normalizeNickname(nickname);

        users.push({
            nickname,
            online:
                onlineUsers.has(key)
        });
    }


    for (const {
        ws
    } of onlineUsers.values()) {

        send(
            ws,
            {
                type: "users",
                users
            }
        );
    }
}


/*
=====================================================
STATIC SITE
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

        ws.nickname = null;


        console.log(
            "WebSocket connection"
        );


        /*
        =============================================
        MESSAGE HANDLER
        =============================================
        */

        ws.on(
            "message",
            (rawData) => {

                try {

                    const data =
                        JSON.parse(
                            rawData.toString()
                        );


                    /*
                    =================================
                    LOGIN
                    =================================
                    */

                    if (
                        data.type === "login"
                    ) {

                        const nickname =
                            String(
                                data.nickname || ""
                            ).trim();


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
                                        "Ник должен содержать от 2 до 24 символов. Разрешены буквы, цифры, _, -, ."
                                }
                            );

                            return;
                        }


                        const normalized =
                            normalizeNickname(
                                nickname
                            );


                        if (
                            onlineUsers.has(
                                normalized
                            )
                        ) {

                            send(
                                ws,
                                {
                                    type:
                                        "login_error",
                                    error:
                                        "Этот ник уже используется."
                                }
                            );

                            return;
                        }


                        ws.nickname =
                            nickname;


                        onlineUsers.set(
                            normalized,
                            {
                                nickname,
                                ws
                            }
                        );


                        knownUsers.set(
                            normalized,
                            nickname
                        );


                        send(
                            ws,
                            {
                                type:
                                    "login_ok",
                                nickname
                            }
                        );


                        broadcastUserList();


                        console.log(
                            `${nickname} connected`
                        );

                        return;
                    }


                    /*
                    =================================
                    EVERYTHING BELOW REQUIRES LOGIN
                    =================================
                    */

                    if (!ws.nickname) {

                        send(
                            ws,
                            {
                                type: "error",
                                error:
                                    "Сначала нужно войти."
                            }
                        );

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

                        const withUser =
                            String(
                                data.with || ""
                            ).trim();


                        if (!withUser) {
                            return;
                        }


                        const key =
                            conversationKey(
                                ws.nickname,
                                withUser
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
                                with:
                                    withUser,
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

                        const recipient =
                            String(
                                data.to || ""
                            ).trim();


                        const text =
                            String(
                                data.text || ""
                            ).trim()
                            .slice(0, 4000);


                        if (!recipient) {
                            return;
                        }

                        if (!text) {
                            return;
                        }


                        const message = {

                            id:
                                `${Date.now()}-${Math.random()}`,

                            from:
                                ws.nickname,

                            to:
                                recipient,

                            text:

                                text,

                            time:
                                new Date()
                                    .toISOString()
                        };


                        const key =
                            conversationKey(
                                ws.nickname,
                                recipient
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


                        // максимум 500 сообщений на диалог

                        if (
                            conversation.length >
                            500
                        ) {

                            conversation.shift();
                        }


                        const recipientKey =
                            normalizeNickname(
                                recipient
                            );


                        const recipientUser =
                            onlineUsers.get(
                                recipientKey
                            );


                        /*
                        =================================
                        SEND TO RECIPIENT
                        =================================
                        */

                        if (
                            recipientUser
                        ) {

                            send(
                                recipientUser.ws,
                                {
                                    type:
                                        "message",
                                    message
                                }
                            );
                        }


                        /*
                        =================================
                        SEND TO SENDER
                        =================================
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

                        const recipient =
                            String(
                                data.to || ""
                            ).trim();


                        const recipientKey =
                            normalizeNickname(
                                recipient
                            );


                        const recipientUser =
                            onlineUsers.get(
                                recipientKey
                            );


                        if (
                            recipientUser
                        ) {

                            send(
                                recipientUser.ws,
                                {
                                    type:
                                        "typing",
                                    from:
                                        ws.nickname,
                                    isTyping:
                                        Boolean(
                                            data.isTyping
                                        )
                                }
                            );
                        }


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
        DISCONNECT
        =============================================
        */

        ws.on(
            "close",
            () => {

                if (!ws.nickname) {
                    return;
                }


                const key =
                    normalizeNickname(
                        ws.nickname
                    );


                const current =
                    onlineUsers.get(
                        key
                    );


                // Только если это тот же connection

                if (
                    current &&
                    current.ws === ws
                ) {

                    onlineUsers.delete(
                        key
                    );
                }


                broadcastUserList();


                console.log(
                    `${ws.nickname} disconnected`
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

            onlineUsers:
                onlineUsers.size,

            knownUsers:
                knownUsers.size
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
