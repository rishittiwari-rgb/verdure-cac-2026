import XCTest

/// Tests that talk to the local Firebase emulators (`./run-all.command`) call this first and
/// skip themselves, with the reason recorded, when nothing listens on 127.0.0.1:8899 — for
/// example on a CI runner that has no emulator stack. Reachability is decided once per process.
enum LocalStack {
    private static let reachable: Bool = {
        guard let url = URL(string: "http://127.0.0.1:8899/") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 3
        let done = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            ok = (response as? HTTPURLResponse) != nil
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 4)
        return ok
    }()

    static func require(file: StaticString = #filePath, line: UInt = #line) throws {
        if !reachable {
            throw XCTSkip("Needs the local Firebase emulators on 127.0.0.1:8899 (start them with ./run-all.command).", file: file, line: line)
        }
    }
}
