// FrameWaker — sends a Bluetooth wake pulse to a BLOOMIN8 frame so its Wi-Fi
// comes back up, then quits.
//
// Usage: FrameWaker --name <BLE name> --out <result.json> [--timeout <s>]
//
// The Stream Deck app doesn't declare Bluetooth use, so a plugin process it
// launches can't touch CoreBluetooth. This helper is its own app bundle
// (launched with `open`), so macOS asks for Bluetooth permission for it
// instead, once. The result goes to the --out file as {"ok":Bool,"error":..}.
//
// The pulse: find the frame by advertised name, connect, and write 0x01 then
// 0x00 (without response) to characteristic 0xF001.

import CoreBluetooth
import Foundation

let wakeCharacteristic = CBUUID(string: "0000F001-0000-1000-8000-00805F9B34FB")

func argument(_ flag: String) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: flag), index + 1 < args.count else { return nil }
    return args[index + 1]
}

let targetName = argument("--name") ?? ""
let outPath = argument("--out")
let scanTimeout = Double(argument("--timeout") ?? "") ?? 20

func finish(_ ok: Bool, _ error: String? = nil) -> Never {
    var result: [String: Any] = ["ok": ok]
    if let error { result["error"] = error }
    if let outPath, let data = try? JSONSerialization.data(withJSONObject: result) {
        try? data.write(to: URL(fileURLWithPath: outPath))
    }
    exit(ok ? 0 : 1)
}

final class Waker: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    var central: CBCentralManager!
    var peripheral: CBPeripheral?
    var pulsed = false
    var pendingServices = 0

    func start() {
        central = CBCentralManager(delegate: self, queue: .main)
        DispatchQueue.main.asyncAfter(deadline: .now() + scanTimeout) { [weak self] in
            guard let self, self.peripheral == nil else { return }
            finish(false, "Couldn't find '\(targetName)' over Bluetooth")
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn: central.scanForPeripherals(withServices: nil)
        case .unauthorized: finish(false, "Bluetooth permission denied for FrameWaker (System Settings › Privacy & Security › Bluetooth)")
        case .poweredOff: finish(false, "Bluetooth is off")
        case .unsupported: finish(false, "Bluetooth isn't available")
        default: break
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name
        guard let name, name.caseInsensitiveCompare(targetName) == .orderedSame else { return }
        central.stopScan()
        self.peripheral = peripheral
        peripheral.delegate = self
        central.connect(peripheral)
        // Don't hold a half-open link that would block the phone app.
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            if self?.pulsed == false { finish(false, "Found the frame but couldn't connect") }
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices(nil)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        finish(false, "Couldn't connect: \(error?.localizedDescription ?? "unknown error")")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        finish(pulsed, pulsed ? nil : "Frame disconnected before the wake pulse")
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let services = peripheral.services, !services.isEmpty else {
            finish(false, "Frame exposed no Bluetooth services")
        }
        pendingServices = services.count
        services.forEach { peripheral.discoverCharacteristics(nil, for: $0) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        pendingServices -= 1
        guard !pulsed else { return }
        guard let characteristic = service.characteristics?.first(where: { $0.uuid == wakeCharacteristic }) else {
            if pendingServices <= 0 { finish(false, "Frame has no wake characteristic") }
            return
        }
        pulsed = true
        peripheral.writeValue(Data([0x01]), for: characteristic, type: .withoutResponse)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.001) {
            peripheral.writeValue(Data([0x00]), for: characteristic, type: .withoutResponse)
            // Writes without response have no callback; let them reach the air.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                self.central.cancelPeripheralConnection(peripheral)
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { finish(true) }
            }
        }
    }
}

guard !targetName.isEmpty else { finish(false, "No Bluetooth name given") }
let waker = Waker()
waker.start()
dispatchMain()
