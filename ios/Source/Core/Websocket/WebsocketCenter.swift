// UNVERIFIED — needs Xcode 16+ compile + on-device test.
// The sparkling-method-cli 2.0.1 codegen emits empty Swift IDL stubs
// (the `@objc public var :` placeholders), so this is hand-written
// against the SparklingMethod framework's PipeMethod pattern and the
// service registration used by Sparkling_Router (see the app's
// MethodServices/SPKServiceRegistrar.swift). Iterate on a Mac.

import Foundation
import SparklingMethod
import Sparkling  // provides the JS event emitter bridge

/// Routes native URLSessionWebSocket events to JS via the pipe event bus
/// (JS subscribes with pipe.on("Websocket.event", …)).
final class WebsocketCenter {
    static let shared = WebsocketCenter()
    private var sockets: [String: URLSessionWebSocketTask] = [:]
    private let queue = DispatchQueue(label: "dollhouse.websocket")
    private var emit: ((String, [String: Any]) -> Void)?

    func bindEmitter(_ pipe: Any?) {
        // UNVERIFIED: obtain the GlobalEventEmitter from the Sparkling bridge.
        // In the running app this is the same emitter that powers pipe.on().
        // Wire it here once autolink + the Sparkling SDK API are confirmed.
    }

    private func send(_ socketId: String, _ event: String, _ extra: [String: Any] = [:]) {
        var payload: [String: Any] = ["socketId": socketId, "event": event]
        extra.forEach { payload[$0.key] = $0.value }
        emit?(socketId, payload)
    }

    func connect(url: String, protocols: [String]) -> String {
        let socketId = UUID().uuidString
        var request = URLRequest(url: URL(string: url)!)
        if !protocols.isEmpty {
            request.setValue(protocols.joined(separator: ","), forHTTPHeaderField: "Sec-WebSocket-Protocol")
        }
        let task = URLSession.shared.webSocketTask(with: request)
        sockets[socketId] = task
        receive(socketId, task)
        task.resume()
        // 'open' is inferred on first message receipt; emit explicitly:
        send(socketId, "open")
        return socketId
    }

    private func receive(_ socketId: String, _ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let msg):
                switch msg {
                case .string(let text): self.send(socketId, "message", ["data": text])
                case .data(let d): self.send(socketId, "message", ["data": String(data: d, encoding: .utf8) ?? ""])
                @unknown default: break
                }
                self.receive(socketId, task)  // keep listening
            case .failure(let err):
                self.sockets.removeValue(forKey: socketId)
                self.send(socketId, "error", ["reason": err.localizedDescription])
                self.send(socketId, "close", ["code": 1006, "reason": err.localizedDescription])
            }
        }
    }

    func send(_ socketId: String, data: String) -> Bool {
        guard let task = sockets[socketId] else { return false }
        task.send(.string(data)) { _ in }
        return true
    }

    func close(_ socketId: String, code: Int?, reason: String?) {
        sockets.removeValue(forKey: socketId)?.cancel(with: .goingAway, reason: nil)
        send(socketId, "close", ["code": code ?? 1000, "reason": reason ?? ""])
    }
}

// UNVERIFIED: register these as Sparkling methods (autolink generates the
// registration scaffolding from module.config.json; mirror the pattern in
// the app's generated SparklingAutolink.swift + SPKServiceRegistrar.swift).
final class WebsocketConnectMethod: NSObject, PipeMethod {
    var methodName: String { "Websocket.connect" }
    func execute(params: Any?, callback: Any?) {
        // parse {url, protocols} → WebsocketCenter.shared.connect → callback(code/msg/data.socketId)
    }
}
