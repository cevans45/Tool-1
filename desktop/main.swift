import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var server: Process?
    var port = 18767
    var root = ""

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow()
        guard let resolved = wwwRoot() else {
            fail("Could not find sigil-reactive.html. Keep Sigil Pulse.app in the desktop folder of this project.")
            return
        }
        root = resolved
        port = preferredPort()
        startServer(root: root, port: port)

        DispatchQueue.global(qos: .userInitiated).async {
            let ready = self.waitUntilReady()
            DispatchQueue.main.async {
                if !ready {
                    self.fail("Pulse did not become reachable at http://127.0.0.1:\(self.port)/sigil-reactive.html\n\nServing:\n\(self.root)")
                    return
                }
                // Scripts and styles are cached separately from the page, so drop the whole
                // HTTP cache or an edited page can keep running last session's code.
                let caches: Set<String> = [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache]
                WKWebsiteDataStore.default().removeData(ofTypes: caches, modifiedSince: .distantPast) {
                    self.webView.load(URLRequest(url: self.pulseURL(), cachePolicy: .reloadIgnoringLocalAndRemoteCacheData))
                }
            }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        server?.terminate()
        server = nil
    }

    @available(macOS 12.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }

    private func pulseURL() -> URL {
        URL(string: "http://127.0.0.1:\(port)/sigil-reactive.html?app=webkit")!
    }

    private func buildWindow() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.preferences.setValue(true, forKey: "acceleratedCompositingEnabled")
        let webpage = WKWebpagePreferences()
        webpage.allowsContentJavaScript = true
        config.defaultWebpagePreferences = webpage

        let view = WKWebView(frame: .zero, configuration: config)
        view.uiDelegate = self
        view.navigationDelegate = self
        view.allowsMagnification = false
        view.allowsBackForwardNavigationGestures = false
        view.setValue(false, forKey: "drawsBackground")
        webView = view

        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: min(1440, screen.width - 40), height: min(900, screen.height - 40))
        let rect = NSRect(
            x: screen.midX - size.width / 2,
            y: screen.midY - size.height / 2,
            width: size.width,
            height: size.height
        )
        let win = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        win.title = "Sigil Pulse"
        win.contentView = view
        win.minSize = NSSize(width: 800, height: 500)
        win.makeKeyAndOrderFront(nil)
        window = win
        NSApp.activate(ignoringOtherApps: true)
    }

    private func fail(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Could not start Sigil Pulse"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func hasPulse(at dir: String) -> Bool {
        FileManager.default.fileExists(atPath: (dir as NSString).appendingPathComponent("sigil-reactive.html"))
    }

    private func wwwRoot() -> String? {
        if let baked = Bundle.main.object(forInfoDictionaryKey: "PulseRootPath") as? String,
           hasPulse(at: baked) {
            return baked
        }
        let bundle = Bundle.main.bundleURL
        let repo = bundle.deletingLastPathComponent().deletingLastPathComponent()
        if hasPulse(at: repo.path) { return repo.path }
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("www"),
           hasPulse(at: bundled.path) {
            return bundled.path
        }
        return nil
    }

    private func pythonExecutable() -> String? {
        var candidates: [String] = []
        if let baked = Bundle.main.object(forInfoDictionaryKey: "PulsePythonPath") as? String {
            candidates.append(baked)
        }
        candidates.append(contentsOf: [
            "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3",
            "/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
            "/usr/local/bin/python3",
            "/opt/homebrew/bin/python3",
            "/usr/bin/python3"
        ])
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    private func preferredPort() -> Int {
        let probe = URL(string: "http://127.0.0.1:18767/sigil-reactive.html")!
        let status = httpStatus(probe)
        if status == 200 { return 18767 }
        if status == nil { return 18767 }
        return freePort()
    }

    private func freePort() -> Int {
        guard let py = pythonExecutable() else { return 18767 }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: py)
        task.arguments = [
            "-c",
            "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()"
        ]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = Pipe()
        do {
            try task.run()
            task.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            if let text = String(data: data, encoding: .utf8),
               let value = Int(text.trimmingCharacters(in: .whitespacesAndNewlines)),
               value > 0 {
                return value
            }
        } catch {}
        return 18767
    }

    private func httpStatus(_ url: URL) -> Int? {
        var status: Int?
        let sem = DispatchSemaphore(value: 0)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 0.4)
        request.httpMethod = "GET"
        URLSession.shared.dataTask(with: request) { _, response, _ in
            status = (response as? HTTPURLResponse)?.statusCode
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 0.5)
        return status
    }

    private func waitUntilReady() -> Bool {
        let url = URL(string: "http://127.0.0.1:\(port)/sigil-reactive.html")!
        let deadline = Date().addingTimeInterval(8)
        while Date() < deadline {
            if httpStatus(url) == 200 { return true }
            Thread.sleep(forTimeInterval: 0.05)
        }
        return false
    }

    private func startServer(root: String, port: Int) {
        if httpStatus(URL(string: "http://127.0.0.1:\(port)/sigil-reactive.html")!) == 200 {
            return
        }
        guard let py = pythonExecutable() else {
            fail("Python 3 was not found. Install Python 3, then open the app again.")
            return
        }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: py)
        task.currentDirectoryURL = URL(fileURLWithPath: root)
        task.arguments = [
            "-m", "http.server", "\(port)",
            "--bind", "127.0.0.1"
        ]
        task.standardOutput = Pipe()
        task.standardError = Pipe()
        do {
            try task.run()
            server = task
        } catch {
            fail(error.localizedDescription)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)

let menubar = NSMenu()
let appMenuItem = NSMenuItem()
menubar.addItem(appMenuItem)
let appMenu = NSMenu()
appMenu.addItem(withTitle: "Quit Sigil Pulse", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
appMenuItem.submenu = appMenu
app.mainMenu = menubar

app.run()
