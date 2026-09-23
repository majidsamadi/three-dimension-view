// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "PhoneScanner",
    platforms: [.iOS(.v15)],
    products: [.library(name: "PhoneScanner", targets: ["PhoneScannerPlugin"])],
    dependencies: [.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")],
    targets: [.target(name: "PhoneScannerPlugin", dependencies: [.product(name: "Capacitor", package: "capacitor-swift-pm"), .product(name: "Cordova", package: "capacitor-swift-pm")], path: "ios/Sources/PhoneScannerPlugin", linkerSettings: [.linkedFramework("ARKit"), .linkedFramework("SceneKit"), .linkedFramework("AVFoundation")])]
)
