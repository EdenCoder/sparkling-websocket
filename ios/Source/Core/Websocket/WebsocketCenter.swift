// Native WebSocket Sparkling Method — iOS (URLSessionWebSocketTask).
// Mirrors the Android OkHttp implementation (WebsocketMethods.kt): same
// method names (Websocket.connect/send/close), same event stream
// (Websocket.event via the LynxView GlobalEventEmitter), same payload
// shape ({socketId, event, data?, binary?, code?, reason?}) with binary
// frames base64-encoded for the JS polyfill to decode.

import Foundation
import SparklingMethod
import Lynx

private let kWebsocketEvent = "Websocket.event"

/// Each socket sends events through the emitter supplied by its owning runtime or view.
@available(iOS 13.0, *)
public final class WebsocketCenter: NSObject, URLSessionWebSocketDelegate {
    public static let shared = WebsocketCenter()

    private let lock = NSLock()
    private var sockets: [String: URLSessionWebSocketTask] = [:]
    private var emitters: [String: ([String: Any]) -> Void] = [:]

    private lazy var session = URLSession(
        configuration: .default,
        delegate: self,
        delegateQueue: nil
    )

    private func emit(_ socketId: String, _ event: String, _ extra: [String: Any] = [:]) {
        lock.lock()
        let emitter = emitters[socketId]
        lock.unlock()
        guard let emitter else { return }
        var payload: [String: Any] = ["socketId": socketId, "event": event]
        extra.forEach { payload[$0.key] = $0.value }
        emitter(payload)
    }

    public func connect(url: String, protocols: [String], emitter: @escaping ([String: Any]) -> Void) -> String? {
        guard let target = URL(string: url) else { return nil }
        let socketId = UUID().uuidString
        var request = URLRequest(url: target)
        if !protocols.isEmpty {
            request.setValue(protocols.joined(separator: ", "), forHTTPHeaderField: "Sec-WebSocket-Protocol")
        }
        let task = session.webSocketTask(with: request)
        task.taskDescription = socketId
        lock.lock()
        sockets[socketId] = task
        emitters[socketId] = emitter
        lock.unlock()
        receive(socketId, task)
        task.resume()
        return socketId
    }

    private func receive(_ socketId: String, _ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.emit(socketId, "message", ["data": text])
                case .data(let bytes):
                    // gzip + compress-json RPC responses arrive as binary;
                    // base64 them for the JS polyfill to decode.
                    self.emit(socketId, "message", ["data": bytes.base64EncodedString(), "binary": true])
                @unknown default:
                    break
                }
                self.receive(socketId, task)
            case .failure:
                // URLSession's completion delegate owns terminal events and cleanup.
                break
            }
        }
    }

    public func send(_ socketId: String, data: String) -> Bool {
        lock.lock()
        let task = sockets[socketId]
        lock.unlock()
        guard let task else { return false }
        task.send(.string(data)) { _ in
            // The completion delegate sends terminal events.
        }
        return true
    }

    public func close(_ socketId: String, code: Int?, reason: String?) {
        lock.lock()
        let task = sockets[socketId]
        lock.unlock()
        let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code ?? 1000) ?? .normalClosure
        task?.cancel(with: closeCode, reason: reason?.data(using: .utf8))
    }

    // MARK: URLSessionWebSocketDelegate

    public func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        guard let socketId = webSocketTask.taskDescription else { return }
        emit(socketId, "open")
    }

    public func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard let task = task as? URLSessionWebSocketTask, let socketId = task.taskDescription else { return }
        lock.lock()
        sockets.removeValue(forKey: socketId)
        let emitter = emitters.removeValue(forKey: socketId)
        lock.unlock()
        guard let emitter else { return }
        let code = task.closeCode == .invalid ? 1006 : task.closeCode.rawValue
        let reason = task.closeReason.flatMap { String(data: $0, encoding: .utf8) } ?? error?.localizedDescription ?? ""
        if code == 1006 {
            emitter(["socketId": socketId, "event": "error", "reason": reason])
        }
        emitter(["socketId": socketId, "event": "close", "code": code, "reason": reason])
    }
}

// MARK: - Param / result models

@objc(WebsocketConnectParamModel)
public class WebsocketConnectParamModel: SPKMethodModel {
    @objc public var url: String?
    @objc public var protocols: [String]?

    public override class func requiredKeyPaths() -> Set<String>? {
        return ["url"]
    }

    public override class func jsonKeyPathsByPropertyKey() -> [AnyHashable: Any] {
        return ["url": "url", "protocols": "protocols"]
    }
}

@objc(WebsocketConnectResultModel)
public class WebsocketConnectResultModel: SPKMethodModel {
    @objc public var socketId: String?

    public override class func jsonKeyPathsByPropertyKey() -> [AnyHashable: Any] {
        return ["socketId": "socketId"]
    }
}

@objc(WebsocketSendParamModel)
public class WebsocketSendParamModel: SPKMethodModel {
    @objc public var socketId: String?
    @objc public var data: String?

    public override class func requiredKeyPaths() -> Set<String>? {
        return ["socketId", "data"]
    }

    public override class func jsonKeyPathsByPropertyKey() -> [AnyHashable: Any] {
        return ["socketId": "socketId", "data": "data"]
    }
}

@objc(WebsocketCloseParamModel)
public class WebsocketCloseParamModel: SPKMethodModel {
    @objc public var socketId: String?
    @objc public var code: NSNumber?
    @objc public var reason: String?

    public override class func requiredKeyPaths() -> Set<String>? {
        return ["socketId"]
    }

    public override class func jsonKeyPathsByPropertyKey() -> [AnyHashable: Any] {
        return ["socketId": "socketId", "code": "code", "reason": "reason"]
    }
}

// MARK: - Pipe methods
//
// Direct PipeMethod subclasses: MethodRegistry.autoRegisterGlobalMethods()
// (called from the app's SPKServiceRegister.registerAll()) registers every
// class whose direct superclass is PipeMethod.

@objc(WebsocketConnectMethod)
public final class WebsocketConnectMethod: PipeMethod {
    public override var methodName: String { "Websocket.connect" }
    public override class func methodName() -> String { "Websocket.connect" }
    @objc public override var paramsModelClass: AnyClass { WebsocketConnectParamModel.self }
    @objc public override var resultModelClass: AnyClass { WebsocketConnectResultModel.self }

    @objc public override func call(withParamModel paramModel: Any, completionHandler: CompletionHandlerProtocol) {
        guard #available(iOS 13.0, *) else {
            completionHandler.handleCompletion(status: .failed(message: "WebSocket requires iOS 13+"), result: nil)
            return
        }
        guard let params = paramModel as? WebsocketConnectParamModel else {
            completionHandler.handleCompletion(status: .invalidParameter(message: "Invalid parameter model type"), result: nil)
            return
        }
        guard let url = params.url, !url.isEmpty else {
            completionHandler.handleCompletion(status: .invalidParameter(message: "url must be a non-empty string"), result: nil)
            return
        }
        // Bind events to the LynxView that called connect — its
        // GlobalEventEmitter is what pipe.on('Websocket.event') hears.
        weak var lynxView = params.context?.pipeContainer as? LynxView
        let socketId = WebsocketCenter.shared.connect(url: url, protocols: params.protocols ?? []) { payload in
            DispatchQueue.main.async {
                lynxView?.sendGlobalEvent(kWebsocketEvent, withParams: [payload])
            }
        }
        guard let socketId else {
            completionHandler.handleCompletion(status: .invalidParameter(message: "invalid url"), result: nil)
            return
        }
        let result = WebsocketConnectResultModel()
        result.socketId = socketId
        completionHandler.handleCompletion(status: .succeeded(), result: result)
    }
}

@objc(WebsocketSendMethod)
public final class WebsocketSendMethod: PipeMethod {
    public override var methodName: String { "Websocket.send" }
    public override class func methodName() -> String { "Websocket.send" }
    @objc public override var paramsModelClass: AnyClass { WebsocketSendParamModel.self }
    @objc public override var resultModelClass: AnyClass { EmptyMethodModelClass.self }

    @objc public override func call(withParamModel paramModel: Any, completionHandler: CompletionHandlerProtocol) {
        guard #available(iOS 13.0, *) else {
            completionHandler.handleCompletion(status: .failed(message: "WebSocket requires iOS 13+"), result: nil)
            return
        }
        guard let params = paramModel as? WebsocketSendParamModel,
              let socketId = params.socketId, let data = params.data else {
            completionHandler.handleCompletion(status: .invalidParameter(message: "socketId and data required"), result: nil)
            return
        }
        if WebsocketCenter.shared.send(socketId, data: data) {
            completionHandler.handleCompletion(status: .succeeded(), result: nil)
        } else {
            completionHandler.handleCompletion(status: .failed(message: "socket not found"), result: nil)
        }
    }
}

@objc(WebsocketCloseMethod)
public final class WebsocketCloseMethod: PipeMethod {
    public override var methodName: String { "Websocket.close" }
    public override class func methodName() -> String { "Websocket.close" }
    @objc public override var paramsModelClass: AnyClass { WebsocketCloseParamModel.self }
    @objc public override var resultModelClass: AnyClass { EmptyMethodModelClass.self }

    @objc public override func call(withParamModel paramModel: Any, completionHandler: CompletionHandlerProtocol) {
        guard #available(iOS 13.0, *) else {
            completionHandler.handleCompletion(status: .failed(message: "WebSocket requires iOS 13+"), result: nil)
            return
        }
        guard let params = paramModel as? WebsocketCloseParamModel, let socketId = params.socketId else {
            completionHandler.handleCompletion(status: .invalidParameter(message: "socketId required"), result: nil)
            return
        }
        WebsocketCenter.shared.close(socketId, code: params.code?.intValue, reason: params.reason)
        completionHandler.handleCompletion(status: .succeeded(), result: nil)
    }
}
