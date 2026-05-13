import { registerPlugin } from "@capacitor/core";
import { CapacitorBarcodeScanner } from "@capacitor/barcode-scanner";

const MeterRectiScanner = registerPlugin("MeterRectiScanner");

window.MeterRectiScanner = MeterRectiScanner;
window.NativeBarcodeScanner = MeterRectiScanner;
window.CapacitorBarcodeScannerFallback = CapacitorBarcodeScanner;
