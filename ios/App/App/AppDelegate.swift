import Capacitor
import UIKit
import UniformTypeIdentifiers

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ application: UIApplication,
    configurationForConnecting session: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let config = UISceneConfiguration(name: "Default Configuration", sessionRole: session.role)
    config.delegateClass = SceneDelegate.self
    return config
  }
}

@objc(SofaBridgeViewController)
class SofaBridgeViewController: CAPBridgeViewController {
  override func capacitorDidLoad() {
    bridge?.registerPluginInstance(SofaNative())
  }
}

@objc(SofaNative)
class SofaNative: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
  let identifier = "SofaNative"
  let jsName = "SofaNative"
  let pluginMethods = ["pick", "open", "chunk", "close", "release", "reading", "fonts"].map {
    CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
  }

  private struct Reader {
    let url: URL
    var offset: UInt64
  }

  private let queue = DispatchQueue(label: "com.sofazhu.sofa-read.documents", qos: .userInitiated)
  private let chunkSize = 1024 * 1024
  private var readers: [String: Reader] = [:]
  private var pickerCall: CAPPluginCall?

  @objc func pick(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      guard self.pickerCall == nil, let controller = self.bridge?.viewController else {
        call.reject("文件选择器已打开或暂不可用。")
        return
      }
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data], asCopy: false)
      picker.allowsMultipleSelection = call.getBool("multiple") ?? false
      picker.delegate = self
      self.pickerCall = call
      controller.present(picker, animated: true)
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pickerCall?.resolve(["documents": []])
    pickerCall = nil
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    let call = pickerCall
    pickerCall = nil
    queue.async {
      do {
        let references = try urls.map { url -> [String: Any] in
          let access = url.startAccessingSecurityScopedResource()
          defer { if access { url.stopAccessingSecurityScopedResource() } }
          // iOS 的文档提供方会将授权附在书签中，应用只持久化书签数据。
          let bookmark = try url.bookmarkData(options: .minimalBookmark)
          let values = try? url.resourceValues(forKeys: [.fileSizeKey, .nameKey])
          return [
            "name": values?.name ?? url.lastPathComponent,
            "bytes": values?.fileSize ?? 0,
            "reference": bookmark.base64EncodedString(),
            "identity": url.absoluteString
          ]
        }
        call?.resolve(["documents": references])
      } catch {
        call?.reject("无法保留所选文件的读取权限。", nil, error)
      }
    }
  }

  @objc func open(_ call: CAPPluginCall) {
    queue.async {
      do {
        guard let reference = call.getString("reference"),
          let data = Data(base64Encoded: reference) else {
          call.reject("文件引用无效。")
          return
        }
        var stale = false
        let url = try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        let token = UUID().uuidString
        self.readers[token] = Reader(url: url, offset: 0)
        call.resolve(["token": token])
      } catch {
        call.reject("无法打开原文件。", nil, error)
      }
    }
  }

  @objc func chunk(_ call: CAPPluginCall) {
    queue.async {
      guard let token = call.getString("token"), var reader = self.readers[token] else {
        call.reject("文件读取已结束。")
        return
      }
      let access = reader.url.startAccessingSecurityScopedResource()
      defer { if access { reader.url.stopAccessingSecurityScopedResource() } }
      var coordinatorError: NSError?
      var readError: Error?
      var data = Data()
      NSFileCoordinator().coordinate(readingItemAt: reader.url, options: [], error: &coordinatorError) { url in
        do {
          let file = try FileHandle(forReadingFrom: url)
          defer { try? file.close() }
          try file.seek(toOffset: reader.offset)
          data = try file.read(upToCount: self.chunkSize) ?? Data()
        } catch {
          readError = error
        }
      }
      if let error = coordinatorError as Error? ?? readError {
        call.reject("读取文件失败。", nil, error)
        return
      }
      reader.offset += UInt64(data.count)
      self.readers[token] = reader
      call.resolve(["data": data.base64EncodedString(), "done": data.count < self.chunkSize])
    }
  }

  @objc func close(_ call: CAPPluginCall) {
    queue.async {
      if let token = call.getString("token") { self.readers.removeValue(forKey: token) }
      call.resolve()
    }
  }

  @objc func release(_ call: CAPPluginCall) {
    // iOS 的持久授权随书签保存，书架删除书签即可。
    call.resolve()
  }

  @objc func reading(_ call: CAPPluginCall) {
    let awake = call.getBool("awake") ?? false
    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = awake
      call.resolve(["volume": false])
    }
  }

  @objc func fonts(_ call: CAPPluginCall) {
    DispatchQueue.main.async { call.resolve(["families": UIFont.familyNames]) }
  }
}
