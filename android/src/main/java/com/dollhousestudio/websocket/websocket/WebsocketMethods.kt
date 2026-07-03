// Native WebSocket Sparkling Method — Android (OkHttp).
// Verified to compile against sparkling-method 2.0.1 + AGP 7.4.2 / JDK 11.
// Runtime + registration still need on-device validation.

package com.dollhousestudio.websocket.websocket

import com.dollhousestudio.websocket.websocket.close.Websocket.close.AbsCloseMethodIDL
import com.dollhousestudio.websocket.websocket.connect.Websocket.connect.AbsConnectMethodIDL
import com.dollhousestudio.websocket.websocket.send.Websocket.send.AbsSendMethodIDL
import com.tiktok.sparkling.method.registry.core.BridgePlatformType
import com.tiktok.sparkling.method.registry.core.model.idl.CompletionBlock
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import android.util.Log
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

private const val EVENT = "Websocket.event"
private const val OK = 1
private const val FAIL = 0
private const val TAG = "WSNative"

/** Holds live sockets keyed by id and fans native callbacks out as JS events. */
internal object WebsocketManager {
    private val client by lazy { OkHttpClient.Builder().build() }
    private val sockets = ConcurrentHashMap<String, WebSocket>()
    // Each socket gets its own emitter tied to the LynxView that
    // called `connect`. A single shared emitter would dispatch the
    // second page's events back to the first page's view after
    // navigation (since pages live in the same process / share this
    // singleton manager).
    private val emitters = ConcurrentHashMap<String, (JSONObject) -> Unit>()

    private fun emit(socketId: String, event: String, extra: Map<String, Any> = emptyMap()) {
        val json = JSONObject().apply {
            put("socketId", socketId)
            put("event", event)
            extra.forEach { (k, v) -> put(k, v) }
        }
        emitters[socketId]?.invoke(json)
    }

    fun connect(url: String, protocols: List<String>, emitter: (JSONObject) -> Unit): String {
        val socketId = UUID.randomUUID().toString()
        emitters[socketId] = emitter
        Log.d(TAG, "connect $url ($socketId) emittersBound=${emitters.size}")
        val builder = Request.Builder().url(url)
        if (protocols.isNotEmpty()) {
            builder.header("Sec-WebSocket-Protocol", protocols.joinToString(", "))
        }
        val ws = client.newWebSocket(builder.build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "onOpen $socketId resp=${response.code}")
                emit(socketId, "open")
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                emit(socketId, "message", mapOf("data" to text))
            }
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                // gzip + compress-json RPC responses arrive here as binary.
                emit(socketId, "message", mapOf("data" to bytes.base64(), "binary" to true))
            }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "onClosing $socketId $code $reason")
                webSocket.close(code, reason)
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "onClosed $socketId $code $reason")
                sockets.remove(socketId)
                emit(socketId, "close", mapOf("code" to code, "reason" to reason))
                emitters.remove(socketId)
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "onFailure $socketId ${t.javaClass.simpleName}: ${t.message} resp=${response?.code}")
                sockets.remove(socketId)
                emit(socketId, "error", mapOf("reason" to (t.message ?: "failure")))
                emit(socketId, "close", mapOf("code" to 1006, "reason" to (t.message ?: "failure")))
                emitters.remove(socketId)
            }
        })
        sockets[socketId] = ws
        return socketId
    }

    fun send(socketId: String, data: String): Boolean = sockets[socketId]?.send(data) ?: false

    fun close(socketId: String, code: Int?, reason: String?) {
        sockets.remove(socketId)?.close(code ?: 1000, reason ?: "")
        emitters.remove(socketId)
    }
}

class WebsocketConnectMethod : AbsConnectMethodIDL() {
    override fun handle(
        params: AbsConnectMethodIDL.IDLMethodConnectInputModel,
        callback: CompletionBlock<AbsConnectMethodIDL.IDLMethodConnectResultModel>,
        type: BridgePlatformType,
    ) {
        // bridge.sendEvent → lynxView.sendGlobalEvent reaches the JS
        // GlobalEventEmitter that pipe.on('Websocket.event') subscribes
        // to. We capture the calling page's bridge per-socket so each
        // socket's events fan out to the right LynxView even when
        // multiple pages share this process.
        val bridge = getSDKContext()?.bridge
        val socketId = WebsocketManager.connect(
            params.url,
            params.protocols ?: emptyList(),
        ) { json -> bridge?.sendEvent(EVENT, json) }
        val data = object : AbsConnectMethodIDL.PipeBeanConnectData {
            override var socketId: String? = socketId
            override fun convert(): Map<String, Any>? = mapOf("socketId" to socketId!!)
            override fun toJSON(): JSONObject = JSONObject().put("socketId", socketId ?: "")
        }
        val result = object : AbsConnectMethodIDL.IDLMethodConnectResultModel {
            override var code: Number? = OK
            override var msg: String? = "ok"
            override var data: AbsConnectMethodIDL.PipeBeanConnectData? = data
            override fun convert(): Map<String, Any>? =
                mapOf("code" to OK, "msg" to "ok", "data" to (data.convert() ?: emptyMap()))
            override fun toJSON(): JSONObject =
                JSONObject().put("code", OK).put("msg", "ok").put("data", data?.toJSON() ?: JSONObject())
        }
        callback.onSuccess(result, "ok")
    }
}

class WebsocketSendMethod : AbsSendMethodIDL() {
    override fun handle(
        params: AbsSendMethodIDL.IDLMethodSendInputModel,
        callback: CompletionBlock<AbsSendMethodIDL.IDLMethodSendResultModel>,
        type: BridgePlatformType,
    ) {
        val ok = WebsocketManager.send(params.socketId, params.data)
        val code = if (ok) OK else FAIL
        val msg = if (ok) "ok" else "socket not found"
        val result = object : AbsSendMethodIDL.IDLMethodSendResultModel {
            override var code: Number? = code
            override var msg: String? = msg
            override fun convert(): Map<String, Any>? = mapOf("code" to code, "msg" to msg)
            override fun toJSON(): JSONObject = JSONObject().put("code", code).put("msg", msg ?: "")
        }
        callback.onSuccess(result, "")
    }
}

class WebsocketCloseMethod : AbsCloseMethodIDL() {
    override fun handle(
        params: AbsCloseMethodIDL.IDLMethodCloseInputModel,
        callback: CompletionBlock<AbsCloseMethodIDL.IDLMethodCloseResultModel>,
        type: BridgePlatformType,
    ) {
        WebsocketManager.close(params.socketId, params.code?.toInt(), params.reason)
        val result = object : AbsCloseMethodIDL.IDLMethodCloseResultModel {
            override var code: Number? = OK
            override var msg: String? = "ok"
            override fun convert(): Map<String, Any>? = mapOf("code" to OK, "msg" to "ok")
            override fun toJSON(): JSONObject = JSONObject().put("code", OK).put("msg", "ok")
        }
        callback.onSuccess(result, "")
    }
}
